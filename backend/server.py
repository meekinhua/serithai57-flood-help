"""Flood mutual-aid board for บ้านสหกรณ์เคหะสถาน 4 (ซ.เสรีไทย 57).

Residents never log in: in an emergency anyone must be able to post within seconds.
The poster gets an edit key (kept in their browser) to delete their own post;
anyone can move a post to "helping"/"done", and every change is logged.

Admins (village committee) log in with email/password (session cookie) to
moderate posts, pin important ones, and publish announcements.
"""
import asyncio
import hashlib
import hmac
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator

# Load .env BEFORE importing our own modules: they read settings (e.g. WEATHER_PROVIDERS) at import time.
load_dotenv(Path(__file__).parent / ".env")

import canal  # noqa: E402
import media  # noqa: E402
import services  # noqa: E402
import staff  # noqa: E402
import trips  # noqa: E402
import zonelog  # noqa: E402
import ops  # noqa: E402
import repair  # noqa: E402
import team  # noqa: E402
import weather  # noqa: E402

# tz_aware so datetimes go out as "+00:00" and browsers don't misread them as local time
client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Flood Help API", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None)
api = APIRouter(prefix="/api")

Kind = Literal["need", "offer", "info"]
Status = Literal["open", "helping", "done"]
# need: "paid" = willing to pay for help; offer: "paid" = hired service. The app never handles money.
Payment = Literal["free", "paid"]
AnnouncementLevel = Literal["info", "warning", "danger"]

CATEGORIES = {
    "need": ["evacuate", "medical", "vulnerable", "food", "medicine", "power", "move_items", "pets", "other"],
    "offer": ["boat", "truck", "food", "shelter", "parking", "labor", "power", "other"],
    "info": ["road_ok", "road_partial", "road_blocked", "danger", "shelter_point", "supply_point", "other"],
}

# Water levels 0..6: ไม่ท่วม, ตาตุ่ม, ครึ่งแข้ง, เข่า, ต้นขา (60-70 ซม.), เอว, อกขึ้นไป
WATER_MAX_LEVEL = 6
WATER_SCALE_VERSION = 2  # v1 had no ต้นขา step: old 4 (เอว) -> 5, old 5 (อก) -> 6

# Loose box around eastern Bangkok: rejects obviously wrong coordinates, not a geofence.
LAT_RANGE = (13.60, 14.00)
LNG_RANGE = (100.45, 100.90)

HIDDEN = {"_id": 0, "edit_key_hash": 0}
# A viewer counts as online if their page pinged within this window (pages ping every 20 s while visible).
ONLINE_WINDOW_S = 60
SESSION_COOKIE = "admin_session"
SESSION_DAYS = 7


def now():
    return datetime.now(timezone.utc)


def public_post(p: dict) -> dict:
    """Post as shown to everyone: phone replaced by has_phone (see /posts/{id}/contact)."""
    out = {k: v for k, v in p.items() if k not in ("phone", "_id", "edit_key_hash")}
    out["has_phone"] = bool(p.get("phone"))
    return out


def level_from_cm(cm: int) -> int:
    """Measured depth -> body level (ไม่ท่วม, ตาตุ่ม, ครึ่งแข้ง, เข่า, ต้นขา, เอว, อก+)."""
    for level, upper in enumerate((0, 15, 35, 55, 75, 99)):
        if cm <= upper:
            return level
    return 6


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def hash_password(password: str, salt: Optional[bytes] = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, digest_hex = stored.split("$")
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, bytes.fromhex(salt_hex)).split("$")[2], digest_hex)


# ---- tiny in-memory rate limit (single uvicorn worker on the pod) ----
_hits: dict[str, deque] = defaultdict(deque)


def client_ip(request: Request) -> str:
    # Behind the platform ingress every request comes from the proxy, so use the forwarded client IP.
    return (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()


def rate_limit(request: Request, bucket: str, limit: int, window_s: int):
    q = _hits[f"{bucket}:{client_ip(request)}"]
    t = time.monotonic()
    while q and t - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "ส่งถี่เกินไป กรุณารอสักครู่")
    q.append(t)


