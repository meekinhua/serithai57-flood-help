"""รอบบ้าน (7 Oct 2026): small asks and warnings between houses that are close enough to help without trouble.

Semi-public: an item shows only to houses within its radius (บ้านฉัน asks with the viewer's own house), never in the
village-wide feed. Two kinds:
  ask   — "I'm away, can someone look at the water at my door / take a photo / take in a parcel / feed the cat".
          The owner's phone stays hidden; a neighbour who taps "ฉันช่วยได้" leaves a name and then sees it.
  alert — "broken manhole cover in front of 4/120, careful" / "power line down" / "lost cat". Anyone nearby can
          say it's still there (+1) or that it's gone. Road-type alerts can also go to the office's issue list
          (คหบาล), so the tool helps the office instead of going round it.
No login: the owner holds an edit key on the phone, as on the other boards.
"""
import hashlib
import math
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

Kind = Literal["ask", "alert"]
# topic: (label, hours it stays up by default, issue type for the office or None)
TOPICS = {
    "ask": {
        "water": ("ดูน้ำหน้าบ้านให้หน่อย", 12, None),
        "photo": ("ถ่ายรูปหน้าบ้าน / ในบ้านให้ดู", 24, None),
        "parcel": ("ช่วยรับพัสดุ / ของ", 24, None),
        "pet": ("ให้อาหารสัตว์เลี้ยง", 24, None),
        "check": ("ดูประตู ปิดน้ำ ปิดไฟให้", 24, None),
        "carry": ("ช่วยยกของ / ขนของ", 48, None),
        "other": ("เรื่องอื่น", 24, None),
    },
    "alert": {
        "manhole": ("ฝาท่อแตก / หลุมบนถนน", 72, "drain"),
        "wire": ("สายไฟห้อย / เสาเอียง", 72, "wire"),
        "tree": ("ต้นไม้ล้ม / กิ่งขวางทาง", 72, "tree"),
        "flood": ("น้ำขังลึก รถผ่านลำบาก", 12, None),
        "lost": ("ของหาย / สัตว์เลี้ยงหาย", 72, None),
        "animal": ("งู / สัตว์อันตราย", 12, None),
        "other": ("เรื่องอื่น", 24, None),
    },
}
RADIUS = {"ask": 250, "alert": 400}  # metres an item reaches


