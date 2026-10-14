"""LINE OA bot (@004forpb) for หาย·เจอ — most neighbours have LINE but not the app.

Everything here is a *reply* (to a message the person just sent), and LINE does not count replies against the
free plan's 300 messages a month, so the bot costs nothing however much it is used. It never pushes.

  พิมพ์ "หาย" / "เจอ" / "แมว" / "หมา"  → the open หาย·เจอ posts as cards with photos (live from the site)
  "แจ้งหาย" / "แจ้งเจอ"               → a short chat: kind → photos → what it looks like → soi → when → name + phone
                                         → confirm → a real หาย·เจอ post (the site's phone notifications go out as usual)
  "ได้คืนแล้ว"                         → the person's own open posts → tap one → 🎉 closed (+ the "back home" notification)
  "ยกเลิก"                             → drop the chat in progress

The OA Manager's own keyword auto-replies (เบอร์ฉุกเฉิน, ขยะ, …) stay on; the bot keeps quiet on those words so
nobody gets two answers. The OA "Default" (reply to everything) has to be OFF once this webhook is on — the bot
sends that fallback itself, and only when no chat is in progress.

  POST /api/line/webhook          (LINE → us; X-Line-Signature checked with the channel secret)
  PUT  /api/admin/line-bot        {secret, token}  (admin; tools/line_bot_setup.py — never typed in chat)
  GET  /api/admin/line-bot        → {configured, events, last_event_at}
"""
import asyncio
import base64
import hashlib
import hmac
import json
import re
import secrets
import tempfile
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import push
import repair
from fastapi import APIRouter, Depends, HTTPException, Request
from media import _process_image
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from pydantic import BaseModel, Field

SITE = "https://serithai57.com"
API = "https://api.line.me/v2/bot"
DATA_API = "https://api-data.line.me/v2/bot"
SESSION_TTL = timedelta(minutes=30)
MAX_PHOTOS = 3
POSTS_PER_DAY = 5
# words the OA Manager already answers (keyword auto-replies) — the bot stays quiet on them
OA_KEYWORDS = {  # exactly the OA Manager's keyword lists as set on 14 Oct (keep in sync if they change)
    "เบอร์ฉุกเฉิน", "เบอร์โทร", "รปภ", "ฉุกเฉิน",  # เบอร์ฉุกเฉิน
    "เมนูทั้งหมด", "เมนู", "menu", "เว็บ",  # เมนูทั้งหมด
    "ขยะ", "รถขยะ", "วันรถขยะ", "ทิ้งขยะ",  # ขยะ
    "ไฟดับ", "ไฟรั่ว", "ไฟถนน",  # ไฟดับ
    "ช่าง", "ร้าน", "หาช่าง", "ซ่อม", "ประปา",  # ช่าง ร้าน
    "บริจาค", "สลิป", "บัญชี", "ยอดบริจาค",  # บริจาค
    "แผนที่", "น้ำท่วม", "ระดับน้ำ",  # แผนที่ น้ำท่วม
}  # (the OA "หาย เจอ" reply — หาย/เจอ/หมา/แมว — must be switched off: the bot answers those now)
LIST_WORDS = {"หาย", "เจอ", "หายเจอ", "หาย·เจอ", "หาย เจอ", "สัตว์หาย", "ของหาย", "ดูประกาศ", "แมว", "หมา", "แมวหาย", "หมาหาย", "สุนัข", "สุนัขหาย"}
CANCEL_WORDS = {"ยกเลิก", "cancel", "เลิก", "❌ ยกเลิก"}
CAT_TH = {"dog": "หมา", "cat": "แมว", "pet": "สัตว์เลี้ยง", "item": "ของ", "document": "เอกสาร", "vehicle": "รถ", "other": "อื่นๆ"}
CAT_ICON = {"dog": "🐶", "cat": "🐱", "pet": "🐾", "item": "🎒", "document": "📄", "vehicle": "🚲", "other": "📦"}
FALLBACK = (
    "ขอบคุณที่ทักมาครับ 🙏\n\nบัญชีนี้ตอบอัตโนมัติ กดเมนูด้านล่างได้เลย หรือพิมพ์คำเหล่านี้\n"
    "• หาย / เจอ — ดูสัตว์เลี้ยงหาย·เจอ และแจ้งเองได้ในแชทนี้\n• เบอร์ฉุกเฉิน\n• แผนที่ / น้ำท่วม\n• ช่าง / ร้าน\n"
    "• ไฟดับ • ขยะ • บริจาค\n• เมนู (ดูทุกอย่าง)\n\nเรื่องในหมู่บ้าน แจ้งได้ที่ serithai57.com ครับ"
)


