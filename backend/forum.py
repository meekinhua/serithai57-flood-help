"""ถาม-ตอบ (2 Oct 2026): a small forum for the village after the flood — how to fix a flooded car, what to do
with ruined furniture, parquet or tiles, insurance, compensation...

No accounts, like the rest of the site. People sign with their house number ("4/917", optionally a nickname)
so neighbours know who is talking; people from outside the village (relatives, helpers) sign with a name and
show as "คนนอก". Nothing is verified — it's a neighbourly board, admins can hide anything. Whoever posts gets
an edit key (kept in their browser) to delete their own post; the asker marks the reply that solved it;
anyone can 👍 a helpful reply (one per IP).
"""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

FORUM_CATEGORIES = ["car", "house", "furniture", "electric", "water", "waste", "health", "money", "general"]
HOUSE_RE = re.compile(r"^\d{1,3}/\d{1,5}(/\d{1,3})?$")  # 4/917, 4/1236
HIDDEN = {"_id": 0, "edit_key_hash": 0, "voters": 0}


def now():
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


class Author(BaseModel):
    house: str = Field("", max_length=20)
    name: str = Field("", max_length=40)
    outsider: bool = False


class TopicCreate(BaseModel):
    category: str
    title: str = Field(..., min_length=4, max_length=120)
    body: str = Field("", max_length=2000)
    author: Author
    media_ids: list[str] = Field(default_factory=list, max_length=3)


class ReplyCreate(BaseModel):
    body: str = Field(..., min_length=1, max_length=2000)
    author: Author
    media_ids: list[str] = Field(default_factory=list, max_length=2)


class SolveBody(BaseModel):
    reply_id: Optional[str] = None  # None = not solved any more


class PinBody(BaseModel):
    pinned: bool


def clean_author(a: Author) -> dict:
    house = re.sub(r"\s+", "", a.house)
    name = a.name.strip()
    if a.outsider:
        if not name:
            raise HTTPException(422, "คนนอกหมู่บ้าน ใส่ชื่อเล่นด้วย")
        return {"house": "", "name": name, "outsider": True}
    if not HOUSE_RE.match(house):
        raise HTTPException(422, "ใส่บ้านเลขที่ เช่น 4/917 (ถ้าไม่ได้อยู่ในหมู่บ้าน เลือก “คนนอก”)")
    return {"house": house, "name": name, "outsider": False}


