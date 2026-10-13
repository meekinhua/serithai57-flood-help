"""บ้านฉัน (7 Oct 2026): what a household needs to know about itself, from just its house number.

No login: the village is mostly older people. A house number is typed once and remembered on the phone;
the answer carries nothing private (no names, no phones) so anyone may look any house up. Built on what the
flood left behind: the electricians' sign-ups (survey_resp), the address book, the soi map.
People who want news by LINE / e-mail / IG leave a contact (optional, team-only) — an outlet for later.
Identity is checked in person when it matters (a volunteer walks over), not by the site.
"""
import hashlib
import math
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

# new subdivided plots get odd numbers ("4/1234/5", "4/88ก") that don't follow the soi order: the owner pins it
HOUSE_RE = re.compile(r"^\d{1,3}/\d{1,5}(/\d{1,3})?[ก-ฮA-Za-z]?$")
SNAP_M = 30  # a pin this close to a mapped roof snaps onto it
SOI_M = 120  # a soi this close to the pin is taken as the house's soi
# the district's regular rounds after the flood (LINE, 5 Oct): even sois Mon & Thu, odd sois Wed & Sat.
# The team changes them from the chat (settings waste.rounds, tools/site.py waste rounds); this is the fallback.
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


class SoiBody(BaseModel):
    house: str = Field(..., max_length=20)
    soi: str = Field(..., min_length=1, max_length=12)  # "14", "ซ.14", "แยก 2/2"


class PinBody(BaseModel):
    house: str = Field(..., max_length=20)
    lat: float = Field(..., ge=13.7, le=13.9)
    lng: float = Field(..., ge=100.6, le=100.8)
    soi: str = Field("", max_length=12)  # the owner's own correction; empty = work it out from the pin


# The electricians from the Ministry left after 2 days with ~80 houses unchecked. บ้านฉัน asks those houses
# what they want now, so the team has a clean, confirmed list if the soldiers come back (weekends?) and
# neighbours in one soi can hire a private electrician together.
Want = Literal["free", "group", "hired", "fine"]  # still want the free check · hire together · hired someone · power is fine now
SLOTS = ["เช้าวันธรรมดา", "บ่ายวันธรรมดา", "หลัง 5 โมงเย็น", "เสาร์-อาทิตย์"]


class ElectricBody(BaseModel):
    house: str = Field(..., max_length=20)
    want: Want
    slots: List[str] = Field(default_factory=list, max_length=4)
    note: str = Field("", max_length=200)


# Questions the team asks every house from the chat (tools/site.py ask), no redeploy: "ยังมีขยะค้างหน้าบ้านไหม".
# "no" hides it for that house; "yes" turns it into a card with a way out (tip, the neighbours' tradesmen of a
# group, a button to the office list) and a "แก้ได้แล้ว" that flips it to no. The team reads the answers by soi.
class Question(BaseModel):
    id: str = Field(..., pattern=r"^[a-z0-9_]{1,30}$")
    on: bool = True
    icon: str = Field("❓", max_length=8)
    short: str = Field("", max_length=24)  # the label once answered "no" ("ขยะค้าง"); empty = the question cut short
    q: str = Field(..., min_length=3, max_length=120)
    yes: str = Field("มี", max_length=30)
    no: str = Field("ไม่มี", max_length=30)
    tip: str = Field("", max_length=300)  # shown after "yes"
    group: str = Field("", max_length=20)  # PRO_GROUPS key on the page: list those tradesmen after "yes"
    action: Literal["", "issue", "ask"] = ""  # a button after "yes": the office list / ask the neighbours
    done: str = Field("แก้ได้แล้ว", max_length=30)  # the button that turns a yes into a no
    media: List[dict] = Field(default_factory=list, max_length=4)  # 7 Oct: photo / clip previews (attached via /admin/media/claim)


class QuestionsBody(BaseModel):
    items: List[Question] = Field(default_factory=list, max_length=10)


class NeighborPin(BaseModel):
    by: str = Field(..., max_length=20)  # the member's own house (must be pinned)
    house: str = Field(..., max_length=20)  # the house next door
    lat: float = Field(..., ge=13.7, le=13.9)
    lng: float = Field(..., ge=100.6, le=100.8)


class NeighborVote(BaseModel):
    by: str = Field(..., max_length=20)
    house: str = Field(..., max_length=20)
    ok: bool


class SpeakerSoi(BaseModel):
    soi: str = Field(..., min_length=1, max_length=10)
    answer: Literal["yes", "no"] = "yes"
    note: str = Field("", max_length=300)
    src: str = Field("", max_length=60)  # "เพจ FB" / "กลุ่ม LINE"


class AddrFix(BaseModel):
    house: str = Field(..., max_length=20)
    soi: Optional[str] = Field(None, max_length=10)
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)
    ok: bool = False  # looked at it: right as it is


class AnswerBody(BaseModel):
    house: str = Field(..., max_length=20)
    qid: str = Field(..., max_length=30)
    answer: Literal["yes", "no"]
    note: Optional[str] = Field(None, max_length=300)  # 9 Oct: เสียงตามสาย in their own words ("ไม่เคยได้ยินเลย ตั้งแต่ก่อนโควิด"); None = keep


