"""Volunteer coordination board (/ops), built from what the volunteer LINE group kept asking:
"which soi is drop point B / who is there / what's their number", "which point is short of what",
"power leak in soi 24, keep out", "who has the boat, who can drive it".

- points:  one per zone: where the drop point really is today, who is on it (name, phone, hours),
           and what it needs / has too much of. Anyone can update (name required, rate limited),
           because the people at the point are volunteers without accounts.
- hazards: ⚡ power leak, 🌳 fallen tree, … by soi; anyone can add or mark cleared.
- boats:   boats and other borrowed kit: owner, who holds it now, where, whether it needs a driver.
Every change is appended to ops_history (kept 7 days) so a bad edit can be traced and undone.
"""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

Need = Literal["food", "water", "meds", "dry", "bags", "people", "boat", "car"]
HazardKind = Literal["power", "tree", "deep", "closed", "other"]
BoatKind = Literal["paddle", "motor", "other"]
KEEP = timedelta(days=7)
CLEARED_SHOWN = timedelta(hours=6)  # a cleared hazard stays visible (struck through) for a while
PHONE_RE = re.compile(r"^[0-9+\- ]{0,20}$")


def now():
    return datetime.now(timezone.utc)


def _phone(v):
    if v is None:
        return v
    v = v.strip()
    if not PHONE_RE.match(v):
        raise ValueError("เบอร์โทรใส่ได้เฉพาะตัวเลข")
    return v


def _in_area(v, lo, hi):
    if v is not None and not lo <= v <= hi:
        raise ValueError("ตำแหน่งอยู่นอกพื้นที่")
    return v


class Who(BaseModel):
    name: str = Field("", max_length=60)


class PointEdit(Who):
    place: Optional[str] = Field(None, max_length=120)
    person: Optional[str] = Field(None, max_length=80)
    phone: Optional[str] = Field(None, max_length=20)
    hours: Optional[str] = Field(None, max_length=40)
    manned: Optional[bool] = None
    needs: Optional[List[Need]] = Field(None, max_length=8)
    surplus: Optional[str] = Field(None, max_length=120)
    note: Optional[str] = Field(None, max_length=200)
    lat: Optional[float] = None
    lng: Optional[float] = None
    clear_pin: bool = False

    @field_validator("phone")
    @classmethod
    def _p(cls, v):
        return _phone(v)

    @field_validator("lat")
    @classmethod
    def _la(cls, v):
        return _in_area(v, 13.6, 14.0)

    @field_validator("lng")
    @classmethod
    def _ln(cls, v):
        return _in_area(v, 100.5, 100.85)


class HazardCreate(Who):
    kind: HazardKind
    soi: str = Field("", max_length=20)
    note: str = Field("", max_length=200)


class BoatEdit(Who):
    label: Optional[str] = Field(None, max_length=60)
    kind: Optional[BoatKind] = None
    owner: Optional[str] = Field(None, max_length=60)
    owner_phone: Optional[str] = Field(None, max_length=20)
    holder: Optional[str] = Field(None, max_length=60)
    holder_phone: Optional[str] = Field(None, max_length=20)
    where: Optional[str] = Field(None, max_length=80)
    due: Optional[str] = Field(None, max_length=60)
    need_driver: Optional[bool] = None
    note: Optional[str] = Field(None, max_length=200)

    @field_validator("owner_phone", "holder_phone")
    @classmethod
    def _p(cls, v):
        return _phone(v)


POINT_FIELDS = ("place", "person", "phone", "hours", "manned", "needs", "surplus", "note", "lat", "lng")
BOAT_FIELDS = ("label", "kind", "owner", "owner_phone", "holder", "holder_phone", "where", "due", "need_driver", "note")


