"""The canals around the village and the pumps (1 Oct 2026): the flood now depends on whether the canals
beside the village are below the top of the flood wall, at it, over it, or leaking through it. Residents
near a canal report how far the water is below the wall ("ต่ำกว่าขอบ 12 ซม.", ล้นแล้ว, เขื่อนรั่ว), so
everyone can see whether pumping out into that canal still makes sense. Pumps: where each one is, where
it pumps to, and whether it is running now. Anyone can report / update (name + rate limit, like the
water reports); admins can delete.
"""
import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

Canal = Literal["rahat", "bueng", "lamrang", "other"]  # คลองระหัส · สวนน้ำ/บึงกุ่ม · คลองลำราง · อื่นๆ
State = Literal["below", "brim", "over", "leak"]  # ต่ำกว่าขอบ · ปริ่มขอบ · ล้นเข้ามา · เขื่อนรั่ว/ซึม
PumpStatusValue = Literal["running", "stopped", "broken", "planned", "removed"]
KEEP = timedelta(hours=72)


def now():
    return datetime.now(timezone.utc)


class Located(BaseModel):
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)


class CanalReport(Located):
    canal: Canal
    state: State
    below_cm: Optional[int] = Field(None, ge=0, le=300)  # how far below the top of the wall (state "below")
    soi: str = Field("", max_length=10)  # the soi end / spot where it was seen
    note: str = Field("", max_length=200)
    name: str = Field("", max_length=80)
    media_ids: list[str] = Field(default_factory=list, max_length=1)


class PumpCreate(Located):
    label: str = Field(..., min_length=2, max_length=80)  # "ปั๊ม 8 นิ้ว หน้าป้อม รปภ."
    place: str = Field("", max_length=120)
    soi: str = Field("", max_length=10)
    owner: str = Field("", max_length=60)  # กทม. / ปภ. / หมู่บ้าน / เอกชน
    into: str = Field("", max_length=60)  # pumps into: คลองระหัส / ท่อ กทม. / ถนน
    status: PumpStatusValue = "running"
    note: str = Field("", max_length=200)
    name: str = Field("", max_length=80)


class PumpStatus(BaseModel):
    status: PumpStatusValue
    note: str = Field("", max_length=200)
    name: str = Field("", max_length=80)


class PumpEdit(Located):
    """Move a pump / fix its details (the pumps get moved around: "ย้ายปั๊มไปท้ายซอย 15")."""
    label: Optional[str] = Field(None, min_length=2, max_length=80)
    place: Optional[str] = Field(None, max_length=120)
    soi: Optional[str] = Field(None, max_length=10)
    owner: Optional[str] = Field(None, max_length=60)
    into: Optional[str] = Field(None, max_length=60)
    name: str = Field("", max_length=80)


def soi_end(sois: dict, main_road: list, soi: str) -> Optional[list]:
    """The far end of a soi (away from the main road) — where it meets the canal / the flood wall."""
    s = sois.get((soi or "").strip())
    if not s:
        return None
    ends = [p for line in s["lines"] for p in (line[0], line[-1])]
    near_road = lambda p: min(math.hypot(p[0] - q[0], p[1] - q[1]) for q in main_road)  # noqa: E731
    return max(ends, key=near_road)


