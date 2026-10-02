"""เงินสมทบทีมอาสา (2 Oct 2026): neighbours were transferring money for the volunteers' food, water and sandbags
to the coordinator's account and posting their slips in the village LINE group — dozens of slips, hand-made
running totals, nobody sure what was counted. This keeps one public ledger instead:

- the receiving account (set by an admin) is shown in one place;
- whoever transferred says so here ("แจ้งโอน": name, amount, time, slip photo) instead of posting the slip;
- the treasurer checks each one against the bank app and marks it ✅ confirmed / ❌ not found;
- the treasurer records what the money bought (with a receipt photo), so everyone sees received / spent / left.

The site never moves money. Slips stay private: their media ids only go to the treasurer (the public list shows a
name — or "ไม่ประสงค์ออกนาม" — the amount, the time and the status). Treasurer access is a separate secret link
(/fund#fk=…), not the volunteer team link, plus admins.
"""
import hashlib
import hmac
import secrets
import uuid
from urllib.parse import unquote
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

Purpose = Literal["food", "sand", "labor", "general"]  # อาหาร/น้ำอาสา · กระสอบทราย · ค่าแรง · ทั่วไป
InStatus = Literal["pending", "confirmed", "rejected"]
PUBLIC_IN = {"_id": 0, "slip": 0, "ip": 0, "house": 0}


def now():
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


class Account(BaseModel):
    on: bool = True
    bank: str = Field("", max_length=40)
    number: str = Field("", max_length=30)
    name: str = Field("", max_length=80)
    note: str = Field("", max_length=300)  # "สมทบค่าอาหาร น้ำดื่ม กระสอบทราย ทีมอาสา · ผู้ดูแลยอด: คุณเอ็ม"


class DonationIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    house: str = Field("", max_length=20)  # only the treasurer sees it
    anonymous: bool = False
    amount: float = Field(..., gt=0, le=1_000_000)
    transferred_at: str = Field("", max_length=40)  # "2 ต.ค. 19:14"
    purpose: Purpose = "general"
    note: str = Field("", max_length=160)
    slip_id: Optional[str] = None


class TreasurerDonation(DonationIn):
    status: InStatus = "confirmed"
    source: Literal["cash", "transfer", "line"] = "transfer"


class DonationReview(BaseModel):
    status: InStatus
    amount: Optional[float] = Field(None, gt=0, le=1_000_000)  # fix a typo against the bank app
    note: str = Field("", max_length=160)