def build_router(db, rate_limit, current_admin, zone_ids: set) -> APIRouter:
    router = APIRouter(prefix="/api/ops")

    async def author(request: Request, body: Who) -> tuple[str, bool]:
        rate_limit(request, "ops", limit=60, window_s=600)
        who = await current_admin(request)
        name = (who or {}).get("name") or body.name.strip()
        if not name:
            raise HTTPException(422, "ใส่ชื่อหรือทีมของคุณด้วย")
        return name, bool(who)

    async def history(what: str, ref: str, name: str, change: dict):
        t = now()
        await db.ops_history.insert_one({"id": str(uuid.uuid4()), "what": what, "ref": ref, "by": name, "change": change, "at": t, "expires_at": t + KEEP})

    def strip(d: dict) -> dict:
        d.pop("_id", None)
        return d

    @router.get("")
    async def board():
        points = {d["zone"]: strip(d) for d in await db.ops_points.find({}, {"_id": 0}).to_list(100)}
        hazards = await db.ops_hazards.find({"$or": [{"cleared_at": None}, {"cleared_at": {"$gte": now() - CLEARED_SHOWN}}]}, {"_id": 0}).sort("created_at", -1).to_list(200)
        boats = await db.ops_boats.find({"active": True}, {"_id": 0}).sort("created_at", 1).to_list(200)
        return {"points": points, "hazards": hazards, "boats": boats}

    @router.put("/points/{zone}")
    async def edit_point(zone: str, body: PointEdit, request: Request):
        zone = zone.upper()
        if zone not in zone_ids:
            raise HTTPException(404, "ไม่มีโซนนี้")
        name, staff = await author(request, body)
        change = {k: getattr(body, k) for k in POINT_FIELDS if getattr(body, k) is not None}
        if isinstance(change.get("needs"), list):
            change["needs"] = list(dict.fromkeys(change["needs"]))
        for k in ("place", "person", "hours", "surplus", "note"):
            if k in change:
                change[k] = change[k].strip()
        if body.clear_pin:
            change["lat"] = change["lng"] = None
        if not change:
            raise HTTPException(422, "ไม่มีอะไรเปลี่ยน")
        doc = {**change, "zone": zone, "updated_by": name, "staff": staff, "updated_at": now()}
        await db.ops_points.update_one({"zone": zone}, {"$set": doc}, upsert=True)
        await history("point", zone, name, change)
        return strip(await db.ops_points.find_one({"zone": zone}, {"_id": 0}))

    @router.post("/hazards", status_code=201)
    async def add_hazard(body: HazardCreate, request: Request):
        name, staff = await author(request, body)
        if not body.soi.strip() and not body.note.strip():
            raise HTTPException(422, "บอกซอยหรือรายละเอียดด้วย")
        doc = {"id": str(uuid.uuid4()), "kind": body.kind, "soi": body.soi.strip(), "note": body.note.strip(), "by": name, "staff": staff,
               "created_at": now(), "cleared_at": None, "cleared_by": None}
        await db.ops_hazards.insert_one(dict(doc))
        await history("hazard", doc["id"], name, {"add": body.kind, "soi": doc["soi"]})
        return doc

    @router.post("/hazards/{hid}/clear")
    async def clear_hazard(hid: str, body: Who, request: Request):
        name, _ = await author(request, body)
        res = await db.ops_hazards.update_one({"id": hid, "cleared_at": None}, {"$set": {"cleared_at": now(), "cleared_by": name}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบ หรือแก้ไขไปแล้ว")
        await history("hazard", hid, name, {"cleared": True})
        return {"ok": True}

    @router.post("/boats", status_code=201)
    async def add_boat(body: BoatEdit, request: Request):
        name, _ = await author(request, body)
        if not (body.label or "").strip():
            raise HTTPException(422, "ตั้งชื่อเรือ เช่น เรือพาย พี่โอ ซ.11")
        doc = {"id": str(uuid.uuid4()), "active": True, "created_at": now(), "kind": "paddle", "need_driver": False,
               **{k: (v.strip() if isinstance(v, str) else v) for k in BOAT_FIELDS if (v := getattr(body, k)) is not None},
               "updated_by": name, "updated_at": now()}
        await db.ops_boats.insert_one(dict(doc))
        await history("boat", doc["id"], name, {"add": doc["label"]})
        doc.pop("_id", None)
        return doc

    @router.put("/boats/{bid}")
    async def edit_boat(bid: str, body: BoatEdit, request: Request):
        name, _ = await author(request, body)
        change = {k: (v.strip() if isinstance(v, str) else v) for k in BOAT_FIELDS if (v := getattr(body, k)) is not None}
        res = await db.ops_boats.update_one({"id": bid, "active": True}, {"$set": {**change, "updated_by": name, "updated_at": now()}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบเรือนี้")
        await history("boat", bid, name, change)
        return strip(await db.ops_boats.find_one({"id": bid}, {"_id": 0}))

    @router.post("/boats/{bid}/return")
    async def return_boat(bid: str, body: Who, request: Request):
        name, _ = await author(request, body)
        res = await db.ops_boats.update_one({"id": bid, "active": True}, {"$set": {"active": False, "returned_by": name, "returned_at": now()}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบเรือนี้")
        await history("boat", bid, name, {"returned": True})
        return {"ok": True}

    @router.get("/history")
    async def ops_history(ref: str = ""):
        q = {"ref": ref} if ref else {}
        return await db.ops_history.find(q, {"_id": 0, "expires_at": 0}).sort("at", -1).to_list(100)

    return router
