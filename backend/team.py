"""Team pages (/hq, /team). By default they are OPEN: anyone who opens the URL can see and update
(the coordinator's choice, 2026-09-30: no password at all). An admin can lock them in /staff; then
only the secret team link works.

Team link: the volunteer teams work without accounts. One secret key, shared only inside the team
(serithai57.com/hq#k=… and /team#k=…), opens the team dashboard and the per-zone case list, and lets
them mark houses "on the way" / "received". Admins can rotate the key (the old link stops working).

The key travels in the X-Team-Key header (the page keeps it after reading it from the URL #fragment,
which browsers never send to the server or in Referer).
"""
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

NeedCategory = Literal["evacuate", "medical", "vulnerable", "food", "medicine", "power", "move_items", "pets", "other"]
RECENT_DONE = timedelta(hours=12)  # finished cases stay on the zone list (greyed) this long


def now():
    return datetime.now(timezone.utc)


class CaseStatus(BaseModel):
    status: Literal["helping", "done", "open"]
    name: str = Field(..., min_length=1, max_length=60)
    note: str = Field("", max_length=300)


class CaseCreate(BaseModel):
    house: str = Field(..., pattern=r"^4/\d{1,4}$")
    soi: str = Field("", max_length=10)
    category: NeedCategory = "food"
    detail: str = Field("", max_length=500)
    people: Optional[int] = Field(None, ge=0, le=500)
    urgent: bool = False
    phone: str = Field("", max_length=40)
    name: str = Field(..., min_length=1, max_length=60)


