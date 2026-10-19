"""🧠 สรุปรายวันของแอด (20 Oct): what residents said everywhere, read and sorted by Claude, for the admin's phone.

Nothing here reads chats. A scheduled Claude Desktop task on the admin's computer (docs/digest_brain.md) runs
tools/digest_collect.py (FB page comments + inbox, LINE OA chats, the village LINE export, the site's new posts),
writes the digest (urgent things to answer with drafted replies, topics, requests, praise, risks, ideas) and sends it
here with tools/digest_publish.py. The admin page shows it (AdminPanel › 🧠 สรุปรายวัน) and ticks items done.

  PUT  /api/admin/digest                          {date, period, data}  (admin) — one per date + period (morning/evening)
  GET  /api/admin/digests?days=14                                        (admin)
  POST /api/admin/digest/{date}/{period}/done     {key, done}            (admin) — tick an item off

✉️ ร่างคำตอบ (20 Oct): the brain also drafts replies to people who asked something (FB inbox / FB comment / LINE OA).
The admin edits and taps ส่ง on the page — nothing goes out without that tap.
  PUT  /api/admin/replies            {items: [{key, channel, to, who, soi, question, draft, link, digest}]}  (admin)
  GET  /api/admin/replies?all=false                                      (admin) — open drafts + LINE push quota
  POST /api/admin/replies/{id}/send  {text, mode: now|later}             (admin) — LINE "later" = with the bot's next reply (free)
  POST /api/admin/replies/{id}/skip                                      (admin)
  PUT  /api/admin/fb-page            {id, token}                         (admin) — tools/fb_setup.py; the token is never sent back
Phone numbers are masked again on the way in; the digest keeps first names only (the brain is told so too).
"""
import asyncio
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

PHONE = re.compile(r"(?<![\w/#=.-])0\d[\d\- ]{7,11}\d(?![\w-])")  # not inside ids/links


def _mask(o):
    if isinstance(o, str):
        return PHONE.sub("0xx-xxx-xxxx", o)
    if isinstance(o, list):
        return [_mask(x) for x in o]
    if isinstance(o, dict):
        return {k: _mask(v) for k, v in o.items()}
    return o


class DigestBody(BaseModel):
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    period: Literal["morning", "midday", "evening", "manual"] = "manual"
    data: dict


class DoneBody(BaseModel):
    key: str = Field(..., min_length=1, max_length=80)
    done: bool = True


class Draft(BaseModel):
    key: str = Field("", max_length=80)
    channel: Literal["fb_inbox", "fb_comment", "line"]
    to: str = Field(..., min_length=3, max_length=120)
    who: str = Field("", max_length=60)
    soi: str = Field("", max_length=20)
    question: str = Field("", max_length=1500)
    draft: str = Field(..., min_length=1, max_length=2000)
    link: str = Field("", max_length=400)
    digest: dict = {}


class DraftsBody(BaseModel):
    items: list[Draft] = Field(..., max_length=40)


class SendBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    mode: Literal["now", "later"] = "now"


class FbPage(BaseModel):
    id: str = Field(..., min_length=5, max_length=40)
    token: str = Field(..., min_length=20, max_length=1000)


GRAPH = "https://graph.facebook.com/v23.0"


def _fb(path: str, token: str, **data) -> tuple[int, dict]:
    body = urllib.parse.urlencode({**{k: json.dumps(v, ensure_ascii=False) if isinstance(v, dict) else v for k, v in data.items()}, "access_token": token}).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{GRAPH}/{path}", data=body, method="POST"), timeout=30) as r:
            return 200, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}").get("error", {})
        except Exception:
            return e.code, {}
    except Exception as e:  # network
        return 0, {"message": str(e)[:200]}