def build_router(db, rate_limit, current_admin, require_admin, claim_media, delete_media, sois: dict, main_road: list) -> APIRouter:
    router = APIRouter(prefix="/api")

    def place(body) -> dict:
        """Where to put it on the map: the pin given, else the far end of the soi named."""
        if body.lat is not None and body.lng is not None:
            return {"lat": body.lat, "lng": body.lng}
        end = soi_end(sois, main_road, body.soi)
        return {"lat": end[0], "lng": end[1]} if end else {"lat": None, "lng": None}

    async def who(request: Request, typed: str) -> tuple[str, bool]:
        admin = await current_admin(request)
        return ((admin or {}).get("name") or typed.strip() or "ไม่ระบุชื่อ"), bool(admin)

    @router.get("/canal")
    async def canal():
        """Reports of the last 72 h (newest first) and every pump that isn't removed."""
        reports = await db.canal_reports.find({"created_at": {"$gte": now() - KEEP}}, {"_id": 0}).sort("created_at", -1).to_list(300)
        pumps = await db.pumps.find({"status": {"$ne": "removed"}}, {"_id": 0}).sort([("status", 1), ("updated_at", -1)]).to_list(100)
        return {"reports": reports, "pumps": pumps}

    @router.post("/canal/reports", status_code=201)
    async def add_report(body: CanalReport, request: Request):
        rate_limit(request, "canal", limit=20, window_s=600)
        if body.state == "below" and body.below_cm is None:
            raise HTTPException(422, "ใส่ว่าน้ำต่ำกว่าขอบเขื่อนกี่เซนติเมตร (กะเอาก็ได้)")
        name, staff = await who(request, body.name)
        rid = str(uuid.uuid4())
        media = await claim_media(body.media_ids, f"canal:{rid}", {"image"})
        doc = {"id": rid, **body.model_dump(exclude={"media_ids", "name"}), **place(body), "below_cm": body.below_cm if body.state == "below" else None,
               "name": name, "staff": staff, "media": media, "created_at": now()}
        await db.canal_reports.insert_one(dict(doc))
        return doc

    @router.post("/pumps", status_code=201)
    async def add_pump(body: PumpCreate, request: Request):
        rate_limit(request, "pump", limit=10, window_s=600)
        name, staff = await who(request, body.name)
        t = now()
        doc = {"id": str(uuid.uuid4()), **body.model_dump(exclude={"name"}), **place(body), "created_at": t, "updated_at": t, "updated_by": name,
               "history": [{"at": t, "status": body.status, "note": body.note, "name": name, "staff": staff}]}
        await db.pumps.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @router.post("/pumps/{pid}/status")
    async def pump_status(pid: str, body: PumpStatus, request: Request):
        rate_limit(request, "pump", limit=30, window_s=600)
        name, staff = await who(request, body.name)
        t = now()
        changes = {"status": body.status, "updated_at": t, "updated_by": name}
        if body.note.strip():
            changes["note"] = body.note.strip()
        res = await db.pumps.update_one({"id": pid}, {"$set": changes, "$push": {"history": {"at": t, "status": body.status, "note": body.note.strip(), "name": name, "staff": staff}}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบเครื่องสูบนี้")
        return await db.pumps.find_one({"id": pid}, {"_id": 0})

    @router.put("/pumps/{pid}")
    async def edit_pump(pid: str, body: PumpEdit, request: Request):
        rate_limit(request, "pump", limit=30, window_s=600)
        name, staff = await who(request, body.name)
        pump = await db.pumps.find_one({"id": pid}, {"_id": 0})
        if not pump:
            raise HTTPException(404, "ไม่พบเครื่องสูบนี้")
        changes = {k: v.strip() for k, v in body.model_dump(include={"label", "place", "soi", "owner", "into"}).items() if v is not None}
        moved = body.lat is not None and body.lng is not None and (body.lat, body.lng) != (pump.get("lat"), pump.get("lng"))
        if moved:
            changes.update(lat=body.lat, lng=body.lng)
        elif "soi" in changes and changes["soi"] != (pump.get("soi") or "") and body.lat is None:
            at = place(PumpEdit(soi=changes["soi"]))  # a new soi and no pin: the canal end of that soi
            if at["lat"] is not None:
                changes.update(at)
                moved = True
        if not changes:
            return pump
        t = now()
        what = "ย้ายตำแหน่ง" if moved else "แก้ข้อมูล"
        if changes.get("place"):
            what += f" → {changes['place']}"
        await db.pumps.update_one({"id": pid}, {"$set": {**changes, "updated_at": t, "updated_by": name},
                                               "$push": {"history": {"at": t, "status": pump["status"], "note": what, "name": name, "staff": staff}}})
        return await db.pumps.find_one({"id": pid}, {"_id": 0})

    @router.delete("/admin/canal/{rid}", status_code=204)
    async def delete_report(rid: str, admin: dict = Depends(require_admin)):
        doc = await db.canal_reports.find_one_and_delete({"id": rid})
        if doc:
            await delete_media([m["id"] for m in doc.get("media", [])])

    @router.delete("/admin/pumps/{pid}", status_code=204)
    async def delete_pump(pid: str, admin: dict = Depends(require_admin)):
        await db.pumps.delete_one({"id": pid})

    return router