def now():
    return datetime.now(timezone.utc)


def norm(t: str) -> str:
    return re.sub(r"\s+", " ", (t or "").strip()).lower()


def qr(*items) -> dict:
    """Quick-reply chips: ("label", "text sent") or ("label", "postback:data")."""
    out = []
    for label, val in items[:13]:
        if val.startswith("postback:"):
            act = {"type": "postback", "label": label[:20], "data": val[9:], "displayText": label[:300]}
        else:
            act = {"type": "message", "label": label[:20], "text": val}
        out.append({"type": "action", "action": act})
    return {"items": out}


def text(t: str, quick=None) -> dict:
    m = {"type": "text", "text": t[:5000]}
    if quick:
        m["quickReply"] = quick
    return m


def card(d: dict) -> dict:
    """One หาย·เจอ post as a Flex bubble: photo, what, where/when, a link to the post on the site."""
    lost = d.get("kind") == "lost"
    tag = ("😢 หาย" if lost else "🙌 เจอ หาเจ้าของ") + " · " + CAT_TH.get(d.get("category"), "")
    where = " · ".join(x for x in (f"ซ.{d['soi']}" if d.get("soi") else "", d.get("when_seen", "")) if x) or "ไม่ระบุที่"
    media = [m for m in d.get("media") or [] if m.get("type") == "image"]
    b = {
        "type": "bubble", "size": "kilo",
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": [
            {"type": "text", "text": tag, "size": "xs", "weight": "bold", "color": "#C62828" if lost else "#1E6B47"},
            {"type": "text", "text": d.get("title", "")[:80], "weight": "bold", "size": "md", "wrap": True, "maxLines": 3},
            {"type": "text", "text": where[:80], "size": "sm", "color": "#45504A", "wrap": True},
        ]},
        "footer": {"type": "box", "layout": "vertical", "contents": [
            {"type": "button", "style": "primary", "height": "sm", "color": "#1E6B47",
             "action": {"type": "uri", "label": "ดูรูป · บอกว่าเห็น", "uri": f"{SITE}/#lost-{d['id']}"}},
        ]},
    }
    if media:
        b["hero"] = {"type": "image", "url": f"{SITE}/api/media/{media[0]['id']}/thumb", "size": "full",
                     "aspectRatio": "4:3", "aspectMode": "cover", "action": {"type": "uri", "uri": f"{SITE}/#lost-{d['id']}"}}
    else:
        b["hero"] = {"type": "box", "layout": "vertical", "height": "90px", "backgroundColor": "#FFF4D6", "justifyContent": "center",
                     "contents": [{"type": "text", "text": CAT_ICON.get(d.get("category"), "🐾"), "size": "3xl", "align": "center"}]}
    return b


class BotCreds(BaseModel):
    secret: str = Field(..., min_length=10, max_length=200)
    token: str = Field(..., min_length=20, max_length=400)


