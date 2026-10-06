"""Tools for field staff / volunteers coordinating help.

- Staff accounts: an admin makes an invite link; a volunteer opens it, types a name, done.
- Tasks: requests (kind "need") can be claimed by one staff member at a time (atomic, so two
  people never go to the same house), claimed a whole soi at once, released or finished.
- Address book: where is house "4/xxx"? Sources, best first:
    staff     - a staff member placed the pin (e.g. after checking Google Maps by eye)
    resident  - the resident pinned their own house when posting in the app
    text      - only the soi is known (someone wrote "4/224 แยก 11" in the LINE chat)
  Fallbacks: the soi's position from OpenStreetMap, or a soi *estimated* from neighbouring
  house numbers (numbers run along the sois). Every location says how precise it is.
  Google Maps data is never fetched or stored automatically: its terms forbid storing
  geocodes and showing them on a non-Google map, so staff look it up and place the pin.
- LINE import: paste an exported OpenChat, get one row per house (the chat repeats each
  house ~17x through copy-and-extend lists), then create the missing requests in one go.
- House lookup: "4/100-4/250, 4/1782" -> which sois, which houses we know, open requests.
"""
import bisect
import hashlib
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

SOI_DATA = json.loads((Path(__file__).parent / "data" / "sois.json").read_text(encoding="utf-8"))
SOIS: dict = SOI_DATA["sois"]
# Relief zones A, B, C… and truck drop points on the main road (data/make_zones.py)
ZONES = json.loads((Path(__file__).parent / "data" / "zones.json").read_text(encoding="utf-8"))
# 1,5xx building centres inside the village (OSM has footprints but no house numbers): staff tap one
# to say "this building is 4/xxx".
BUILDINGS = json.loads((Path(__file__).parent / "data" / "buildings.json").read_text(encoding="utf-8"))

HOUSE_RE = re.compile(r"(?<![\d/])4\s*/\s*(\d{1,4})(?![\d/])")  # village house numbers are 4/xxxx
SOI_RE = re.compile(r"(?:แยก|ซอย|ซ\.)\s*(\d{1,3}(?:\s*/\s*\d{1,2})?)")
PHONE_RE = re.compile(r"0\d[\d\- ]{7,11}\d")
MSG_START = re.compile(r"^(\d{1,2}:\d{2}) (.*)$")
DATE_LINE = re.compile(r"^\d{4}\.\d{2}\.\d{2} ")
# "got it" / "delivered" — closes the house's open job on import. Never after ไม่ ("ยังไม่ได้รับข้าว").
RECEIVED_RE = re.compile(
    r"(?<!ไม่)(?:ได้รับ(?:ความช่วยเหลือ|การช่วยเหลือ|ของ|ข้าว|อาหาร|น้ำ)?\s*(?:แล้ว|เรียบร้อย|ครบ)"
    r"|ได้รับ(?:ข้าว|ของ|อาหาร)"
    r"|ได้(?:ข้าว|ของ|อาหาร|น้ำ)แล้ว|(?<!ได้)รับแล้ว|(?:ส่ง|แจก)(?:ข้าว|ของ|อาหาร)?(?:ให้)?(?:เรียบร้อย)?แล้ว"
    r"|เคลียร์แล้ว|ไม่ต้องแล้ว|✅|☑️|✔️?)"
)
NOT_RECEIVED_RE = re.compile(r"ยังไม่ได้|ไม่ได้รับ|ยังไม่มี|ยังไม่ถึง|ยังรอ|รออยู่")
SOURCE_RANK = {"staff": 3, "resident": 2, "text": 1}
RECENT_DONE = timedelta(hours=24)
# Messages that are selling/pre-ordering things. Their "1. 4/688 ..." sign-up lists look exactly like
# help lists, so without this the buyers of waterproof suits became "requests" for staff.
# "Name 4/123 ..." at the start of a message: the house is part of the sender's LINE display name.
NAME_TAG_RE = re.compile(r"^[^\d\n]{1,30}?\s4\s*/\s*\d{1,4}(?![\d/])")
NEED_SIGNAL_RE = re.compile(r"อาหาร|ข้าว|น้ำดื่ม|\d+\s*(?:ที่|คน|กล่อง)|ผู้สูงอายุ|ติดเตียง|ป่วย|เด็ก|ยา|ขอความช่วยเหลือ|ต้องการ|อพยพ|เรือ|ไม่มีไฟ|หิว")
SALE_RE = re.compile(r"ขาย|ราคา|มัดจำ|พรีออเดอร์|pre-?order|ค่าหิ้ว|ค่าส่ง|ตัวละ|ชิ้นละ|ไซส์|สนใจลงชื่อ|รับซื้อ|รับหิ้ว|ผ่อน|โปรโมชั่น", re.I)


def now():
    return datetime.now(timezone.utc)


def house_of(text: str) -> Optional[str]:
    m = HOUSE_RE.search(text or "")
    return f"4/{int(m.group(1))}" if m else None


