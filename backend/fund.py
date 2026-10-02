"""เงินสมทบทีมอาสา (2 Oct 2026): one public, checkable ledger for the money neighbours send the volunteer team.

Neighbours transfer to the coordinator's account and post slips in the village LINE group; volunteers keep a
running "ชื่อ = ยอด" tally by hand (and get the sums wrong). Here instead:

- every donation is one row with the evidence: the slip photo, the bank's transaction reference (เลขที่รายการ),
  the time of transfer, the bank; a reference can only be entered once, so a slip posted twice is counted once;
- every expense is one row with its receipt photos;
- status per donation: ⏳ waiting / ✅ found in the bank app / ❌ not found — the treasurer ticks them;
- rows come in three ways: the treasurer adds them on /fund (with the slip), Claude pushes them from the chat
  (tools/fund_push.py: slip screenshots from the LINE album + reference + amount), or the "ชื่อ = ยอด" tallies
  from the chat (tools/fund_sweep.py, no slip yet).

Public view: names (or "ไม่ประสงค์ออกนาม"), amounts, times, status, "📎 มีสลิป" and the last 4 characters of the
reference — enough to check one's own transfer is counted. Slip photos and house numbers stay with the treasurer.
Treasurer access: admins, or the separate treasurer link (/fund#fk=…). The site never moves money.
"""
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

Purpose = Literal["food", "sand", "labor", "supplies", "general"]  # อาหาร/น้ำ · กระสอบทราย · ค่าแรง · อุปกรณ์ · ทั่วไป
InStatus = Literal["pending", "confirmed", "rejected"]
Source = Literal["slip", "cash", "transfer", "line"]  # slip in hand · cash · seen in the bank app · from a chat tally


def now():
    return datetime.now(timezone.utc)


def norm_ref(ref: str) -> str:
    return re.sub(r"[\s\-]", "", ref or "").upper()


class Account(BaseModel):
    on: bool = True
    bank: str = Field("", max_length=40)
    number: str = Field("", max_length=30)
    name: str = Field("", max_length=80)
    note: str = Field("", max_length=300)


class DonationIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)  # as on the slip or in the chat
    house: str = Field("", max_length=20)  # treasurer only
    anonymous: bool = False
    amount: float = Field(..., gt=0, le=1_000_000)
    paid_at: Optional[datetime] = None  # time on the slip
    bank: str = Field("", max_length=30)
    ref: str = Field("", max_length=60)  # เลขที่รายการ / รหัสอ้างอิง
    purpose: Purpose = "general"
    note: str = Field("", max_length=200)
    status: InStatus = "pending"
    source: Source = "slip"
    slip_id: Optional[str] = None