def build_router(db, require_admin, audit, line=None) -> APIRouter:
    router = APIRouter(prefix="/api/admin")

    @router.put("/digest")
    async def put_digest(body: DigestBody, admin: dict = Depends(require_admin)):
        if len(str(body.data)) > 120_000:
            raise HTTPException(413, "สรุปยาวเกินไป")
        now = datetime.now(timezone.utc)
        old = await db.digests.find_one({"date": body.date, "period": body.period}, {"_id": 0, "done": 1}) or {}
        await db.digests.update_one({"date": body.date, "period": body.period},
                                    {"$set": {"date": body.date, "period": body.period, "data": _mask(body.data), "at": now, "by": admin.get("name"),
                                              "done": old.get("done", [])}}, upsert=True)
        await audit(admin, "digest", f"{body.date} {body.period}", "")
        return {"ok": True}

    @router.get("/digests")
    async def list_digests(days: int = 14, admin: dict = Depends(require_admin)):
        since = (datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 90)))).strftime("%Y-%m-%d")
        return await db.digests.find({"date": {"$gte": since}}, {"_id": 0}).sort([("date", -1), ("at", -1)]).to_list(200)

    @router.post("/digest/{date}/{period}/done")
    async def tick(date: str, period: str, body: DoneBody, admin: dict = Depends(require_admin)):
        op = {"$addToSet": {"done": body.key}} if body.done else {"$pull": {"done": body.key}}
        r = await db.digests.update_one({"date": date, "period": period}, op)
        if not r.matched_count:
            raise HTTPException(404, "ไม่พบสรุป")
        return {"ok": True}

    # ---------- ✉️ ร่างคำตอบ ----------
    @router.put("/replies")
    async def put_drafts(body: DraftsBody, admin: dict = Depends(require_admin)):
        now = datetime.now(timezone.utc)
        new = 0
        for d in body.items:
            key = d.key or hashlib.sha1(f"{d.channel}|{d.to}|{d.question}".encode()).hexdigest()[:16]
            old = await db.reply_drafts.find_one({"key": key}, {"_id": 0, "status": 1})
            if old and old.get("status") != "open":
                continue  # already sent / queued / skipped: leave it alone
            doc = {**d.model_dump(), "key": key, "question": _mask(d.question), "updated_at": now}
            if old:
                await db.reply_drafts.update_one({"key": key}, {"$set": doc})
            else:
                await db.reply_drafts.insert_one({**doc, "id": str(uuid.uuid4()), "status": "open", "created_at": now})
                new += 1
        return {"ok": True, "new": new}

    @router.get("/replies")
    async def list_drafts(all: bool = False, admin: dict = Depends(require_admin)):
        since = datetime.now(timezone.utc) - timedelta(days=7)
        q = {"created_at": {"$gte": since}} if all else {"status": {"$in": ["open", "queued", "failed"]}}
        items = await db.reply_drafts.find(q, {"_id": 0}).sort("created_at", -1).to_list(100)
        fb = await db.settings.find_one({"id": "fb_page"}, {"_id": 0, "id": 1})
        quota = {}
        if line is not None and any(x["channel"] == "line" for x in items):
            try:
                quota = await line.push_quota()
            except Exception:
                quota = {}
        return {"items": items, "fb_ready": bool(fb), "line_quota": quota}

    @router.post("/replies/{rid}/send")
    async def send_draft(rid: str, body: SendBody, admin: dict = Depends(require_admin)):
        # claim first so a double tap (or two phones) can't send twice
        d = await db.reply_drafts.find_one_and_update({"id": rid, "status": {"$in": ["open", "failed"]}}, {"$set": {"status": "sending"}}, projection={"_id": 0})
        if not d:
            raise HTTPException(409, "ส่งไปแล้ว หรือไม่พบร่างนี้")
        txt = body.text.strip()
        if d["channel"] == "line":
            if line is None:
                ok, msg = False, "LINE bot ไม่พร้อม"
            else:
                ok, msg = await line.admin_send(d["to"], txt, "later" if body.mode == "later" else "push", rid)
            status = ("queued" if body.mode == "later" else "sent") if ok else "failed"
        else:
            fb = await db.settings.find_one({"id": "fb_page"}, {"_id": 0})
            if not fb:
                code, res = 0, {"message": "ยังไม่ได้ตั้งค่าเพจ FB บนเซิร์ฟเวอร์ (tools/fb_setup.py)"}
            elif fb.get("dry"):  # sim
                code, res = 200, {"id": "sim"}
            elif d["channel"] == "fb_inbox":
                code, res = await asyncio.to_thread(_fb, f"{fb['page']}/messages", fb["token"], recipient={"id": d["to"]}, messaging_type="RESPONSE", message={"text": txt})
                if code != 200 and res.get("error_subcode") == 2018278:  # outside 24 h → human agent tag (7 days)
                    code, res = await asyncio.to_thread(_fb, f"{fb['page']}/messages", fb["token"], recipient={"id": d["to"]}, messaging_type="MESSAGE_TAG", tag="HUMAN_AGENT", message={"text": txt})
            else:
                code, res = await asyncio.to_thread(_fb, f"{d['to']}/comments", fb["token"], message=txt)
            ok = code == 200
            msg = "ส่งแล้ว" if ok else (f"FB {code}: " if code else "") + str(res.get("message", ""))[:200]
            status = "sent" if ok else "failed"
        await db.reply_drafts.update_one({"id": rid}, {"$set": {"status": status, "text": txt, "mode": body.mode, "result": msg, "sent_at": datetime.now(timezone.utc),
                                                                "by": admin.get("name"), "edited": txt != d["draft"].strip()}})
        g = d.get("digest") or {}
        if ok and g.get("key"):
            await db.digests.update_one({"date": g.get("date"), "period": g.get("period")}, {"$addToSet": {"done": g["key"]}})
        await audit(admin, "reply_send", rid, f"{d['channel']} {status}")
        if not ok:
            raise HTTPException(502, msg)
        return {"ok": True, "status": status, "message": msg}

    @router.post("/replies/{rid}/skip")
    async def skip_draft(rid: str, admin: dict = Depends(require_admin)):
        r = await db.reply_drafts.update_one({"id": rid, "status": {"$in": ["open", "failed"]}}, {"$set": {"status": "skipped", "sent_at": datetime.now(timezone.utc)}})
        if not r.matched_count:
            raise HTTPException(404, "ไม่พบร่าง")
        return {"ok": True}

    @router.put("/fb-page")
    async def set_fb(body: FbPage, admin: dict = Depends(require_admin)):
        await db.settings.update_one({"id": "fb_page"}, {"$set": {"id": "fb_page", "page": body.id, "token": body.token, "at": datetime.now(timezone.utc)}}, upsert=True)
        await audit(admin, "fb_page", body.id, "")
        return {"ok": True}

    return router
