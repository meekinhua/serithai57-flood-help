"""บ้านฉัน, things that make a household keep the page (7 Oct 2026). All under /api/myhome, no login, like the rest.

- check-in ("ปลอดภัยไหม"): the team starts one from the chat when something happens (flood, a long power cut);
  every บ้านฉัน asks "safe / need help", the team sees who needs help and which fragile houses haven't answered.
- repair plan: what this house still has to fix after the flood, each item tied to the tradesmen on the board.
- aid: the flood relief a house can claim (the team writes them from the district's own notices), with
  "applied / received" per house and a reminder before the deadline.
- outages: "no power" / "no water" taps, counted per soi, with the utilities' numbers.
Fragile households (elderly, bedridden, small children, alone) are kept with the contact, team only.
"""
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

BKK = timezone(timedelta(hours=7))
PLAN_ITEMS = ["electric", "ac", "water", "appliance", "clean", "walls", "doors", "junk", "vehicle"]
OUTAGE_H = 6  # a "no power" tap counts this long unless the house says it's back


def now():
    return datetime.now(timezone.utc)


class CheckinBody(BaseModel):
    house: str = Field(..., max_length=20)
    status: Literal["ok", "help"]
    note: str = Field("", max_length=200)


class CheckinStart(BaseModel):
    on: bool
    title: str = Field("", max_length=80)


class PlanBody(BaseModel):
    house: str = Field(..., max_length=20)
    items: Dict[str, Literal["todo", "done"]] = Field(default_factory=dict)


class Aid(BaseModel):
    id: str = Field(..., pattern=r"^[a-z0-9_]{1,30}$")
    on: bool = True
    title: str = Field(..., min_length=3, max_length=100)
    amount: str = Field("", max_length=40)
    who: str = Field("", max_length=80)  # the agency
    docs: str = Field("", max_length=300)
    where: str = Field("", max_length=200)
    deadline: Optional[date] = None
    link: str = Field("", max_length=300)


class AidBody(BaseModel):
    items: List[Aid] = Field(default_factory=list, max_length=10)


class AidMark(BaseModel):
    house: str = Field(..., max_length=20)
    aid: str = Field(..., max_length=30)
    status: Literal["none", "applied", "received"]


class OutageBody(BaseModel):
    house: str = Field(..., max_length=20)
    kind: Literal["power", "water"]
    state: Literal["out", "back"]