# ---------------- models ----------------
class Located(BaseModel):
    lat: float
    lng: float

    @field_validator("lat")
    @classmethod
    def _lat(cls, v):
        if not LAT_RANGE[0] <= v <= LAT_RANGE[1]:
            raise ValueError("ตำแหน่งอยู่นอกพื้นที่")
        return v

    @field_validator("lng")
    @classmethod
    def _lng(cls, v):
        if not LNG_RANGE[0] <= v <= LNG_RANGE[1]:
            raise ValueError("ตำแหน่งอยู่นอกพื้นที่")
        return v


class PostCreate(Located):
    kind: Kind
    category: str
    detail: str = Field(min_length=1, max_length=1000)
    place: str = Field("", max_length=200)  # บ้านเลขที่ / ซอย / จุดสังเกต
    name: str = Field(min_length=1, max_length=80)
    phone: str = Field("", max_length=40)
    people: Optional[int] = Field(None, ge=0, le=500)
    urgent: bool = False
    general: bool = False  # village-wide info/offer with no specific spot (not allowed for requests)
    pin_confirmed: bool = False  # the user moved the map / used GPS, so lat/lng is really their spot
    payment: Payment = "free"
    price: str = Field("", max_length=100)  # free text, e.g. "300 บาท" / "100 บาท/เที่ยว"
    media_ids: list[str] = Field(default_factory=list, max_length=4)  # uploaded via /api/media


class StatusUpdate(BaseModel):
    status: Status
    name: str = Field(min_length=1, max_length=80)
    note: str = Field("", max_length=300)


class WaterCreate(Located):
    level: Optional[int] = Field(None, ge=0, le=WATER_MAX_LEVEL)
    cm: Optional[int] = Field(None, ge=0, le=300)  # measured depth; when given it decides the level
    trend: Optional[Literal["up", "steady", "down"]] = None
    where: Optional[Literal["street", "house"]] = None
    note: str = Field("", max_length=200)
    name: str = Field("", max_length=80)
    media_ids: list[str] = Field(default_factory=list, max_length=1)  # one photo of the water


class PresenceBody(BaseModel):
    # Random per-browser id generated by the page; not linked to any person.
    id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class KeyLoginBody(BaseModel):
    key: str = Field(min_length=1, max_length=200)


class AdminCreate(BaseModel):
    email: str = Field(min_length=3, max_length=120, pattern=r"^[^@\s]+@[^@\s]+$")
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=8, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