class DonationEdit(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    house: Optional[str] = Field(None, max_length=20)
    anonymous: Optional[bool] = None
    amount: Optional[float] = Field(None, gt=0, le=1_000_000)
    paid_at: Optional[datetime] = None
    bank: Optional[str] = Field(None, max_length=30)
    ref: Optional[str] = Field(None, max_length=60)
    purpose: Optional[Purpose] = None
    note: Optional[str] = Field(None, max_length=200)
    status: Optional[InStatus] = None
    slip_id: Optional[str] = None  # attach / replace the slip


class ExpenseIn(BaseModel):
    item: str = Field(..., min_length=2, max_length=120)  # "ข้าวกล่อง 100 กล่อง ร้านป้าแก้ว"
    amount: float = Field(..., gt=0, le=1_000_000)
    purpose: Purpose = "general"
    paid_by: str = Field("", max_length=60)
    paid_at: Optional[datetime] = None
    note: str = Field("", max_length=200)
    receipt_ids: list[str] = Field(default_factory=list, max_length=4)


def build_router(db, rate_limit, current_admin, require_admin, audit, client_ip, claim_media, delete_media) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def fund_key() -> str:
        doc = await db.settings.find_one({"id": "fund_key"})
        if not doc:
            key = secrets.token_urlsafe(24)
            await db.settings.update_one({"id": "fund_key"}, {"$setOnInsert": {"id": "fund_key", "key": key, "created_at": now()}}, upsert=True)
            doc = await db.settings.find_one({"id": "fund_key"})
        return doc["key"]

    async def treasurer(request: Request) -> str:
        """An admin, or whoever holds the treasurer link."""
        admin = await current_admin(request)
        if admin and admin.get("role", "admin") == "admin":
            return admin["name"]
        given = request.headers.get("x-fund-key", "")
        if given and hmac.compare_digest(given, await fund_key()):
            return unquote(request.headers.get("x-fund-name", ""))[:40] or "เหรัญญิกทีมอาสา"
        if given:
            rate_limit(request, "fundkey-miss", limit=20, window_s=600)
        raise HTTPException(403, "สำหรับผู้ดูแลยอดเงินเท่านั้น (ลิงก์เหรัญญิก)")

    def public_in(d: dict) -> dict:
        out = {k: v for k, v in d.items() if k not in ("_id", "slip", "house", "ref", "ref_norm")}
        if d.get("anonymous"):
            out["name"] = "ไม่ประสงค์ออกนาม"
        out["has_slip"] = bool(d.get("slip"))
        out["ref_tail"] = d["ref_norm"][-4:] if d.get("ref_norm") else ""
        return out

    def public_out(d: dict) -> dict:
        return {k: v for k, v in d.items() if k != "_id"}

    async def ref_taken(ref: str, exclude: str = "") -> Optional[dict]:
        r = norm_ref(ref)
        if not r:
            return None
        return await db.fund_in.find_one({"ref_norm": r, "id": {"$ne": exclude}}, {"_id": 0, "id": 1, "name": 1, "amount": 1})

    # ---------------- public dashboard data ----------------
    @router.get("/fund")
    async def get_fund():
        acc = await db.settings.find_one({"id": "fund_account"}, {"_id": 0, "id": 0})
        ins = await db.fund_in.find({}, {"_id": 0}).sort([("paid_at", -1), ("created_at", -1)]).to_list(5000)
        outs = await db.fund_out.find({}, {"_id": 0}).sort([("paid_at", -1), ("created_at", -1)]).to_list(5000)
        last = max([d.get("updated_at") or d["created_at"] for d in ins + outs], default=None)
        return {
            "account": acc if acc and acc.get("on") else None,
            "donations": [public_in(d) for d in ins],
            "expenses": [public_out(d) for d in outs],
            "updated_at": last,
        }

    # ---------------- treasurer ----------------
    @router.get("/fund/treasurer")
    async def treasurer_view(request: Request):
        who = await treasurer(request)
        ins = await db.fund_in.find({}, {"_id": 0}).sort([("paid_at", -1), ("created_at", -1)]).to_list(5000)
        return {"who": who, "donations": ins}

    @router.post("/fund/donations", status_code=201)
    async def add_donation(body: DonationIn, request: Request):
        who = await treasurer(request)
        dup = await ref_taken(body.ref)
        if dup:
            raise HTTPException(409, f"เลขที่รายการนี้ลงไปแล้ว ({dup['name']} {dup['amount']:,.0f} บาท) — สลิปซ้ำ")
        doc_id = str(uuid.uuid4())
        slip = await claim_media([body.slip_id] if body.slip_id else [], f"fund-slip:{doc_id}", {"image"})
        data = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"slip_id"}).items()}
        doc = {
            "id": doc_id,
            **data,
            "ref_norm": norm_ref(body.ref),
            "slip": slip,
            "added_by": who,
            **({"reviewed_by": who, "reviewed_at": now()} if body.status != "pending" else {}),
            "created_at": now(),
        }
        await db.fund_in.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @router.patch("/fund/donations/{doc_id}")
    async def edit_donation(doc_id: str, body: DonationEdit, request: Request):
        who = await treasurer(request)
        old = await db.fund_in.find_one({"id": doc_id}, {"_id": 0})
        if not old:
            raise HTTPException(404, "ไม่พบรายการ")
        changes = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"slip_id"}, exclude_unset=True).items()}
        if "ref" in changes:
            dup = await ref_taken(changes["ref"], exclude=doc_id)
            if dup:
                raise HTTPException(409, f"เลขที่รายการนี้เป็นของ {dup['name']} {dup['amount']:,.0f} บาทแล้ว — สลิปซ้ำ")
            changes["ref_norm"] = norm_ref(changes["ref"])
        if body.slip_id:
            changes["slip"] = await claim_media([body.slip_id], f"fund-slip:{doc_id}", {"image"})
            await delete_media([m["id"] for m in old.get("slip", [])])
        if "status" in changes and changes["status"] != old.get("status"):
            changes.update(reviewed_by=who, reviewed_at=now())
        changes.update(updated_at=now(), updated_by=who)
        doc = await db.fund_in.find_one_and_update({"id": doc_id}, {"$set": changes}, projection={"_id": 0}, return_document=True)
        return doc

    @router.delete("/fund/donations/{doc_id}", status_code=204)
    async def delete_donation(doc_id: str, request: Request):
        who = await treasurer(request)
        doc = await db.fund_in.find_one_and_delete({"id": doc_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await delete_media([m["id"] for m in doc.get("slip", [])])
        await db.fund_log.insert_one({"at": now(), "by": who, "action": "delete_donation", "name": doc["name"], "amount": doc["amount"], "ref": doc.get("ref", "")})

    @router.post("/fund/expenses", status_code=201)
    async def add_expense(body: ExpenseIn, request: Request):
        who = await treasurer(request)
        doc_id = str(uuid.uuid4())
        doc = {
            "id": doc_id,
            **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"receipt_ids"}).items()},
            "receipts": await claim_media(body.receipt_ids, f"fund-receipt:{doc_id}", {"image"}),
            "by": who,
            "created_at": now(),
        }
        await db.fund_out.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @router.delete("/fund/expenses/{doc_id}", status_code=204)
    async def delete_expense(doc_id: str, request: Request):
        who = await treasurer(request)
        doc = await db.fund_out.find_one_and_delete({"id": doc_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await delete_media([m["id"] for m in doc.get("receipts", [])])
        await db.fund_log.insert_one({"at": now(), "by": who, "action": "delete_expense", "item": doc["item"], "amount": doc["amount"]})

    # ---------------- admin: account shown + treasurer link ----------------
    @router.put("/admin/fund/account")
    async def set_account(body: Account, admin: dict = Depends(require_admin)):
        data = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()}
        await db.settings.update_one({"id": "fund_account"}, {"$set": {"id": "fund_account", **data, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "fund_account", "fund", f"{data['bank']} {data['number']} {data['name']} on={data['on']}")
        return data

    @router.get("/admin/fund/key")
    async def get_key(admin: dict = Depends(require_admin)):
        return {"key": await fund_key()}

    @router.post("/admin/fund/key/rotate")
    async def rotate_key(admin: dict = Depends(require_admin)):
        key = secrets.token_urlsafe(24)
        await db.settings.update_one({"id": "fund_key"}, {"$set": {"key": key, "created_at": now(), "rotated_by": admin["name"]}}, upsert=True)
        await audit(admin, "rotate_fund_key", "fund")
        return {"key": key}

    return router