def build(db, rate_limit, require_admin, locate_house, clean):
    """Returns (router, extras): extras(house, soi) adds this module's part to GET /api/myhome."""
    router = APIRouter(prefix="/api")

    async def checkin_doc():
        return await db.settings.find_one({"id": "checkin"}, {"_id": 0}) or {}

    async def aids():
        return [a for a in ((await db.settings.find_one({"id": "aid"}, {"_id": 0}) or {}).get("items") or []) if a.get("on")]

    # ---------------- check-in ----------------
    @router.post("/myhome/checkin")
    async def checkin(body: CheckinBody, request: Request):
        rate_limit(request, "myhome-checkin", limit=20, window_s=600)
        c = await checkin_doc()
        if not c.get("on"):
            raise HTTPException(404, "ตอนนี้ไม่มีการเช็กชื่อ")
        h = clean(body.house)
        loc = await locate_house(h)
        await db.checkins.update_one(
            {"cid": c["cid"], "house": h},
            {"$set": {"status": body.status, "note": body.note.strip(), "soi": loc.get("soi") or "", "lat": loc.get("lat"), "lng": loc.get("lng"), "at": now()}},
            upsert=True,
        )
        return {"ok": True, "status": body.status}

    @router.put("/admin/checkin")
    async def start_checkin(body: CheckinStart, admin: dict = Depends(require_admin)):
        c = await checkin_doc()
        if body.on:
            c = {"id": "checkin", "on": True, "cid": datetime.now(BKK).strftime("%Y%m%d%H%M"), "title": body.title.strip() or "เช็กชื่อ ปลอดภัยไหม", "started_at": now(), "by": admin["name"]}
        else:
            c = {**c, "id": "checkin", "on": False, "ended_at": now()}
        await db.settings.update_one({"id": "checkin"}, {"$set": c}, upsert=True)
        return {k: v for k, v in c.items() if k != "_id"}

    @router.get("/admin/checkin")
    async def checkin_report(admin: dict = Depends(require_admin)):
        c = await checkin_doc()
        if not c.get("cid"):
            return {"checkin": None}
        rows = await db.checkins.find({"cid": c["cid"]}, {"_id": 0}).to_list(5000)
        contacts = {x["house"]: x async for x in db.households.find({}, {"_id": 0})}
        answered = {r["house"] for r in rows}
        def who(h):
            x = contacts.get(h) or {}
            return {"house": h, "name": x.get("name", ""), "phone": x.get("phone", ""), "line_id": x.get("line_id", ""), "vulnerable": x.get("vulnerable", [])}
        help_ = [{**who(r["house"]), "soi": r.get("soi"), "note": r.get("note", ""), "at": r["at"]} for r in rows if r["status"] == "help"]
        fragile_silent = [who(h) for h, x in contacts.items() if x.get("vulnerable") and h not in answered]
        return {"checkin": {k: v for k, v in c.items() if k != "_id"}, "answered": len(rows), "ok": sum(r["status"] == "ok" for r in rows), "help": help_, "fragile_silent": fragile_silent}

    # ---------------- repair plan ----------------
    @router.post("/myhome/plan")
    async def plan(body: PlanBody, request: Request):
        rate_limit(request, "myhome-plan", limit=60, window_s=600)
        h = clean(body.house)
        items = {k: v for k, v in body.items.items() if k in PLAN_ITEMS}
        await db.repair_plan.update_one({"house": h}, {"$set": {"items": items, "updated_at": now()}, "$setOnInsert": {"created_at": now()}}, upsert=True)
        return {"items": items}

    # ---------------- flood aid ----------------
    @router.put("/admin/aid")
    async def set_aid(body: AidBody, admin: dict = Depends(require_admin)):
        items = [a.model_dump(mode="json") for a in body.items]
        await db.settings.update_one({"id": "aid"}, {"$set": {"id": "aid", "items": items, "by": admin["name"], "at": now()}}, upsert=True)
        return items

    @router.get("/admin/aid")
    async def get_aid(admin: dict = Depends(require_admin)):
        items = (await db.settings.find_one({"id": "aid"}, {"_id": 0}) or {}).get("items") or []
        for a in items:
            a["applied"] = await db.myhome_aid.count_documents({"aid": a["id"], "status": "applied"})
            a["received"] = await db.myhome_aid.count_documents({"aid": a["id"], "status": "received"})
        return items

    @router.post("/myhome/aid")
    async def mark_aid(body: AidMark, request: Request):
        rate_limit(request, "myhome-aid", limit=40, window_s=600)
        h = clean(body.house)
        await db.myhome_aid.update_one({"house": h, "aid": body.aid}, {"$set": {"status": body.status, "at": now()}}, upsert=True)
        return {"ok": True}

    # ---------------- power / water outages ----------------
    @router.post("/myhome/outage")
    async def outage(body: OutageBody, request: Request):
        rate_limit(request, "myhome-outage", limit=30, window_s=600)
        h = clean(body.house)
        loc = await locate_house(h)
        await db.outages.insert_one({"id": str(uuid.uuid4()), "house": h, "soi": loc.get("soi") or "", "kind": body.kind, "state": body.state, "at": now()})
        return {"ok": True}

    async def outage_view(h: str, soi: Optional[str]) -> dict:
        since = now() - timedelta(hours=OUTAGE_H)
        latest = {}  # (house, kind) -> the last report in the window
        q = {"at": {"$gte": since}, **({"soi": soi} if soi else {"house": h})}
        async for r in db.outages.find(q, {"_id": 0}).sort("at", 1):
            latest[(r["house"], r["kind"])] = r
        out = {}
        for kind in ("power", "water"):
            down = [r for (hh, k), r in latest.items() if k == kind and r["state"] == "out"]
            mine = latest.get((h, kind))
            out[kind] = {"out": len(down), "last": max((r["at"] for r in down), default=None), "mine": mine["state"] if mine else None}
        return out

    # ---------------- what GET /api/myhome adds ----------------
    async def extras(h: str, soi: Optional[str]) -> dict:
        c = await checkin_doc()
        check = None
        if c.get("on"):
            mine = await db.checkins.find_one({"cid": c["cid"], "house": h}, {"_id": 0, "status": 1, "note": 1})
            check = {"id": c["cid"], "title": c.get("title", ""), "mine": mine}
        plan_doc = await db.repair_plan.find_one({"house": h}, {"_id": 0, "items": 1})
        marks = {m["aid"]: m["status"] async for m in db.myhome_aid.find({"house": h}, {"_id": 0})}
        today = datetime.now(BKK).date()
        aid_list, soon = [], []
        for a in await aids():
            st = marks.get(a["id"], "none")
            aid_list.append({**a, "mine": st})
            if a.get("deadline") and st == "none":
                d = date.fromisoformat(a["deadline"])
                if today <= d <= today + timedelta(days=3):
                    soon.append({"id": f"aid_{a['id']}_{a['deadline']}", "icon": "💰", "date": a["deadline"],
                                 "when": "วันนี้" if d == today else "พรุ่งนี้" if d == today + timedelta(days=1) else f"อีก {(d - today).days} วัน",
                                 "text": f"หมดเขต: {a['title']}"})
        return {"checkin": check, "plan": (plan_doc or {}).get("items"), "aid": aid_list, "outage": await outage_view(h, soi), "_soon": soon}

    return router, extras