def soi_of(text: str) -> Optional[str]:
    m = SOI_RE.search(text or "")
    if not m:
        return None
    s = m.group(1).replace(" ", "")
    return s if s in SOIS else None


def house_num(house: str) -> int:
    # pinned new plots can read "4/88ก" or "4/1234/5": the plot number is the leading digits
    m = re.match(r"\d+", house.split("/")[1] if "/" in house else "")
    return int(m.group()) if m else 0


def needs_of(text: str) -> tuple[str, bool]:
    """Best-guess request category from free text, and whether it involves vulnerable people."""
    vulnerable = bool(re.search(r"ผู้สูงอายุ|สูงวัย|คนแก่|ชรา|ติดเตียง|ป่วย|เด็ก|ทารก|พิการ|ตั้งครรภ์|ยาย|คนท้อง", text))
    if re.search(r"อพยพ|เรือ|ออกจากบ้าน|ติดอยู่", text):
        return "evacuate", vulnerable
    if vulnerable and not re.search(r"อาหาร|ข้าว|กล่อง|ที่", text):
        return "vulnerable", True
    if re.search(r"ยา(?!ย)", text):
        return "medicine", vulnerable
    if re.search(r"ไฟ|ชาร์จ|แบต", text):
        return "power", vulnerable
    return "food", vulnerable


class JoinBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)
    name: str = Field(min_length=1, max_length=60)
    team: str = Field("", max_length=40)  # where they came from: มูลนิธิ / เขต / บริษัท ... (staff come from many groups)


class HandoffBody(BaseModel):
    token: str = Field(min_length=10, max_length=100)


class InviteCreate(BaseModel):
    expires_hours: int = Field(72, ge=1, le=24 * 30)
    importer: bool = False  # account for the central LINE import (tools/push_line.py), not for people


class AddressSet(BaseModel):
    lat: float
    lng: float
    soi: Optional[str] = Field(None, max_length=10)
    building_id: Optional[int] = None


NeedCategory = Literal["evacuate", "medical", "vulnerable", "food", "medicine", "power", "move_items", "pets", "other"]  # = CATEGORIES["need"] in server.py


class TaskEdit(BaseModel):
    """Quick fix-ups from the field: what they really need, how many, urgent or not."""
    category: Optional[NeedCategory] = None
    people: Optional[int] = Field(None, ge=0, le=500)
    urgent: Optional[bool] = None
    detail: Optional[str] = Field(None, max_length=1000)


class DoneBody(BaseModel):
    note: str = Field("", max_length=300)


class ImportPreview(BaseModel):
    text: str = Field(min_length=1, max_length=3_000_000)


class ImportRow(BaseModel):
    house: str = Field(pattern=r"^4/\d{1,4}$")
    soi: Optional[str] = None
    soi_from_text: bool = False  # True only when the chat itself said "แยก N"; estimates must not enter the address book
    text: str = Field("", max_length=1000)
    phone: str = Field("", max_length=40)
    portions: Optional[int] = Field(None, ge=0, le=500)
    force: bool = False  # create even if this house was helped in the last 24 h
    received: bool = False  # the chat says they got help: close the open job, never create one


class ImportCommit(BaseModel):
    rows: list[ImportRow] = Field(max_length=500)


class LookupBody(BaseModel):
    query: str = Field(min_length=1, max_length=2000)


def with_groups(base: dict, groups: list[list[str]]) -> dict:
    """Regroup zones at runtime: each group works as one block from its first zone's own drop point,
    the other zones' own field points staying on the map as second pins. Zones in no group stand alone.
    Sois, houses and letters never change, so cases and history keep their zones."""
    order = [z["id"] for z in base["zones"]]
    of = {}
    for g in groups:
        ids = [i for i in order if i in set(g)]
        for i in ids:
            of[i] = ids
    by = {z["id"]: z for z in base["zones"]}
    out = []
    for z in base["zones"]:
        ids = of.get(z["id"], [z["id"]])
        r = by[ids[0]]["own_drop"]
        extra = r["extra"] + [{"soi": by[m]["own_drop"]["soi"], "place": by[m]["own_drop"]["place"], "lat": by[m]["own_drop"]["lat"],
                               "lng": by[m]["own_drop"]["lng"], "tag": m} for m in ids[1:] if by[m]["own_drop"]["explicit"]]
        place = r["place"]
        out.append({**z, "drop": {"lat": r["lat"], "lng": r["lng"], "soi": r["soi"], "place": place, "shared": ids,
                                  "label": f"จุดลงของ {'·'.join(ids)} · {place}", "extra": extra}})
    return {**base, "zones": out}


class ZoneGroups(BaseModel):
    groups: list[list[str]] = Field(max_length=12)


