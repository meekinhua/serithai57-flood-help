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


class QuestionsBody(BaseModel):
    items: List[Question] = Field(default_factory=list, max_length=10)


class AnswerBody(BaseModel):
    house: str = Field(..., max_length=20)
    qid: str = Field(..., max_length=30)
    answer: Literal["yes", "no"]


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


def build_router(db, rate_limit, require_admin, locate_house, learn_address, norm_house, sois: dict, buildings: list, extras=None) -> APIRouter:
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

    @router.post("/myhome/electric")
    async def electric(body: ElectricBody, request: Request):
        rate_limit(request, "myhome-electric", limit=20, window_s=600)
        h = clean(body.house)
        follow = {"want": body.want, "slots": [x for x in body.slots if x in SLOTS], "note": body.note.strip(), "at": now()}
        res = await db.survey_resp.update_one({"survey": "electric", "house": h}, {"$set": {"followup": follow}})
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
        await db.myhome_answers.update_one(
            {"house": h, "qid": body.qid},
            {"$set": {"answer": body.answer, "soi": loc.get("soi") or "", "at": now()}, "$push": {"log": {"answer": body.answer, "at": now()}}},
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
                out.append({"id": f"{r['id']}_{r['date']}", "icon": r.get("icon") or "📅", "when": when_word(d, today), "date": r["date"], "text": r["text"]})
        return sorted(out, key=lambda x: x["date"])

    @router.get("/myhome")
    async def myhome(house: str, request: Request):
        rate_limit(request, "myhome", limit=60, window_s=600)
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
        follow = (sig or {}).get("followup") or {}
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