def build_router(db, rate_limit, current_admin, require_admin, audit, client_ip, claim_media, delete_media) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def is_admin(request: Request) -> bool:
        a = await current_admin(request)
        return bool(a and a.get("role", "admin") == "admin")

    async def can_edit(doc: dict, key: str, request: Request) -> bool:
        return bool(key and doc.get("edit_key_hash") == _hash(key)) or await is_admin(request)

    @router.get("/forum")
    async def list_topics(category: Optional[str] = None, q: str = ""):
        query: dict = {"hidden": {"$ne": True}}
        if category:
            query["category"] = category
        if q.strip():
            rx = {"$regex": re.escape(q.strip()[:60]), "$options": "i"}
            query["$or"] = [{"title": rx}, {"body": rx}]
        docs = await db.forum_topics.find(query, HIDDEN).sort([("pinned", -1), ("last_at", -1)]).to_list(300)
        for d in docs:
            d["body"] = d.get("body", "")[:220]  # the list shows a snippet; the topic page has it all
        return docs

    @router.get("/forum/{topic_id}")
    async def get_topic(topic_id: str):
        topic = await db.forum_topics.find_one({"id": topic_id, "hidden": {"$ne": True}}, HIDDEN)
        if not topic:
            raise HTTPException(404, "ไม่พบกระทู้ (อาจถูกลบแล้ว)")
        replies = await db.forum_replies.find({"topic_id": topic_id, "hidden": {"$ne": True}}, HIDDEN).sort("created_at", 1).to_list(500)
        return {**topic, "replies": replies}

    @router.post("/forum", status_code=201)
    async def create_topic(body: TopicCreate, request: Request):
        rate_limit(request, "forum-topic", limit=8, window_s=600)
        if body.category not in FORUM_CATEGORIES:
            raise HTTPException(422, "หมวดไม่ถูกต้อง")
        author = clean_author(body.author)
        key, topic_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        doc = {
            "id": topic_id,
            "category": body.category,
            "title": body.title.strip(),
            "body": body.body.strip(),
            "author": author,
            "media": await claim_media(body.media_ids, f"forum:{topic_id}", {"image"}),
            "reply_count": 0,
            "solved_reply": None,
            "pinned": False,
            "created_at": t,
            "last_at": t,
            "edit_key_hash": _hash(key),
        }
        await db.forum_topics.insert_one(dict(doc))
        doc.pop("edit_key_hash")
        return {**doc, "edit_key": key}

    @router.post("/forum/{topic_id}/replies", status_code=201)
    async def create_reply(topic_id: str, body: ReplyCreate, request: Request):
        rate_limit(request, "forum-reply", limit=20, window_s=600)
        if not await db.forum_topics.find_one({"id": topic_id, "hidden": {"$ne": True}}, {"_id": 1}):
            raise HTTPException(404, "ไม่พบกระทู้")
        author = clean_author(body.author)
        key, reply_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        doc = {
            "id": reply_id,
            "topic_id": topic_id,
            "body": body.body.strip(),
            "author": author,
            "media": await claim_media(body.media_ids, f"forum-reply:{reply_id}", {"image"}),
            "votes": 0,
            "voters": [],
            "created_at": t,
            "edit_key_hash": _hash(key),
        }
        await db.forum_replies.insert_one(dict(doc))
        await db.forum_topics.update_one({"id": topic_id}, {"$inc": {"reply_count": 1}, "$set": {"last_at": t}})
        for k in ("edit_key_hash", "voters"):
            doc.pop(k)
        return {**doc, "edit_key": key}

    @router.post("/forum/replies/{reply_id}/vote")
    async def vote(reply_id: str, request: Request):
        rate_limit(request, "forum-vote", limit=60, window_s=600)
        who = _hash(client_ip(request))
        doc = await db.forum_replies.find_one_and_update(
            {"id": reply_id, "voters": {"$ne": who}}, {"$inc": {"votes": 1}, "$push": {"voters": who}}, projection=HIDDEN, return_document=True
        )
        return doc or await db.forum_replies.find_one({"id": reply_id}, HIDDEN)

    @router.post("/forum/{topic_id}/solve")
    async def solve(topic_id: str, body: SolveBody, request: Request, x_edit_key: str = Header("")):
        topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
        if not topic:
            raise HTTPException(404, "ไม่พบกระทู้")
        if not await can_edit(topic, x_edit_key, request):
            raise HTTPException(403, "เฉพาะคนตั้งกระทู้ (จากเครื่องที่ตั้ง)")
        if body.reply_id and not await db.forum_replies.find_one({"id": body.reply_id, "topic_id": topic_id}, {"_id": 1}):
            raise HTTPException(404, "ไม่พบคำตอบ")
        await db.forum_topics.update_one({"id": topic_id}, {"$set": {"solved_reply": body.reply_id}})
        return await get_topic(topic_id)

    @router.delete("/forum/{topic_id}", status_code=204)
    async def delete_topic(topic_id: str, request: Request, x_edit_key: str = Header("")):
        topic = await db.forum_topics.find_one({"id": topic_id}, {"_id": 0})
        if not topic:
            raise HTTPException(404, "ไม่พบกระทู้")
        if not await can_edit(topic, x_edit_key, request):
            raise HTTPException(403, "ลบได้เฉพาะคนตั้งกระทู้ (จากเครื่องที่ตั้ง)")
        replies = await db.forum_replies.find({"topic_id": topic_id}, {"_id": 0, "media": 1}).to_list(1000)
        await delete_media([m["id"] for m in topic.get("media", []) + [m for r in replies for m in r.get("media", [])]])
        await db.forum_replies.delete_many({"topic_id": topic_id})
        await db.forum_topics.delete_one({"id": topic_id})
        admin = await current_admin(request)
        if admin:
            await audit(admin, "delete_forum_topic", topic_id, topic["title"])

    @router.delete("/forum/replies/{reply_id}", status_code=204)
    async def delete_reply(reply_id: str, request: Request, x_edit_key: str = Header("")):
        reply = await db.forum_replies.find_one({"id": reply_id}, {"_id": 0})
        if not reply:
            raise HTTPException(404, "ไม่พบคำตอบ")
        if not await can_edit(reply, x_edit_key, request):
            raise HTTPException(403, "ลบได้เฉพาะคนตอบ (จากเครื่องที่ตอบ)")
        await delete_media([m["id"] for m in reply.get("media", [])])
        await db.forum_replies.delete_one({"id": reply_id})
        await db.forum_topics.update_one({"id": reply["topic_id"]}, {"$inc": {"reply_count": -1}})
        await db.forum_topics.update_one({"id": reply["topic_id"], "solved_reply": reply_id}, {"$set": {"solved_reply": None}})

    @router.put("/admin/forum/{topic_id}/pin")
    async def pin(topic_id: str, body: PinBody, admin: dict = Depends(require_admin)):
        res = await db.forum_topics.update_one({"id": topic_id}, {"$set": {"pinned": body.pinned}})
        if not res.matched_count:
            raise HTTPException(404, "ไม่พบกระทู้")
        await audit(admin, "pin_forum_topic", topic_id, str(body.pinned))
        return {"pinned": body.pinned}

    return router
