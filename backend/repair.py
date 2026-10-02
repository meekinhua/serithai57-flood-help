"""After the flood (2 Oct 2026): the water is gone and the village is cleaning and repairing.

The flood board is frozen as an archive (read-only, see FLOOD_WRITES / site mode) and the home page
becomes "ซ่อมบ้าน" mode, with four boards that work like the flood board did (no accounts; whoever
posts gets an edit key kept in their browser; phone numbers are revealed one item at a time):

- lend   ยืม · ให้ยืม · ให้ฟรี · ตามหา  — pressure washers, wet vacs, ladders, fans... with a queue
          of neighbours waiting to borrow, which only the owner sees in full (names + phones)
- jobs   ขอแรง / อาสาไปช่วย — clean a house, carry out ruined furniture, haul trash; helpers sign up
- issues ปัญหาในซอย — trash piles waiting for the district truck, blocked drains, dead street lights,
          broken road, fallen trees, hanging wires; "me too" counts, status open → reported → fixed
- reviews on the contact board (services): neighbours say a tradesman was good (or not) and why

Site mode: settings {id: "site_mode", mode: "repair"|"flood"}. In repair mode the flood write routes
answer 423 for everyone but admins; an admin can switch back to flood mode if the water returns.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

LendKind = Literal["lend", "give", "want"]  # ให้ยืม · ให้ฟรี · ตามหา/อยากยืม
LEND_CATEGORIES = [
    "washer", "pump", "vacuum", "dryer", "ladder", "cleaning", "tools", "cart", "power", "furniture", "supplies", "other",
]
LendStatus = Literal["available", "lent", "closed"]  # ว่าง · มีคนยืมอยู่ · ปิด (คืนเจ้าของ/ให้ไปแล้ว/หาได้แล้ว)
JobKind = Literal["need", "offer"]  # ขอแรง · อาสาพร้อมไปช่วย
JOB_TYPES = ["clean", "move", "trash", "fix", "check", "elderly", "other"]
JobStatus = Literal["open", "scheduled", "done"]
ISSUE_TYPES = ["trash", "drain", "light", "road", "tree", "wire", "water", "smell", "other"]
IssueStatus = Literal["open", "reported", "fixed"]
SiteMode = Literal["repair", "flood"]

# Writes that belong to the flood board: closed in repair mode (admins can still fix things).
FLOOD_WRITES = ("/api/posts", "/api/water", "/api/canal", "/api/pumps", "/api/leaks", "/api/ops", "/api/team", "/api/staff", "/api/zones")
HIDDEN = {"_id": 0, "edit_key_hash": 0, "phone": 0, "house": 0, "voters": 0}


def now():
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _clean(d: dict) -> dict:
    return {k: v.strip() if isinstance(v, str) else v for k, v in d.items()}


class Contact(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    phone: str = Field("", max_length=40)


class LendCreate(Contact):
    kind: LendKind = "lend"
    category: str
    title: str = Field(..., min_length=2, max_length=80)  # "เครื่องฉีดน้ำแรงดันสูง Karcher"
    detail: str = Field("", max_length=400)  # condition, how long, deposit, pick up where
    soi: str = Field("", max_length=12)
    media_ids: list[str] = Field(default_factory=list, max_length=3)


class LendUpdate(BaseModel):
    status: Optional[LendStatus] = None
    lent_to: Optional[str] = Field(None, max_length=60)  # who has it now (name only)
    until: Optional[str] = Field(None, max_length=40)  # "คืนเสาร์ 4 ต.ค."
    detail: Optional[str] = Field(None, max_length=400)


class QueueJoin(Contact):
    phone: str = Field(..., min_length=3, max_length=40)  # the owner has to be able to call back
    note: str = Field("", max_length=160)  # "ขอใช้ครึ่งวัน พรุ่งนี้เช้า"


class JobCreate(Contact):
    kind: JobKind = "need"
    type: str
    detail: str = Field(..., min_length=3, max_length=400)
    soi: str = Field("", max_length=12)
    house: str = Field("", max_length=20)  # shown only with the phone
    when: str = Field("", max_length=60)  # "เสาร์นี้ 9 โมง"
    people: int = Field(2, ge=1, le=30)


class JobJoin(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class JobStatusBody(BaseModel):
    status: JobStatus
    name: str = Field("", max_length=60)
    note: str = Field("", max_length=160)


class IssueCreate(BaseModel):
    type: str
    detail: str = Field("", max_length=300)
    soi: str = Field("", max_length=12)
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)
    name: str = Field("", max_length=60)
    media_ids: list[str] = Field(default_factory=list, max_length=2)


class IssueStatusBody(BaseModel):
    status: IssueStatus
    name: str = Field("", max_length=60)
    note: str = Field("", max_length=160)  # "แจ้ง Traffy แล้ว เลขที่ ..." / "รถเขตมาเก็บแล้ว"


class ReviewBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    good: bool = True
    text: str = Field("", max_length=200)


class SiteBody(BaseModel):
    mode: SiteMode


async def site_mode(db) -> str:
    doc = await db.settings.find_one({"id": "site_mode"}, {"_id": 0})
    return (doc or {}).get("mode", "repair")


def build_router(db, rate_limit, current_admin, require_admin, audit, client_ip, claim_media, delete_media) -> APIRouter:
    router = APIRouter(prefix="/api")

    def log(by: str, text: str) -> dict:
        return {"at": now(), "by": (by or "ไม่ระบุชื่อ")[:60], "text": text[:200]}

    async def owned(coll, item_id: str, key: str, request: Request) -> dict:
        doc = await coll.find_one({"id": item_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        admin = await current_admin(request)
        if not (key and doc.get("edit_key_hash") == _hash(key)) and not (admin and admin.get("role", "admin") == "admin"):
            raise HTTPException(403, "แก้ไขได้เฉพาะคนที่ลงไว้ (จากเครื่องที่ลง)")
        return doc

    def public_lend(d: dict) -> dict:
        out = {k: v for k, v in d.items() if k not in ("_id", "edit_key_hash", "phone", "queue")}
        out["queue_count"] = len([q for q in d.get("queue", []) if not q.get("done")])
        out["has_phone"] = bool(d.get("phone"))
        return out

    # ---------------- site mode ----------------
    @router.get("/site")
    async def get_site():
        return {"mode": await site_mode(db)}

    @router.put("/admin/site")
    async def set_site(body: SiteBody, admin: dict = Depends(require_admin)):
        await db.settings.update_one({"id": "site_mode"}, {"$set": {"id": "site_mode", "mode": body.mode, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "site_mode", body.mode)
        return {"mode": body.mode}

    # ---------------- lend / borrow / give ----------------
    @router.get("/lend")
    async def list_lend(include_closed: bool = False):
        q = {} if include_closed else {"status": {"$ne": "closed"}}
        docs = await db.lend_items.find(q, {"_id": 0}).sort([("status", 1), ("updated_at", -1)]).to_list(1000)
        return [public_lend(d) for d in docs]

    @router.post("/lend", status_code=201)
    async def create_lend(body: LendCreate, request: Request):
        rate_limit(request, "lend", limit=15, window_s=600)
        if body.category not in LEND_CATEGORIES:
            raise HTTPException(422, "หมวดหมู่ไม่ถูกต้อง")
        if body.kind != "want" and len(body.phone.strip()) < 3:
            raise HTTPException(422, "ใส่เบอร์โทรให้คนยืมติดต่อได้")
        key, item_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        doc = {
            "id": item_id,
            **_clean(body.model_dump(exclude={"media_ids"})),
            "media": await claim_media(body.media_ids, f"lend:{item_id}", {"image"}),
            "status": "available",
            "lent_to": "",
            "until": "",
            "queue": [],
            "history": [log(body.name, "ลงรายการ")],
            "created_at": t,
            "updated_at": t,
            "edit_key_hash": _hash(key),
        }
        await db.lend_items.insert_one(dict(doc))
        return {**public_lend(doc), "edit_key": key}

    @router.get("/lend/{item_id}/contact")
    async def lend_contact(item_id: str, request: Request):
        rate_limit(request, "contact", limit=40, window_s=600)
        doc = await db.lend_items.find_one({"id": item_id}, {"_id": 0, "phone": 1, "name": 1})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return {"phone": doc.get("phone", ""), "name": doc.get("name", "")}

    @router.post("/lend/{item_id}/queue")
    async def join_queue(item_id: str, body: QueueJoin, request: Request):
        """'I'd like to borrow it': the owner sees who is waiting, in order, with phone numbers."""
        rate_limit(request, "lend-queue", limit=20, window_s=600)
        entry = {"id": uuid.uuid4().hex[:10], **_clean(body.model_dump()), "at": now(), "done": False}
        doc = await db.lend_items.find_one_and_update(
            {"id": item_id, "status": {"$ne": "closed"}},
            {"$push": {"queue": entry, "history": log(body.name, "ขอคิวยืม")}, "$set": {"updated_at": now()}},
            projection={"_id": 0},
            return_document=True,
        )
        if not doc:
            raise HTTPException(404, "รายการนี้ปิดไปแล้ว")
        return public_lend(doc)

    @router.get("/lend/{item_id}/owner")
    async def lend_owner(item_id: str, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lend_items, item_id, x_edit_key, request)
        return {**public_lend(doc), "queue": doc.get("queue", []), "phone": doc.get("phone", "")}

    @router.patch("/lend/{item_id}")
    async def update_lend(item_id: str, body: LendUpdate, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lend_items, item_id, x_edit_key, request)
        changes = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items() if v is not None}
        if not changes:
            raise HTTPException(422, "ไม่มีข้อมูลที่จะแก้ไข")
        if changes.get("status") == "available":
            changes.update(lent_to="", until="")
        text = {"available": "ว่างแล้ว / คืนแล้ว", "lent": f"ให้ยืมไป{(' · ' + changes.get('lent_to', '')) if changes.get('lent_to') else ''}", "closed": "ปิดรายการ"}.get(changes.get("status"), "แก้ไขรายละเอียด")
        upd = {"$set": {**changes, "updated_at": now()}, "$push": {"history": log(doc["name"], text)}}
        doc = await db.lend_items.find_one_and_update({"id": item_id}, upd, projection={"_id": 0}, return_document=True)
        return public_lend(doc)

    @router.post("/lend/{item_id}/queue/{entry_id}/done")
    async def queue_done(item_id: str, entry_id: str, request: Request, x_edit_key: str = Header("")):
        await owned(db.lend_items, item_id, x_edit_key, request)
        await db.lend_items.update_one({"id": item_id, "queue.id": entry_id}, {"$set": {"queue.$.done": True}})
        return await lend_owner(item_id, request, x_edit_key)

    @router.delete("/lend/{item_id}", status_code=204)
    async def delete_lend(item_id: str, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lend_items, item_id, x_edit_key, request)
        await db.lend_items.delete_one({"id": item_id})
        for m in doc.get("media", []):
            await delete_media(m["id"])

    # ---------------- jobs: ask for hands / volunteer ----------------
    @router.get("/jobs")
    async def list_jobs(include_done: bool = False):
        q = {} if include_done else {"status": {"$ne": "done"}}
        docs = await db.jobs.find(q, HIDDEN).sort([("status", 1), ("created_at", -1)]).to_list(1000)
        return docs

    @router.post("/jobs", status_code=201)
    async def create_job(body: JobCreate, request: Request):
        rate_limit(request, "job", limit=15, window_s=600)
        if body.type not in JOB_TYPES:
            raise HTTPException(422, "ประเภทงานไม่ถูกต้อง")
        if len(body.phone.strip()) < 3:
            raise HTTPException(422, "ใส่เบอร์โทรให้อาสาติดต่อได้")
        key, t = secrets.token_urlsafe(18), now()
        doc = {
            "id": str(uuid.uuid4()),
            **_clean(body.model_dump()),
            "has_phone": True,
            "helpers": [],
            "status": "open",
            "history": [log(body.name, "ลงประกาศ")],
            "created_at": t,
            "updated_at": t,
            "edit_key_hash": _hash(key),
        }
        await db.jobs.insert_one(dict(doc))
        return {**{k: v for k, v in doc.items() if k not in HIDDEN}, "edit_key": key}

    @router.get("/jobs/{job_id}/contact")
    async def job_contact(job_id: str, request: Request):
        rate_limit(request, "contact", limit=40, window_s=600)
        doc = await db.jobs.find_one({"id": job_id}, {"_id": 0, "phone": 1, "house": 1})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return {"phone": doc.get("phone", ""), "house": doc.get("house", "")}

    @router.post("/jobs/{job_id}/join")
    async def join_job(job_id: str, body: JobJoin, request: Request):
        rate_limit(request, "job-join", limit=30, window_s=600)
        who = body.name.strip()
        doc = await db.jobs.find_one({"id": job_id}, {"_id": 0})
        if not doc or doc["status"] == "done":
            raise HTTPException(404, "งานนี้ปิดไปแล้ว")
        if any(h["name"] == who for h in doc.get("helpers", [])):
            return {k: v for k, v in doc.items() if k not in HIDDEN}
        helpers = doc.get("helpers", []) + [{"name": who, "at": now()}]
        status = "scheduled" if doc["kind"] == "need" and len(helpers) >= doc.get("people", 1) else doc["status"]
        doc = await db.jobs.find_one_and_update(
            {"id": job_id},
            {"$set": {"helpers": helpers, "status": status, "updated_at": now()}, "$push": {"history": log(who, "ไปช่วย" if doc["kind"] == "need" else "ขอให้มาช่วย")}},
            projection=HIDDEN,
            return_document=True,
        )
        return doc

    @router.post("/jobs/{job_id}/status")
    async def job_status(job_id: str, body: JobStatusBody, request: Request):
        rate_limit(request, "job-status", limit=30, window_s=600)
        text = {"open": "เปิดใหม่ / ยังต้องการคน", "scheduled": "นัดกันแล้ว", "done": "เสร็จแล้ว"}[body.status]
        doc = await db.jobs.find_one_and_update(
            {"id": job_id},
            {"$set": {"status": body.status, "updated_at": now()}, "$push": {"history": log(body.name, f"{text}{(' · ' + body.note.strip()) if body.note.strip() else ''}")}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return doc

    @router.delete("/jobs/{job_id}", status_code=204)
    async def delete_job(job_id: str, request: Request, x_edit_key: str = Header("")):
        await owned(db.jobs, job_id, x_edit_key, request)
        await db.jobs.delete_one({"id": job_id})

    # ---------------- soi issues ----------------
    @router.get("/issues")
    async def list_issues(include_fixed: bool = False):
        q = {} if include_fixed else {"status": {"$ne": "fixed"}}
        return await db.issues.find(q, HIDDEN).sort([("status", 1), ("votes", -1), ("created_at", -1)]).to_list(1000)

    @router.post("/issues", status_code=201)
    async def create_issue(body: IssueCreate, request: Request):
        rate_limit(request, "issue", limit=20, window_s=600)
        if body.type not in ISSUE_TYPES:
            raise HTTPException(422, "ประเภทปัญหาไม่ถูกต้อง")
        if body.lat is None and not body.soi.strip():
            raise HTTPException(422, "บอกซอย หรือปักหมุดตำแหน่ง")
        issue_id, t = str(uuid.uuid4()), now()
        doc = {
            "id": issue_id,
            **_clean(body.model_dump(exclude={"media_ids"})),
            "media": await claim_media(body.media_ids, f"issue:{issue_id}", {"image"}),
            "status": "open",
            "votes": 1,
            "voters": [_hash(client_ip(request))],
            "history": [log(body.name, "แจ้งปัญหา")],
            "created_at": t,
            "updated_at": t,
        }
        await db.issues.insert_one(dict(doc))
        return {k: v for k, v in doc.items() if k not in HIDDEN}

    @router.post("/issues/{issue_id}/plusone")
    async def plus_one(issue_id: str, request: Request):
        rate_limit(request, "issue-vote", limit=40, window_s=600)
        who = _hash(client_ip(request))
        doc = await db.issues.find_one_and_update(
            {"id": issue_id, "voters": {"$ne": who}}, {"$inc": {"votes": 1}, "$push": {"voters": who}}, projection=HIDDEN, return_document=True
        )
        return doc or await db.issues.find_one({"id": issue_id}, HIDDEN)

    @router.post("/issues/{issue_id}/status")
    async def issue_status(issue_id: str, body: IssueStatusBody, request: Request):
        rate_limit(request, "issue-status", limit=30, window_s=600)
        text = {"open": "ยังไม่ได้แก้", "reported": "แจ้งเขต / หน่วยงานแล้ว", "fixed": "แก้แล้ว"}[body.status]
        doc = await db.issues.find_one_and_update(
            {"id": issue_id},
            {"$set": {"status": body.status, "updated_at": now()}, "$push": {"history": log(body.name, f"{text}{(' · ' + body.note.strip()) if body.note.strip() else ''}")}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return doc

    @router.delete("/admin/issues/{issue_id}", status_code=204)
    async def admin_delete_issue(issue_id: str, admin: dict = Depends(require_admin)):
        doc = await db.issues.find_one_and_delete({"id": issue_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        for m in doc.get("media", []):
            await delete_media(m["id"])
        await audit(admin, "delete_issue", issue_id, doc.get("detail", ""))

    # ---------------- reviews on the contact board ----------------
    @router.post("/services/{service_id}/review")
    async def review_service(service_id: str, body: ReviewBody, request: Request):
        """One review per device-IP per listing; the newest replaces the older one."""
        rate_limit(request, "service-review", limit=20, window_s=600)
        who = _hash(client_ip(request))
        doc = await db.services.find_one({"id": service_id}, {"_id": 0, "id": 1, "reviews": 1})
        if doc is None:
            raise HTTPException(404, "ไม่พบรายการ")
        reviews = [r for r in doc.get("reviews", []) if r.get("who") != who]
        reviews.append({"who": who, "name": body.name.strip(), "good": body.good, "text": body.text.strip(), "at": now()})
        reviews = reviews[-30:]
        await db.services.update_one(
            {"id": service_id},
            {"$set": {"reviews": reviews, "good": sum(r["good"] for r in reviews), "bad": sum(not r["good"] for r in reviews)}},
        )
        return await db.services.find_one({"id": service_id}, {"_id": 0, "edit_key_hash": 0, "reporters": 0, "reviews.who": 0})

    return router