# "เร็วๆ นี้" on บ้านฉัน: what is about to happen to this house. The regular rubbish round comes by itself from the
# rounds; the team adds the rest from the chat (tools/site.py remind) with a date and which sois it is for.
BKK = timezone(timedelta(hours=7))
THAI_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์", "อาทิตย์"]  # date.weekday() order


class Reminder(BaseModel):
    id: str = Field(..., pattern=r"^[a-z0-9_]{1,30}$")
    text: str = Field(..., min_length=3, max_length=160)
    icon: str = Field("📅", max_length=8)
    date: date  # the day it happens
    start: Optional[date] = None  # shown from (default: the day before)
    sois: str = Field("", max_length=80)  # "" all · "22-57,60" · "odd" · "even"
    media: List[dict] = Field(default_factory=list, max_length=4)  # 7 Oct: photo / clip previews (attached via /admin/media/claim)


class RemindersBody(BaseModel):
    items: List[Reminder] = Field(default_factory=list, max_length=20)


def soi_in(soi: Optional[str], spec: str) -> bool:
    spec = (spec or "").replace(" ", "")
    if not spec:
        return True
    m = re.match(r"\d+", soi or "")
    if not m:
        return False
    n = int(m.group())
    for part in spec.split(","):
        if part == "odd" and n % 2 or part == "even" and not n % 2:
            return True
        r = re.match(r"^(\d+)(?:-(\d+))?$", part)
        if r and int(r.group(1)) <= n <= int(r.group(2) or r.group(1)):
            return True
    return False


def when_word(d: date, today: date) -> str:
    return "วันนี้" if d == today else "พรุ่งนี้" if d == today + timedelta(days=1) else f"{THAI_DAYS[d.weekday()]} {d.day}"


class ContactBody(BaseModel):
    house: str = Field(..., max_length=20)
    name: str = Field("", max_length=60)
    phone: str = Field("", max_length=40)
    line_id: str = Field("", max_length=60)
    email: str = Field("", max_length=120)
    ig: str = Field("", max_length=60)
    news: bool = True  # wants the village news by these channels
    # fragile households, for the team when something happens (check-in): elder · bedridden · child · alone · disabled
    vulnerable: List[Literal["elder", "bedridden", "child", "alone", "disabled"]] = Field(default_factory=list, max_length=5)


def _inside(p, g) -> bool:
    c = False
    for i in range(len(g)):
        (a1, b1), (a2, b2) = g[i - 1], g[i]
        if (a1 > p[0]) != (a2 > p[0]) and p[1] < (b2 - b1) * (p[0] - a1) / (a2 - a1) + b1:
            c = not c
    return c


