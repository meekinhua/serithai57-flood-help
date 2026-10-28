"""🚩 Red flags (28 Oct) for ช่าง·บริการ (db.services) and ตลาด posts (db.lend_items).

Neighbours tell each other "be careful with this one": a reason + what happened. One flag per phone/IP per listing.
  1–2 flags  → "warn": the card shows an amber box with the reasons, still listed as usual
  3+ flags   → "hidden": the card is folded into a red "เสี่ยง" box; the details open only on a tap
The admin can decide it at once (hide / warn / clear = ignore the flags) and drop a flag that isn't fair.
Each doc keeps `flags` (raw, with the reporter hash) and `flag_level` (stored, so lists and the LINE bot can filter);
the public view gets `redflag` and never the reporter hashes.

  POST   /api/flags/{kind}/{item_id}                 {reason, detail, name}         kind: service | lend
  PUT    /api/admin/flags/{kind}/{item_id}           {state: auto|warn|hide|clear, note}   (admin)
  DELETE /api/admin/flags/{kind}/{item_id}/{flag_id}                                 (admin)
"""
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

HIDE_AT = 3  # distinct neighbours before a listing folds away on its own
REASONS = {
    "scam": "หลอกเอาเงิน / มิจฉาชีพ",
    "bad_work": "งานไม่เรียบร้อย / ไม่แก้ปัญหา",
    "overcharge": "คิดเงินเกิน / เปลี่ยนของไม่ตรงที่บอก",
    "no_contact": "ติดต่อไม่ได้หลังรับเงิน",
    "unsafe": "พฤติกรรมไม่ปลอดภัย",
    "other": "อื่นๆ",
}
Reason = Literal["scam", "bad_work", "overcharge", "no_contact", "unsafe", "other"]
State = Literal["auto", "warn", "hide", "clear"]


class FlagBody(BaseModel):
    reason: Reason
    detail: str = Field("", max_length=400)  # what happened
    name: str = Field("", max_length=40)  # optional, shown as "เพื่อนบ้าน" when empty


class AdminFlagBody(BaseModel):
    state: State
    note: str = Field("", max_length=200)  # shown on the card: "แอดตรวจแล้ว มีหลักฐานการโอนเงิน"


def level(doc: dict) -> str:
    """none | warn | hidden — the admin's word wins, else the count."""
    st = doc.get("flag_admin") or "auto"
    if st == "hide":
        return "hidden"
    if st == "clear":
        return "none"
    if st == "warn":
        return "warn"
    n = len(doc.get("flags") or [])
    return "hidden" if n >= HIDE_AT else "warn" if n else "none"


def public(doc: dict) -> dict:
    """Strip the raw flags off a doc on its way out and add the readable summary."""
    flags = doc.pop("flags", None) or []
    lv = doc.get("flag_level") or level({**doc, "flags": flags})
    if flags or lv != "none" or doc.get("flag_admin"):
        doc["redflag"] = {
            "level": lv,
            "count": len(flags),
            "admin": doc.get("flag_admin") or "auto",
            "note": doc.get("flag_note", ""),
            "hide_at": HIDE_AT,
            "items": [{"id": f["id"], "reason": f["reason"], "label": REASONS.get(f["reason"], ""), "detail": f.get("detail", ""),
                       "name": f.get("name") or "เพื่อนบ้าน", "at": f["at"]} for f in flags[-10:]],
        }
    for k in ("flag_admin", "flag_note"):
        doc.pop(k, None)
    return doc


def build_router(db, rate_limit, client_ip, require_admin, audit) -> APIRouter:
    router = APIRouter(prefix="/api")
    colls = {"service": db.services, "lend": db.lend_items}

    def coll(kind: str):
        if kind not in colls:
            raise HTTPException(404, "ไม่รู้จักประเภทนี้")
        return colls[kind]

    async def relevel(c, item_id: str) -> dict:
        doc = await c.find_one({"id": item_id}, {"_id": 0})
        lv = level(doc)
        if doc.get("flag_level") != lv:
            await c.update_one({"id": item_id}, {"$set": {"flag_level": lv}})
        doc["flag_level"] = lv
        return doc

    def out(doc: dict) -> dict:
        return {"id": doc["id"], **public({k: doc.get(k) for k in ("flags", "flag_level", "flag_admin", "flag_note") if k in doc})}

    @router.post("/flags/{kind}/{item_id}")
    async def add_flag(kind: str, item_id: str, body: FlagBody, request: Request):
        rate_limit(request, "redflag", limit=10, window_s=3600)
        c = coll(kind)
        who = hashlib.sha256(f"flag|{client_ip(request)}".encode()).hexdigest()[:24]
        if body.reason == "other" and len(body.detail.strip()) < 5:
            raise HTTPException(422, "เล่าสั้นๆ ว่าเกิดอะไรขึ้น")
        flag = {"id": uuid.uuid4().hex[:12], "reason": body.reason, "detail": body.detail.strip(), "name": body.name.strip(),
                "who": who, "at": datetime.now(timezone.utc).isoformat()}
        res = await c.update_one({"id": item_id, "flags.who": {"$ne": who}}, {"$push": {"flags": flag}})
        if not res.matched_count:
            if not await c.find_one({"id": item_id}, {"_id": 1}):
                raise HTTPException(404, "ไม่พบรายการ")
            raise HTTPException(409, "เครื่องนี้แจ้งรายการนี้ไปแล้ว ขอบคุณครับ")
        return out(await relevel(c, item_id))

    @router.put("/admin/flags/{kind}/{item_id}")
    async def admin_flag(kind: str, item_id: str, body: AdminFlagBody, admin: dict = Depends(require_admin)):
        c = coll(kind)
        res = await c.update_one({"id": item_id}, {"$set": {"flag_admin": body.state, "flag_note": body.note.strip()}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบรายการ")
        await audit(admin, "redflag", item_id, f"{kind} {body.state} {body.note[:80]}")
        return out(await relevel(c, item_id))

    @router.delete("/admin/flags/{kind}/{item_id}/{flag_id}")
    async def drop_flag(kind: str, item_id: str, flag_id: str, admin: dict = Depends(require_admin)):
        c = coll(kind)
        res = await c.update_one({"id": item_id}, {"$pull": {"flags": {"id": flag_id}}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบรายการ")
        await audit(admin, "redflag_drop", item_id, f"{kind} {flag_id}")
        return out(await relevel(c, item_id))

    return router