def build_router(db, require_admin, audit, claim_media) -> APIRouter:
    router = APIRouter(prefix="/api")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="media")
    cache = {"at": None, "creds": None}

    async def creds():
        if cache["at"] and now() - cache["at"] < timedelta(seconds=60):
            return cache["creds"]
        cache["creds"] = await db.settings.find_one({"id": "line_bot"}, {"_id": 0})
        cache["at"] = now()
        return cache["creds"]

    def call(method: str, url: str, token: str, body=None, raw=False, timeout=15):
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {token}", **({"Content-Type": "application/json"} if data else {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return r.status, (b if raw else (json.loads(b) if b else {}))
        except urllib.error.HTTPError as e:
            return e.code, e.read()[:300]
        except Exception as e:  # network
            return 0, str(e)[:200]

    async def reply(token_reply: str, messages: list):
        c = await creds()
        if not c or not messages:
            return
        if c.get("dry"):  # sim / tests only (set straight in the DB): keep the reply instead of calling LINE
            await db.line_replies.insert_one({"at": now(), "token": token_reply, "messages": messages[:5]})
            return
        code, r = await asyncio.to_thread(call, "POST", f"{API}/message/reply", c["token"], {"replyToken": token_reply, "messages": messages[:5]})
        if code != 200:
            await db.line_log.insert_one({"at": now(), "error": f"reply {code} {r!r}"[:400]})

    async def display_name(user: str) -> str:
        c = await creds()
        if c.get("dry"):
            return "ทดสอบ"
        code, r = await asyncio.to_thread(call, "GET", f"{API}/profile/{user}", c["token"])
        return (r.get("displayName") or "")[:40] if code == 200 and isinstance(r, dict) else ""

    async def save_photo(message_id: str) -> str | None:
        """LINE photo → the site's own media (re-encoded, EXIF/GPS dropped), unattached until the post is made."""
        c = await creds()
        if c.get("dry"):  # a made-up photo
            import io
            from PIL import Image
            buf = io.BytesIO()
            Image.new("RGB", (800, 600), (230, 150, 60)).save(buf, "JPEG")
            code, data = 200, buf.getvalue()
        else:
            code, data = await asyncio.to_thread(call, "GET", f"{DATA_API}/message/{message_id}/content", c["token"], None, True, 30)
        if code != 200 or not data or len(data) > 20 * 1024 * 1024:
            return None
        with tempfile.NamedTemporaryFile(suffix=".img", delete=False) as f:
            f.write(data)
            src = Path(f.name)
        try:
            main, thumb, w, h = await asyncio.to_thread(_process_image, src)
        except Exception:
            return None
        finally:
            src.unlink(missing_ok=True)
        mid = str(uuid.uuid4())
        file_id = await bucket.upload_from_stream(f"{mid}.jpg", main, metadata={"contentType": "image/jpeg"})
        thumb_id = await bucket.upload_from_stream(f"{mid}-thumb.jpg", thumb, metadata={"contentType": "image/jpeg"})
        await db.media.insert_one({"id": mid, "type": "image", "mime": "image/jpeg", "declared_size": len(data), "chunks": 0, "status": "ready",
                                   "file_id": file_id, "thumb_id": thumb_id, "width": w, "height": h, "duration": None, "size": len(main),
                                   "attached_to": None, "created_at": now(), "ready_at": now(), "via": "line"})
        return mid

    # ---------- sessions (one chat in progress per LINE user) ----------
    async def session(user: str) -> dict | None:
        s = await db.line_sessions.find_one({"user": user}, {"_id": 0})
        if s and now() - s["updated_at"].replace(tzinfo=timezone.utc) > SESSION_TTL:
            await db.line_sessions.delete_one({"user": user})
            return None
        return s

    async def save(user: str, s: dict):
        kv = {k: v for k, v in s.items() if k not in ("user", "updated_at")}
        await db.line_sessions.update_one({"user": user}, {"$set": {**kv, "user": user, "updated_at": now()}}, upsert=True)

    async def drop(user: str):
        await db.line_sessions.delete_one({"user": user})

    # ---------- the list ----------
    async def list_messages(only: str = "") -> list:
        q = {"status": "open"}
        if only:
            q["category"] = only
        items = await db.lost.find(q, repair.HIDDEN).sort("updated_at", -1).to_list(60)
        pets = [d for d in items if d.get("category") in ("dog", "cat", "pet")]
        rest = [d for d in items if d.get("category") not in ("dog", "cat", "pet")]
        items = (pets + rest)[:11]
        chips = qr(("📢 แจ้งสัตว์หาย", "แจ้งหาย"), ("🙌 เจอสัตว์หลง", "แจ้งเจอ"), ("🎉 ได้คืนแล้ว", "ได้คืนแล้ว"))
        if not items:
            return [text("ตอนนี้ไม่มีประกาศหาย·เจอ" + (f" ({CAT_TH[only]})" if only else "") + " ครับ 🙂\nถ้ามีน้องหาย กด 📢 แจ้งสัตว์หาย ด้านล่างได้เลย", chips)]
        bubbles = [card(d) for d in items]
        bubbles.append({"type": "bubble", "size": "kilo", "body": {"type": "box", "layout": "vertical", "justifyContent": "center", "spacing": "md", "contents": [
            {"type": "text", "text": "ดูทั้งหมด + แผนที่จุดที่เห็น", "weight": "bold", "wrap": True, "align": "center"},
            {"type": "button", "style": "secondary", "action": {"type": "uri", "label": "เปิดหาย·เจอ", "uri": f"{SITE}/#lost"}}]}})
        head = f"หาย·เจอ ตอนนี้ {len(items)} รายการ" + (f" ({CAT_TH[only]})" if only else "") + " · ปัดดูได้ ➡️"
        return [text(head), {"type": "flex", "altText": head, "contents": {"type": "carousel", "contents": bubbles}, "quickReply": chips}]

    # ---------- the report chat ----------
    STEPS = ("category", "photos", "desc", "soi", "when", "contact", "confirm")

    def ask(s: dict) -> dict:
        lost = s.get("kind") == "lost"
        step = s["step"]
        if step == "category":
            return text(("📢 แจ้งสัตว์หาย" if lost else "🙌 แจ้งเจอสัตว์หลง / ของหล่น") + "\nเป็นอะไรครับ?",
                        qr(("🐶 หมา", "หมา"), ("🐱 แมว", "แมว"), ("🐾 สัตว์อื่น", "สัตว์อื่น"), ("🎒 สิ่งของ", "สิ่งของ"), ("❌ ยกเลิก", "ยกเลิก")))
        if step == "photos":
            n = len(s.get("media", []))
            if n:
                return text(f"ได้รูปแล้ว {n} รูป 👍 ส่งเพิ่มได้อีก {MAX_PHOTOS - n} รูป หรือกด ต่อไป", qr(("➡️ ต่อไป", "ต่อไป"), ("❌ ยกเลิก", "ยกเลิก")))
            chips = {"items": [
                {"type": "action", "action": {"type": "cameraRoll", "label": "🖼️ เลือกรูป"}},
                {"type": "action", "action": {"type": "camera", "label": "📷 ถ่ายรูป"}},
                {"type": "action", "action": {"type": "message", "label": "ไม่มีรูป", "text": "ไม่มีรูป"}},
                {"type": "action", "action": {"type": "message", "label": "❌ ยกเลิก", "text": "ยกเลิก"}}]}
            return text("ส่งรูป" + ("น้อง" if s.get("category") in ("dog", "cat", "pet") else "") + f"มาได้เลยครับ (1–{MAX_PHOTOS} รูป) รูปช่วยให้คนจำได้มากที่สุด 📷", chips)
        if step == "desc":
            ex = "เช่น \"แมวส้ม ชื่อส้มจีน ตัวผู้ หูซ้ายแหว่ง ปลอกคอแดง\"" if lost else "เช่น \"หมาพันธุ์ไทย สีน้ำตาล ปลอกคอฟ้า เดินอยู่หน้าซอย\""
            return text(f"บอกลักษณะสั้นๆ ให้คนจำได้ครับ\n{ex}", qr(("❌ ยกเลิก", "ยกเลิก")))
        if step == "soi":
            return text(("หายแถวซอยไหนครับ" if lost else "เจอที่ซอยไหนครับ") + " (พิมพ์เลขซอย เช่น 16)", qr(("ไม่แน่ใจ", "ไม่แน่ใจ"), ("❌ ยกเลิก", "ยกเลิก")))
        if step == "when":
            return text(("หายตั้งแต่เมื่อไหร่ครับ" if lost else "เจอเมื่อไหร่ครับ") + " (พิมพ์เองได้ เช่น \"เมื่อคืน 2 ทุ่ม\")",
                        qr(("วันนี้", "วันนี้"), ("เมื่อวาน", "เมื่อวาน"), ("2–3 วันก่อน", "2–3 วันก่อน"), ("❌ ยกเลิก", "ยกเลิก")))
        if step == "contact":
            hint = f"\n(ไม่ใส่ชื่อจะใช้ชื่อ LINE \"{s['line_name']}\")" if s.get("line_name") else ""
            return text(f"ขอชื่อกับเบอร์ให้คน{'ที่เจอ' if lost else 'เป็นเจ้าของ'}โทรหาครับ เช่น \"ฝน 0812345678\"{hint}\nเบอร์จะโชว์เฉพาะตอนคนกดดูบนเว็บ", qr(("❌ ยกเลิก", "ยกเลิก")))
        # confirm
        lines = [
            ("😢 หาย" if lost else "🙌 เจอ") + f" · {CAT_TH.get(s.get('category'), '')}",
            f"📝 {s.get('desc', '')}",
            f"📍 {('ซ.' + s['soi']) if s.get('soi') else 'ไม่ระบุซอย'} · 🕒 {s.get('when') or '-'}",
            f"📷 รูป {len(s.get('media', []))} รูป",
            f"☎️ {s.get('name', '')} {s.get('phone', '')}",
        ]
        return text("เช็กก่อนลงประกาศนะครับ\n\n" + "\n".join(lines) + "\n\nลงแล้วเพื่อนบ้านที่เปิดแจ้งเตือนหาย·เจอ จะได้รับแจ้งทันที",
                    qr(("✅ ลงประกาศ", "postback:publish"), ("❌ ยกเลิก", "ยกเลิก")))

    async def advance(user: str, s: dict) -> list:
        s["step"] = STEPS[STEPS.index(s["step"]) + 1]
        await save(user, s)
        return [ask(s)]

    async def start(user: str, kind: str) -> list:
        s = {"kind": kind, "step": "category", "media": [], "line_name": await display_name(user)}
        await drop(user)
        await save(user, s)
        return [ask(s)]

    async def publish(user: str, s: dict) -> list:
        since = now() - timedelta(days=1)
        if await db.line_posts.count_documents({"user": user, "at": {"$gte": since}}) >= POSTS_PER_DAY:
            await drop(user)
            return [text("วันนี้ลงประกาศครบ 5 รายการแล้วครับ ถ้าจำเป็นทักเพจ FB หมู่บ้านได้เลย")]
        key, item_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        body = {"kind": s["kind"], "category": s["category"], "title": s["desc"][:80], "detail": s["desc"] if len(s["desc"]) > 80 else "",
                "soi": s.get("soi", ""), "when_seen": s.get("when", "")[:60], "name": s["name"], "phone": s["phone"], "lat": None, "lng": None}
        try:
            media = await claim_media(s.get("media", []), f"lost:{item_id}", {"image"})
        except HTTPException:
            media = []
        doc = {
            "id": item_id, **repair._clean(body), **repair.place(body, item_id, repair.NEAR_M), "media": media, "has_phone": True,
            "sightings": [], "status": "open", "via": "line",
            "history": [{"at": t, "by": s["name"][:60], "text": ("แจ้งของหาย" if s["kind"] == "lost" else "แจ้งเจอของ") + " (ผ่าน LINE)"}],
            "created_at": t, "updated_at": t, "edit_key_hash": repair._hash(key),
        }
        await db.lost.insert_one(dict(doc))
        await db.line_posts.insert_one({"user": user, "id": item_id, "title": doc["title"], "at": t})
        push.fire(push.on_lost, doc)
        await drop(user)
        return [text(f"✅ ลงประกาศแล้วครับ\n{SITE}/#lost-{item_id}\n\nเพื่อนบ้านที่เปิดแจ้งเตือนได้รับแจ้งแล้ว คนที่เห็นจะกด \"บอกว่าเห็น\" ไว้ในหน้าประกาศ"
                     + ("\n\nเจอน้องแล้ว พิมพ์ \"ได้คืนแล้ว\" ในแชทนี้ เพื่อปิดประกาศ 🎉" if s["kind"] == "lost" else "\n\nเจ้าของมารับแล้ว พิมพ์ \"ได้คืนแล้ว\" เพื่อปิดประกาศ 🎉"),
                     qr(("ดูหาย·เจอ ทั้งหมด", "หาย")))]

    async def mine(user: str) -> list:
        ids = [p["id"] async for p in db.line_posts.find({"user": user}, {"id": 1})]
        open_ = await db.lost.find({"id": {"$in": ids}, "status": "open"}, {"_id": 0, "id": 1, "title": 1}).to_list(12)
        if not open_:
            return [text("ไม่พบประกาศที่คุณลงผ่าน LINE ที่ยังเปิดอยู่ครับ\n(ถ้าลงผ่านเว็บ ปิดได้ที่หน้าประกาศบนเว็บ)", qr(("ดูหาย·เจอ", "หาย")))]
        return [text("ปิดประกาศไหนครับ 🎉", qr(*[(f"🎉 {d['title'][:17]}", f"postback:close:{d['id']}") for d in open_], ("ไม่ใช่", "ยกเลิก")))]

    async def close(user: str, item_id: str) -> list:
        if not await db.line_posts.find_one({"user": user, "id": item_id}):
            return [text("ปิดได้เฉพาะประกาศที่คุณลงเองครับ")]
        doc = await db.lost.find_one_and_update(
            {"id": item_id, "status": "open"},
            {"$set": {"status": "reunited", "updated_at": now()}, "$push": {"history": {"at": now(), "by": "เจ้าของประกาศ", "text": "ได้คืนแล้ว 🎉 (ผ่าน LINE)"}}},
            projection=repair.HIDDEN, return_document=True)
        if not doc:
            return [text("ประกาศนี้ปิดไปแล้วครับ")]
        push.fire(push.on_reunited, doc)
        return [text(f"🎉 ดีใจด้วยครับ ปิดประกาศ \"{doc['title'][:40]}\" แล้ว\nขอบคุณเพื่อนบ้านทุกคนที่ช่วยกันดู 🙏")]

    # ---------- one incoming message ----------
    async def on_text(user: str, raw: str) -> list:
        t = norm(raw)
        if t in CANCEL_WORDS:
            had = await session(user)
            await drop(user)
            return [text("ยกเลิกแล้วครับ 👌" if had else "โอเคครับ", qr(("ดูหาย·เจอ", "หาย")))]
        if t in ("แจ้งหาย", "📢 แจ้งสัตว์หาย", "แจ้งสัตว์หาย", "แจ้งของหาย"):
            return await start(user, "lost")
        if t in ("แจ้งเจอ", "🙌 เจอสัตว์หลง", "เจอสัตว์หลง", "แจ้งเจอของ"):
            return await start(user, "found")
        if t in ("ได้คืนแล้ว", "🎉 ได้คืนแล้ว", "กลับบ้านแล้ว", "ปิดประกาศ"):
            await drop(user)
            return await mine(user)
        s = await session(user)
        if s:
            step = s["step"]
            if step == "category":
                cat = {"หมา": "dog", "สุนัข": "dog", "🐶 หมา": "dog", "แมว": "cat", "🐱 แมว": "cat", "สัตว์อื่น": "pet", "สิ่งของ": "item", "ของ": "item"}.get(t)
                if not cat:
                    return [ask(s)]
                s["category"] = cat
                return await advance(user, s)
            if step == "photos":
                if t in ("ต่อไป", "ไม่มีรูป", "➡️ ต่อไป", "ไม่มี"):
                    return await advance(user, s)
                if len(t) >= 4:  # they skipped the photo and went straight to describing it
                    s["desc"] = raw.strip()[:400]
                    s["step"] = "desc"
                    return await advance(user, s)
                return [ask(s)]
            if step == "desc":
                if len(t) < 3:
                    return [text("ขออีกนิดครับ บอกสี ชื่อ หรือจุดสังเกต", qr(("❌ ยกเลิก", "ยกเลิก")))]
                s["desc"] = raw.strip()[:400]
                return await advance(user, s)
            if step == "soi":
                m = re.search(r"\d{1,3}(?:/\d{1,2})?", t)
                if not m and "ไม่" not in t:
                    return [text("พิมพ์เลขซอยครับ เช่น 16 หรือ 48/2", qr(("ไม่แน่ใจ", "ไม่แน่ใจ"), ("❌ ยกเลิก", "ยกเลิก")))]
                s["soi"] = m.group(0) if m else ""
                return await advance(user, s)
            if step == "when":
                s["when"] = raw.strip()[:60]
                return await advance(user, s)
            if step == "contact":
                m = re.search(r"0[\d\s\-]{8,12}", raw)
                if not m or len(re.sub(r"\D", "", m.group(0))) < 9:
                    return [text("ขอเบอร์โทรด้วยครับ เช่น \"ฝน 0812345678\"", qr(("❌ ยกเลิก", "ยกเลิก")))]
                phone = re.sub(r"\D", "", m.group(0))
                name = re.sub(r"\s+", " ", raw.replace(m.group(0), " ")).strip(" ,:-") or s.get("line_name") or "เจ้าของ"
                s["phone"], s["name"] = phone[:15], name[:60]
                return await advance(user, s)
            if step == "confirm":
                return [ask(s)]
        if t in LIST_WORDS:
            only = "cat" if "แมว" in t else "dog" if ("หมา" in t or "สุนัข" in t) else ""
            return await list_messages(only)
        if t in OA_KEYWORDS:
            return []  # the OA Manager's keyword reply answers this one
        return [text(FALLBACK, qr(("🐾 หาย·เจอ", "หาย"), ("☎️ เบอร์ฉุกเฉิน", "เบอร์ฉุกเฉิน"), ("☰ เมนู", "เมนู")))]

    async def on_image(user: str, message_id: str) -> list:
        s = await session(user)
        if not s or s["step"] not in ("photos", "category"):
            return []  # a photo outside a report: nothing to do (the bot never answers random photos)
        if len(s.get("media", [])) >= MAX_PHOTOS:
            return [] if s["step"] != "photos" else [ask(s)]
        mid = await save_photo(message_id)
        if not mid:
            return [text("รูปนี้เปิดไม่ได้ครับ ลองส่งใหม่อีกครั้ง")]
        # one atomic push: a person often sends 3 photos at once and they arrive as 3 events
        s = await db.line_sessions.find_one_and_update({"user": user}, {"$push": {"media": mid}, "$set": {"updated_at": now()}}, projection={"_id": 0}, return_document=True)
        if s["step"] == "category":
            return []  # the kind question is still on screen; the photo is kept
        return [ask(s)]  # "ได้รูปแล้ว n รูป · ส่งเพิ่ม หรือ ต่อไป"

    async def handle(ev: dict):
        user = (ev.get("source") or {}).get("userId")
        tok = ev.get("replyToken")
        if not user or not tok or (ev.get("source") or {}).get("type") != "user":
            return
        out: list = []
        try:
            if ev["type"] == "message":
                m = ev["message"]
                if m["type"] == "text":
                    out = await on_text(user, m.get("text", ""))
                elif m["type"] == "image":
                    out = await on_image(user, m["id"])
            elif ev["type"] == "postback":
                data = (ev.get("postback") or {}).get("data", "")
                if data == "publish":
                    s = await session(user)
                    out = await publish(user, s) if s and s["step"] == "confirm" else [text("หมดเวลาแล้วครับ เริ่มใหม่ได้ด้วยการพิมพ์ \"แจ้งหาย\"")]
                elif data.startswith("close:"):
                    out = await close(user, data[6:])
        except Exception as e:  # never let one bad event break the webhook
            await db.line_log.insert_one({"at": now(), "error": f"{type(e).__name__}: {e}"[:400]})
            out = [text("ขอโทษครับ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง หรือแจ้งที่ serithai57.com/#lost")]
        if out:
            await reply(tok, out)

    @router.post("/line/webhook")
    async def webhook(request: Request):
        body = await request.body()
        c = await creds()
        if not c:
            raise HTTPException(503, "bot not configured")
        sig = base64.b64encode(hmac.new(c["secret"].encode(), body, hashlib.sha256).digest()).decode()
        if not hmac.compare_digest(sig, request.headers.get("x-line-signature", "")):
            raise HTTPException(401, "bad signature")
        events = json.loads(body or b"{}").get("events", [])
        await db.settings.update_one({"id": "line_bot"}, {"$inc": {"events": len(events)}, "$set": {"last_event_at": now()}})
        for ev in events:  # in order: three photos sent together must land in the same report
            await handle(ev)
        return {"ok": True}

    @router.put("/admin/line-bot")
    async def put_creds(body: BotCreds, admin: dict = Depends(require_admin)):
        await db.settings.update_one({"id": "line_bot"}, {"$set": {"id": "line_bot", "secret": body.secret.strip(), "token": body.token.strip(), "set_at": now(), "by": admin["name"]}}, upsert=True)
        cache["at"] = None
        await audit(admin, "line-bot", "settings", "set channel secret/token")
        return {"configured": True}

    @router.get("/admin/line-bot")
    async def get_status(admin: dict = Depends(require_admin)):
        c = await db.settings.find_one({"id": "line_bot"}, {"_id": 0, "secret": 0, "token": 0}) or {}
        errors = await db.line_log.find({}, {"_id": 0}).sort("at", -1).to_list(5)
        return {"configured": bool(c.get("set_at")), "events": c.get("events", 0), "last_event_at": c.get("last_event_at"), "errors": errors}

    return router
