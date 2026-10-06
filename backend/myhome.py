"""บ้านฉัน (7 Oct 2026): what a household needs to know about itself, from just its house number.

No login: the village is mostly older people. A house number is typed once and remembered on the phone;
the answer carries nothing private (no names, no phones) so anyone may look any house up. Built on what the
flood left behind: the electricians' sign-ups (survey_resp), the address book, the soi map.
People who want news by LINE / e-mail / IG leave a contact (optional, team-only) — an outlet for later.
Identity is checked in person when it matters (a volunteer walks over), not by the site.
"""
import math
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

# new subdivided plots get odd numbers ("4/1234/5", "4/88ก") that don't follow the soi order: the owner pins it
HOUSE_RE = re.compile(r"^\d{1,3}/\d{1,5}(/\d{1,3})?[ก-ฮA-Za-z]?$")
SNAP_M = 30  # a pin this close to a mapped roof snaps onto it
SOI_M = 120  # a soi this close to the pin is taken as the house's soi
# the district's regular rounds after the flood (LINE, 5 Oct): even sois Mon & Thu, odd sois Wed & Sat
WASTE_ROUNDS = {"even": "จันทร์ · พฤหัส", "odd": "พุธ · เสาร์"}


def now():
    return datetime.now(timezone.utc)


def soi_parity(soi: Optional[str]) -> Optional[str]:
    m = re.match(r"\d+", soi or "")
    return None if not m else ("even" if int(m.group()) % 2 == 0 else "odd")


def metres(a, b):
    dy = (a[0] - b[0]) * 111_320
    dx = (a[1] - b[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def to_segment(p, a, b):
    """Distance in metres from point p to segment a–b (small area: treat lat/lng as a flat grid)."""
    ky = 111_320
    kx = 111_320 * math.cos(math.radians(p[0]))
    px, py, ax, ay, bx, by = p[1] * kx, p[0] * ky, a[1] * kx, a[0] * ky, b[1] * kx, b[0] * ky
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class PinBody(BaseModel):
    house: str = Field(..., max_length=20)
    lat: float = Field(..., ge=13.7, le=13.9)
    lng: float = Field(..., ge=100.6, le=100.8)
    soi: str = Field("", max_length=12)  # the owner's own correction; empty = work it out from the pin


class ContactBody(BaseModel):
    house: str = Field(..., max_length=20)
    name: str = Field("", max_length=60)
    phone: str = Field("", max_length=40)
    line_id: str = Field("", max_length=60)
    email: str = Field("", max_length=120)
    ig: str = Field("", max_length=60)
    news: bool = True  # wants the village news by these channels


def build_router(db, rate_limit, require_admin, locate_house, learn_address, norm_house, sois: dict, buildings: list) -> APIRouter:
    router = APIRouter(prefix="/api")

    def clean(house: str) -> str:
        h = norm_house(house)
        if not HOUSE_RE.match(h):
            raise HTTPException(422, "ใส่บ้านเลขที่แบบ 4/917")
        return h

    def nearest_soi(p):
        best = None
        for name, s in sois.items():
            for line in s.get("lines") or []:
                for a, b in zip(line, line[1:]):
                    d = to_segment(p, a, b)
                    if best is None or d < best[0]:
                        best = (d, name)
        return best[1] if best and best[0] <= SOI_M else None

    def nearest_roof(p):
        best = None
        for lat, lng, bid in buildings:
            if abs(lat - p[0]) > 0.0005 or abs(lng - p[1]) > 0.0005:
                continue
            d = metres(p, (lat, lng))
            if best is None or d < best[0]:
                best = (d, lat, lng, bid)
        return best if best and best[0] <= SNAP_M else None

    @router.post("/myhome/pin")
    async def pin(body: PinBody, request: Request):
        """The owner shows where the house is (GPS or dragging the map): snap to the roof, find the soi."""
        rate_limit(request, "myhome-pin", limit=20, window_s=600)
        h = clean(body.house)
        p = (body.lat, body.lng)
        roof = nearest_roof(p)
        lat, lng, bid = (roof[1], roof[2], roof[3]) if roof else (body.lat, body.lng, None)
        soi = re.sub(r"^(ซอย|ซ\.?|แยก)\s*", "", body.soi.strip()) or nearest_soi((lat, lng))
        await learn_address(h, soi=soi, lat=lat, lng=lng, source="resident", by="บ้านฉัน", building_id=bid)
        return await myhome(h, request)

    @router.get("/myhome")
    async def myhome(house: str, request: Request):
        rate_limit(request, "myhome", limit=60, window_s=600)
        h = clean(house)
        sig = await db.survey_resp.find_one({"survey": "electric", "house": h}, {"_id": 0, "soi": 1, "job": 1, "updated_at": 1})
        loc = await locate_house(h, (sig or {}).get("soi") or None)
        soi = loc.get("soi")
        job = (sig or {}).get("job") or {}
        parity = soi_parity(soi)
        open_issues = await db.issues.count_documents({"status": {"$ne": "fixed"}, "soi": soi}) if soi else 0
        return {
            "house": h,
            "soi": soi,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "precision": loc["precision"],
            "electric": {"signed": bool(sig), "status": job.get("status", "todo") if sig else None, "at": job.get("at")},
            "waste": {"parity": parity, "days": WASTE_ROUNDS.get(parity)} if parity else None,
            "issues_open": open_issues,
            "has_contact": bool(await db.households.find_one({"house": h}, {"_id": 1})),
        }

    @router.post("/myhome/contact", status_code=201)
    async def contact(body: ContactBody, request: Request):
        rate_limit(request, "myhome-contact", limit=10, window_s=600)
        h = clean(body.house)
        if not any(x.strip() for x in (body.phone, body.line_id, body.email, body.ig)):
            raise HTTPException(422, "ใส่อย่างน้อยหนึ่งช่องทาง")
        doc = {k: (v.strip() if isinstance(v, str) else v) for k, v in body.model_dump().items()}
        doc["house"] = h
        await db.households.update_one(
            {"house": h},
            {"$set": {**doc, "updated_at": now()}, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now()}},
            upsert=True,
        )
        return {"ok": True}

    @router.get("/admin/myhome/contacts")
    async def contacts(admin: dict = Depends(require_admin)):
        return await db.households.find({}, {"_id": 0}).sort("house", 1).to_list(5000)

    return router
