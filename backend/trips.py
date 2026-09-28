"""Live positions of staff boats / trucks, so residents can see what's coming and where it is.

A staff member starts a trip (vehicle + mission), their phone sends GPS pings while the trip
is active, and they tap the phase (on the way / serving / out of stock / returning).
The public map shows active trips heard from in the last 15 minutes. Staff identity is not
exposed: only the label they chose (e.g. "เรือทีมต้น").
"""
import math
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

Vehicle = Literal["boat", "truck", "car", "walk"]
Mission = Literal["food", "water", "evacuate", "medical", "cargo", "survey", "other"]
Phase = Literal["enroute", "serving", "out_of_stock", "returning"]

STALE = timedelta(minutes=15)  # hide a trip that stopped reporting (phone off, no signal)
MAX_PATH = 300  # points kept per trip (a few hours at one point per ~30 m)
MIN_PING_S = 3


def now():
    return datetime.now(timezone.utc)


class TripStart(BaseModel):
    vehicle: Vehicle
    mission: Mission
    label: str = Field(min_length=1, max_length=40)
    note: str = Field("", max_length=200)


class Ping(BaseModel):
    lat: float = Field(ge=13.5, le=14.1)
    lng: float = Field(ge=100.4, le=101.0)
    accuracy: Optional[float] = Field(None, ge=0, le=5000)


class PhaseBody(BaseModel):
    phase: Phase
    note: Optional[str] = Field(None, max_length=200)


def nearest_soi(lat: float, lng: float, sois: dict) -> Optional[str]:
    """Closest soi line vertex within ~120 m, else None (outside the village / main road)."""
    best, best_d = None, 120.0
    k = 111320 * math.cos(math.radians(lat))
    for name, s in sois.items():
        for line in s["lines"]:
            for plat, plng in line:
                d = math.hypot((plat - lat) * 110540, (plng - lng) * k)
                if d < best_d:
                    best, best_d = name, d
    return best


def public_trip(t: dict) -> dict:
    return {
        "id": t["id"], "label": t["label"], "vehicle": t["vehicle"], "mission": t["mission"], "phase": t["phase"], "note": t.get("note", ""),
        "lat": t.get("lat"), "lng": t.get("lng"), "soi": t.get("soi"), "updated_at": t.get("updated_at"), "started_at": t["started_at"],
        "path": [[p[0], p[1]] for p in t.get("path", [])[-40:]],
    }


def build_router(db, require_staff, sois: dict) -> APIRouter:
    router = APIRouter(prefix="/api")
    last_ping: dict[str, float] = {}

    async def own_trip(trip_id: str, user: dict) -> dict:
        t = await db.trips.find_one({"id": trip_id, "status": "active"})
        if not t:
            raise HTTPException(404, "งานนี้จบไปแล้ว")
        if t["staff_id"] != user["id"]:
            raise HTTPException(403, "อัปเดตได้เฉพาะงานของคุณ")
        return t

    @router.get("/trips")
    async def active_trips():
        docs = await db.trips.find({"status": "active", "updated_at": {"$gte": now() - STALE}}, {"_id": 0}).sort("started_at", 1).to_list(100)
        return [public_trip(t) for t in docs if t.get("lat") is not None]

    @router.post("/staff/trips", status_code=201)
    async def start_trip(body: TripStart, user: dict = Depends(require_staff)):
        # one active trip per person: starting a new one closes the old
        await db.trips.update_many({"staff_id": user["id"], "status": "active"}, {"$set": {"status": "ended", "ended_at": now()}})
        t = now()
        doc = {"id": str(uuid.uuid4()), "staff_id": user["id"], "staff_name": user["name"], **body.model_dump(), "phase": "enroute",
               "status": "active", "started_at": t, "updated_at": t, "lat": None, "lng": None, "soi": None, "path": []}
        await db.trips.insert_one(dict(doc))
        return public_trip(doc)

    @router.get("/staff/trips/mine")
    async def my_trip(user: dict = Depends(require_staff)):
        t = await db.trips.find_one({"staff_id": user["id"], "status": "active"}, {"_id": 0})
        return public_trip(t) if t else None

    @router.post("/staff/trips/{trip_id}/ping")
    async def ping(trip_id: str, body: Ping, user: dict = Depends(require_staff)):
        if time.monotonic() - last_ping.get(trip_id, 0) < MIN_PING_S:
            return {"ok": True, "throttled": True}
        last_ping[trip_id] = time.monotonic()
        await own_trip(trip_id, user)
        soi = nearest_soi(body.lat, body.lng, sois)
        await db.trips.update_one(
            {"id": trip_id},
            {"$set": {"lat": body.lat, "lng": body.lng, "accuracy": body.accuracy, "soi": soi, "updated_at": now()},
             "$push": {"path": {"$each": [[round(body.lat, 6), round(body.lng, 6)]], "$slice": -MAX_PATH}}},
        )
        return {"ok": True, "soi": soi}

    @router.post("/staff/trips/{trip_id}/phase")
    async def set_phase(trip_id: str, body: PhaseBody, user: dict = Depends(require_staff)):
        await own_trip(trip_id, user)
        changes = {"phase": body.phase, "updated_at": now()}
        if body.note is not None:
            changes["note"] = body.note
        await db.trips.update_one({"id": trip_id}, {"$set": changes})
        return public_trip(await db.trips.find_one({"id": trip_id}, {"_id": 0}))

    @router.post("/staff/trips/{trip_id}/end")
    async def end_trip(trip_id: str, user: dict = Depends(require_staff)):
        await own_trip(trip_id, user)
        await db.trips.update_one({"id": trip_id}, {"$set": {"status": "ended", "ended_at": now()}})
        return {"ok": True}

    return router