def zone_of_soi(soi) -> Optional[str]:
    """Zone of a soi; a soi missing from the map (แยก 85 when the map ends at 83) takes the zone of
    the nearest mapped soi with a close number, so the case still reaches that zone's team."""
    if not soi:
        return None
    sz = ZONES["soi_zone"]
    if soi in sz:
        return sz[soi]
    m = re.match(r"(\d+)", str(soi))
    if not m:
        return None
    n = int(m.group(1))
    near = min(((abs(int(k.split("/")[0]) - n), z) for k, z in sz.items() if k.split("/")[0].isdigit()), default=None)
    return near[1] if near and near[0] <= 4 else None


def build_router(db, rate_limit, current_admin, require_admin, start_session, audit, public_post, village_center):
    router = APIRouter(prefix="/api")

    async def require_staff(request: Request) -> dict:
        who = await current_admin(request)  # admins and staff share the accounts collection
        if not who:
            raise HTTPException(401, "ต้องเข้าสู่ระบบเจ้าหน้าที่")
        return who

    async def require_importer(request: Request) -> dict:
        """LINE import is done centrally (admin or the import account), not by field staff."""
        who = await require_staff(request)
        if who.get("role", "admin") != "admin" and not who.get("importer"):
            raise HTTPException(403, "การนำเข้า LINE ทำจากส่วนกลาง เจ้าหน้าที่ไม่ต้องทำ")
        return who

    def me(user: dict) -> dict:
        return {"id": user["id"], "name": user["name"]}

    # ---------- staff accounts ----------
    @router.post("/admin/staff-invites", status_code=201)
    async def create_invite(body: InviteCreate, admin: dict = Depends(require_admin)):
        token = secrets.token_urlsafe(18)
        doc = {"token": token, "created_by": admin["name"], "created_at": now(), "expires_at": now() + timedelta(hours=body.expires_hours), "active": True, "joined": 0, "importer": body.importer}
        await db.staff_invites.insert_one(dict(doc))
        await audit(admin, "create_staff_invite", token[:6])
        return {k: v for k, v in doc.items() if k != "_id"}

    @router.get("/admin/staff-invites")
    async def list_invites(admin: dict = Depends(require_admin)):
        return await db.staff_invites.find({}, {"_id": 0}).sort("created_at", -1).to_list(50)

    @router.delete("/admin/staff-invites/{token}", status_code=204)
    async def revoke_invite(token: str, admin: dict = Depends(require_admin)):
        await db.staff_invites.update_one({"token": token}, {"$set": {"active": False}})
        await audit(admin, "revoke_staff_invite", token[:6])

    @router.post("/auth/staff-join")
    async def staff_join(body: JoinBody, request: Request, response: Response):
        rate_limit(request, "login", limit=10, window_s=600)
        inv = await db.staff_invites.find_one({"token": body.token, "active": True, "expires_at": {"$gt": now()}})
        if not inv:
            raise HTTPException(401, "ลิงก์เชิญหมดอายุหรือถูกยกเลิกแล้ว ขอลิงก์ใหม่จากผู้ดูแล")
        user = {"id": str(uuid.uuid4()), "email": f"staff-{uuid.uuid4().hex[:8]}@staff.local", "name": body.name.strip(), "team": body.team.strip(), "role": "staff",
                "password_hash": "!", "created_at": now(), "created_by": f"invite:{inv['created_by']}", "importer": bool(inv.get("importer"))}
        await db.admins.insert_one(dict(user))
        await db.staff_invites.update_one({"token": body.token}, {"$inc": {"joined": 1}})
        return await start_session(user, request, response)

    # ---------- move a signed-in staff member from the LINE/Messenger in-app browser to Chrome/Safari ----------
    # Links shared in chats open inside the chat app, where GPS stops and the login is stuck. A one-time,
    # 10-minute token carries the session over so they don't have to join again.
    @router.post("/staff/handoff")
    async def make_handoff(user: dict = Depends(require_staff)):
        token = secrets.token_urlsafe(24)
        await db.handoffs.insert_one({"hash": hashlib.sha256(token.encode()).hexdigest(), "admin_id": user["id"], "used": False,
                                      "expires_at": now() + timedelta(minutes=10)})
        return {"token": token}

    @router.post("/auth/staff-handoff")
    async def use_handoff(body: HandoffBody, request: Request, response: Response):
        rate_limit(request, "login", limit=10, window_s=600)
        h = await db.handoffs.find_one_and_update(
            {"hash": hashlib.sha256(body.token.encode()).hexdigest(), "used": False, "expires_at": {"$gt": now()}}, {"$set": {"used": True}})
        user = h and await db.admins.find_one({"id": h["admin_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "ลิงก์ย้ายเบราว์เซอร์หมดอายุหรือถูกใช้ไปแล้ว กด “ย้ายไปเบราว์เซอร์” ใหม่อีกครั้ง")
        return await start_session(user, request, response)

    @router.get("/staff/invite")
    async def share_invite(user: dict = Depends(require_staff)):
        """The team link any staff member can pass on (QR / LINE): the longest-lived open admin invite.
        The admin can revoke it at any time, which stops new joins for everyone."""
        inv = await db.staff_invites.find_one({"active": True, "expires_at": {"$gt": now()}, "importer": {"$ne": True}}, {"_id": 0, "token": 1, "expires_at": 1},
                                             sort=[("expires_at", -1)])
        if not inv:
            raise HTTPException(404, "ตอนนี้ไม่มีลิงก์เชิญที่เปิดอยู่ ขอให้ผู้ดูแลสร้างลิงก์ใหม่")
        return inv

    # ---------- address book / locating a house ----------
    async def known_sois() -> list[tuple[int, str]]:
        pairs = [(house_num(a["house"]), a["soi"]) async for a in db.addresses.find({"soi": {"$ne": None}}, {"house": 1, "soi": 1})]
        for h, s in SOI_DATA.get("known_houses", {}).items():
            pairs.append((house_num(h), s))
        return sorted(pairs)

    def estimate_soi(num: int, pairs: list[tuple[int, str]]) -> Optional[str]:
        """House numbers run along the sois: take the soi of the nearest known house number."""
        if not pairs:
            return None
        i = bisect.bisect_left(pairs, (num, ""))
        near = [p for p in pairs[max(0, i - 1): i + 1]]
        best = min(near, key=lambda p: abs(p[0] - num))
        return best[1] if abs(best[0] - num) <= 60 else None

    async def locate(house: Optional[str], soi_hint: Optional[str] = None, pairs=None) -> dict:
        addr = await db.addresses.find_one({"house": house}, {"_id": 0}) if house else None
        if addr and addr.get("lat") is not None:
            return {"lat": addr["lat"], "lng": addr["lng"], "soi": addr.get("soi") or soi_hint, "precision": "house", "source": addr["source"]}
        soi = soi_hint or (addr or {}).get("soi")
        precision = "soi"
        if not soi and house:
            pairs = pairs if pairs is not None else await known_sois()
            soi = estimate_soi(house_num(house), pairs)
            precision = "estimated_soi"
        if soi and soi in SOIS:
            lat, lng = SOIS[soi]["center"]
            return {"lat": lat, "lng": lng, "soi": soi, "precision": precision, "source": "osm"}
        return {"lat": village_center[0], "lng": village_center[1], "soi": None, "precision": "unknown", "source": None}

    async def learn(house: str, soi: Optional[str] = None, lat=None, lng=None, source="text", by="system", building_id=None):
        """Upsert what we know about a house without letting a weaker source overwrite a stronger one."""
        cur = await db.addresses.find_one({"house": house})
        if cur and SOURCE_RANK.get(cur.get("source"), 0) > SOURCE_RANK[source]:
            if soi and not cur.get("soi"):
                await db.addresses.update_one({"house": house}, {"$set": {"soi": soi}})
            return
        changes = {"house": house, "source": source, "updated_at": now(), "updated_by": by}
        if soi:
            changes["soi"] = soi
        if lat is not None:
            changes.update(lat=lat, lng=lng)
        if building_id is not None:
            changes["building_id"] = building_id
        await db.addresses.update_one({"house": house}, {"$set": changes}, upsert=True)

    @router.get("/sois")
    async def sois():
        return {"source": SOI_DATA["source"], "sois": SOIS}

    @router.get("/zones")
    async def zones():
        """Public: zones, the drop points on the main road, and every house coloured by zone.
        Merged zones (one block, one drop point) follow settings "zone_groups" when an admin has set it,
        else the grouping baked into zones.json."""
        doc = await db.settings.find_one({"id": "zone_groups"}, {"_id": 0})
        return with_groups(ZONES, doc["groups"]) if doc else ZONES

    @router.get("/admin/zone-groups")
    async def get_zone_groups(admin: dict = Depends(require_admin)):
        doc = await db.settings.find_one({"id": "zone_groups"}, {"_id": 0})
        default = sorted({tuple(z["drop"]["shared"]) for z in ZONES["zones"]})
        return {"groups": doc["groups"] if doc else [list(g) for g in default], "custom": bool(doc)}

    @router.put("/admin/zone-groups")
    async def set_zone_groups(body: ZoneGroups, admin: dict = Depends(require_admin)):
        """Merge / split zones without a deploy, e.g. [["A","B"],["G","H"]]; [] = every zone alone.
        DELETE goes back to the grouping in zones.json."""
        ids = {z["id"] for z in ZONES["zones"]}
        seen = set()
        for g in body.groups:
            if not g or any(i not in ids for i in g) or seen & set(g):
                raise HTTPException(422, "กลุ่มโซนไม่ถูกต้อง: ต้องเป็นโซนที่มีอยู่ และแต่ละโซนอยู่ได้กลุ่มเดียว")
            seen |= set(g)
        groups = [g for g in body.groups if len(g) > 1]
        await db.settings.update_one({"id": "zone_groups"}, {"$set": {"id": "zone_groups", "groups": groups, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "set_zone_groups", " ".join("+".join(g) for g in groups))
        return {"groups": groups}

    @router.delete("/admin/zone-groups", status_code=204)
    async def reset_zone_groups(admin: dict = Depends(require_admin)):
        await db.settings.delete_one({"id": "zone_groups"})
        await audit(admin, "reset_zone_groups", "")

    @router.get("/staff/buildings")
    async def buildings(user: dict = Depends(require_staff)):
        taken = {a["building_id"]: a["house"] async for a in db.addresses.find({"building_id": {"$ne": None}}, {"building_id": 1, "house": 1})}
        return {"source": BUILDINGS["source"], "buildings": [[lat, lng, bid, taken.get(bid)] for lat, lng, bid in BUILDINGS["buildings"]]}

    @router.get("/staff/addresses")
    async def list_addresses(q: str = "", user: dict = Depends(require_staff)):
        filt = {}
        h = house_of(q) if q else None
        if h:
            filt["house"] = h
        docs = await db.addresses.find(filt, {"_id": 0}).sort("updated_at", -1).to_list(2000)
        if h and not docs:
            loc = await locate(h)
            return [{"house": h, "soi": loc["soi"], "precision": loc["precision"], "unsaved": True}]
        return docs

    @router.put("/staff/addresses/{num}")
    async def set_address(num: int, body: AddressSet, user: dict = Depends(require_staff)):
        house = f"4/{num}"
        soi = body.soi if body.soi in SOIS else None
        if body.building_id is not None:  # one building = one house number
            other = await db.addresses.find_one({"building_id": body.building_id, "house": {"$ne": house}})
            if other:
                raise HTTPException(409, f"อาคารนี้ตั้งเป็น {other['house']} ไว้แล้ว")
        await learn(house, soi=soi, lat=body.lat, lng=body.lng, source="staff", by=user["name"], building_id=body.building_id)
        # move open requests of this house onto the confirmed spot
        await db.posts.update_many({"house": house, "status": {"$ne": "done"}}, {"$set": {"lat": body.lat, "lng": body.lng, "precision": "house", **({"soi": soi} if soi else {})}})
        await audit(user, "set_address", house, f"{body.lat:.5f},{body.lng:.5f} soi={soi}")
        return await db.addresses.find_one({"house": house}, {"_id": 0})

    # ---------- tasks ----------
    def task_view(p: dict) -> dict:
        out = public_post(p)
        out["phone"] = p.get("phone", "")  # staff need to call
        out["zone"] = zone_of_soi(p.get("soi"))
        return out

    @router.get("/staff/tasks")
    async def tasks(include_done: bool = False, user: dict = Depends(require_staff)):
        q = {"kind": "need", "payment": {"$ne": "paid"}}  # paid jobs belong to the contact board, not staff
        if not include_done:
            q["status"] = {"$ne": "done"}
        docs = await db.posts.find(q, {"_id": 0, "edit_key_hash": 0}).sort([("urgent", -1), ("created_at", 1)]).to_list(2000)
        return [task_view(p) for p in docs]

    async def history(post_id: str, user: dict, status: str, note: str):
        await db.posts.update_one({"id": post_id}, {"$push": {"history": {"at": now(), "status": status, "name": user["name"], "note": note, "staff": True}}})

    @router.post("/staff/tasks/{post_id}/claim")
    async def claim(post_id: str, user: dict = Depends(require_staff)):
        doc = await db.posts.find_one_and_update(
            {"id": post_id, "kind": "need", "status": {"$ne": "done"}, "$or": [{"assignee": None}, {"assignee": {"$exists": False}}, {"assignee.id": user["id"]}]},
            {"$set": {"assignee": me(user), "assigned_at": now(), "status": "helping", "updated_at": now()}},
            projection={"_id": 0, "edit_key_hash": 0},
            return_document=True,
        )
        if not doc:
            cur = await db.posts.find_one({"id": post_id}, {"assignee": 1, "status": 1})
            if not cur:
                raise HTTPException(404, "ไม่พบงาน")
            who = (cur.get("assignee") or {}).get("name", "คนอื่น")
            raise HTTPException(409, f"{who} รับงานนี้ไปแล้ว" if cur.get("status") != "done" else "งานนี้เสร็จไปแล้ว")
        await history(post_id, user, "helping", "เจ้าหน้าที่รับงาน")
        return task_view(await db.posts.find_one({"id": post_id}, {"_id": 0}))

    @router.post("/staff/tasks/claim-soi/{soi}")
    async def claim_soi(soi: str, user: dict = Depends(require_staff)):
        filt = {"kind": "need", "status": {"$ne": "done"}, "soi": soi, "$or": [{"assignee": None}, {"assignee": {"$exists": False}}]}
        ids = [p["id"] async for p in db.posts.find(filt, {"id": 1})]
        taken = 0
        for pid in ids:  # one by one so a concurrent claim on any single house still wins cleanly
            r = await db.posts.update_one({**filt, "id": pid}, {"$set": {"assignee": me(user), "assigned_at": now(), "status": "helping", "updated_at": now()}})
            if r.modified_count:
                taken += 1
                await history(pid, user, "helping", f"เจ้าหน้าที่รับทั้งซอย {soi}")
        return {"claimed": taken, "soi": soi}

    @router.post("/staff/tasks/{post_id}/release")
    async def release(post_id: str, user: dict = Depends(require_staff)):
        filt = {"id": post_id} if user.get("role", "admin") == "admin" else {"id": post_id, "assignee.id": user["id"]}
        doc = await db.posts.find_one_and_update(filt, {"$set": {"assignee": None, "status": "open", "updated_at": now()}}, projection={"_id": 0}, return_document=True)
        if not doc:
            raise HTTPException(403, "ปล่อยได้เฉพาะงานของคุณ")
        await history(post_id, user, "open", "ปล่อยงานคืน (ยังไม่มีคนรับ)")
        return task_view(doc)

    @router.patch("/staff/tasks/{post_id}")
    async def edit_task(post_id: str, body: TaskEdit, user: dict = Depends(require_staff)):
        post = await db.posts.find_one({"id": post_id, "kind": "need"}, {"_id": 0})
        if not post:
            raise HTTPException(404, "ไม่พบงาน")
        if post.get("assignee") and post["assignee"]["id"] != user["id"] and user.get("role", "admin") != "admin":
            raise HTTPException(409, f"{post['assignee']['name']} รับงานนี้อยู่ ให้คนที่รับแก้ หรือขอให้ปล่อยงานก่อน")
        changes = {k: v for k, v in body.model_dump().items() if v is not None and v != post.get(k)}
        if "detail" in changes:
            changes["detail"] = changes["detail"].strip() or post.get("detail", "")
        if not changes:
            return task_view(post)
        await db.posts.update_one({"id": post_id}, {"$set": {**changes, "updated_at": now()}})
        labels = {"category": "ประเภท", "people": "จำนวน", "urgent": "ด่วน", "detail": "รายละเอียด"}
        await history(post_id, user, post["status"], "แก้ไข " + ", ".join(labels[k] for k in changes))
        return task_view(await db.posts.find_one({"id": post_id}, {"_id": 0}))

    @router.post("/staff/tasks/{post_id}/done")
    async def done(post_id: str, body: DoneBody, user: dict = Depends(require_staff)):
        doc = await db.posts.find_one_and_update(
            {"id": post_id}, {"$set": {"status": "done", "done_by": me(user), "updated_at": now()}}, projection={"_id": 0}, return_document=True
        )
        if not doc:
            raise HTTPException(404, "ไม่พบงาน")
        await history(post_id, user, "done", body.note or "เจ้าหน้าที่ช่วยเสร็จแล้ว")
        return task_view(await db.posts.find_one({"id": post_id}, {"_id": 0}))

    # ---------- LINE import ----------
    def parse_line_export(text: str) -> tuple[int, dict]:
        msgs, cur, day = [], None, ""
        for line in text.splitlines():
            if DATE_LINE.match(line):
                day = line.split(" ")[0]
                continue
            m = MSG_START.match(line)
            if m:
                cur = {"stamp": f"{day} {m.group(1)}".strip(), "lines": [m.group(2)]}
                msgs.append(cur)
            elif cur:
                cur["lines"].append(line)
        if not msgs:  # plain pasted list without timestamps
            msgs = [{"stamp": "", "lines": text.splitlines()}]
        houses: dict[str, dict] = {}
        skipped = 0
        for msg in msgs:
            body = "\n".join(msg["lines"])
            if SALE_RE.search(body):  # not staff work: selling / pre-orders
                skipped += 1
                continue
            # a short "got it" message about one house counts even if the words are on another line
            confirm = bool(RECEIVED_RE.search(body)) and not NOT_RECEIVED_RE.search(body) and len(body) < 200 and len(set(HOUSE_RE.findall(body))) == 1
            lines = list(msg["lines"])
            # Many display names carry the poster's house ("Sara 4/1552"), so every message they send
            # "mentions" it. Count that house only when the message asks for help for it alone.
            tag = NAME_TAG_RE.match(lines[0]) if lines else None
            if tag:
                rest = "\n".join([lines[0][tag.end():]] + lines[1:])
                own_request = not HOUSE_RE.search(rest) and NEED_SIGNAL_RE.search(rest)
                if not own_request:
                    lines[0] = lines[0][tag.end():]
            for line in lines:
                for num in HOUSE_RE.findall(line):
                    h = f"4/{int(num)}"
                    clean = re.sub(r"^\s*\d+\s*[.)]\s*", "", line).strip()
                    rec = houses.setdefault(h, {"house": h, "mentions": 0, "first_seen": msg["stamp"]})
                    rec["mentions"] += 1
                    rec.update(last_seen=msg["stamp"], text=clean[:500])
                    s = soi_of(clean)
                    if s:
                        rec["soi"] = s
                    ph = PHONE_RE.search(clean)
                    if ph:
                        rec["phone"] = re.sub(r"[\s-]", "", ph.group(0))
                    # "got it" sticks: copied lists keep repeating old requests. Only an explicit
                    # "ยังไม่ได้ / ยังรอ" about the house reopens it.
                    if (RECEIVED_RE.search(line) and not NOT_RECEIVED_RE.search(line)) or confirm:
                        rec["received"] = True
                        rec["received_text"] = (body if confirm else clean)[:300].replace("\n", " / ")
                    elif NOT_RECEIVED_RE.search(line):
                        rec["received"] = False
        return len(msgs), houses, skipped

    @router.post("/staff/import/preview")
    async def import_preview(body: ImportPreview, user: dict = Depends(require_importer)):
        n_msgs, houses, skipped = parse_line_export(body.text)
        pairs = await known_sois()
        pairs += [(house_num(h), r["soi"]) for h, r in houses.items() if r.get("soi")]
        pairs.sort()
        open_posts = {p["house"]: p async for p in db.posts.find({"kind": "need", "status": {"$ne": "done"}, "house": {"$in": list(houses)}}, {"_id": 0, "id": 1, "house": 1, "status": 1})}
        # Copy-and-extend lists keep re-posting houses that were already helped: flag them.
        recent_done = {p["house"]: p async for p in db.posts.find(
            {"kind": "need", "status": "done", "closed_reason": None, "house": {"$in": list(houses)}, "updated_at": {"$gte": now() - RECENT_DONE}},
            {"_id": 0, "house": 1, "updated_at": 1, "done_by": 1})}
        rows = []
        for h, r in sorted(houses.items(), key=lambda kv: house_num(kv[0])):
            loc = await locate(h, r.get("soi"), pairs)
            category, vulnerable = needs_of(r["text"])
            # "3 ที่", "2 กล่อง" — not a house number ("4/705 คนชรา" is not 705 people)
            portions = sum(n for n in (int(x) for x in re.findall(r"(?<![\d/])(\d{1,3})\s*(?:ที่|กล่อง|ชุด|คน(?!ชรา|แก่|ป่วย))", r["text"])) if n <= 100) or None
            rows.append({**r, "soi": loc["soi"], "soi_from_text": bool(r.get("soi")), "precision": loc["precision"], "category": category, "vulnerable": vulnerable,
                         "portions": portions, "existing_post": (open_posts.get(h) or {}).get("id"),
                         "recently_done": h in recent_done and h not in open_posts,
                         "done_by": ((recent_done.get(h) or {}).get("done_by") or {}).get("name")})
        mentions = sum(r["mentions"] for r in houses.values())
        return {
            "messages": n_msgs, "skipped_sales": skipped, "mentions": mentions, "houses": len(rows), "rows": rows,
            "new": sum(1 for r in rows if not r["existing_post"] and not r["recently_done"] and not r.get("received")),
            "already_open": sum(1 for r in rows if r["existing_post"]),
            "recently_done": sum(1 for r in rows if r["recently_done"]),
            "to_clear": sum(1 for r in rows if r.get("received") and r["existing_post"]),
        }

    @router.post("/staff/import/commit")
    async def import_commit(body: ImportCommit, request: Request, user: dict = Depends(require_importer)):
        created, updated, skipped_done = 0, 0, 0
        # pass 1: what the chat itself says (house -> soi) goes into the address book first...
        for row in body.rows:
            if row.soi in SOIS and row.soi_from_text:
                await learn(row.house, soi=row.soi, source="text", by=user["name"])
        # ...so pass 2 can estimate the soi of the houses that didn't say it
        pairs = await known_sois()
        cleared, cleared_houses = 0, []
        for row in body.rows:
            soi = row.soi if row.soi in SOIS and row.soi_from_text else None
            existing = await db.posts.find_one({"kind": "need", "status": {"$ne": "done"}, "house": row.house})
            if row.received:
                if existing:
                    await db.posts.update_one({"id": existing["id"]}, {"$set": {"status": "done", "done_by": me(user), "updated_at": now()}})
                    await history(existing["id"], user, "done", f"แจ้งใน LINE ว่าได้รับแล้ว: {row.text[:200]}")
                    cleared += 1
                    cleared_houses.append(row.house)
                continue
            if existing:  # same house already has an open request: add the new wording, don't duplicate
                note = f"จาก LINE: {row.text[:200]}"
                if not any(h.get("note") == note for h in existing.get("history", [])):  # re-imports repeat the same lines
                    await history(existing["id"], user, existing["status"], note)
                if needs_of(row.text)[1] and not existing.get("urgent"):  # new message says elderly / sick / children
                    await db.posts.update_one({"id": existing["id"]}, {"$set": {"urgent": True}})
                updated += 1
                continue
            if not row.force and await db.posts.find_one({"kind": "need", "status": "done", "closed_reason": None, "house": row.house, "updated_at": {"$gte": now() - RECENT_DONE}}):
                skipped_done += 1  # helped recently; the chat is just repeating an old list
                continue
            # closed WITHOUT help (went quiet / "not needed" / not a request) and now asking again: reopen that case
            closed = await db.posts.find_one({"kind": "need", "status": "done", "closed_reason": {"$ne": None}, "house": row.house}, sort=[("updated_at", -1)])
            if closed:
                await db.posts.update_one({"id": closed["id"]}, {"$set": {"status": "open", "closed_reason": None, "assignee": None, "updated_at": now()}})
                await history(closed["id"], user, "open", f"เปิดใหม่ — ขอใน LINE อีกครั้ง: {row.text[:180]}")
                updated += 1
                continue
            loc = await locate(row.house, soi, pairs)
            category, vulnerable = needs_of(row.text)
            t = now()
            place = f"{row.house}" + (f" แยก {loc['soi']}" if loc["soi"] else "")
            doc = {
                "id": str(uuid.uuid4()), "kind": "need", "category": category, "detail": row.text or "ขอความช่วยเหลือ (จาก LINE)",
                "place": place, "name": "จาก LINE OpenChat", "phone": row.phone, "people": row.portions,
                "urgent": vulnerable, "general": False, "payment": "free", "price": "",
                "media": [], "pinned": False, "status": "open", "created_at": t, "updated_at": t,
                "lat": loc["lat"], "lng": loc["lng"], "house": row.house, "soi": loc["soi"], "precision": loc["precision"], "source": "line",
                "history": [{"at": t, "status": "open", "name": user["name"], "note": "นำเข้าจาก LINE OpenChat", "staff": True}],
                "edit_key_hash": "", "assignee": None,
            }
            await db.posts.insert_one(doc)
            created += 1
        await audit(user, "import_line", "", f"created {created}, merged {updated}, cleared {cleared}, skipped recently done {skipped_done}")
        return {"created": created, "merged_into_existing": updated, "cleared": cleared, "cleared_houses": cleared_houses, "skipped_recently_done": skipped_done}

    # ---------- lookup by house number (for announcements) ----------
    @router.post("/staff/houses/lookup")
    async def lookup(body: LookupBody, user: dict = Depends(require_staff)):
        pairs = await known_sois()
        wanted: set[int] = set()
        ranges = []
        for a, b in re.findall(r"4\s*/\s*(\d{1,4})\s*[-–ถึง]+\s*(?:4\s*/\s*)?(\d{1,4})", body.query):
            lo, hi = sorted((int(a), int(b)))
            ranges.append((lo, hi))
        singles = {int(n) for n in HOUSE_RE.findall(re.sub(r"4\s*/\s*\d{1,4}\s*[-–ถึง]+\s*(?:4\s*/\s*)?\d{1,4}", " ", body.query))}
        wanted |= singles
        known = {house_num(a["house"]): a async for a in db.addresses.find({}, {"_id": 0})}
        posts = {p["house"]: p async for p in db.posts.find({"house": {"$ne": None}, "status": {"$ne": "done"}}, {"_id": 0, "id": 1, "house": 1, "kind": 1, "category": 1, "status": 1})}
        for lo, hi in ranges:
            wanted |= {n for n in known if lo <= n <= hi} | {house_num(h) for h in posts if lo <= house_num(h) <= hi}
        rows = []
        for n in sorted(wanted):
            h = f"4/{n}"
            loc = await locate(h, (known.get(n) or {}).get("soi"), pairs)
            rows.append({"house": h, "soi": loc["soi"], "precision": loc["precision"], "lat": loc["lat"], "lng": loc["lng"], "open_post": posts.get(h)})
        # which sois a range most likely covers, from known house->soi pairs
        range_sois = []
        for lo, hi in ranges:
            found = {s for num, s in pairs if lo <= num <= hi} | {estimate_soi(lo, pairs), estimate_soi(hi, pairs)} - {None}
            # one stray pair in the chat (e.g. a 4/2xx house typed next to "55") shouldn't widen the range:
            # keep sois close to the bulk of what the range says
            nums = sorted(int(s.split("/")[0]) for s in found)
            if len(nums) >= 3:
                median = nums[len(nums) // 2]
                spread = max(6, (nums[-2] - nums[1]) * 2) if len(nums) >= 4 else 10
                found = {s for s in found if abs(int(s.split("/")[0]) - median) <= spread}
            sois = sorted(found, key=lambda s: int(s.split("/")[0]))
            range_sois.append({"range": f"4/{lo}–4/{hi}", "sois": sois})
        return {"rows": rows, "ranges": range_sois}

    return router, locate, learn, require_staff
