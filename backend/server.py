"""Flood mutual-aid board for บ้านสหกรณ์เคหะสถาน 4 (ซ.เสรีไทย 57).

No login on purpose: in an emergency anyone must be able to post within seconds.
The poster gets an edit key (kept in their browser) to delete their own post;
anyone can move a post to "helping"/"done", and every change is logged.
"""
import hashlib
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator

load_dotenv(Path(__file__).parent / ".env")

# tz_aware so datetimes go out as "+00:00" and browsers don't misread them as local time
client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="Flood Help API", openapi_url="/api/openapi.json", docs_url="/api/docs", redoc_url=None)
api = APIRouter(prefix="/api")

Kind = Literal["need", "offer", "info"]
Status = Literal["open", "helping", "done"]
# need: "paid" = willing to pay for help; offer: "paid" = hired service. The app never handles money.
Payment = Literal["free", "paid"]

CATEGORIES = {
    "need": ["evacuate", "medical", "vulnerable", "food", "medicine", "power", "move_items", "pets", "other"],
    "offer": ["boat", "truck", "food", "shelter", "parking", "labor", "power", "other"],
    "info": ["road_ok", "road_blocked", "danger", "shelter_point", "supply_point", "other"],
}

# Loose box around eastern Bangkok: rejects obviously wrong coordinates, not a geofence.
LAT_RANGE = (13.60, 14.00)
LNG_RANGE = (100.45, 100.90)

HIDDEN = {"_id": 0, "edit_key_hash": 0}


def now():
    return datetime.now(timezone.utc)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


# ---- tiny in-memory rate limit (single uvicorn worker on the pod) ----
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request, bucket: str, limit: int, window_s: int):
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
    q = _hits[f"{bucket}:{ip}"]
    t = time.monotonic()
    while q and t - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "ส่งถี่เกินไป กรุณารอสักครู่")
    q.append(t)


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
    payment: Payment = "free"
    price: str = Field("", max_length=100)  # free text, e.g. "300 บาท" / "100 บาท/เที่ยว"


class StatusUpdate(BaseModel):
    status: Status
    name: str = Field(min_length=1, max_length=80)
    note: str = Field("", max_length=300)


class WaterCreate(Located):
    level: int = Field(ge=0, le=5)  # 0 แห้ง .. 5 เกินอก
    note: str = Field("", max_length=200)
    name: str = Field("", max_length=80)


@api.get("/health")
async def health():
    return {"status": "ok"}


@api.get("/meta")
async def meta():
    return {"categories": CATEGORIES}


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
    cursor = db.posts.find(q, HIDDEN).sort([("urgent", -1), ("created_at", -1)])
    return await cursor.to_list(1000)


@api.post("/posts", status_code=201)
async def create_post(body: PostCreate, request: Request):
    rate_limit(request, "post", limit=15, window_s=600)
    if body.category not in CATEGORIES[body.kind]:
        raise HTTPException(422, "หมวดหมู่ไม่ถูกต้อง")
    edit_key = secrets.token_urlsafe(18)
    t = now()
    doc = {
        "id": str(uuid.uuid4()),
        **body.model_dump(),
        "urgent": body.urgent and body.kind == "need",
        "payment": "free" if body.kind == "info" else body.payment,
        "price": body.price.strip() if body.kind != "info" and body.payment == "paid" else "",
        "status": "open",
        "created_at": t,
        "updated_at": t,
        "history": [{"at": t, "status": "open", "name": body.name, "note": "สร้างรายการ"}],
        "edit_key_hash": hash_key(edit_key),
    }
    await db.posts.insert_one(dict(doc))
    doc.pop("edit_key_hash")
    return {**doc, "edit_key": edit_key}


@api.post("/posts/{post_id}/status")
async def update_status(post_id: str, body: StatusUpdate, request: Request):
    rate_limit(request, "status", limit=60, window_s=600)
    t = now()
    entry = {"at": t, "status": body.status, "name": body.name, "note": body.note}
    doc = await db.posts.find_one_and_update(
        {"id": post_id},
        {"$set": {"status": body.status, "updated_at": t}, "$push": {"history": entry}},
        projection=HIDDEN,
        return_document=True,
    )
    if not doc:
        raise HTTPException(404, "ไม่พบรายการ")
    return doc


@api.delete("/posts/{post_id}", status_code=204)
async def delete_post(post_id: str, x_edit_key: str = Header(...)):
    result = await db.posts.delete_one({"id": post_id, "edit_key_hash": hash_key(x_edit_key)})
    if result.deleted_count == 0:
        raise HTTPException(403, "ลบได้เฉพาะผู้โพสต์ (จากเครื่องที่โพสต์)")


@api.get("/water")
async def list_water(since_hours: int = Query(48, ge=1, le=24 * 30)):
    q = {"created_at": {"$gte": now() - timedelta(hours=since_hours)}}
    return await db.water.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)


@api.post("/water", status_code=201)
async def create_water(body: WaterCreate, request: Request):
    rate_limit(request, "water", limit=30, window_s=600)
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": now()}
    await db.water.insert_one(dict(doc))
    return doc


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await db.posts.create_index("id", unique=True)
    await db.posts.create_index([("status", 1), ("created_at", -1)])
    await db.water.create_index("created_at")


@app.on_event("shutdown")
async def shutdown():
    client.close()