class AnnouncementCreate(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    level: AnnouncementLevel = "warning"
    expires_hours: Optional[int] = Field(None, ge=1, le=24 * 30)  # None = until turned off


class AnnouncementUpdate(BaseModel):
    active: Optional[bool] = None
    text: Optional[str] = Field(None, min_length=1, max_length=500)
    level: Optional[AnnouncementLevel] = None


class PostAdminUpdate(BaseModel):
    kind: Optional[Kind] = None
    category: Optional[str] = None
    urgent: Optional[bool] = None


class PinBody(BaseModel):
    pinned: bool


# ---------------- admin auth ----------------
def public_admin(a: dict) -> dict:
    return {"id": a["id"], "email": a["email"], "name": a["name"], "role": a.get("role", "admin"), "importer": bool(a.get("importer")), "team": a.get("team", ""), "created_at": a.get("created_at")}


async def current_admin(request: Request) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    session = await db.sessions.find_one({"token_hash": hash_key(token), "expires_at": {"$gt": now()}})
    if not session:
        return None
    return await db.admins.find_one({"id": session["admin_id"]}, {"_id": 0})


async def require_admin(request: Request) -> dict:
    admin = await current_admin(request)
    if not admin:
        raise HTTPException(401, "ต้องเข้าสู่ระบบผู้ดูแล")
    if admin.get("role", "admin") != "admin":  # staff accounts can't use admin tools
        raise HTTPException(403, "สำหรับผู้ดูแลเท่านั้น")
    return admin


async def audit(admin: dict, action: str, target: str = "", detail: str = ""):
    await db.audit.insert_one(
        {"id": str(uuid.uuid4()), "at": now(), "admin_id": admin["id"], "admin_name": admin["name"], "action": action, "target": target, "detail": detail[:300]}
    )


async def start_session(admin: dict, request: Request, response: Response) -> dict:
    token = secrets.token_urlsafe(32)
    await db.sessions.insert_one({"token_hash": hash_key(token), "admin_id": admin["id"], "created_at": now(), "expires_at": now() + timedelta(days=SESSION_DAYS)})
    secure = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax", secure=secure, path="/")
    return public_admin(admin)


@api.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response):
    rate_limit(request, "login", limit=10, window_s=600)
    admin = await db.admins.find_one({"email": body.email.strip().lower()}, {"_id": 0})
    if not admin or not verify_password(body.password, admin["password_hash"]):
        raise HTTPException(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
    return await start_session(admin, request, response)


@api.post("/auth/key")
async def login_with_key(body: KeyLoginBody, request: Request, response: Response):
    """Quick admin entry via a secret link (/admin#key=...). Logs in as the seeded admin.
    Anyone holding the link is an admin: rotate ADMIN_URL_KEY in backend/.env if it leaks."""
    rate_limit(request, "login", limit=10, window_s=600)
    expected = os.environ.get("ADMIN_URL_KEY", "")
    if len(expected) < 16 or not hmac.compare_digest(body.key, expected):
        raise HTTPException(401, "ลิงก์ผู้ดูแลไม่ถูกต้อง")
    admin = await db.admins.find_one({"email": os.environ.get("ADMIN_EMAIL", "").strip().lower()}, {"_id": 0})
    if not admin:
        raise HTTPException(500, "ยังไม่ได้ตั้งค่าผู้ดูแลหลัก (ADMIN_EMAIL)")
    return await start_session(admin, request, response)


@api.post("/auth/logout", status_code=204)
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.sessions.delete_one({"token_hash": hash_key(token)})
    response.delete_cookie(SESSION_COOKIE, path="/")


@api.get("/auth/me")
async def me(request: Request):
    admin = await current_admin(request)
    if not admin:
        raise HTTPException(401, "ยังไม่ได้เข้าสู่ระบบ")
    return public_admin(admin)


@api.post("/auth/password", status_code=204)
async def change_password(body: PasswordChange, admin: dict = Depends(require_admin)):
    if not verify_password(body.current_password, admin["password_hash"]):
        raise HTTPException(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
    await db.admins.update_one({"id": admin["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await audit(admin, "change_password", admin["email"])


# ---------------- public ----------------
@api.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/meta")
async def meta():
    return {"categories": CATEGORIES, "water_max_level": WATER_MAX_LEVEL}


async def online_count() -> int:
    return await db.presence.count_documents({"last_seen": {"$gt": now() - timedelta(seconds=ONLINE_WINDOW_S)}})


@api.post("/presence")
async def presence_ping(body: PresenceBody):
    await db.presence.update_one({"_id": body.id}, {"$set": {"last_seen": now()}}, upsert=True)
    return {"online": await online_count()}


@api.post("/presence/leave", status_code=204)
async def presence_leave(body: PresenceBody):
    await db.presence.delete_one({"_id": body.id})


@api.get("/presence")
async def presence_count():
    return {"online": await online_count()}


@api.get("/announcements")
async def list_announcements():
    q = {"active": True, "$or": [{"expires_at": None}, {"expires_at": {"$gt": now()}}]}
    items = await db.announcements.find(q, {"_id": 0}).sort("created_at", -1).to_list(20)
    order = {"danger": 0, "warning": 1, "info": 2}
    return sorted(items, key=lambda a: order[a["level"]])  # stable: newest first within a level


@api.get("/posts")
async def list_posts(
    kind: Optional[Kind] = None,
    payment: Optional[Payment] = None,
    include_done: bool = False,
    since_hours: int = Query(24 * 14, ge=1, le=24 * 60),
):
    q: dict = {"created_at": {"$gte": now() - timedelta(hours=since_hours)}}
    if kind:
        q["kind"] = kind
    if payment == "paid":
        q["payment"] = "paid"
    elif payment == "free":
        q["payment"] = {"$ne": "paid"}  # posts from before this field existed count as free
    if not include_done:
        q["status"] = {"$ne": "done"}
    cursor = db.posts.find(q, HIDDEN).sort([("pinned", -1), ("urgent", -1), ("created_at", -1)])
    return [public_post(p) for p in await cursor.to_list(1000)]


@api.get("/posts/{post_id}/contact")
async def post_contact(post_id: str, request: Request):
    """Phone numbers are shown one post at a time, so nobody can harvest every household's number
    (and who lives alone) from the list in one request."""
    rate_limit(request, "contact", limit=40, window_s=600)
    doc = await db.posts.find_one({"id": post_id}, {"_id": 0, "phone": 1})
    if not doc:
        raise HTTPException(404, "ไม่พบรายการ")
    return {"phone": doc.get("phone", "")}


@api.post("/posts", status_code=201)
async def create_post(body: PostCreate, request: Request):
    rate_limit(request, "post", limit=15, window_s=600)
    if body.category not in CATEGORIES[body.kind]:
        raise HTTPException(422, "หมวดหมู่ไม่ถูกต้อง")
    edit_key = secrets.token_urlsafe(18)
    t = now()
    post_id = str(uuid.uuid4())
    house = staff.house_of(body.place) or staff.house_of(body.detail)
    soi = staff.soi_of(f"{body.place} {body.detail}")
    if house and body.pin_confirmed and not body.general:
        await learn_address(house, soi=soi, lat=body.lat, lng=body.lng, source="resident", by=body.name)  # residents build the address book
    attachments = await claim_media(body.media_ids, f"post:{post_id}", {"image", "video"})
    doc = {
        "id": post_id,
        **body.model_dump(exclude={"media_ids", "pin_confirmed"}),
        "media": attachments,
        "urgent": body.urgent and body.kind == "need",
        "general": body.general and body.kind != "need",
        "house": house,
        "soi": soi,
        "precision": "house" if body.pin_confirmed else "unconfirmed",
        "assignee": None,
        "payment": "free" if body.kind == "info" else body.payment,
        "price": body.price.strip() if body.kind != "info" and body.payment == "paid" else "",
        "pinned": False,
        "status": "open",
        "created_at": t,
        "updated_at": t,
        "history": [{"at": t, "status": "open", "name": body.name, "note": "สร้างรายการ"}],
        "edit_key_hash": hash_key(edit_key),
    }
    await db.posts.insert_one(dict(doc))
    return {**public_post(doc), "edit_key": edit_key}


@api.post("/posts/{post_id}/status")
async def update_status(post_id: str, body: StatusUpdate, request: Request):
    rate_limit(request, "status", limit=60, window_s=600)
    admin = await current_admin(request)
    t = now()
    entry = {"at": t, "status": body.status, "name": body.name, "note": body.note, "admin": bool(admin)}
    doc = await db.posts.find_one_and_update(
        {"id": post_id},
        {"$set": {"status": body.status, "updated_at": t}, "$push": {"history": entry}},
        projection=HIDDEN,
        return_document=True,
    )
    if not doc:
        raise HTTPException(404, "ไม่พบรายการ")
    if admin:
        await audit(admin, "post_status", post_id, body.status)
    return public_post(doc)


@api.delete("/posts/{post_id}", status_code=204)
async def delete_post(post_id: str, x_edit_key: str = Header(...)):
    post = await db.posts.find_one_and_delete({"id": post_id, "edit_key_hash": hash_key(x_edit_key)})
    if not post:
        raise HTTPException(403, "ลบได้เฉพาะผู้โพสต์ (จากเครื่องที่โพสต์)")
    await delete_media([m["id"] for m in post.get("media", [])])


@api.get("/water")
async def list_water(since_hours: int = Query(48, ge=1, le=24 * 30)):
    q = {"created_at": {"$gte": now() - timedelta(hours=since_hours)}}
    return await db.water.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api.post("/water", status_code=201)
async def create_water(body: WaterCreate, request: Request):
    rate_limit(request, "water", limit=30, window_s=600)
    level = level_from_cm(body.cm) if body.cm is not None else body.level
    if level is None:
        raise HTTPException(422, "กรุณาเลือกระดับน้ำหรือใส่ความสูงเป็นเซนติเมตร")
    water_id = str(uuid.uuid4())
    attachments = await claim_media(body.media_ids, f"water:{water_id}", {"image"})
    doc = {"id": water_id, **body.model_dump(exclude={"media_ids"}), "level": level, "media": attachments, "v": WATER_SCALE_VERSION, "created_at": now()}
    await db.water.insert_one(dict(doc))
    return doc


# ---------------- admin ----------------
@api.delete("/admin/posts/{post_id}", status_code=204)
async def admin_delete_post(post_id: str, admin: dict = Depends(require_admin)):
    post = await db.posts.find_one_and_delete({"id": post_id})
    if not post:
        raise HTTPException(404, "ไม่พบรายการ")
    await delete_media([m["id"] for m in post.get("media", [])])
    await audit(admin, "delete_post", post_id, f"{post['kind']}/{post['category']}: {post['detail']}")


@api.post("/admin/posts/{post_id}/pin")
async def admin_pin_post(post_id: str, body: PinBody, admin: dict = Depends(require_admin)):
    doc = await db.posts.find_one_and_update({"id": post_id}, {"$set": {"pinned": body.pinned}}, projection=HIDDEN, return_document=True)
    if not doc:
        raise HTTPException(404, "ไม่พบรายการ")
    await audit(admin, "pin_post" if body.pinned else "unpin_post", post_id, doc["detail"])
    return public_post(doc)


@api.patch("/admin/posts/{post_id}")
async def admin_update_post(post_id: str, body: PostAdminUpdate, admin: dict = Depends(require_admin)):
    """Fix posts filed under the wrong type, e.g. a bedridden resident posted as 'info'."""
    post = await db.posts.find_one({"id": post_id})
    if not post:
        raise HTTPException(404, "ไม่พบรายการ")
    kind = body.kind or post["kind"]
    category = body.category or (post["category"] if post["category"] in CATEGORIES[kind] else "other")
    if category not in CATEGORIES[kind]:
        raise HTTPException(422, "หมวดหมู่ไม่ตรงกับประเภท")
    urgent = body.urgent if body.urgent is not None else post.get("urgent", False)
    changes = {"kind": kind, "category": category, "urgent": urgent and kind == "need", "updated_at": now()}
    if kind == "need":
        changes["general"] = False
    note = f"ผู้ดูแลแก้ประเภทเป็น {kind}/{category}" + (" (ด่วน)" if changes["urgent"] else "")
    doc = await db.posts.find_one_and_update(
        {"id": post_id},
        {"$set": changes, "$push": {"history": {"at": now(), "status": post["status"], "name": admin["name"], "note": note, "admin": True}}},
        projection=HIDDEN,
        return_document=True,
    )
    await audit(admin, "update_post", post_id, f"{post['kind']}/{post['category']} -> {kind}/{category} urgent={changes['urgent']}")
    return public_post(doc)


@api.delete("/admin/water/{water_id}", status_code=204)
async def admin_delete_water(water_id: str, admin: dict = Depends(require_admin)):
    doc = await db.water.find_one_and_delete({"id": water_id})
    if not doc:
        raise HTTPException(404, "ไม่พบรายงาน")
    await delete_media([m["id"] for m in doc.get("media", [])])
    await audit(admin, "delete_water", water_id, f"level {doc['level']} {doc.get('note', '')}")


@api.get("/admin/announcements")
async def admin_list_announcements(admin: dict = Depends(require_admin)):
    return await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api.post("/admin/announcements", status_code=201)
async def admin_create_announcement(body: AnnouncementCreate, admin: dict = Depends(require_admin)):
    t = now()
    doc = {
        "id": str(uuid.uuid4()),
        "text": body.text.strip(),
        "level": body.level,
        "active": True,
        "created_at": t,
        "expires_at": t + timedelta(hours=body.expires_hours) if body.expires_hours else None,
        "created_by": admin["name"],
    }
    await db.announcements.insert_one(dict(doc))
    await audit(admin, "create_announcement", doc["id"], doc["text"])
    return doc


@api.patch("/admin/announcements/{ann_id}")
async def admin_update_announcement(ann_id: str, body: AnnouncementUpdate, admin: dict = Depends(require_admin)):
    changes = {k: v for k, v in body.model_dump().items() if v is not None}
    if not changes:
        raise HTTPException(422, "ไม่มีข้อมูลที่จะแก้ไข")
    doc = await db.announcements.find_one_and_update({"id": ann_id}, {"$set": changes}, projection={"_id": 0}, return_document=True)
    if not doc:
        raise HTTPException(404, "ไม่พบประกาศ")
    await audit(admin, "update_announcement", ann_id, str(changes))
    return doc


@api.delete("/admin/announcements/{ann_id}", status_code=204)
async def admin_delete_announcement(ann_id: str, admin: dict = Depends(require_admin)):
    doc = await db.announcements.find_one_and_delete({"id": ann_id})
    if not doc:
        raise HTTPException(404, "ไม่พบประกาศ")
    await audit(admin, "delete_announcement", ann_id, doc["text"])


@api.get("/admin/admins")
async def admin_list_admins(admin: dict = Depends(require_admin)):
    return [public_admin(a) for a in await db.admins.find({}, {"_id": 0}).sort("created_at", 1).to_list(100)]


@api.post("/admin/admins", status_code=201)
async def admin_create_admin(body: AdminCreate, admin: dict = Depends(require_admin)):
    email = body.email.strip().lower()
    if await db.admins.find_one({"email": email}):
        raise HTTPException(409, "มีผู้ดูแลอีเมลนี้แล้ว")
    doc = {"id": str(uuid.uuid4()), "email": email, "name": body.name.strip(), "password_hash": hash_password(body.password), "created_at": now(), "created_by": admin["name"]}
    await db.admins.insert_one(dict(doc))
    await audit(admin, "create_admin", email)
    return public_admin(doc)


@api.delete("/admin/admins/{admin_id}", status_code=204)
async def admin_delete_admin(admin_id: str, admin: dict = Depends(require_admin)):
    if admin_id == admin["id"]:
        raise HTTPException(400, "ลบบัญชีของตัวเองไม่ได้")
    target = await db.admins.find_one_and_delete({"id": admin_id})
    if not target:
        raise HTTPException(404, "ไม่พบผู้ดูแล")
    await db.sessions.delete_many({"admin_id": admin_id})
    await audit(admin, "delete_admin", target["email"])


@api.get("/admin/audit")
async def admin_audit(admin: dict = Depends(require_admin)):
    return await db.audit.find({}, {"_id": 0}).sort("at", -1).to_list(200)


media_router, claim_media, delete_media, media_maintenance = media.build_router(db, rate_limit)

app.include_router(api)
app.include_router(media_router)
app.include_router(weather.build_router(db))
app.include_router(services.build_router(db, rate_limit, require_admin, audit, client_ip))
VILLAGE_CENTER = (13.7958, 100.67)
staff_router, locate_house, learn_address, require_staff = staff.build_router(
    db, rate_limit, current_admin, require_admin, start_session, audit, public_post, VILLAGE_CENTER
)
app.include_router(staff_router)
app.include_router(trips.build_router(db, require_staff, staff.SOIS))
app.include_router(zonelog.build_router(db, rate_limit, current_admin, {z["id"] for z in staff.ZONES["zones"]}))
team_router, is_team = team.build_router(db, rate_limit, current_admin, require_admin, locate_house, staff.ZONES, staff.needs_of, staff.zone_of_soi)
app.include_router(team_router)
app.include_router(ops.build_router(db, rate_limit, current_admin, {z["id"] for z in staff.ZONES["zones"]}, is_team))
app.include_router(repair.build_router(db, rate_limit, current_admin, require_admin, audit, client_ip, claim_media, delete_media))
app.include_router(canal.build_router(db, rate_limit, current_admin, require_admin, claim_media, delete_media, staff.SOIS, staff.ZONES["main_road"]))
# Same-origin in production (ingress). Reflect the origin so the admin cookie also works cross-origin in dev.
@app.middleware("http")
async def flood_archive_guard(request: Request, call_next):
    """Repair mode: the flood board is an archive. Its write routes answer 423 for everyone but admins."""
    path = request.url.path
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith(repair.FLOOD_WRITES):
        if await repair.site_mode(db) == "repair":
            admin = await current_admin(request)
            if not (admin and admin.get("role", "admin") == "admin"):
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "ระบบน้ำท่วมปิดแล้ว (ดูย้อนหลังได้อย่างเดียว) · ตอนนี้เป็นโหมดซ่อมบ้าน"}, status_code=423)
    return await call_next(request)


app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await db.posts.create_index("id", unique=True)
    await db.posts.create_index([("status", 1), ("created_at", -1)])
    await db.water.create_index("created_at")
    await db.canal_reports.create_index("created_at")
    await db.pumps.create_index("id", unique=True)
    await db.leaks.create_index("id", unique=True)
    await db.leaks.create_index([("status", 1), ("updated_at", -1)])
    await db.admins.create_index("email", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.announcements.create_index("created_at")
    await db.presence.create_index("last_seen", expireAfterSeconds=600)  # Mongo drops stale viewers itself
    await db.services.create_index("id", unique=True)
    await db.addresses.create_index("house", unique=True)
    await db.posts.create_index([("house", 1), ("status", 1)])
    await db.staff_invites.create_index("token", unique=True)
    await db.trips.create_index([("status", 1), ("updated_at", -1)])
    await db.trips.create_index("staff_id")
    await db.trips.create_index([("staff_id", 1), ("presence", 1)])
    await db.handoffs.create_index("expires_at", expireAfterSeconds=0)
    await db.zone_log.create_index("expires_at", expireAfterSeconds=0)
    await db.zone_log.create_index([("at", -1)])
    await db.ops_points.create_index("zone", unique=True)
    await db.ops_hazards.create_index([("cleared_at", 1), ("created_at", -1)])
    await db.ops_boats.create_index([("active", 1), ("created_at", 1)])
    await db.ops_history.create_index("expires_at", expireAfterSeconds=0)
    await db.ops_notes.create_index([("archived", 1), ("created_at", -1)])
    await db.ops_people.create_index([("active", 1), ("digits", 1)])
    await db.ops_history.create_index([("ref", 1), ("at", -1)])
    await db.services.create_index([("category", 1), ("updated_at", -1)])
    await db.media.create_index("id", unique=True)
    for coll in (db.lend_items, db.jobs, db.issues):
        await coll.create_index("id", unique=True)
        await coll.create_index([("status", 1), ("updated_at", -1)])
    await db.media.create_index([("attached_to", 1), ("created_at", 1)])

    async def media_housekeeping():
        first = True
        while True:
            try:
                await media_maintenance(first_run=first)
            except Exception:
                pass
            first = False
            await asyncio.sleep(3600)

    app.state.media_task = asyncio.create_task(media_housekeeping())

    async def expire_requests():  # old requests nobody asked again for: closed as expired (team.expire_stale)
        while True:
            try:
                await team.expire_stale(db)
            except Exception:
                pass
            await asyncio.sleep(1800)

    app.state.expire_task = asyncio.create_task(expire_requests())

    # Water scale v1 -> v2 (inserted ต้นขา between เข่า and เอว). Idempotent: only touches unversioned docs.
    await db.water.update_many({"v": {"$exists": False}, "level": 5}, {"$set": {"level": 6, "v": WATER_SCALE_VERSION}})
    await db.water.update_many({"v": {"$exists": False}, "level": 4}, {"$set": {"level": 5, "v": WATER_SCALE_VERSION}})
    await db.water.update_many({"v": {"$exists": False}}, {"$set": {"v": WATER_SCALE_VERSION}})

    # Seed the first admin from env (idempotent; a changed password is kept).
    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "")
    if email and password and not await db.admins.find_one({"email": email}):
        await db.admins.insert_one(
            {"id": str(uuid.uuid4()), "email": email, "name": os.environ.get("ADMIN_NAME", "ผู้ดูแล"), "password_hash": hash_password(password), "created_at": now(), "created_by": "seed"}
        )


@app.on_event("shutdown")
async def shutdown():
    client.close()
