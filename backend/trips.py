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
PRESENCE_STALE = timedelta(minutes=3)  # "staff online" dot: gone soon after /staff is closed
MAX_PATH = 300  # points kept per trip (a few hours at one point per ~30 m)
MIN_PING_S = 3
VILLAGE = (13.8020, 100.6670)  # centre of สหกรณ์เคหะสถาน 4
SHOW_WITHIN_KM = 15  # farther than this: listed as "outside the area", no map pin


def now():
    return datetime.now(timezone.utc)


class TripStart(BaseModel):
    vehicle: Vehicle
    mission: Mission
    label: str = Field(min_length=1, max_length=40)
    note: str = Field("", max_length=200)


class Ping(BaseModel):
    # Accept any real fix: a coarse indoor/desktop fix or a test far away must not silently fail.
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: Optional[float] = Field(None, ge=0)


def km_from_village(lat: float, lng: float) -> float:
    return math.hypot((lat - VILLAGE[0]) * 110.54, (lng - VILLAGE[1]) * 111.32 * math.cos(math.radians(lat)))


class NoteBody(BaseModel):
    note: str = Field("", max_length=200)


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
    km = km_from_village(t["lat"], t["lng"]) if t.get("lat") is not None else None
    far = km is not None and km > SHOW_WITHIN_KM
    return {
        "id": t["id"], "label": t["label"] + (f" · {t['team']}" if t.get("team") else ""), "vehicle": t["vehicle"], "mission": t["mission"], "phase": t["phase"], "note": t.get("note", ""),
        "lat": None if far else t.get("lat"), "lng": None if far else t.get("lng"), "soi": t.get("soi"),
        "km": None if km is None else round(km, 1), "far": far, "has_fix": t.get("lat") is not None,
        "updated_at": t.get("updated_at"), "started_at": t["started_at"],
        "path": [] if far else [[p[0], p[1]] for p in t.get("path", [])[-40:]],
    }


