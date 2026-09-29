"""Zone activity log: what has been done in each zone and when ("boat went in with food at 14:20",
"truck dropped supplies at the drop point"), so everyone can see which zones were reached and
which have been quiet. Anyone can post (name required, rate limited); a signed-in staff member's
posts are marked as from the team. Admins, and the staff member who posted, can delete.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

Kind = Literal["boat", "truck_drop", "food", "water", "evacuate", "medical", "need", "other"]
KEEP = timedelta(days=7)


def now():
    return datetime.now(timezone.utc)


class LogCreate(BaseModel):
    kind: Kind
    minutes_ago: int = Field(0, ge=0, le=24 * 60)  # "30 นาทีก่อน" etc.
    note: str = Field("", max_length=300)
    name: str = Field("", max_length=60)


def build_router(db, rate_limit, current_admin, zone_ids: set) -> APIRouter:
    router = APIRouter(prefix="/api")

    def view(d: dict) -> dict:
        return {k: d.get(k) for k in ("id", "zone", "kind", "note", "name", "staff", "at", "created_at")}

    @router.get("/zones/log")
    async def zone_log(hours: int = 48):
        since = now() - timedelta(hours=max(1, min(hours, 24 * 7)))
        docs = await db.zone_log.find({"at": {"$gte": since}}, {"_id": 0}).sort("at", -1).to_list(1000)
        return [view(d) for d in docs]

    @router.post("/zones/{zone}/log", status_code=201)
    async def add_log(zone: str, body: LogCreate, request: Request):
        zone = zone.upper()
        if zone not in zone_ids:
            raise HTTPException(404, "ไม่มีโซนนี้")
        rate_limit(request, "zonelog", limit=12, window_s=600)
        who = await current_admin(request)  # staff / admin session, if any
        name = (who or {}).get("name") or body.name.strip()
        if not name:
            raise HTTPException(422, "ใส่ชื่อหรือทีมของคุณด้วย")
        t = now()
        doc = {"id": str(uuid.uuid4()), "zone": zone, "kind": body.kind, "note": body.note.strip(), "name": name,
               "staff": bool(who), "staff_id": (who or {}).get("id"), "at": t - timedelta(minutes=body.minutes_ago), "created_at": t,
               "expires_at": t + KEEP}
        await db.zone_log.insert_one(dict(doc))
        return view(doc)

    @router.delete("/zones/log/{entry_id}", status_code=204)
    async def delete_log(entry_id: str, request: Request):
        who = await current_admin(request)
        if not who:
            raise HTTPException(401, "ต้องเข้าสู่ระบบเจ้าหน้าที่")
        entry = await db.zone_log.find_one({"id": entry_id})
        if not entry:
            return
        if who.get("role", "admin") != "admin" and entry.get("staff_id") != who["id"]:
            raise HTTPException(403, "ลบได้เฉพาะของที่คุณแจ้งเอง")
        await db.zone_log.delete_one({"id": entry_id})

    return router