def build_router(db, rate_limit, current_admin, require_admin, locate, zones: dict, needs_of):
    router = APIRouter(prefix="/api")
    soi_zone = zones["soi_zone"]

    async def team_key() -> str:
        doc = await db.settings.find_one({"id": "team_key"})
        if not doc:
            key = secrets.token_urlsafe(18)
            await db.settings.update_one({"id": "team_key"}, {"$setOnInsert": {"id": "team_key", "key": key, "created_at": now()}}, upsert=True)
            doc = await db.settings.find_one({"id": "team_key"})
        return doc["key"]

    async def team_open() -> bool:
        doc = await db.settings.find_one({"id": "team_open"})
        return True if doc is None else bool(doc.get("open"))

    async def is_team(request: Request) -> Optional[str]:
        """'admin' / 'staff' / 'team' / 'open' when the caller may see team data, else None."""
        who = await current_admin(request)
        if who:
            return who.get("role", "admin")
        if await team_open():
            return "open"
        given = request.headers.get("x-team-key", "")
        if not given:
            return None
        if hmac.compare_digest(given, await team_key()):
            return "team"
        rate_limit(request, "teamkey-miss", limit=20, window_s=600)  # slow down guessing
        return None

    async def require_team(request: Request) -> str:
        role = await is_team(request)
        if not role:
            raise HTTPException(401, "ลิงก์ทีมไม่ถูกต้อง หรือถูกเปลี่ยนแล้ว — ขอลิงก์ใหม่จากผู้ประสานงาน")
        return role

    # ---------- the key itself ----------
    @router.get("/admin/team-key")
    async def get_key(admin: dict = Depends(require_admin)):
        return {"key": await team_key(), "open": await team_open()}

    class Access(BaseModel):
        open: bool

    @router.post("/admin/team-access")
    async def set_access(body: Access, admin: dict = Depends(require_admin)):
        await db.settings.update_one({"id": "team_open"}, {"$set": {"id": "team_open", "open": body.open, "by": admin["name"], "at": now()}}, upsert=True)
        return {"open": body.open}

    @router.post("/admin/team-key/rotate")
    async def rotate_key(admin: dict = Depends(require_admin)):
        key = secrets.token_urlsafe(18)
        await db.settings.update_one({"id": "team_key"}, {"$set": {"key": key, "created_at": now(), "rotated_by": admin["name"]}}, upsert=True)
        return {"key": key}

    @router.get("/team/check")
    async def check(role: str = Depends(require_team)):
        return {"ok": True, "role": role}

    # ---------- cases (help requests) by zone ----------
    def case_view(p: dict) -> dict:
        last = (p.get("history") or [{}])[-1]
        return {
            **{k: p.get(k) for k in ("id", "house", "soi", "category", "detail", "people", "urgent", "status", "lat", "lng", "precision",
                                     "created_at", "updated_at", "assignee", "source", "phone", "place")},
            "zone": soi_zone.get(p.get("soi") or ""),
            "last": {"note": last.get("note", ""), "name": last.get("name", ""), "at": last.get("at")},
        }

    @router.get("/team/cases")
    async def cases(zone: str = "", role: str = Depends(require_team)):
        q = {"kind": "need", "payment": {"$ne": "paid"},
             "$or": [{"status": {"$ne": "done"}}, {"status": "done", "updated_at": {"$gte": now() - RECENT_DONE}}]}
        docs = await db.posts.find(q, {"_id": 0, "edit_key_hash": 0}).to_list(3000)
        out = [case_view(p) for p in docs]
        if zone:  # "F" or a merged group "F,G,H"; "?" = cases whose zone isn't known yet
            want = {z.strip().upper() for z in zone.split(",") if z.strip()}
            out = [c for c in out if c["zone"] in want or ("?" in want and not c["zone"])]
        return out

    @router.post("/team/cases/{post_id}/status")
    async def set_status(post_id: str, body: CaseStatus, request: Request, role: str = Depends(require_team)):
        rate_limit(request, "teamcase", limit=120, window_s=600)
        who = await current_admin(request)
        name = (who or {}).get("name") or body.name.strip()
        t = now()
        changes = {"status": body.status, "updated_at": t}
        if body.status == "helping":
            changes["assignee"] = {"id": (who or {}).get("id") or f"team:{name}", "name": name}
            changes["assigned_at"] = t
        elif body.status == "open":
            changes["assignee"] = None
        else:
            changes["done_by"] = {"id": (who or {}).get("id") or f"team:{name}", "name": name}
        note = body.note.strip() or {"helping": "ทีมกำลังไป", "done": "ทีมแจก: ได้รับแล้ว", "open": "ยังไม่ได้ไป (ปล่อยคืน)"}[body.status]
        res = await db.posts.update_one({"id": post_id, "kind": "need"}, {"$set": changes, "$push": {"history": {"at": t, "status": body.status, "name": name, "note": note, "staff": True}}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบเคสนี้")
        return case_view(await db.posts.find_one({"id": post_id}, {"_id": 0}))

    @router.post("/team/cases", status_code=201)
    async def add_case(body: CaseCreate, request: Request, role: str = Depends(require_team)):
        """A house the team found door to door: add it on the spot (or add to its open case)."""
        rate_limit(request, "teamcase-add", limit=40, window_s=600)
        t = now()
        existing = await db.posts.find_one({"kind": "need", "status": {"$ne": "done"}, "house": body.house})
        line = body.detail.strip() or "ทีมแจกพบว่าต้องการความช่วยเหลือ"
        if existing:
            await db.posts.update_one({"id": existing["id"]}, {"$set": {"updated_at": t, **({"urgent": True} if body.urgent else {})},
                                                              "$push": {"history": {"at": t, "status": existing["status"], "name": body.name, "note": f"ทีมแจก: {line}", "staff": True}}})
            return case_view(await db.posts.find_one({"id": existing["id"]}, {"_id": 0}))
        loc = await locate(body.house, body.soi or None)
        urgent = body.urgent or needs_of(line)[1]
        doc = {
            "id": str(uuid.uuid4()), "kind": "need", "category": body.category, "detail": line,
            "place": body.house + (f" แยก {loc['soi']}" if loc["soi"] else ""), "name": f"ทีมแจก · {body.name}", "phone": body.phone.strip(),
            "people": body.people, "urgent": urgent, "general": False, "payment": "free", "price": "", "media": [], "pinned": False,
            "status": "open", "created_at": t, "updated_at": t, "lat": loc["lat"], "lng": loc["lng"], "house": body.house, "soi": loc["soi"],
            "precision": loc["precision"], "source": "team",
            "history": [{"at": t, "status": "open", "name": body.name, "note": "ทีมแจกเพิ่มเคส", "staff": True}], "edit_key_hash": "", "assignee": None,
        }
        await db.posts.insert_one(dict(doc))
        return case_view(doc)

    # ---------- /teamwork: what the teams are doing, for the whole village (read only, nothing personal) ----------
    @router.get("/public/teamwork")
    async def teamwork(request: Request):
        """Counts and progress only. No house numbers, no resident or volunteer names, no phone numbers,
        no internal board questions. Safe for the village LINE group whatever the team-page lock is."""
        rate_limit(request, "teamwork", limit=120, window_s=600)
        t = now()
        day = t - timedelta(hours=24)
        per: dict = {}
        totals = {"open": 0, "helping": 0, "urgent": 0, "done_24h": 0, "done_total": 0}
        activity = []
        async for p in db.posts.find({"kind": "need", "payment": {"$ne": "paid"}}, {"_id": 0, "status": 1, "soi": 1, "urgent": 1, "updated_at": 1, "history": 1}):
            z = soi_zone.get(p.get("soi") or "") or "?"
            o = per.setdefault(z, {"open": 0, "helping": 0, "done_24h": 0, "done_total": 0, "urgent": 0})
            st = p.get("status")
            if st == "done":
                o["done_total"] += 1
                totals["done_total"] += 1
                upd = p.get("updated_at")
                if upd and (upd if upd.tzinfo else upd.replace(tzinfo=timezone.utc)) >= day:
                    o["done_24h"] += 1
                    totals["done_24h"] += 1
            else:
                key = "helping" if st == "helping" else "open"
                o[key] += 1
                totals[key] += 1
                totals["urgent"] += bool(p.get("urgent"))
                o["urgent"] += bool(p.get("urgent"))
            for h in p.get("history") or []:
                at = h.get("at")
                if not at:
                    continue
                at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
                if at >= day and h.get("status") in ("done", "helping") and h.get("staff"):
                    activity.append({"zone": z, "kind": "delivered" if h["status"] == "done" else "on_the_way", "at": at})
        async for e in db.zone_log.find({"at": {"$gte": day}}, {"_id": 0, "zone": 1, "kind": 1, "at": 1}):
            activity.append({"zone": e["zone"], "kind": e["kind"], "at": e["at"]})
        activity.sort(key=lambda x: x["at"], reverse=True)

        points = [{"zone": d["zone"], "place": d.get("place", ""), "manned": bool(d.get("person")) and d.get("manned") is not False, "needs": d.get("needs") or []}
                  async for d in db.ops_points.find({}, {"_id": 0})]
        # the team as roles only (no names, no phones)
        roles = [x.get("role") or "อาสา" async for x in db.ops_people.find({"active": True, "role": {"$not": {"$regex": "^ติดต่อ"}}}, {"_id": 0, "role": 1}).sort("created_at", 1)]
        people = len(roles)
        boats = [b async for b in db.ops_boats.find({"active": True}, {"_id": 0, "need_driver": 1, "kind": 1})]
        supplies = [n["text"] async for n in db.ops_notes.find({"archived": False, "kind": "supply", "done": False}, {"_id": 0, "text": 1}).sort("created_at", 1)]
        hazards = [{"kind": h["kind"], "soi": h.get("soi", ""), "note": h.get("note", "")}
                   async for h in db.ops_hazards.find({"cleared_at": None}, {"_id": 0}).sort("created_at", -1)]
        return {
            "updated_at": t, "totals": totals, "zones": per, "points": points, "volunteers": people, "roles": roles,
            "boats": {"total": len(boats), "need_driver": sum(1 for b in boats if b.get("need_driver"))},
            "supplies": supplies, "hazards": hazards, "activity": activity[:25],
        }

    return router, is_team