def build_router(db, require_staff, sois: dict) -> APIRouter:
    router = APIRouter(prefix="/api")
    last_ping: dict[str, float] = {}

    async def own_trip(trip_id: str, user: dict) -> dict:
        t = await db.trips.find_one({"id": trip_id, "status": "active", "presence": {"$ne": True}})
        if not t:
            raise HTTPException(404, "งานนี้จบไปแล้ว")
        if t["staff_id"] != user["id"]:
            raise HTTPException(403, "อัปเดตได้เฉพาะงานของคุณ")
        return t

    @router.get("/trips")
    async def active_trips():
        docs = await db.trips.find({"status": "active", "updated_at": {"$gte": now() - STALE}}, {"_id": 0}).sort("started_at", 1).to_list(200)
        # what each person has claimed, so residents can see who is coming to which soi
        claimed: dict[str, list] = {}
        async for p in db.posts.find({"kind": "need", "status": {"$ne": "done"}, "assignee.id": {"$in": [t["staff_id"] for t in docs]}}, {"assignee": 1, "soi": 1}):
            claimed.setdefault(p["assignee"]["id"], []).append(p.get("soi"))
        out = []
        for t in docs:
            if t.get("presence"):
                # staff with /staff open but not on a trip: only while fresh and with a position
                if t["updated_at"].replace(tzinfo=timezone.utc) < now() - PRESENCE_STALE or t.get("lat") is None:
                    continue
            # trips still waiting for their first GPS fix are listed too ("กำลังหาตำแหน่ง"), just without a pin
            mine = claimed.get(t["staff_id"], [])
            sois_claimed = sorted({s for s in mine if s}, key=lambda s: [int(x) for x in s.split("/") if x.isdigit()] or [999])
            out.append({**public_trip(t), "presence": bool(t.get("presence")), "claimed": len(mine), "claimed_sois": sois_claimed[:6]})
        return out

    @router.post("/staff/presence")
    async def presence(body: Ping, user: dict = Depends(require_staff)):
        """Position from anyone with /staff open. Goes to their active trip if they have one,
        otherwise to an "online" dot so the public map shows every staff member on duty."""
        key = f"presence:{user['id']}"
        if time.monotonic() - last_ping.get(key, 0) < MIN_PING_S:
            return {"ok": True, "throttled": True}
        last_ping[key] = time.monotonic()
        km = km_from_village(body.lat, body.lng)
        soi = nearest_soi(body.lat, body.lng, sois) if km < 3 else None
        fields = {"lat": body.lat, "lng": body.lng, "accuracy": min(body.accuracy or 0, 99999), "soi": soi, "updated_at": now()}
        push = {"path": {"$each": [[round(body.lat, 6), round(body.lng, 6)]], "$slice": -MAX_PATH}}
        trip = await db.trips.find_one({"staff_id": user["id"], "status": "active", "presence": {"$ne": True}}, {"id": 1})
        if trip:
            await db.trips.update_one({"id": trip["id"]}, {"$set": fields, "$push": push})
        else:
            await db.trips.update_one(
                {"staff_id": user["id"], "presence": True},
                {"$set": {**fields, "status": "active", "label": user["name"], "team": user.get("team", ""), "staff_name": user["name"]},
                 "$setOnInsert": {"id": str(uuid.uuid4()), "vehicle": "walk", "mission": "standby", "phase": "standby", "note": "", "started_at": now(), "path": []}},
                upsert=True,
            )
        return {"ok": True, "soi": soi, "km": round(km, 1), "far": km > SHOW_WITHIN_KM, "on_trip": bool(trip)}

    @router.put("/staff/presence/note")
    async def presence_note(body: NoteBody, user: dict = Depends(require_staff)):
        """'What I'm about to do', shown to residents when they tap this person on the map."""
        note = body.note.strip()
        await db.trips.update_one({"staff_id": user["id"], "presence": True},
                                  {"$set": {"note": note, "label": user["name"], "team": user.get("team", ""), "staff_name": user["name"]},
                                   "$setOnInsert": {"id": str(uuid.uuid4()), "vehicle": "walk", "mission": "standby", "phase": "standby", "status": "ended",
                                                    "started_at": now(), "updated_at": now(), "lat": None, "lng": None, "soi": None, "path": []}}, upsert=True)
        return {"note": note}

    @router.get("/staff/presence/note")
    async def get_presence_note(user: dict = Depends(require_staff)):
        doc = await db.trips.find_one({"staff_id": user["id"], "presence": True}, {"note": 1})
        return {"note": (doc or {}).get("note", "")}

    @router.delete("/staff/presence", status_code=204)
    async def stop_presence(user: dict = Depends(require_staff)):
        await db.trips.update_one({"staff_id": user["id"], "presence": True}, {"$set": {"status": "ended"}})

    @router.post("/staff/trips", status_code=201)
    async def start_trip(body: TripStart, user: dict = Depends(require_staff)):
        # one active trip per person: starting a new one closes the old
        await db.trips.update_many({"staff_id": user["id"], "status": "active", "presence": {"$ne": True}}, {"$set": {"status": "ended", "ended_at": now()}})
        here = await db.trips.find_one_and_update({"staff_id": user["id"], "presence": True, "status": "active"}, {"$set": {"status": "ended"}}) or {}
        fresh = here.get("updated_at") and here["updated_at"].replace(tzinfo=timezone.utc) > now() - PRESENCE_STALE
        t = now()
        doc = {"id": str(uuid.uuid4()), "staff_id": user["id"], "staff_name": user["name"], "team": user.get("team", ""), **body.model_dump(), "phase": "enroute",
               "status": "active", "started_at": t, "updated_at": t, "lat": here.get("lat") if fresh else None, "lng": here.get("lng") if fresh else None,
               "soi": here.get("soi") if fresh else None, "path": []}
        await db.trips.insert_one(dict(doc))
        return public_trip(doc)

    @router.get("/staff/trips/mine")
    async def my_trip(user: dict = Depends(require_staff)):
        t = await db.trips.find_one({"staff_id": user["id"], "status": "active", "presence": {"$ne": True}}, {"_id": 0})
        return public_trip(t) if t else None

    @router.post("/staff/trips/{trip_id}/ping")
    async def ping(trip_id: str, body: Ping, user: dict = Depends(require_staff)):
        if time.monotonic() - last_ping.get(trip_id, 0) < MIN_PING_S:
            return {"ok": True, "throttled": True}
        last_ping[trip_id] = time.monotonic()
        await own_trip(trip_id, user)
        km = km_from_village(body.lat, body.lng)
        soi = nearest_soi(body.lat, body.lng, sois) if km < 3 else None
        await db.trips.update_one(
            {"id": trip_id},
            {"$set": {"lat": body.lat, "lng": body.lng, "accuracy": min(body.accuracy or 0, 99999), "soi": soi, "updated_at": now()},
             "$push": {"path": {"$each": [[round(body.lat, 6), round(body.lng, 6)]], "$slice": -MAX_PATH}}},
        )
        return {"ok": True, "soi": soi, "km": round(km, 1), "far": km > SHOW_WITHIN_KM}

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
