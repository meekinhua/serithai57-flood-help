"""🗺️ Places on the village map (11 Oct 2026): the admin draws them on /admin › สถานที่.

  pin    a shop, a meeting point, the tennis court's gate …       geometry: [lat, lng]
  area   the tennis court, the park, a car park …                  geometry: [[lat, lng], …] (closed)
  route  the monks' alms round, a walk, a garbage-truck run …     geometry: [[lat, lng], …]

Each can have a timetable (weekdays + start–end, Bangkok time). show = "always" (always on the map, the popup tells
the times) or "schedule" (only on the map while it's on, and `notice` minutes before it starts: "อีก 20 นาที").

  GET    /api/places                 → every place + its state now: on / soon / off, minutes to start / end, next time
  POST   /api/admin/places           {…} → new
  PUT    /api/admin/places/{id}      {…} → replace
  DELETE /api/admin/places/{id}
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

BKK = timezone(timedelta(hours=7))
DAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."]  # date.weekday() order


class Slot(BaseModel):
    days: List[int] = Field(default_factory=lambda: list(range(7)))  # 0 = Monday
    start: str = Field(..., pattern=r"^\d{1,2}:\d{2}$")
    end: str = Field(..., pattern=r"^\d{1,2}:\d{2}$")


class PlaceBody(BaseModel):
    kind: Literal["pin", "area", "route"]
    name: str = Field(..., min_length=1, max_length=80)
    emoji: str = Field("📍", max_length=8)
    detail: str = Field("", max_length=600)
    color: str = Field("#1E6B47", pattern=r"^#[0-9A-Fa-f]{6}$")
    geometry: list = Field(...)
    slots: List[Slot] = Field(default_factory=list, max_length=12)
    show: Literal["always", "schedule"] = "always"
    notice: int = Field(30, ge=0, le=24 * 60)  # minutes before a slot starts: shown as "เร็วๆ นี้"
    phone: str = Field("", max_length=40)
    link: str = Field("", max_length=300)
    on: bool = True


def _mins(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def state(p: dict, now: Optional[datetime] = None) -> dict:
    """on / soon / off right now, from the timetable (Bangkok time). No timetable = always on."""
    slots = p.get("slots") or []
    if not slots:
        return {"state": "on", "when": ""}
    t = (now or datetime.now(BKK)).astimezone(BKK)
    best = None  # (minutes until it starts, slot, day offset)
    for d in range(0, 8):
        day = (t + timedelta(days=d)).date()
        wd = day.weekday()
        for s in slots:
            if wd not in s["days"]:
                continue
            st, en = _mins(s["start"]), _mins(s["end"])
            start = datetime(day.year, day.month, day.day, tzinfo=BKK) + timedelta(minutes=st)
            end = start + timedelta(minutes=(en - st) % (24 * 60) or 24 * 60)
            if start <= t < end:
                return {"state": "on", "ends_in": int((end - t).total_seconds() // 60), "when": f"ถึง {s['end']}"}
            if start > t:
                m = int((start - t).total_seconds() // 60)
                if best is None or m < best[0]:
                    best = (m, s, d)
    if best is None:
        return {"state": "off", "when": ""}
    m, s, d = best
    label = "วันนี้" if d == 0 else "พรุ่งนี้" if d == 1 else DAYS[(t + timedelta(days=d)).weekday()]
    st = "soon" if m <= (p.get("notice") or 0) else "off"
    return {"state": st, "starts_in": m, "when": f"{label} {s['start']}–{s['end']}"}


def timetable(p: dict) -> str:
    out = []
    for s in p.get("slots") or []:
        ds = sorted(set(s["days"]))
        days = "ทุกวัน" if len(ds) == 7 else "จ.–ศ." if ds == [0, 1, 2, 3, 4] else "ส.–อา." if ds == [5, 6] else " ".join(DAYS[i] for i in ds)
        out.append(f"{days} {s['start']}–{s['end']}")
    return " · ".join(out)


def build_router(db, require_admin, audit) -> APIRouter:
    router = APIRouter(prefix="/api")

    def check(b: PlaceBody) -> dict:
        g = b.geometry
        ok = lambda p: isinstance(p, list) and len(p) == 2 and 13.7 < float(p[0]) < 13.9 and 100.6 < float(p[1]) < 100.8  # noqa: E731
        if b.kind == "pin":
            if not ok(g):
                raise HTTPException(422, "หมุดต้องอยู่ในหมู่บ้าน")
        else:
            need = 3 if b.kind == "area" else 2
            if not isinstance(g, list) or len(g) < need or len(g) > 400 or not all(ok(p) for p in g):
                raise HTTPException(422, f"ต้องมีอย่างน้อย {need} จุด และอยู่ในหมู่บ้าน")
        for s in b.slots:
            if not s.days or any(d not in range(7) for d in s.days):
                raise HTTPException(422, "เลือกวันอย่างน้อย 1 วัน")
        d = b.model_dump()
        d["geometry"] = [round(float(g[0]), 6), round(float(g[1]), 6)] if b.kind == "pin" else [[round(float(p[0]), 6), round(float(p[1]), 6)] for p in g]
        return d

    @router.get("/places")
    async def places():
        docs = await db.places.find({"on": True}, {"_id": 0}).sort("created_at", 1).to_list(500)
        now = datetime.now(BKK)
        return [{**p, **state(p, now), "times": timetable(p)} for p in docs]

    @router.get("/admin/places")
    async def all_places(admin: dict = Depends(require_admin)):
        docs = await db.places.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
        return [{**p, **state(p), "times": timetable(p)} for p in docs]

    @router.post("/admin/places", status_code=201)
    async def add(body: PlaceBody, admin: dict = Depends(require_admin)):
        doc = {"id": str(uuid.uuid4()), **check(body), "created_at": datetime.now(timezone.utc), "by": admin.get("name", "")}
        await db.places.insert_one(dict(doc))
        await audit(admin, "add_place", doc["id"], f"{body.kind} {body.name}")
        doc.pop("_id", None)
        return doc

    @router.put("/admin/places/{pid}")
    async def edit(pid: str, body: PlaceBody, admin: dict = Depends(require_admin)):
        r = await db.places.update_one({"id": pid}, {"$set": {**check(body), "updated_at": datetime.now(timezone.utc)}})
        if not r.matched_count:
            raise HTTPException(404, "ไม่พบ")
        await audit(admin, "edit_place", pid, body.name)
        return await db.places.find_one({"id": pid}, {"_id": 0})

    @router.delete("/admin/places/{pid}", status_code=204)
    async def remove(pid: str, admin: dict = Depends(require_admin)):
        await db.places.delete_one({"id": pid})
        await audit(admin, "delete_place", pid, "")

    return router