class ExpenseIn(BaseModel):
    item: str = Field(..., min_length=2, max_length=120)  # "ข้าวกล่อง 100 กล่อง ร้านป้าแก้ว"
    amount: float = Field(..., gt=0, le=1_000_000)
    purpose: Purpose = "general"
    paid_by: str = Field("", max_length=60)
    spent_at: str = Field("", max_length=40)
    note: str = Field("", max_length=200)
    receipt_ids: list[str] = Field(default_factory=list, max_length=3)


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
        """The person checking the money: an admin, or whoever holds the treasurer link."""
        admin = await current_admin(request)
        if admin and admin.get("role", "admin") == "admin":
            return admin["name"]
        given = request.headers.get("x-fund-key", "")
        if given and hmac.compare_digest(given, await fund_key()):
            return unquote(request.headers.get("x-fund-name", ""))[:40] or "เหรัญญิกทีมอาสา"
        if given:
            rate_limit(request, "fundkey-miss", limit=20, window_s=600)
        raise HTTPException(403, "สำหรับผู้ดูแลยอดเงินเท่านั้น (ลิงก์เหรัญญิก)")

    async def summary() -> dict:
        ins = await db.fund_in.find({}, {"_id": 0, "amount": 1, "status": 1}).to_list(5000)
        outs = await db.fund_out.find({}, {"_id": 0, "amount": 1}).to_list(5000)
        got = sum(d["amount"] for d in ins if d["status"] == "confirmed")
        pending = sum(d["amount"] for d in ins if d["status"] == "pending")
        spent = sum(d["amount"] for d in outs)
        return {
            "received": round(got, 2),
            "pending": round(pending, 2),
            "spent": round(spent, 2),
            "left": round(got - spent, 2),
            "count_confirmed": sum(d["status"] == "confirmed" for d in ins),
            "count_pending": sum(d["status"] == "pending" for d in ins),
        }

    def public_in(d: dict) -> dict:
        out = {k: v for k, v in d.items() if k not in ("_id", "slip", "ip", "house")}
        if d.get("anonymous"):
            out["name"] = "ไม่ประสงค์ออกนาม"
        out["has_slip"] = bool(d.get("slip"))
        return out

    # ---------------- public ----------------
    @router.get("/fund")
    async def get_fund():
        acc = await db.settings.find_one({"id": "fund_account"}, {"_id": 0, "id": 0})
        ins = await db.fund_in.find({"status": {"$ne": "rejected"}}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        outs = await db.fund_out.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
        return {"account": acc if acc and acc.get("on") else None, "totals": await summary(), "donations": [public_in(d) for d in ins], "expenses": outs}

    @router.post("/fund/donations", status_code=201)
    async def report_donation(body: DonationIn, request: Request):
        """'I transferred 500': goes in as pending until the treasurer finds it in the bank app."""
        rate_limit(request, "fund-in", limit=10, window_s=600)
        t = now()
        ip = _hash(client_ip(request))
        # the same person sending the same amount twice within 15 minutes is almost always a double tap
        dup = await db.fund_in.find_one({"ip": ip, "amount": body.amount, "name": body.name.strip(), "created_at": {"$gte": datetime.fromtimestamp(t.timestamp() - 900, timezone.utc)}})
        if dup:
            raise HTTPException(409, "แจ้งยอดนี้ไปแล้วเมื่อสักครู่ ไม่ต้องแจ้งซ้ำ")
        doc_id = str(uuid.uuid4())
        slip = await claim_media([body.slip_id] if body.slip_id else [], f"fund-slip:{doc_id}", {"image"})
        doc = {
            "id": doc_id,
            **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"slip_id"}).items()},
            "slip": slip,
            "status": "pending",
            "source": "form",
            "ip": ip,
            "created_at": t,
        }
        await db.fund_in.insert_one(dict(doc))
        return public_in(doc)

    # ---------------- treasurer ----------------
    @router.get("/fund/treasurer")
    async def treasurer_view(request: Request):
        who = await treasurer(request)
        ins = await db.fund_in.find({}, {"_id": 0, "ip": 0}).sort("created_at", -1).to_list(5000)
        return {"who": who, "donations": ins, "totals": await summary()}

    @router.post("/fund/donations/{doc_id}/review")
    async def review(doc_id: str, body: DonationReview, request: Request):
        who = await treasurer(request)
        changes = {"status": body.status, "reviewed_by": who, "reviewed_at": now()}
        if body.amount:
            changes["amount"] = body.amount
        if body.note.strip():
            changes["review_note"] = body.note.strip()
        doc = await db.fund_in.find_one_and_update({"id": doc_id}, {"$set": changes}, projection={"_id": 0, "ip": 0}, return_document=True)
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return doc

    @router.post("/fund/treasurer/donations", status_code=201)
    async def add_donation(body: TreasurerDonation, request: Request):
        """Cash handed over, or a transfer the treasurer saw in the bank app that nobody reported."""
        who = await treasurer(request)
        doc_id = str(uuid.uuid4())
        slip = await claim_media([body.slip_id] if body.slip_id else [], f"fund-slip:{doc_id}", {"image"})
        doc = {
            "id": doc_id,
            **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"slip_id"}).items()},
            "slip": slip,
            "reviewed_by": who,
            "reviewed_at": now(),
            "created_at": now(),
        }
        await db.fund_in.insert_one(dict(doc))
        doc.pop("_id", None)
        return doc

    @router.delete("/fund/donations/{doc_id}", status_code=204)
    async def delete_donation(doc_id: str, request: Request):
        await treasurer(request)
        doc = await db.fund_in.find_one_and_delete({"id": doc_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        for m in doc.get("slip", []):
            await delete_media(m["id"])

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
        await treasurer(request)
        doc = await db.fund_out.find_one_and_delete({"id": doc_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        for m in doc.get("receipts", []):
            await delete_media(m["id"])

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