def build_router(db, rate_limit, require_admin, locate_house, learn_address, norm_house, sois: dict, buildings: list, extras=None, shapes_fn=None) -> APIRouter:
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
        soi = re.sub(r"^(ซอย|ซ\.?|แยก)\s*", "", re.sub(r"\s", "", body.soi.strip()))
        if not re.fullmatch(r"\d{1,3}(/\d{1,2})?", soi):
            soi = nearest_soi((lat, lng))  # 9 Oct: "4/229 ซอย 10" came in as a soi — a typed soi must look like 14 or 2/2
        await learn_address(h, soi=soi, lat=lat, lng=lng, source="resident", by="บ้านฉัน", building_id=bid)
        return await myhome(h, request)

    @router.get("/myhome/soi-at")
    async def soi_at(lat: float, lng: float, request: Request):
        """Which soi a dragged pin sits on (the pin page shows it live; the owner can still type another)."""
        rate_limit(request, "soi-at", limit=300, window_s=600)
        roof = nearest_roof((lat, lng))
        p = (roof[1], roof[2]) if roof else (lat, lng)
        return {"soi": nearest_soi(p)}

    @router.post("/myhome/soi")
    async def set_soi(body: SoiBody, request: Request):
        """"ซอยไม่ถูก" → the owner types it; it wins over the guess from the house number."""
        rate_limit(request, "myhome-pin", limit=20, window_s=600)
        h = clean(body.house)
        soi = re.sub(r"^(ซอย|ซ\.?|แยก)\s*", "", re.sub(r"\s", "", body.soi.strip()))
        if not re.fullmatch(r"\d{1,3}(/\d{1,2})?", soi):
            raise HTTPException(422, "ใส่เลขซอย เช่น 14 หรือ 2/2")
        await learn_address(h, soi=soi, source="resident", by="บ้านฉัน (แก้ซอย)")
        # the electricians' list follows the corrected soi
        await db.survey_resp.update_many({"house": h}, {"$set": {"soi": soi}})
        return await myhome(h, request)

    @router.post("/myhome/electric")
    async def electric(body: ElectricBody, request: Request):
        rate_limit(request, "myhome-electric", limit=20, window_s=600)
        h = clean(body.house)
        follow = {"want": body.want, "slots": [x for x in body.slots if x in SLOTS], "note": body.note.strip(), "at": now()}
        res = await db.survey_resp.update_one({"survey": "electric", "house": h}, {"$set": {"followup": follow}})
        if res.matched_count or body.want in ("free", "group"):
            await db.electric_nosign.delete_one({"house": h})
        else:
            # a house that never signed says it doesn't need the check: keep the answer apart (not a job for the electricians)
            await db.electric_nosign.update_one({"house": h}, {"$set": {"house": h, "followup": follow}}, upsert=True)
        if not res.matched_count and body.want in ("free", "group"):
            loc = await locate_house(h)
            await db.survey_resp.insert_one({
                "id": str(uuid.uuid4()), "survey": "electric", "house": h, "soi": loc.get("soi") or "", "name": "", "phone": "",
                "picks": [], "note": "ลงจากบ้านฉัน (ยังไม่มีเบอร์)", "source": "myhome", "followup": follow, "created_at": now(), "updated_at": now(),
            })
        return await myhome(h, request)

    @router.post("/myhome/answer")
    async def answer(body: AnswerBody, request: Request):
        rate_limit(request, "myhome-answer", limit=40, window_s=600)
        h = clean(body.house)
        loc = await locate_house(h)
        put = {"answer": body.answer, "soi": loc.get("soi") or "", "at": now()}
        if body.note is not None:
            put.update(note=body.note.strip(), note_at=now())
        await db.myhome_answers.update_one(
            {"house": h, "qid": body.qid},
            {"$set": put, "$push": {"log": {"answer": body.answer, "at": now(), **({"note": put["note"]} if "note" in put else {})}}},
            upsert=True,
        )
        return await myhome(h, request)

    @router.put("/admin/myhome/questions")
    async def set_questions(body: QuestionsBody, admin: dict = Depends(require_admin)):
        items = [q.model_dump() for q in body.items]
        if len({q["id"] for q in items}) != len(items):
            raise HTTPException(422, "id ซ้ำ")
        await db.settings.update_one({"id": "myhome_questions"}, {"$set": {"id": "myhome_questions", "items": items, "by": admin["name"], "at": now()}}, upsert=True)
        return items

    @router.get("/admin/myhome/questions")
    async def get_questions(admin: dict = Depends(require_admin)):
        doc = await db.settings.find_one({"id": "myhome_questions"}, {"_id": 0}) or {}
        items = doc.get("items", [])
        for q in items:
            rows = await db.myhome_answers.find({"qid": q["id"]}, {"_id": 0, "log": 0}).sort([("soi", 1), ("house", 1)]).to_list(3000)
            q["answers"] = rows
        return items

    @router.get("/speaker/map")
    async def speaker_map(request: Request):
        """เสียงตามสาย on the map: one point per answering house (no house numbers). A pinned house is where it is;
        the others are spread along their soi (by house number), so a soi isn't one blob in its middle."""
        rate_limit(request, "speaker-map", limit=60, window_s=600)
        rows = await db.myhome_answers.find({"qid": "speaker"}, {"_id": 0, "house": 1, "answer": 1, "soi": 1, "id": 1}).to_list(5000)
        out = []
        for r in rows:
            if not r.get("house"):
                r["house"] = r.get("id") or "x"  # only for spreading it along the soi
                loc = {"soi": r.get("soi"), "precision": "soi"} if r.get("soi") in sois else {"precision": "unknown"}
                if loc["precision"] == "soi":
                    loc["lat"], loc["lng"] = sois[r["soi"]]["center"]
            else:
                loc = await locate_house(r["house"])
            if loc.get("precision") == "unknown":
                continue
            lat, lng, exact = loc["lat"], loc["lng"], loc.get("precision") == "house"
            if not exact and loc.get("soi") in sois:
                line = [p for seg in sois[loc["soi"]].get("lines") or [] for p in seg]
                if len(line) >= 2:
                    t = int(hashlib.sha256(r["house"].encode()).hexdigest()[:6], 16) / 0xFFFFFF * (len(line) - 1)
                    k = min(int(t), len(line) - 2)
                    f = t - k
                    lat = line[k][0] + (line[k + 1][0] - line[k][0]) * f
                    lng = line[k][1] + (line[k + 1][1] - line[k][1]) * f
            out.append({"lat": round(lat, 5), "lng": round(lng, 5), "heard": r["answer"] == "no", "exact": exact})
        return out

    # ---------- 🏠 9 Oct: the admin checks the address book (house → soi / pin) that residents filled in ----------
    SOI_RE = re.compile(r"\d{1,3}(/\d{1,2})?")

    def main_soi(x):
        return (x or "").split("/")[0]

    def soi_dist(p):
        best = (1e9, None)
        for name, sv in sois.items():
            for line in sv.get("lines") or []:
                for a_, b_ in zip(line, line[1:]):
                    d = to_segment(p, a_, b_)
                    if d < best[0]:
                        best = (d, name)
        return best

    def hnum(h):
        m = re.match(r"4/(\d+)", h or "")
        return int(m.group(1)) if m else None

    # ---------- 🏙️ 13 Oct: the 3D map paints each house by its soi, from the address book members filled in ----------
    _m3d = {"at": 0, "key": None, "soi": {}, "house": {}}

    async def map3d_index():
        """Building → house number and soi, from what members pinned (their own house + neighbours') and the soi lines.

        Rebuilt as soon as a pin or a building changes (checked at most every 10 s), so a member's work shows at once."""
        if time.time() - _m3d["at"] < 10:
            return _m3d
        n_pins = await db.addresses.count_documents({"lat": {"$ne": None}})
        last = await db.addresses.find_one({"lat": {"$ne": None}}, {"_id": 0, "updated_at": 1}, sort=[("updated_at", -1)])
        key = (n_pins, str((last or {}).get("updated_at")), len(buildings), buildings[-1][2] if buildings else 0)
        if key == _m3d["key"]:
            _m3d["at"] = time.time()
            return _m3d
        pins = [(d["lat"], d["lng"], d["house"], d.get("soi")) async for d in db.addresses.find({"lat": {"$ne": None}}, {"_id": 0, "house": 1, "soi": 1, "lat": 1, "lng": 1})]
        shapes = await shapes_fn() if shapes_fn else [{"id": bid, "g": None, "c": (lat, lng)} for lat, lng, bid in list(buildings)]
        for b in shapes:
            g = b.get("g")
            b["c"] = b.get("c") or (sum(q[0] for q in g) / len(g), sum(q[1] for q in g) / len(g))
            b["box"] = (min(q[0] for q in g), max(q[0] for q in g), min(q[1] for q in g), max(q[1] for q in g)) if g else None
        segs = [(name, a_, b_) for name, sv in sois.items() for line in sv.get("lines") or [] for a_, b_ in zip(line, line[1:])]
        soi_of, house_of, orphans, housed = {}, {}, [], []
        # 1) each pin → the building it sits in (else one whose centre is within 12 m)
        for lat, lng, h, so in pins:
            p = (lat, lng)
            hit = next((b for b in shapes if b["box"] and b["box"][0] <= lat <= b["box"][1] and b["box"][2] <= lng <= b["box"][3] and _inside(p, b["g"])), None)
            if not hit:
                near = min(((metres(p, b["c"]), b) for b in shapes if abs(b["c"][0] - lat) < 0.0002 and abs(b["c"][1] - lng) < 0.0002), default=None, key=lambda x: x[0])
                hit = near[1] if near and near[0] <= 12 else None
            if not hit:
                orphans.append((lat, lng, h))
                continue
            housed.append(f"mb:pin:{h}")
            bid = hit.get("grp") or hit["id"]
            if bid not in house_of or (h == house_of[bid] and so):
                house_of[bid] = h
            house_of.setdefault(hit["id"], h)
            if so:
                soi_of.setdefault(hit["id"], so)
        # 2) buildings nobody pinned → the nearest soi line (45 m), else the soi of the nearest pin (25 m)
        for b in shapes:
            if b["id"] in soi_of:
                continue
            p = b["c"]
            best = (1e9, None)
            for name, a_, b_ in segs:
                if min(a_[0], b_[0]) - 0.0005 > p[0] or max(a_[0], b_[0]) + 0.0005 < p[0] or min(a_[1], b_[1]) - 0.0005 > p[1] or max(a_[1], b_[1]) + 0.0005 < p[1]:
                    continue
                d = to_segment(p, a_, b_)
                if d < best[0]:
                    best = (d, name)
            if best[0] <= 45:
                soi_of[b["id"]] = best[1]
                continue
            near = min(((metres(p, (a, c)), so) for a, c, _, so in pins if so and abs(a - p[0]) < 0.0003 and abs(c - p[1]) < 0.0003), default=None)
            if near and near[0] <= 25:
                soi_of[b["id"]] = near[1]
        # group members share the lead's soi
        for b in shapes:
            if b.get("grp") and b["grp"] in soi_of:
                soi_of[b["id"]] = soi_of[b["grp"]]
        # 3) a pin with no building under it: the pinner's vote for "there is a house here" (one more report adds it)
        for lat, lng, h in orphans:
            await db.building_suggestions.update_one(
                {"id": f"mb:pin:{h}"},
                {"$setOnInsert": {"id": f"mb:pin:{h}", "kind": "missing", "src": "member", "status": "open", "at": time.time(),
                                  "g": [[round(lat - 4.5e-5, 6), round(lng - 3.2e-5, 6)], [round(lat - 4.5e-5, 6), round(lng + 3.2e-5, 6)], [round(lat + 4.5e-5, 6), round(lng + 3.2e-5, 6)], [round(lat + 4.5e-5, 6), round(lng - 3.2e-5, 6)]],
                                  "votes": [h], "ips": ["pin"], "label": f"หมุดบ้าน {h} ยังไม่มีอาคาร"}},
                upsert=True,
            )
        # …and once a building stands there (added by anyone), that vote is done
        await db.building_suggestions.delete_many({"id": {"$in": housed}, "status": "open"})
        _m3d.update(at=time.time(), key=key, soi=soi_of, house=house_of)
        return _m3d

    @router.get("/map3d/sois")
    async def map3d_sois():
        """Which soi each building is on (for colouring the 3D map; no house numbers)."""
        return {"sois": {str(k): v for k, v in (await map3d_index())["soi"].items()}}

    @router.get("/map3d/me")
    async def map3d_me(house: str, request: Request):
        rate_limit(request, "map3d-me", limit=30, window_s=600)
        h = norm_house(house) if norm_house else house
        idx = await map3d_index()
        bid = next((k for k, v in idx["house"].items() if v == h), None)
        if bid is None:
            d = await db.addresses.find_one({"house": h, "lat": {"$ne": None}}, {"_id": 0, "lat": 1, "lng": 1})
            if d:
                best = min(((metres((d["lat"], d["lng"]), (la, ln)), b) for la, ln, b in list(buildings)), default=None)
                if best and best[0] <= 25:
                    bid = best[1]
        return {"id": bid}

    @router.get("/admin/map3d/houses")
    async def map3d_houses(admin: dict = Depends(require_admin)):
        return {"houses": {str(k): v for k, v in (await map3d_index())["house"].items()}}

    @router.get("/admin/addresses/review")
    async def addr_review(admin: dict = Depends(require_admin)):
        from repair import _in_outline

        docs = await db.addresses.find({}, {"_id": 0}).to_list(5000)
        signed = {r["house"]: str(r["soi"]) async for r in db.survey_resp.find({"soi": {"$nin": [None, ""]}}, {"_id": 0, "house": 1, "soi": 1})}
        pairs = sorted((hnum(d["house"]), d["soi"]) for d in docs if d.get("soi") and hnum(d["house"]) is not None)
        pins = {d["house"]: (d["lat"], d["lng"]) for d in docs if d.get("lat") is not None}
        nos, far_adds = {}, {}
        async for c in db.addr_claims.find({}, {"_id": 0, "house": 1, "kind": 1, "lat": 1, "lng": 1}):
            if c["kind"] == "no":
                nos[c["house"]] = nos.get(c["house"], 0) + 1
            elif c["kind"] == "add" and c["house"] in pins and metres(pins[c["house"]], (c["lat"], c["lng"])) > 15:
                far_adds[c["house"]] = far_adds.get(c["house"], 0) + 1
        out = []
        for d in docs:
            h, soi, flags = d["house"], d.get("soi"), []
            pin = (d["lat"], d["lng"]) if d.get("lat") is not None else None
            pin_soi = None
            if soi and soi not in sois:
                flags.append(["amber", f"ซ.{soi} ยังไม่มีเส้นในแผนที่"] if SOI_RE.fullmatch(soi) else ["red", f"ซอยพิมพ์ผิดรูป “{soi}”"])
            if pin:
                if not _in_outline(*pin):
                    flags.append(["red", "หมุดอยู่นอกหมู่บ้าน"])
                dist, pin_soi = soi_dist(pin)
                if dist > SOI_M:
                    flags.append(["amber", f"หมุดห่างถนนซอย {int(dist)} ม."])
                    pin_soi = None
                elif soi and pin_soi != soi:
                    same = main_soi(pin_soi) == main_soi(soi) or soi not in sois
                    flags.append(["amber" if same else "red", f"หมุดอยู่บน ซ.{pin_soi} แต่บันทึกเป็น ซ.{soi}"])
                twins = [o["house"] for o in docs if o["house"] != h and o.get("lat") is not None and (metres(pin, (o["lat"], o["lng"])) < 2 or (d.get("building_id") and o.get("building_id") == d.get("building_id")))]
                if twins:
                    flags.append(["red", "หมุดซ้ำกับ " + ", ".join(twins)])
            near_soi = None
            n = hnum(h)
            if soi and n is not None:
                nb = sorted((abs(m - n), m, x) for m, x in pairs if m != n and abs(m - n) <= 20)[:6]
                if len(nb) >= 3 and all(main_soi(x) != main_soi(soi) for _, _, x in nb):
                    top = max({main_soi(x) for _, _, x in nb}, key=lambda t: sum(main_soi(x) == t for _, _, x in nb))
                    if sum(main_soi(x) == top for _, _, x in nb) >= 3:
                        near_soi = top
                        flags.append(["amber", f"เลขบ้านข้างเคียงอยู่ ซ.{top} (" + ", ".join(f"4/{m}" for _, m, x in nb if main_soi(x) == top) + ")"])
            no = nos.get(h, 0)
            if no:
                flags.append(["red" if no >= 2 else "amber", f"เพื่อนบ้าน {no} คนบอกว่าหมุดนี้ไม่ใช่ {h}"])
            if far_adds.get(h):
                flags.append(["amber", f"เพื่อนบ้านปักหมุด {h} ไว้อีกที่ ({far_adds[h]} ครั้ง)"])
            sv = signed.get(h)
            if sv and soi and main_soi(sv) != main_soi(soi):
                flags.append(["amber", f"ลงทะเบียนตรวจไฟบอก ซ.{sv}"])
            if d.get("reviewed_at") and d.get("reviewed_at") >= (d.get("updated_at") or d["reviewed_at"]):
                flags = []  # an admin looked after the last change
            out.append({
                "house": h, "soi": soi, "lat": d.get("lat"), "lng": d.get("lng"), "source": d.get("source"), "by": d.get("updated_by", ""),
                "at": d.get("updated_at"), "reviewed": bool(d.get("reviewed_at")), "flags": flags,
                "hints": {k: v for k, v in {"pin": pin_soi, "signup": sv, "numbers": near_soi}.items() if v and v != soi},
            })
        out.sort(key=lambda r: (0 if any(f[0] == "red" for f in r["flags"]) else 1 if r["flags"] else 2, hnum(r["house"]) or 0))
        return {"items": out, "sois": sorted(sois, key=lambda x: [int(t) for t in re.findall(r"\d+", x)])}

    @router.post("/admin/addresses/delete")
    async def addr_delete(body: AddrFix, admin: dict = Depends(require_admin)):
        """11 Oct: a wrong entry (a typo'd number, a house that doesn't exist): gone from the address book."""
        h = clean(body.house)
        r = await db.addresses.delete_one({"house": h})
        if not r.deleted_count:
            raise HTTPException(404, "ไม่พบบ้านนี้ในสมุดที่อยู่")
        return {"ok": True}

    @router.post("/admin/addresses/review")
    async def addr_fix(body: AddrFix, admin: dict = Depends(require_admin)):
        h = clean(body.house)
        cur = await db.addresses.find_one({"house": h}, {"_id": 0}) or {}
        soi = body.soi.strip() if body.soi is not None else cur.get("soi")
        if soi and not SOI_RE.fullmatch(soi):
            raise HTTPException(422, "ซอยต้องเป็นแบบ 14 หรือ 2/2")
        lat, lng = (body.lat, body.lng) if body.lat is not None and body.lng is not None else (cur.get("lat"), cur.get("lng"))
        by = f"แอดมิน {admin.get('name', '')}".strip()
        await learn_address(h, soi=soi, lat=lat, lng=lng, source="staff", by=by)
        t = now()
        await db.addresses.update_one({"house": h}, {"$set": {"reviewed_at": t, "reviewed_by": by, "updated_at": t}})
        if soi and soi != cur.get("soi"):
            await db.survey_resp.update_many({"house": h}, {"$set": {"soi": soi}})  # the electricians' list follows
        return await db.addresses.find_one({"house": h}, {"_id": 0})

    # ---------- 🗺️ 10 Oct: members fill in the houses around their own (number + pin), and check each other's ----------
    NEAR_R = 150  # metres around the member's own pinned house

    async def own_pin(by: str):
        h = clean(by)
        a = await db.addresses.find_one({"house": h}, {"_id": 0, "lat": 1, "lng": 1})
        if not a or a.get("lat") is None:
            raise HTTPException(409, "ปักหมุดบ้านคุณก่อน แล้วค่อยช่วยใส่บ้านข้างๆ")
        return h, (a["lat"], a["lng"])

    @router.get("/myhome/neighbors")
    async def neighbors(house: str, request: Request):
        rate_limit(request, "neighbors", limit=60, window_s=600)
        h, me = await own_pin(house)
        near = []
        async for a in db.addresses.find({"lat": {"$ne": None}}, {"_id": 0, "house": 1, "lat": 1, "lng": 1, "source": 1, "reviewed_at": 1}):
            if a["house"] != h and metres(me, (a["lat"], a["lng"])) <= NEAR_R:
                near.append(a)
        votes = {}
        async for c in db.addr_claims.find({"house": {"$in": [a["house"] for a in near]}, "kind": {"$in": ["ok", "no"]}}, {"_id": 0, "house": 1, "kind": 1, "by": 1}):
            v = votes.setdefault(c["house"], {"ok": 0, "no": 0, "mine": None})
            v[c["kind"]] += 1
            if c["by"] == h:
                v["mine"] = c["kind"]
        src = lambda a: "team" if a.get("reviewed_at") or a.get("source") == "staff" else "owner" if a.get("source") == "resident" else "neighbor"  # noqa: E731
        known = [{"house": a["house"], "lat": a["lat"], "lng": a["lng"], "src": src(a), **votes.get(a["house"], {"ok": 0, "no": 0, "mine": None})} for a in near]
        roofs = [[lat, lng] for lat, lng, _ in buildings if metres(me, (lat, lng)) <= NEAR_R and not any(metres((lat, lng), (k["lat"], k["lng"])) < 6 for k in known + [{"lat": me[0], "lng": me[1]}])]
        mine = await db.addr_claims.count_documents({"by": h, "kind": "add"})
        return {"me": list(me), "radius": NEAR_R, "known": known, "roofs": roofs, "mine": mine}

    @router.post("/myhome/neighbors")
    async def neighbor_pin(body: NeighborPin, request: Request):
        rate_limit(request, "neighbor-pin", limit=40, window_s=600)
        by, me = await own_pin(body.by)
        h = clean(body.house if "/" in body.house else f"4/{body.house.strip()}")
        if h == by:
            raise HTTPException(422, "นี่คือบ้านคุณเอง · ย้ายหมุดบ้านคุณได้ที่ ข้อมูลบ้าน")
        p = (body.lat, body.lng)
        if metres(me, p) > NEAR_R + 30:
            raise HTTPException(422, "ใส่ได้เฉพาะบ้านรอบๆ บ้านคุณ (ไม่เกิน 150 ม.)")
        roof = nearest_roof(p)
        if roof and roof[0] <= 6:
            p = (roof[1], roof[2])
        cur = await db.addresses.find_one({"house": h}, {"_id": 0}) or {}
        await db.addr_claims.insert_one({"house": h, "by": by, "kind": "add", "lat": p[0], "lng": p[1], "at": now()})
        strong = cur.get("lat") is not None and cur.get("source") in ("resident", "staff")
        if strong:
            far = metres(p, (cur["lat"], cur["lng"])) > 15
            return {"ok": True, "kept": True, "note": "เจ้าของบ้านปักหมุดไว้เองแล้ว" + (" · ตำแหน่งที่คุณใส่ต่างออกไป ทีมจะตรวจให้" if far else " · ตรงกัน ขอบคุณครับ")}
        await learn_address(h, soi=nearest_soi(p), lat=p[0], lng=p[1], source="neighbor", by=f"เพื่อนบ้าน {by}")
        return {"ok": True, "kept": False, "note": f"ใส่ {h} แล้ว ขอบคุณครับ"}

    @router.post("/myhome/neighbors/vote")
    async def neighbor_vote(body: NeighborVote, request: Request):
        rate_limit(request, "neighbor-vote", limit=80, window_s=600)
        by, me = await own_pin(body.by)
        h = clean(body.house)
        a = await db.addresses.find_one({"house": h}, {"_id": 0, "lat": 1, "lng": 1})
        if not a or a.get("lat") is None or metres(me, (a["lat"], a["lng"])) > NEAR_R + 30:
            raise HTTPException(422, "ยืนยันได้เฉพาะบ้านรอบๆ บ้านคุณ")
        await db.addr_claims.update_one({"house": h, "by": by, "kind": {"$in": ["ok", "no"]}}, {"$set": {"kind": "ok" if body.ok else "no", "at": now()}}, upsert=True)
        return {"ok": True}

    @router.post("/admin/myhome/speaker", status_code=201)
    async def speaker_add(body: SpeakerSoi, admin: dict = Depends(require_admin)):
        """เสียงตามสาย heard about outside the app with only a soi ("แยก 79 ไม่เคยได้ยิน" in a comment): one point on that soi."""
        soi = re.sub(r"^(ซอย|ซ\.?|แยก)\s*", "", re.sub(r"\s", "", body.soi))
        if soi not in sois:
            raise HTTPException(422, f"ไม่มี ซ.{soi} ในแผนที่")
        doc = {"id": str(uuid.uuid4()), "house": "", "qid": "speaker", "soi": soi, "answer": body.answer, "note": body.note.strip(), "src": body.src.strip(), "at": now(), "by": admin.get("name", "")}
        await db.myhome_answers.insert_one(dict(doc))
        return doc

    @router.get("/admin/myhome/speaker")
    async def speaker_report(admin: dict = Depends(require_admin)):
        """เสียงตามสาย: which houses can't hear it, by soi (for คหบาล)."""
        rows = await db.myhome_answers.find({"qid": "speaker"}, {"_id": 0, "house": 1, "soi": 1, "answer": 1, "at": 1, "note": 1, "src": 1}).to_list(5000)
        by = {}
        for r in rows:
            k = r.get("soi") or "?"
            b = by.setdefault(k, {"soi": k, "no": [], "ok": 0})
            if r["answer"] == "yes":
                b["no"].append({"house": r.get("house") or f"(ไม่ระบุบ้าน · {r.get('src') or 'แจ้งนอกแอป'})", "at": r.get("at"), "note": r.get("note") or ""})
            else:
                b["ok"] += 1
        return sorted(by.values(), key=lambda b: (-len(b["no"]), b["soi"]))

    @router.put("/admin/myhome/reminders")
    async def set_reminders(body: RemindersBody, admin: dict = Depends(require_admin)):
        items = [r.model_dump(mode="json") for r in body.items]
        await db.settings.update_one({"id": "myhome_reminders"}, {"$set": {"id": "myhome_reminders", "items": items, "by": admin["name"], "at": now()}}, upsert=True)
        return items

    @router.get("/admin/myhome/reminders")
    async def get_reminders(admin: dict = Depends(require_admin)):
        return ((await db.settings.find_one({"id": "myhome_reminders"}, {"_id": 0})) or {}).get("items", [])

    async def soon(soi: Optional[str], rounds: dict) -> list:
        today = datetime.now(BKK).date()
        out = []
        days = rounds.get(soi_parity(soi)) if soi else None
        if days:
            for d in (today, today + timedelta(days=1)):
                if THAI_DAYS[d.weekday()] in days:
                    out.append({"id": f"waste_{d.isoformat()}", "icon": "🚛", "when": when_word(d, today), "date": d.isoformat(),
                                "text": "รถขยะเข้าซอยคุณ" + (" · มัดถุงวางหน้าบ้านคืนนี้" if d != today else "")})
                    break
        for r in ((await db.settings.find_one({"id": "myhome_reminders"}, {"_id": 0, "items": 1})) or {}).get("items", []):
            d = date.fromisoformat(r["date"])
            start = date.fromisoformat(r["start"]) if r.get("start") else d - timedelta(days=1)
            if start <= today <= d and soi_in(soi, r.get("sois", "")):
                out.append({"id": f"{r['id']}_{r['date']}", "icon": r.get("icon") or "📅", "when": when_word(d, today), "date": r["date"], "text": r["text"], "media": r.get("media") or []})
        return sorted(out, key=lambda x: x["date"])

    @router.get("/myhome")
    async def myhome(house: str, request: Request):
        rate_limit(request, "myhome", limit=300, window_s=600)  # many phones can share one mobile-network IP
        h = clean(house)
        sig = await db.survey_resp.find_one({"survey": "electric", "house": h}, {"_id": 0, "soi": 1, "job": 1, "updated_at": 1, "followup": 1})
        loc = await locate_house(h, (sig or {}).get("soi") or None)
        soi = loc.get("soi")
        job = (sig or {}).get("job") or {}
        parity = soi_parity(soi)
        open_issues = await db.issues.count_documents({"status": {"$ne": "fixed"}, "soi": soi}) if soi else 0
        waiting_q = {"survey": "electric", "job.status": {"$ne": "done"}, "followup.want": {"$nin": ["hired", "fine"]}}
        soi_waiting = await db.survey_resp.count_documents({**waiting_q, "soi": soi, "house": {"$ne": h}}) if soi else 0
        soi_group = await db.survey_resp.count_documents({"survey": "electric", "soi": soi, "followup.want": "group", "house": {"$ne": h}}) if soi else 0
        village_waiting = await db.survey_resp.count_documents(waiting_q)
        follow = (sig or {}).get("followup") or ((await db.electric_nosign.find_one({"house": h}, {"_id": 0, "followup": 1})) or {}).get("followup") or {}
        qs = [q for q in ((await db.settings.find_one({"id": "myhome_questions"}, {"_id": 0, "items": 1}) or {}).get("items") or []) if q.get("on")]
        mine = {a["qid"]: a["answer"] async for a in db.myhome_answers.find({"house": h, "qid": {"$in": [q["id"] for q in qs]}}, {"_id": 0, "qid": 1, "answer": 1})}
        for q in qs:
            q["answer"] = mine.get(q["id"])
            q["soi_yes"] = await db.myhome_answers.count_documents({"qid": q["id"], "answer": "yes", "soi": soi, "house": {"$ne": h}}) if soi else 0
        rounds = {**WASTE_ROUNDS, **((await db.settings.find_one({"id": "waste"}, {"_id": 0, "rounds": 1}) or {}).get("rounds") or {})}
        more = await extras(h, soi) if extras else {}
        coming = sorted(await soon(soi, rounds) + more.pop("_soon", []), key=lambda x: x["date"])
        return {
            **more,
            "house": h,
            "soi": soi,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "precision": loc["precision"],
            "electric": {
                "signed": bool(sig),
                "status": job.get("status", "todo") if sig else None,
                "at": job.get("at"),
                "want": follow.get("want"),
                "slots": follow.get("slots", []),
                "soi_waiting": soi_waiting,  # other houses in my soi still waiting
                "soi_group": soi_group,  # … who want to hire one electrician together
                "village_waiting": village_waiting,
            },
            "waste": {"parity": parity, "days": rounds.get(parity)} if parity else None,
            "issues_open": open_issues,
            "questions": qs,
            "soon": coming,
            "has_contact": bool(await db.households.find_one({"house": h}, {"_id": 1})),
            # 9 Oct: the village loudspeaker — "yes" = can't hear it (qid "speaker", always on, any time)
            "speaker": {
                "answer": None,
                **((await db.myhome_answers.find_one({"house": h, "qid": "speaker"}, {"_id": 0, "answer": 1, "note": 1})) or {}),
                "soi_no": await db.myhome_answers.count_documents({"qid": "speaker", "answer": "yes", "soi": soi, "house": {"$ne": h}}) if soi else 0,
                "all_no": await db.myhome_answers.count_documents({"qid": "speaker", "answer": "yes"}),
            },
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

    @router.get("/admin/myhome/electric")
    async def electric_list(admin: dict = Depends(require_admin)):
        """The houses that answered "what now" in บ้านฉัน, with their contact if they left one (team only)."""
        rows = await db.survey_resp.find({"survey": "electric", "followup": {"$exists": True}}, {"_id": 0, "house": 1, "soi": 1, "phone": 1, "job": 1, "followup": 1}).to_list(2000)
        contacts = {c["house"]: c async for c in db.households.find({"house": {"$in": [r["house"] for r in rows]}}, {"_id": 0})}
        for r in rows:
            c = contacts.get(r["house"]) or {}
            r["status"] = (r.pop("job", None) or {}).get("status", "todo")
            r["reach"] = " ".join(x for x in (c.get("name"), r.get("phone"), c.get("phone"), c.get("line_id") and f"LINE {c['line_id']}") if x)
        return sorted(rows, key=lambda r: (r["followup"]["want"], r.get("soi") or "", r["house"]))

    @router.get("/admin/myhome/contacts")
    async def contacts(admin: dict = Depends(require_admin)):
        return await db.households.find({}, {"_id": 0}).sort("house", 1).to_list(5000)

    return router