def now():
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def metres(a, b):
    dy = (a[0] - b[0]) * 111_320
    dx = (a[1] - b[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


class NearbyCreate(BaseModel):
    kind: Kind
    topic: str = Field(..., max_length=20)
    text: str = Field("", max_length=200)
    house: str = Field(..., max_length=20)
    name: str = Field("", max_length=60)
    phone: str = Field("", max_length=60)  # phone or LINE id; asks need one, hidden until someone offers help
    hours: Optional[int] = Field(None, ge=1, le=168)
    to_office: bool = False  # alerts: also put it on the soi issue list for the office
    media_ids: List[str] = Field(default_factory=list, max_length=2)  # 7 Oct: a photo or a short clip


class HelpBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    phone: str = Field("", max_length=60)  # optional, only the owner sees it
    note: str = Field("", max_length=120)


class AlertBody(BaseModel):
    still: bool  # True: still there (+1) · False: gone / fixed


def build_router(db, rate_limit, client_ip, require_admin, locate_house, norm_house, claim_media=None) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def where(house: str):
        h = norm_house(house)
        loc = await locate_house(h)
        if not loc.get("lat") or loc.get("precision") == "unknown":
            raise HTTPException(422, "ยังไม่รู้ว่าบ้านนี้อยู่ตรงไหน ปักหมุดบ้านในบ้านฉันก่อน")
        return h, loc

    def public(doc, here=None):
        d = {k: v for k, v in doc.items() if k not in ("_id", "edit_key_hash", "phone", "voters")}
        d["helpers"] = [{"name": x["name"], "at": x["at"]} for x in doc.get("helpers", [])]
        if here:
            d["m"] = round(metres(here, (doc["lat"], doc["lng"])))
        return d

    @router.get("/nearby")
    async def nearby(house: str, request: Request):
        """What's open around this house: asks within 250 m, alerts within 400 m (wider while the house isn't pinned)."""
        rate_limit(request, "nearby", limit=80, window_s=600)
        h, loc = await where(house)
        here = (loc["lat"], loc["lng"])
        slack = 0 if loc.get("precision") == "house" else 150
        box = 0.006
        q = {"status": "open", "expires_at": {"$gt": now()}, "lat": {"$gt": here[0] - box, "$lt": here[0] + box}, "lng": {"$gt": here[1] - box, "$lt": here[1] + box}}
        out = []
        async for d in db.nearby.find(q, {"_id": 0}).sort("created_at", -1).limit(200):
            m = metres(here, (d["lat"], d["lng"]))
            if d["house"] == h or m <= d.get("radius", RADIUS[d["kind"]]) + slack:
                out.append({**public(d, here), "mine": d["house"] == h})
        return out

    @router.post("/nearby", status_code=201)
    async def create(body: NearbyCreate, request: Request):
        rate_limit(request, "nearby-new", limit=10, window_s=600)
        topic = TOPICS[body.kind].get(body.topic)
        if not topic:
            raise HTTPException(422, "เลือกเรื่อง")
        if body.kind == "ask" and len(body.phone.strip()) < 3:
            raise HTTPException(422, "ใส่เบอร์หรือ LINE ให้คนที่จะช่วยติดต่อได้")
        if body.topic == "other" and len(body.text.strip()) < 3:
            raise HTTPException(422, "เขียนสั้นๆ ว่าเรื่องอะไร")
        h, loc = await where(body.house)
        key, t = secrets.token_urlsafe(18), now()
        nid = str(uuid.uuid4())
        doc = {
            "id": nid,
            "media": await claim_media(body.media_ids, f"nearby:{nid}", {"image", "video"}) if claim_media and body.media_ids else [],
            "kind": body.kind,
            "topic": body.topic,
            "label": topic[0],
            "text": body.text.strip(),
            "house": h,
            "soi": loc.get("soi") or "",
            "lat": loc["lat"],
            "lng": loc["lng"],
            "radius": RADIUS[body.kind],
            "name": body.name.strip()[:60],
            "phone": body.phone.strip(),
            "helpers": [],
            "still": 1,
            "voters": [_hash(client_ip(request))],
            "status": "open",
            "issue_id": None,
            "created_at": t,
            "expires_at": t + timedelta(hours=body.hours or topic[1]),
            "edit_key_hash": _hash(key),
        }
        if body.kind == "alert" and body.to_office and topic[2]:
            issue = {
                "id": str(uuid.uuid4()), "type": topic[2], "detail": f"{topic[0]} · หน้าบ้าน {h}" + (f" · {doc['text']}" if doc["text"] else ""),
                "soi": doc["soi"], "lat": doc["lat"], "lng": doc["lng"], "name": doc["name"], "media": [], "status": "open", "votes": 1,
                "voters": doc["voters"], "history": [{"at": t, "by": doc["name"] or "ไม่ระบุชื่อ", "text": "แจ้งปัญหา (จากรอบบ้าน)"}], "created_at": t, "updated_at": t,
            }
            await db.issues.insert_one(issue)
            doc["issue_id"] = issue["id"]
        await db.nearby.insert_one(dict(doc))
        return {**public(doc), "mine": True, "edit_key": key}

    @router.post("/nearby/{item_id}/help")
    async def help_(item_id: str, body: HelpBody, request: Request):
        """A neighbour offers to help with an ask: their name goes on it, and they get the owner's contact."""
        rate_limit(request, "nearby-help", limit=20, window_s=600)
        d = await db.nearby.find_one({"id": item_id, "kind": "ask", "status": "open"}, {"_id": 0})
        if not d:
            raise HTTPException(404, "เรื่องนี้ปิดไปแล้ว")
        who = body.name.strip()
        if not any(x["name"] == who for x in d.get("helpers", [])):
            await db.nearby.update_one({"id": item_id}, {"$push": {"helpers": {"name": who, "phone": body.phone.strip(), "note": body.note.strip(), "at": now()}}})
        return {"phone": d["phone"], "name": d.get("name", ""), "house": d["house"]}

    @router.post("/nearby/{item_id}/alert")
    async def alert(item_id: str, body: AlertBody, request: Request):
        """Anyone nearby: 'still there' (+1, once per phone) or 'gone now' (closes it)."""
        rate_limit(request, "nearby-alert", limit=30, window_s=600)
        if body.still:
            who = _hash(client_ip(request))
            await db.nearby.update_one({"id": item_id, "kind": "alert", "voters": {"$ne": who}}, {"$inc": {"still": 1}, "$push": {"voters": who}})
        else:
            await db.nearby.update_one({"id": item_id, "kind": "alert"}, {"$set": {"status": "done", "closed_at": now()}})
        d = await db.nearby.find_one({"id": item_id}, {"_id": 0})
        if not d:
            raise HTTPException(404, "ไม่พบรายการ")
        return public(d)

    @router.get("/nearby/{item_id}/owner")
    async def owner(item_id: str, x_edit_key: str = Header("")):
        """The owner's view: who offered help, with the phone they chose to leave."""
        d = await db.nearby.find_one({"id": item_id}, {"_id": 0})
        if not d or not x_edit_key or d["edit_key_hash"] != _hash(x_edit_key):
            raise HTTPException(403, "ไม่ใช่เจ้าของเรื่องนี้")
        return {**public(d), "helpers": d.get("helpers", [])}

    @router.post("/nearby/{item_id}/done")
    async def done(item_id: str, x_edit_key: str = Header("")):
        d = await db.nearby.find_one({"id": item_id}, {"_id": 0, "edit_key_hash": 1})
        if not d or not x_edit_key or d["edit_key_hash"] != _hash(x_edit_key):
            raise HTTPException(403, "ไม่ใช่เจ้าของเรื่องนี้")
        await db.nearby.update_one({"id": item_id}, {"$set": {"status": "done", "closed_at": now()}})
        return {"ok": True}

    @router.get("/admin/nearby")
    async def admin_list(admin: dict = Depends(require_admin)):
        return await db.nearby.find({}, {"_id": 0, "edit_key_hash": 0, "voters": 0}).sort("created_at", -1).to_list(500)

    @router.delete("/admin/nearby/{item_id}", status_code=204)
    async def admin_delete(item_id: str, admin: dict = Depends(require_admin)):
        await db.nearby.delete_one({"id": item_id})

    return router
