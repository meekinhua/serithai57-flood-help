"""LINE OA bot (@004forpb) for หาย·เจอ — most neighbours have LINE but not the app.

Everything here is a *reply* (to a message the person just sent), and LINE does not count replies against the
free plan's 300 messages a month, so the bot costs nothing however much it is used. It never pushes.

  พิมพ์ "หาย" / "เจอ" / "แมว" / "หมา"  → the open หาย·เจอ posts as cards with photos (live from the site)
  "แจ้งหาย" / "แจ้งเจอ"               → a short chat: kind → photos → what it looks like → soi → when → name + phone
                                         → confirm → a real หาย·เจอ post (the site's phone notifications go out as usual)
  "ได้คืนแล้ว"                         → the person's own open posts → tap one → 🎉 closed (+ the "back home" notification)
  "ตลาด" / "ซื้อ" / "ของกิน"            → ตลาดเพื่อนบ้าน: the open things for sale (lend items of kind "sell") as cards
  "ลงขาย" / "ขายของ"                   → a short chat: category → photos → what → price → soi → when → name + phone
                                         → confirm → a real ตลาด item, same as the site's form (POST /api/lend)
  "ขายหมดแล้ว" / "ปิดร้าน"              → the person's own open market items → tap one → closed
  🛒 สั่ง / จอง (button on a card)      → a short chat: how many → when to pick up → name + phone → confirm → an order in
                                         that item's queue (same as the site's form); homemade sellers cook to order
  "ออเดอร์"                            → the seller's open orders (name, phone, qty, when) → tap ✅ when handed over;
                                         a seller with new orders gets a "🛎️ มีออเดอร์ใหม่" line on top of any reply
  "ยกเลิก"                             → drop the chat in progress (either one; one chat per person, and the market's
                                         steps are named m_* so the two chats never read each other's answers)

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
    "ไฟดับ", "ไฟรั่ว", "ไฟถนน",  # ไฟดับ
    "ช่าง", "หาช่าง", "ซ่อม", "ประปา",  # ช่าง บริการ (16 Oct: "ร้าน" now opens ตลาด — take it off the OA reply too)
    "บริจาค", "สลิป", "บัญชี", "ยอดบริจาค",  # บริจาค
    "แผนที่", "น้ำท่วม", "ระดับน้ำ",  # แผนที่ น้ำท่วม
}  # (the OA "หาย เจอ" and "ขยะ" replies must be switched off: the bot answers those now, per soi)
WASTE_WORDS = {"ขยะ", "รถขยะ", "วันรถขยะ", "ทิ้งขยะ", "🚛 รถขยะ", "รถขยะซอยฉัน"}
HOME_WORDS = {"บ้านฉัน", "🏠 บ้านฉัน", "บ้านเลขที่"}
SET_HOME_WORDS = {"เปลี่ยนบ้าน", "ใส่บ้านเลขที่", "🏠 ใส่บ้านเลขที่", "ผูกบ้าน", "ตั้งบ้าน"}
UNLINK_WORDS = {"ลบบ้าน", "เลิกผูก", "ลบบ้านเลขที่", "ลืมบ้าน"}
HOUSE_IN_TEXT = re.compile(r"^(?:บ้าน(?:เลขที่)?\s*)?(4\s*[/.\-]\s*\d{1,5}(?:/\d{1,3})?[ก-ฮ]?)$")
BKK = timezone(timedelta(hours=7))
WASTE_MORE = ("• กองขยะค้าง / มีคนเอามาทิ้ง แจ้งพร้อมปักหมุด serithai57.com/#issues\n• แจ้ง กทม. 1555 หรือ Traffy Fondue\n"
              "• วิธีแยกขยะ serithai57.com/#waste")
LIST_WORDS = {"หาย", "เจอ", "หายเจอ", "หาย·เจอ", "หาย เจอ", "สัตว์หาย", "ของหาย", "ดูประกาศ", "แมว", "หมา", "แมวหาย", "หมาหาย", "สุนัข", "สุนัขหาย"}
CANCEL_WORDS = {"ยกเลิก", "cancel", "เลิก", "❌ ยกเลิก"}
CAT_TH = {"dog": "หมา", "cat": "แมว", "pet": "สัตว์เลี้ยง", "item": "ของ", "document": "เอกสาร", "vehicle": "รถ", "other": "อื่นๆ"}
CAT_ICON = {"dog": "🐶", "cat": "🐱", "pet": "🐾", "item": "🎒", "document": "📄", "vehicle": "🚲", "other": "📦"}
FALLBACK = (  # 15 Oct: the team reads the chat now
    "ได้รับข้อความแล้วครับ 🙏 ทีมงานจะอ่านและตอบกลับ\nระหว่างนี้กดเมนูด้านล่าง หรือพิมพ์:\n"
    "• หาย / เจอ — สัตว์เลี้ยงหาย·เจอ แจ้งเองได้ในแชทนี้\n• ตลาด — ของทำเอง ร้านอาหาร ร้านค้า (สั่ง/จอง ลงขาย ได้ในแชทนี้)\n"
    "• เบอร์ฉุกเฉิน • ช่าง\n• ไฟดับ • ขยะ • บริจาค\n• บ้านฉัน — บอกบ้านเลขที่ครั้งเดียว ได้วันรถขยะของซอยคุณ\n• เมนู (ดูทุกอย่าง)"
)
# ---------- 🛍️ ตลาดเพื่อนบ้าน (15 Oct): lend items of kind "sell" (backend/repair.py), listed and posted from the chat ----------
MARKET_WORDS = {"ตลาด", "ตลาดเพื่อนบ้าน", "ซื้อ", "ของขาย", "ของกิน", "🛍️ ตลาด", "🛍️ ดูตลาด", "ดูตลาด",
                "ร้าน", "ร้านอาหาร", "ร้านค้า", "ของใช้", "สั่งอาหาร"}
SHOP_CATS = ("food", "shop", "supplies")  # 16 Oct: shops from the directory are part of ตลาด (site and bot)
SHOP_TH = {"food": ("🍜", "ร้านอาหาร"), "shop": ("🏪", "ร้านค้า"), "supplies": ("🧱", "วัสดุ·ของใช้")}
SELL_WORDS = {"ลงขาย", "ขายของ", "🛍️ ลงขายของ", "ลงขายของ"}
SOLD_WORDS = {"ขายหมดแล้ว", "✅ ขายหมดแล้ว", "ขายหมด", "ปิดร้าน"}
ORDER_WORDS = {"ออเดอร์", "ดูออเดอร์", "📋 ออเดอร์", "คำสั่งซื้อ", "ออเดอร์ของฉัน", "order", "orders"}
PREORDER_HINT = ("สั่ง", "ล่วงหน้า", "พรี", "จอง", "pre")
MKT_CATS = [("🍲 อาหารทำเอง", "homemade"), ("🧁 ขนม·เบเกอรี่", "dessert"), ("🧋 เครื่องดื่ม", "drinks"),
            ("🧶 งานฝีมือ", "handmade"), ("🪴 ต้นไม้", "plants"), ("📦 ของมือสอง/อื่นๆ", "other")]
MKT_WORD_CAT = {**{label: c for label, c in MKT_CATS},
                "อาหาร": "homemade", "อาหารทำเอง": "homemade", "กับข้าว": "homemade", "ของกิน": "homemade",
                "ขนม": "dessert", "เบเกอรี่": "dessert", "ขนม·เบเกอรี่": "dessert", "เครื่องดื่ม": "drinks", "น้ำ": "drinks",
                "งานฝีมือ": "handmade", "ต้นไม้": "plants", "มือสอง": "other", "ของมือสอง": "other", "อื่นๆ": "other", "ของมือสอง/อื่นๆ": "other"}
MKT_TH = {"homemade": "อาหารทำเอง", "dessert": "ขนม·เบเกอรี่", "drinks": "เครื่องดื่ม", "handmade": "งานฝีมือ", "plants": "ต้นไม้",
          "food": "ของกิน", "clothes": "เสื้อผ้า", "electronics": "เครื่องใช้ไฟฟ้า", "furniture": "ของใช้", "kids": "ของเด็ก", "other": "มือสอง·อื่นๆ"}
MKT_ICON = {"homemade": "🍲", "dessert": "🧁", "drinks": "🧋", "handmade": "🧶", "plants": "🪴", "food": "🍱", "clothes": "👕", "kids": "🧸"}


def now():
    return datetime.now(timezone.utc)


# ---------- per-house rich menu: the village menu + a strip on top "🏠 4/917 · ซอย 16 · รถขยะ จ.·พฤ." ----------
# Text pieces are pre-rendered (tools/line_menu_assets.py) because the server has no Thai font; we only paste them.
MENU_DIR = Path(__file__).parent / "data" / "line_menu"
MENU_VER = "v2"  # bump when base.png / the tiles change, so every house gets a freshly drawn menu
DAY_ABBR = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."]
_glyphs = {}


def _glyph(tok: str):
    from PIL import Image
    if not _glyphs:
        _glyphs["m"] = json.loads((MENU_DIR / "glyphs.json").read_text(encoding="utf-8"))
    g = _glyphs["m"]["glyphs"].get(tok)
    if not g:
        return None
    if tok not in _glyphs:
        _glyphs[tok] = Image.open(MENU_DIR / "glyphs" / g["file"]).convert("RGBA")
    return _glyphs[tok]


def menu_image(house: str, soi: str, days: str | None, thai_days: list) -> bytes:
    """2500×1686 JPEG: base.png with the house / soi / truck days written into the top strip."""
    import io
    from PIL import Image
    base = Image.open(MENU_DIR / "base.png").convert("RGB")
    words = [list(house), ["·"], ["ซอย"], list(soi)]
    if days:
        abbr = [DAY_ABBR[i] for i, d in enumerate(thai_days) if d in days]
        if abbr:
            words += [["·"], ["รถขยะ"], sum(([a, "dot_y"] for a in abbr), [])[:-1]]
    pieces, gap = [], 30
    for w in words:
        pieces += [_glyph(t) for t in w if _glyph(t) is not None] + [None]  # None = a word gap
    width = sum(gap if p is None else p.width for p in pieces)
    x0, room = 250, 2500 - 250 - 40
    scale = min(1.0, room / max(width, 1))
    x, strip = x0, _glyphs["m"]["strip"]
    for p in pieces:
        if p is None:
            x += int(gap * scale)
            continue
        im = p if scale == 1 else p.resize((max(1, int(p.width * scale)), max(1, int(p.height * scale))))
        base.paste(im, (x, (strip - im.height) // 2), im)
        x += im.width
    out = io.BytesIO()
    base.save(out, "JPEG", quality=86, optimize=True)
    return out.getvalue()


def home_url(house: str, hash_: str = "") -> str:
    """A site link that opens on this house (the page keeps ?home= as its บ้านฉัน)."""
    return f"{SITE}/?home={house}" + (f"#{hash_}" if hash_ else "")


def menu_areas(house: str) -> list:
    """Tap areas: the strip → บ้านฉัน; the 6 tiles as on the village menu (OA Manager menu 20408889); 15 Oct: tile 6 → ตลาด."""
    strip, w, h = 230, [833, 833, 834], (1686 - 230) // 2
    acts = [{"type": "message", "text": "เบอร์ฉุกเฉิน"}, {"type": "uri", "uri": home_url(house, "issues")}, {"type": "uri", "uri": home_url(house, "pros")},
            {"type": "message", "text": "หาย"}, {"type": "message", "text": "ขยะ"}, {"type": "message", "text": "ตลาด"}]
    areas = [{"bounds": {"x": 0, "y": 0, "width": 2500, "height": strip}, "action": {"type": "message", "text": "บ้านฉัน"}}]
    for i, a in enumerate(acts):
        r, c = divmod(i, 3)
        areas.append({"bounds": {"x": sum(w[:c]), "y": strip + r * h, "width": w[c], "height": h if r == 0 else 1686 - strip - h}, "action": a})
    return areas


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


def build_router(db, require_admin, audit, claim_media, locate_house, norm_house, house_re, soi_parity, waste_rounds, thai_days) -> APIRouter:
    router = APIRouter(prefix="/api")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="media")
    cache = {"at": None, "creds": None}

    async def creds():
        if cache["at"] and now() - cache["at"] < timedelta(seconds=60):
            return cache["creds"]
        cache["creds"] = await db.settings.find_one({"id": "line_bot"}, {"_id": 0})
        cache["at"] = now()
        return cache["creds"]

    def call(method: str, url: str, token: str, body=None, raw=False, timeout=15, content=None, ctype="image/jpeg"):
        data = content if content is not None else json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        hdr = {"Content-Type": ctype} if content is not None else {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(url, data=data if data is not None else (b"" if method == "POST" else None), method=method, headers={"Authorization": f"Bearer {token}", **hdr})
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

    # ---------- บ้านฉัน: one LINE user ↔ one house (only the number and its soi are kept; "ลบบ้าน" forgets it) ----------
    async def home_of(user: str) -> dict | None:
        return await db.line_users.find_one({"user": user}, {"_id": 0})

    async def next_waste(soi: str):
        """(parity, "จันทร์ · พฤหัส", "พรุ่งนี้") for a soi, from the team's rounds (settings) or the defaults."""
        rounds = {**waste_rounds, **((await db.settings.find_one({"id": "waste"}, {"_id": 0, "rounds": 1}) or {}).get("rounds") or {})}
        parity = soi_parity(soi)
        days = rounds.get(parity) if parity else None
        if not days:
            return parity, None, None
        nowb = datetime.now(BKK)
        today = nowb.date()
        for i in range(8):
            if i == 0 and nowb.hour >= 12:
                continue  # the trucks come in the morning: after noon "today" has gone
            d = today + timedelta(days=i)
            if thai_days[d.weekday()] in days:
                return parity, days, ("วันนี้" if i == 0 else "พรุ่งนี้" if i == 1 else f"{thai_days[d.weekday()]} {d.day}")
        return parity, days, None

    async def set_menu(user: str, house: str, soi: str):
        """Give this LINE user the menu with their house on it (shared by everyone linked to the same house + soi).
        Linking a menu to a user is not a message, so it costs nothing; LINE allows 1000 menus per channel."""
        c = await creds()
        _, days, _ = await next_waste(soi)
        key = f"{MENU_VER}|{house}|{soi}|{days or ''}"
        m = await db.line_menus.find_one({"key": key})
        if not m:
            img = await asyncio.to_thread(menu_image, house, soi, days, thai_days)
            if c.get("dry"):
                Path(tempfile.gettempdir(), f"line_menu_{house.replace('/', '-')}.jpg").write_bytes(img)
                menu_id = "dry-" + uuid.uuid4().hex[:8]
            else:
                if await db.line_menus.count_documents({}) >= 900:  # keep well under LINE's 1000: drop menus nobody uses
                    used = set(await db.line_users.distinct("menu_id"))
                    async for old in db.line_menus.find({"menu_id": {"$nin": list(used)}}, {"menu_id": 1}):
                        await asyncio.to_thread(call, "DELETE", f"{API}/richmenu/{old['menu_id']}", c["token"])
                        await db.line_menus.delete_one({"menu_id": old["menu_id"]})
                body = {"size": {"width": 2500, "height": 1686}, "selected": False, "name": f"home {house}"[:300], "chatBarText": "เมนูหมู่บ้าน", "areas": menu_areas(house)}
                code, r = await asyncio.to_thread(call, "POST", f"{API}/richmenu", c["token"], body)
                if code != 200:
                    raise RuntimeError(f"richmenu create {code} {r!r}"[:300])
                menu_id = r["richMenuId"]
                code, r = await asyncio.to_thread(call, "POST", f"{DATA_API}/richmenu/{menu_id}/content", c["token"], None, False, 30, img)
                if code != 200:
                    await asyncio.to_thread(call, "DELETE", f"{API}/richmenu/{menu_id}", c["token"])
                    raise RuntimeError(f"richmenu image {code} {r!r}"[:300])
            m = {"key": key, "house": house, "soi": soi, "days": days, "menu_id": menu_id, "at": now()}
            await db.line_menus.insert_one(dict(m))
        if not c.get("dry"):
            code, r = await asyncio.to_thread(call, "POST", f"{API}/user/{user}/richmenu/{m['menu_id']}", c["token"])
            if code != 200:
                raise RuntimeError(f"richmenu link {code} {r!r}"[:300])
        await db.line_users.update_one({"user": user}, {"$set": {"menu_id": m["menu_id"], "menu_ver": MENU_VER}})

    async def clear_menu(user: str):
        c = await creds()
        if not c.get("dry"):
            await asyncio.to_thread(call, "DELETE", f"{API}/user/{user}/richmenu", c["token"])  # back to the village menu

    async def waste_reply(user: str) -> list:
        home = await home_of(user)
        if home and home.get("soi"):
            parity, days, nxt = await next_waste(home["soi"])
            if days:
                head = (f"🚛 ซ.{home['soi']} (ซอยเลข{'คู่' if parity == 'even' else 'คี่'}) รถเก็บขยะ {days}\nรอบต่อไป: {nxt}"
                        + (" · มัดถุงวางหน้าบ้านคืนนี้" if nxt == "พรุ่งนี้" else ""))
                return [text(f"{head}\n\n🔔 อยากให้เตือนคืนก่อนรถมา: เปิด {home_url(home['house'])} แล้วกด เปิดแจ้งเตือน\n\n{WASTE_MORE}", qr(("🏠 บ้านฉัน", "บ้านฉัน")))]
        even, odd = (await next_waste("2"))[1], (await next_waste("1"))[1]
        return [text(f"🚛 รถเก็บขยะประจำ\n• ซอยเลขคู่: {even}\n• ซอยเลขคี่: {odd}\n\n🏠 บอกบ้านเลขที่ครั้งเดียว ครั้งหน้าพิมพ์ \"ขยะ\" จะบอกวันรถของซอยคุณเลย\n\n{WASTE_MORE}",
                     qr(("🏠 ใส่บ้านเลขที่", "ใส่บ้านเลขที่")))]

    async def home_ask(user: str) -> list:
        await drop(user)
        await save(user, {"step": "house"})
        return [text("🏠 บ้านเลขที่อะไรครับ (เช่น 4/917 หรือพิมพ์แค่ 917)\nเก็บไว้แค่บ้านเลขที่กับซอย ลบได้ทุกเมื่อด้วยการพิมพ์ \"ลบบ้าน\"", qr(("❌ ยกเลิก", "ยกเลิก")))]

    async def house_entered(user: str, raw: str) -> list:
        h = norm_house(re.sub(r"^บ้าน(เลขที่)?", "", raw.strip()))
        if not house_re.match(h):
            return [text("ใส่บ้านเลขที่แบบ 4/917 ครับ (พิมพ์แค่ 917 ก็ได้)", qr(("❌ ยกเลิก", "ยกเลิก")))]
        loc = await locate_house(h)
        if loc.get("soi"):
            await save(user, {"step": "house_confirm", "house": h, "soi": loc["soi"]})
            return [text(f"บ้าน {h} อยู่ ซ.{loc['soi']} ใช่ไหมครับ", qr(("✅ ใช่", "ใช่"), ("ซอยไม่ใช่", "ซอยไม่ใช่"), ("❌ ยกเลิก", "ยกเลิก")))]
        await save(user, {"step": "house_soi", "house": h})
        return [text(f"บ้าน {h} อยู่ซอยอะไรครับ (พิมพ์เลขซอย เช่น 16)", qr(("❌ ยกเลิก", "ยกเลิก")))]

    async def link(user: str, house: str, soi: str) -> list:
        await db.line_users.update_one({"user": user}, {"$set": {"user": user, "house": house, "soi": soi, "at": now()}}, upsert=True)
        await drop(user)
        try:
            await set_menu(user, house, soi)
        except Exception as e:  # the link stands even if LINE refuses the menu
            await db.line_log.insert_one({"at": now(), "error": f"menu: {type(e).__name__}: {e}"[:400]})
        return [text(f"✅ จำแล้วครับ บ้าน {house} · ซ.{soi}\nต่อไปพิมพ์ \"ขยะ\" จะบอกวันรถของซอยคุณ แจ้งหายก็ใส่ซอยให้เอง")] + await home_summary(user)

    async def home_summary(user: str) -> list:
        home = await home_of(user)
        if not home:
            return await home_ask(user)
        soi = home.get("soi") or ""
        parity, days, nxt = await next_waste(soi)
        issues = await db.issues.count_documents({"status": {"$ne": "fixed"}, "soi": soi}) if soi else 0
        lost = await db.lost.count_documents({"status": "open", "soi": soi}) if soi else 0
        lines = [f"🏠 บ้าน {home['house']} · ซ.{soi}"]
        if days:
            lines.append(f"🚛 รถขยะ {days} · รอบต่อไป {nxt}")
        lines.append(f"📍 ปัญหาในซอยที่ยังไม่แก้ {issues} เรื่อง" if issues else "📍 ซอยคุณไม่มีปัญหาค้าง 👍")
        if lost:
            lines.append(f"🐾 หาย·เจอ ในซอยคุณ {lost} รายการ")
        lines.append(f"\nดูเต็มๆ ที่บ้านคุณ:\n{home_url(home['house'])}")
        return [text("\n".join(lines), qr(("🚛 รถขยะ", "ขยะ"), ("🐾 หาย·เจอ", "หาย"), ("🛍️ ตลาด", "ตลาด"), ("เปลี่ยนบ้าน", "เปลี่ยนบ้าน")))]

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
            mine_soi = [(f"ซ.{s['home_soi']} (ซอยบ้านฉัน)", s["home_soi"])] if s.get("home_soi") else []
            return text(("หายแถวซอยไหนครับ" if lost else "เจอที่ซอยไหนครับ") + " (พิมพ์เลขซอย เช่น 16)", qr(*mine_soi, ("ไม่แน่ใจ", "ไม่แน่ใจ"), ("❌ ยกเลิก", "ยกเลิก")))
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
        s = {"kind": kind, "step": "category", "media": [], "line_name": await display_name(user), "home_soi": ((await home_of(user)) or {}).get("soi")}
        await drop(user)
        await save(user, s)
        return [ask(s)]

    async def publish(user: str, s: dict) -> list:
        since = now() - timedelta(days=1)
        if await db.line_posts.count_documents({"user": user, "type": {"$ne": "market"}, "at": {"$gte": since}}) >= POSTS_PER_DAY:
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
        ids = [p["id"] async for p in db.line_posts.find({"user": user, "type": {"$ne": "market"}}, {"id": 1})]
        open_ = await db.lost.find({"id": {"$in": ids}, "status": "open"}, {"_id": 0, "id": 1, "title": 1}).to_list(12)
        if not open_:
            return [text("ไม่พบประกาศที่คุณลงผ่าน LINE ที่ยังเปิดอยู่ครับ\n(ถ้าลงผ่านเว็บ ปิดได้ที่หน้าประกาศบนเว็บ)", qr(("ดูหาย·เจอ", "หาย")))]
        return [text("ปิดประกาศไหนครับ 🎉", qr(*[(f"🎉 {d['title'][:17]}", f"postback:close:{d['id']}") for d in open_], ("ไม่ใช่", "ยกเลิก")))]

    async def close(user: str, item_id: str) -> list:
        if not await db.line_posts.find_one({"user": user, "id": item_id, "type": {"$ne": "market"}}):
            return [text("ปิดได้เฉพาะประกาศที่คุณลงเองครับ")]
        doc = await db.lost.find_one_and_update(
            {"id": item_id, "status": "open"},
            {"$set": {"status": "reunited", "updated_at": now()}, "$push": {"history": {"at": now(), "by": "เจ้าของประกาศ", "text": "ได้คืนแล้ว 🎉 (ผ่าน LINE)"}}},
            projection=repair.HIDDEN, return_document=True)
        if not doc:
            return [text("ประกาศนี้ปิดไปแล้วครับ")]
        push.fire(push.on_reunited, doc)
        return [text(f"🎉 ดีใจด้วยครับ ปิดประกาศ \"{doc['title'][:40]}\" แล้ว\nขอบคุณเพื่อนบ้านทุกคนที่ช่วยกันดู 🙏")]

    # ---------- 🛍️ ตลาดเพื่อนบ้าน ----------
    def market_card(d: dict) -> dict:
        """One thing for sale as a Flex bubble: photo, what, price, soi · when, a link to it in the site's market."""
        cat = d.get("category")
        where = " · ".join(x for x in (f"ซ.{d['soi']}" if d.get("soi") else "", d.get("when", "")) if x)
        url = f"{SITE}/#market-{d['id']}"
        body = [{"type": "text", "text": f"🛍️ {MKT_TH.get(cat, 'ของขาย')}", "size": "xs", "weight": "bold", "color": "#8F2A1C"},
                {"type": "text", "text": d.get("title", "")[:80] or "-", "weight": "bold", "size": "md", "wrap": True, "maxLines": 3}]
        if d.get("price"):
            body.append({"type": "text", "text": d["price"][:60], "weight": "bold", "size": "lg", "color": "#8F2A1C", "wrap": True})
        if where:
            body.append({"type": "text", "text": where[:100], "size": "sm", "color": "#45504A", "wrap": True, "maxLines": 3})
        if d.get("preorder"):
            body.append({"type": "text", "text": "📝 รับสั่งล่วงหน้า", "size": "sm", "weight": "bold", "color": "#1E6B47"})
        b = {
            "type": "bubble", "size": "kilo",
            "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": body},
            "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": [
                {"type": "button", "style": "primary", "height": "sm", "color": "#1E6B47",
                 "action": {"type": "postback", "label": "🛒 สั่ง / จองไว้", "data": f"order:{d['id']}", "displayText": "🛒 สั่ง / จอง"}},
                {"type": "button", "style": "secondary", "height": "sm", "action": {"type": "uri", "label": "ดูรายละเอียด·โทร", "uri": url}}]},
        }
        media = [m for m in d.get("media") or [] if m.get("type") == "image"]
        if media:
            b["hero"] = {"type": "image", "url": f"{SITE}/api/media/{media[0]['id']}/thumb", "size": "full",
                         "aspectRatio": "4:3", "aspectMode": "cover", "action": {"type": "uri", "uri": url}}
        else:
            b["hero"] = {"type": "box", "layout": "vertical", "height": "90px", "backgroundColor": "#FFF4D6", "justifyContent": "center",
                         "contents": [{"type": "text", "text": MKT_ICON.get(cat, "🛍️"), "size": "3xl", "align": "center"}]}
        return b

    def shop_card(d: dict) -> dict:
        """A shop open every day (ช่าง·ร้าน directory, food / shop / supplies): name, area, a call button."""
        icon, cat = SHOP_TH.get(d.get("category"), ("🏪", "ร้าน"))
        body = [{"type": "text", "text": f"{icon} ร้านประจำ · {cat}", "size": "xs", "weight": "bold", "color": "#1F4F8A"},
                {"type": "text", "text": d.get("name", "")[:80] or "-", "weight": "bold", "size": "md", "wrap": True, "maxLines": 3}]
        if d.get("area") or d.get("price"):
            body.append({"type": "text", "text": " · ".join(x for x in (d.get("price", ""), d.get("area", "")) if x)[:100], "size": "sm", "color": "#45504A", "wrap": True, "maxLines": 2})
        tel = re.sub(r"[^\d+]", "", d.get("phone") or "")
        foot = [{"type": "button", "style": "primary", "height": "sm", "color": "#15201A", "action": {"type": "uri", "label": "📞 โทร", "uri": f"tel:{tel}"}}] if len(tel) >= 9 else []
        foot.append({"type": "button", "style": "secondary", "height": "sm", "action": {"type": "uri", "label": "ดูร้านทั้งหมด", "uri": f"{SITE}/#market"}})
        return {"type": "bubble", "size": "kilo",
                "hero": {"type": "box", "layout": "vertical", "height": "90px", "backgroundColor": "#E3EDF9", "justifyContent": "center",
                         "contents": [{"type": "text", "text": icon, "size": "3xl", "align": "center"}]},
                "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": body},
                "footer": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": foot}}

    async def market_list() -> list:
        items = await db.lend_items.find({"kind": "sell", "status": {"$ne": "closed"}}, {"_id": 0, "phone": 0, "edit_key_hash": 0, "queue": 0, "history": 0, "notify_endpoint": 0}
                                         ).sort("created_at", -1).to_list(10)
        chips = qr(("🛍️ ลงขายของ", "ลงขาย"), ("📋 ออเดอร์ของฉัน", "ออเดอร์"), ("✅ ขายหมดแล้ว", "ขายหมดแล้ว"))
        shops = await db.services.find({"category": {"$in": list(SHOP_CATS)}}, {"_id": 0, "name": 1, "category": 1, "area": 1, "price": 1, "phone": 1}
                                       ).sort([("pinned", -1), ("verified", -1), ("updated_at", -1)]).to_list(11)
        if not items and shops:
            items = []
        elif not items:
            return [text("ตอนนี้ยังไม่มีของขายในตลาดเพื่อนบ้านครับ 🙂\nทำขนม ทำกับข้าว หรือมีของเหลือใช้? กด 🛍️ ลงขายของ ด้านล่างได้เลย", qr(("🛍️ ลงขายของ", "ลงขาย")))]
        bubbles = ([market_card(d) for d in items] + [shop_card(d) for d in shops])[:11]
        bubbles.append({"type": "bubble", "size": "kilo", "body": {"type": "box", "layout": "vertical", "justifyContent": "center", "spacing": "md", "contents": [
            {"type": "text", "text": "ดูทั้งหมด + แยกตามหมวด + ร้านประจำ", "weight": "bold", "wrap": True, "align": "center"},
            {"type": "button", "style": "secondary", "action": {"type": "uri", "label": "ดูทั้งหมด", "uri": f"{SITE}/#market"}}]}})
        head = (f"🛍️ ตลาดเพื่อนบ้าน · ของทำเอง {len(items)} · ร้านประจำ {len(shops)} · ปัดดูได้ ➡️\n"
                "ของทำเองกด 🛒 สั่ง/จองไว้ได้ · ร้านกดโทรได้เลย · ระบบไม่รับเงิน")
        return [text(head), {"type": "flex", "altText": "ตลาดเพื่อนบ้าน", "contents": {"type": "carousel", "contents": bubbles}, "quickReply": chips}]

    MSTEPS = ("m_category", "m_photos", "m_title", "m_price", "m_soi", "m_when", "m_contact", "m_confirm")
    CANCEL = ("❌ ยกเลิก", "ยกเลิก")

    def mask(s: dict) -> dict:
        step = s["step"]
        if step == "m_category":
            return text("🛍️ ลงขายของในตลาดเพื่อนบ้าน\nขายอะไรครับ? เลือกหมวด", qr(*[(label, label) for label, _ in MKT_CATS], CANCEL))
        if step == "m_photos":
            n = len(s.get("media", []))
            if n:
                return text(f"ได้รูปแล้ว {n} รูป 👍 ส่งเพิ่มได้อีก {MAX_PHOTOS - n} รูป หรือกด ต่อไป", qr(("➡️ ต่อไป", "ต่อไป"), CANCEL))
            return text(f"ส่งรูปของที่ขายมาได้เลยครับ (1–{MAX_PHOTOS} รูป) รูปน่ากิน ขายง่าย 📷", {"items": [
                {"type": "action", "action": {"type": "cameraRoll", "label": "🖼️ เลือกรูป"}},
                {"type": "action", "action": {"type": "camera", "label": "📷 ถ่ายรูป"}},
                {"type": "action", "action": {"type": "message", "label": "ไม่มีรูป", "text": "ไม่มีรูป"}},
                {"type": "action", "action": {"type": "message", "label": "❌ ยกเลิก", "text": "ยกเลิก"}}]})
        if step == "m_title":
            return text("ขายอะไรครับ บอกชื่อของ + รายละเอียดสั้นๆ\nเช่น \"ขนมกล้วย ห่อใบตอง หวานน้อย\"", qr(CANCEL))
        if step == "m_price":
            return text("ราคาเท่าไหร่ครับ\nเช่น \"50 บาท\" หรือ \"กล่องละ 35\"", qr(("ต่อรองได้", "ต่อรองได้"), CANCEL))
        if step == "m_soi":
            mine_soi = [(f"ซ.{s['home_soi']} (ซอยบ้านฉัน)", s["home_soi"])] if s.get("home_soi") else []
            return text("รับของที่ซอยไหนครับ (พิมพ์เลขซอย เช่น 16)", qr(*mine_soi, ("ไม่บอกซอย", "ไม่บอกซอย"), CANCEL))
        if step == "m_when":
            return text("มีขายเมื่อไหร่ / รับของยังไงครับ\nพิมพ์เองได้ เช่น \"ทุกเช้า 7–9 โมง รับที่บ้าน\"",
                        qr(("สั่งล่วงหน้า", "สั่งล่วงหน้า"), ("มีทุกวัน", "มีทุกวัน"), ("วันนี้เท่านั้น", "วันนี้เท่านั้น"), CANCEL))
        if step == "m_contact":
            hint = f"\n(ไม่ใส่ชื่อจะใช้ชื่อ LINE \"{s['line_name']}\")" if s.get("line_name") else ""
            return text(f"ขอชื่อกับเบอร์ให้คนซื้อโทรหาครับ เช่น \"ป้าแดง 0812345678\"{hint}\nเบอร์จะโชว์เฉพาะตอนคนกดดูบนเว็บ", qr(CANCEL))
        lines = [
            f"🛍️ {MKT_TH.get(s.get('category'), '')} · {s.get('title', '')}",
            *([f"📝 {s['detail']}"] if s.get("detail") else []),
            f"💰 {s.get('price') or '-'}",
            f"📍 {('ซ.' + s['soi']) if s.get('soi') else 'ไม่ระบุซอย'} · 🕒 {s.get('when') or '-'}",
            f"📷 รูป {len(s.get('media', []))} รูป",
            f"☎️ {s.get('name', '')} {s.get('phone', '')}",
        ]
        return text("เช็กก่อนลงขายนะครับ\n\n" + "\n".join(lines) + "\n\nระบบไม่รับเงิน คนซื้อโทรตกลงกับคุณเอง",
                    qr(("✅ ลงขาย", "postback:publish_market"), CANCEL))

    def ask_any(s: dict) -> dict:
        return oask(s) if s.get("flow") == "order" else mask(s) if s.get("flow") == "market" else ask(s)

    async def madvance(user: str, s: dict) -> list:
        s["step"] = MSTEPS[MSTEPS.index(s["step"]) + 1]
        await save(user, s)
        return [mask(s)]

    async def market_start(user: str) -> list:
        s = {"flow": "market", "kind": "sell", "step": "m_category", "media": [], "line_name": await display_name(user),
             "home_soi": ((await home_of(user)) or {}).get("soi")}
        await drop(user)
        await save(user, s)
        return [mask(s)]

    async def market_step(user: str, s: dict, t: str, raw: str) -> list:
        step = s["step"]
        if step == "m_category":
            cat = MKT_WORD_CAT.get(raw.strip()) or MKT_WORD_CAT.get(t)
            if not cat:
                return [mask(s)]
            s["category"] = cat
            return await madvance(user, s)
        if step == "m_photos":
            if t in ("ต่อไป", "ไม่มีรูป", "➡️ ต่อไป", "ไม่มี"):
                return await madvance(user, s)
            if len(t) >= 4:  # skipped the photo and went straight to what it is
                s["step"] = "m_title"
                return await market_step(user, s, t, raw)
            return [mask(s)]
        if step == "m_title":
            if len(t) < 2:
                return [text("ขออีกนิดครับ ขายอะไร เช่น \"ขนมกล้วย ห่อใบตอง\"", qr(CANCEL))]
            first, _, rest = raw.strip().partition("\n")
            s["title"] = first.strip()[:80]
            s["detail"] = (raw.strip() if len(first.strip()) > 80 else rest.strip())[:400]
            return await madvance(user, s)
        if step == "m_price":
            p = raw.strip()[:60]
            s["price"] = f"{p} บาท" if re.fullmatch(r"\d[\d,.]*", p) else p
            return await madvance(user, s)
        if step == "m_soi":
            m = re.search(r"\d{1,3}(?:/\d{1,2})?", t)
            if not m and "ไม่" not in t:
                return [text("พิมพ์เลขซอยครับ เช่น 16 หรือ 48/2", qr(("ไม่บอกซอย", "ไม่บอกซอย"), CANCEL))]
            s["soi"] = m.group(0) if m else ""
            return await madvance(user, s)
        if step == "m_when":
            s["when"] = raw.strip()[:80]
            return await madvance(user, s)
        if step == "m_contact":
            m = re.search(r"0[\d\s\-]{8,12}", raw)
            if not m or len(re.sub(r"\D", "", m.group(0))) < 9:
                return [text("ขอเบอร์โทรด้วยครับ เช่น \"ป้าแดง 0812345678\"", qr(CANCEL))]
            name = re.sub(r"\s+", " ", raw.replace(m.group(0), " ")).strip(" ,:-") or s.get("line_name") or "ผู้ขาย"
            s["phone"], s["name"] = re.sub(r"\D", "", m.group(0))[:15], name[:60]
            return await madvance(user, s)
        return [mask(s)]  # m_confirm: the buttons are on screen

    async def market_publish(user: str, s: dict) -> list:
        """The same item POST /api/lend makes (kind sell), plus via: line; the LINE user closes it with "ขายหมดแล้ว"."""
        since = now() - timedelta(days=1)
        if await db.line_posts.count_documents({"user": user, "type": "market", "at": {"$gte": since}}) >= POSTS_PER_DAY:
            await drop(user)
            return [text(f"วันนี้ลงขายครบ {POSTS_PER_DAY} รายการแล้วครับ พรุ่งนี้ลงต่อได้ หรือลงที่ {SITE}/#market")]
        cat = s.get("category") if s.get("category") in repair.LEND_CATEGORIES else "other"
        key, item_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        body = {"name": s["name"], "phone": s["phone"], "kind": "sell", "category": cat, "title": s.get("title", "")[:80] or "ของขาย",
                "detail": s.get("detail", "")[:400], "soi": s.get("soi", "")[:12], "price": s.get("price", "")[:60], "pickup": "", "when": s.get("when", "")[:80],
                "preorder": any(w in s.get("when", "").lower() for w in PREORDER_HINT), "notify_endpoint": ""}
        try:
            media = await claim_media(s.get("media", []), f"lend:{item_id}", {"image"})
        except HTTPException:
            media = []
        doc = {
            "id": item_id, **repair._clean(body), "media": media, "status": "available", "lent_to": "", "until": "", "queue": [],
            "history": [{"at": t, "by": s["name"][:60], "text": "ลงขายผ่าน LINE"}], "via": "line",
            "created_at": t, "updated_at": t, "edit_key_hash": repair._hash(key),
        }
        await db.lend_items.insert_one(dict(doc))
        await db.line_posts.insert_one({"user": user, "id": item_id, "title": doc["title"], "at": t, "type": "market"})
        push.fire(push.on_lend, doc)
        await drop(user)
        return [text(f"✅ ลงขายแล้วครับ\n{SITE}/#market-{item_id}\n\nเพื่อนบ้านกด 🛒 สั่ง/จอง ไว้ได้ หรือโทรหาคุณเอง ระบบไม่รับเงิน\n"
                     "• มีคนสั่ง บอทจะบอกตอนคุณทักแชทนี้ หรือพิมพ์ \"ออเดอร์\" ดูชื่อ·เบอร์·จำนวน\n• ขายหมดแล้ว พิมพ์ \"ขายหมดแล้ว\" เพื่อปิด",
                     qr(("📋 ออเดอร์", "ออเดอร์"), ("🛍️ ดูตลาด", "ตลาด")))]

    async def market_mine(user: str) -> list:
        ids = [p["id"] async for p in db.line_posts.find({"user": user, "type": "market"}, {"id": 1})]
        open_ = await db.lend_items.find({"id": {"$in": ids}, "status": {"$ne": "closed"}}, {"_id": 0, "id": 1, "title": 1}).to_list(12)
        if not open_:
            return [text("ไม่พบของที่คุณลงขายผ่าน LINE ที่ยังเปิดอยู่ครับ\n(ถ้าลงผ่านเว็บ ปิดได้ที่หน้าตลาดบนเว็บ จากเครื่องที่ลง)", qr(("🛍️ ดูตลาด", "ตลาด")))]
        return [text("ปิดรายการไหนครับ ✅", qr(*[(f"✅ {d['title'][:17]}", f"postback:sold:{d['id']}") for d in open_], ("ไม่ใช่", "ยกเลิก")))]

    async def market_close(user: str, item_id: str) -> list:
        if not await db.line_posts.find_one({"user": user, "id": item_id, "type": "market"}):
            return [text("ปิดได้เฉพาะของที่คุณลงขายเองครับ")]
        doc = await db.lend_items.find_one_and_update(
            {"id": item_id, "kind": "sell", "status": {"$ne": "closed"}},
            {"$set": {"status": "closed", "updated_at": now()}, "$push": {"history": {"at": now(), "by": "ผู้ขาย", "text": "ขายหมด · ปิด (ผ่าน LINE)"}}},
            projection={"_id": 0, "title": 1})
        if not doc:
            return [text("รายการนี้ปิดไปแล้วครับ")]
        return [text(f"✅ ปิด \"{doc['title'][:40]}\" แล้วครับ ขอบคุณที่ขายให้เพื่อนบ้าน 🙏", qr(("🛍️ ลงขายของ", "ลงขาย")))]

    # ---------- 🛒 สั่ง / จอง (16 Oct): homemade sellers cook to order; the order goes into the item's queue ----------
    OSTEPS = ("o_qty", "o_pick", "o_contact", "o_confirm")

    def oask(s: dict) -> dict:
        step, what = s["step"], s.get("title", "")[:40]
        if step == "o_qty":
            return text(f"🛒 สั่ง / จอง \"{what}\"\nเอากี่ชิ้น/กี่กล่องครับ (พิมพ์ได้ เช่น \"2 กล่อง ไม่เผ็ด\")",
                        qr(("1", "1"), ("2", "2"), ("3", "3"), ("5", "5"), CANCEL))
        if step == "o_pick":
            return text(f"อยากได้เมื่อไหร่ครับ{(' (ผู้ขายแจ้งว่า ' + s['when'][:40] + ')') if s.get('when') else ''}\nพิมพ์เองได้ เช่น \"เสาร์ 8 โมง\"",
                        qr(("วันนี้", "วันนี้"), ("พรุ่งนี้เช้า", "พรุ่งนี้เช้า"), ("พรุ่งนี้เย็น", "พรุ่งนี้เย็น"), ("เสาร์-อาทิตย์", "เสาร์-อาทิตย์"), ("ตามสะดวกผู้ขาย", "ตามสะดวกผู้ขาย"), CANCEL))
        if step == "o_contact":
            hint = f"\n(ไม่ใส่ชื่อจะใช้ชื่อ LINE \"{s['line_name']}\")" if s.get("line_name") else ""
            last = [(f"ใช้ {s['last_phone']}", f"{s['last_name']} {s['last_phone']}")] if s.get("last_phone") else []
            return text(f"ขอชื่อกับเบอร์ให้ผู้ขายโทรยืนยันครับ เช่น \"ฝน 0812345678\"{hint}\nผู้ขายเห็นคนเดียว", qr(*last, CANCEL))
        lines = [f"🛒 {what}", f"จำนวน {s.get('qty') or '-'}", f"🕒 {s.get('pick') or '-'}", f"☎️ {s.get('name', '')} {s.get('phone', '')}"]
        return text("เช็กก่อนส่งออเดอร์นะครับ\n\n" + "\n".join(lines) + "\n\nผู้ขายจะโทรยืนยันราคา·เวลารับ ระบบไม่รับเงิน",
                    qr(("✅ ส่งออเดอร์", "postback:publish_order"), CANCEL))

    async def order_start(user: str, item_id: str) -> list:
        d = await db.lend_items.find_one({"id": item_id, "kind": "sell"}, {"_id": 0, "title": 1, "status": 1, "when": 1})
        if not d or d.get("status") == "closed":
            return [text("รายการนี้ปิดไปแล้วครับ 🙏", qr(("🛍️ ดูตลาด", "ตลาด")))]
        last = await db.line_buyers.find_one({"user": user}, {"_id": 0}) or {}
        s = {"flow": "order", "step": "o_qty", "item": item_id, "title": d.get("title", ""), "when": d.get("when", ""),
             "line_name": await display_name(user), "last_name": last.get("buyer_name", ""), "last_phone": last.get("buyer_phone", "")}
        await drop(user)
        await save(user, s)
        return [oask(s)]

    async def order_step(user: str, s: dict, t: str, raw: str) -> list:
        step = s["step"]
        if step == "o_qty":
            if not t:
                return [oask(s)]
            q = raw.strip()[:40]
            s["qty"] = f"{q} ชิ้น" if re.fullmatch(r"\d{1,3}", q) else q
        elif step == "o_pick":
            s["pick"] = raw.strip()[:60]
        elif step == "o_contact":
            m = re.search(r"0[\d\s\-]{8,12}", raw)
            if not m or len(re.sub(r"\D", "", m.group(0))) < 9:
                return [text("ขอเบอร์โทรด้วยครับ เช่น \"ฝน 0812345678\"", qr(CANCEL))]
            name = re.sub(r"\s+", " ", raw.replace(m.group(0), " ")).strip(" ,:-") or s.get("line_name") or "ผู้สั่ง"
            s["phone"], s["name"] = re.sub(r"\D", "", m.group(0))[:15], name[:60]
        else:
            return [oask(s)]  # o_confirm: the buttons are on screen
        s["step"] = OSTEPS[OSTEPS.index(step) + 1]
        await save(user, s)
        return [oask(s)]

    async def order_publish(user: str, s: dict) -> list:
        since = now() - timedelta(days=1)
        if await db.line_posts.count_documents({"user": user, "type": "order", "at": {"$gte": since}}) >= 10:
            await drop(user)
            return [text("วันนี้สั่งครบ 10 ครั้งแล้วครับ โทรหาผู้ขายได้จากหน้าเว็บ")]
        data = {"name": s["name"], "phone": s["phone"], "qty": s.get("qty", "")[:40], "pick": s.get("pick", "")[:60], "note": ""}
        doc = await repair.add_to_queue(db, s["item"], data, via="line", line_user=user)
        await drop(user)
        if not doc:
            return [text("รายการนี้ปิดไปแล้วครับ 🙏", qr(("🛍️ ดูตลาด", "ตลาด")))]
        await db.line_posts.insert_one({"user": user, "id": s["item"], "title": s.get("title", ""), "at": now(), "type": "order"})
        await db.line_buyers.update_one({"user": user}, {"$set": {"user": user, "buyer_name": s["name"], "buyer_phone": s["phone"], "at": now()}}, upsert=True)
        return [text(f"✅ ส่งออเดอร์ \"{s.get('title', '')[:40]}\" ให้ผู้ขายแล้วครับ\nผู้ขายจะโทรยืนยันที่ {s['phone']}\n"
                     f"ถ้าด่วน โทรหาผู้ขายเองได้ที่ {SITE}/#market-{s['item']}", qr(("🛍️ ดูตลาด", "ตลาด")))]

    async def seller_items(user: str) -> list:
        ids = [p["id"] async for p in db.line_posts.find({"user": user, "type": "market"}, {"id": 1})]
        if not ids:
            return []
        return await db.lend_items.find({"id": {"$in": ids}, "status": {"$ne": "closed"}}, {"_id": 0, "id": 1, "title": 1, "queue": 1}).to_list(20)

    async def unseen_orders(user: str) -> int:
        return sum(1 for d in await seller_items(user) for q in d.get("queue", []) if not q.get("done") and not q.get("seen"))

    async def seller_orders(user: str) -> list:
        items = await seller_items(user)
        rows, chips = [], []
        for d in items:
            for q in d.get("queue", []):
                if q.get("done"):
                    continue
                new = "🆕 " if not q.get("seen") else ""
                rows.append(f"{new}{d['title'][:30]}\n  {q.get('name', '')} ☎️ {q.get('phone', '')}\n  {' · '.join(x for x in (q.get('qty', ''), q.get('pick', ''), q.get('note', '')) if x) or '-'}")
                chips.append((f"✅ {q.get('name', '')[:8]} ได้แล้ว", f"postback:odone:{d['id']}:{q['id']}"))
            if any(not q.get("seen") for q in d.get("queue", [])):
                await db.lend_items.update_one({"id": d["id"]}, {"$set": {"queue.$[q].seen": True}}, array_filters=[{"q.seen": False}])
        if not items:
            return [text("ยังไม่มีของที่คุณลงขายผ่าน LINE ที่เปิดอยู่ครับ\n(ลงผ่านเว็บ ดูออเดอร์ได้ที่หน้าตลาด จากเครื่องที่ลง)", qr(("🛍️ ลงขายของ", "ลงขาย")))]
        if not rows:
            return [text("ยังไม่มีออเดอร์ใหม่ครับ 🙂 มีคนกดสั่ง บอทจะบอกตอนคุณทักแชทนี้", qr(("🛍️ ดูตลาด", "ตลาด")))]
        body = "\n\n".join(rows[:15])
        return [text(f"📋 ออเดอร์ที่ยังไม่ได้ส่ง {len(rows)} รายการ\n\n{body}\n\nโทรยืนยันกับผู้สั่ง แล้วกด ✅ เมื่อได้ของแล้ว"[:4900], qr(*chips[:12]))]

    async def order_done(user: str, item_id: str, entry_id: str) -> list:
        if not await db.line_posts.find_one({"user": user, "id": item_id, "type": "market"}):
            return [text("ปิดได้เฉพาะออเดอร์ของร้านคุณครับ")]
        await db.lend_items.update_one({"id": item_id, "queue.id": entry_id}, {"$set": {"queue.$.done": True, "updated_at": now()}})
        return [text("✅ เรียบร้อยครับ")] + await seller_orders(user)

    # ---------- one incoming message ----------
    async def on_text(user: str, raw: str) -> list:
        t = norm(raw)
        if t in CANCEL_WORDS:
            had = await session(user)
            await drop(user)
            chip = ("🛍️ ดูตลาด", "ตลาด") if had and had.get("flow") in ("market", "order") else ("ดูหาย·เจอ", "หาย")
            return [text("ยกเลิกแล้วครับ 👌" if had else "โอเคครับ", qr(chip))]
        if t in SELL_WORDS:
            return await market_start(user)
        if t in SOLD_WORDS:
            await drop(user)
            return await market_mine(user)
        if t in ORDER_WORDS:
            await drop(user)
            return await seller_orders(user)
        if t in ("แจ้งหาย", "📢 แจ้งสัตว์หาย", "แจ้งสัตว์หาย", "แจ้งของหาย"):
            return await start(user, "lost")
        if t in ("แจ้งเจอ", "🙌 เจอสัตว์หลง", "เจอสัตว์หลง", "แจ้งเจอของ"):
            return await start(user, "found")
        if t in ("ได้คืนแล้ว", "🎉 ได้คืนแล้ว", "กลับบ้านแล้ว", "ปิดประกาศ"):
            await drop(user)
            return await mine(user)
        if t in UNLINK_WORDS:
            await drop(user)
            r = await db.line_users.delete_one({"user": user})
            if r.deleted_count:
                await clear_menu(user)
            return [text("ลบบ้านเลขที่ออกแล้วครับ 👌" if r.deleted_count else "ยังไม่ได้ใส่บ้านเลขที่ไว้ครับ")]
        if t in SET_HOME_WORDS:
            return await home_ask(user)
        if t in HOME_WORDS:
            await drop(user)
            return await home_summary(user)
        if t == "ไว้ก่อน":
            return [text("ได้ครับ 👌 ใส่ทีหลังได้ พิมพ์ \"บ้านฉัน\"")]
        s = await session(user)
        if s and s["step"] in ("house", "house_confirm", "house_soi"):
            if s["step"] == "house":
                return await house_entered(user, raw)
            if s["step"] == "house_confirm":
                if t in ("ใช่", "✅ ใช่", "ถูก", "ใช่ครับ", "ใช่ค่ะ"):
                    return await link(user, s["house"], s["soi"])
                await save(user, {**s, "step": "house_soi"})
                return [text(f"บ้าน {s['house']} อยู่ซอยอะไรครับ (พิมพ์เลขซอย เช่น 16)", qr(("❌ ยกเลิก", "ยกเลิก")))]
            m = re.search(r"\d{1,3}(?:/\d{1,2})?", t)
            if not m:
                return [text("พิมพ์เลขซอยครับ เช่น 16 หรือ 48/2", qr(("❌ ยกเลิก", "ยกเลิก")))]
            return await link(user, s["house"], m.group(0))
        if not s and HOUSE_IN_TEXT.match(raw.strip()):
            await save(user, {"step": "house"})
            return await house_entered(user, raw)
        if s and s["step"].startswith("m_"):
            return await market_step(user, s, t, raw)
        if s and s["step"].startswith("o_"):
            return await order_step(user, s, t, raw)
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
        if t in MARKET_WORDS:
            return await market_list()
        if t in WASTE_WORDS:
            return await waste_reply(user)
        if t in OA_KEYWORDS:
            return []  # the OA Manager's keyword reply answers this one
        linked = await home_of(user)
        return [text(FALLBACK, qr(*([] if linked else [("🏠 ใส่บ้านเลขที่", "ใส่บ้านเลขที่")]), ("🐾 หาย·เจอ", "หาย"), ("🛍️ ตลาด", "ตลาด"), ("☎️ เบอร์ฉุกเฉิน", "เบอร์ฉุกเฉิน"), ("☰ เมนู", "เมนู")))]

    async def on_image(user: str, message_id: str) -> list:
        s = await session(user)
        if not s or s["step"] not in ("photos", "category", "m_photos", "m_category"):
            return []  # a photo outside a report: nothing to do (the bot never answers random photos)
        if len(s.get("media", [])) >= MAX_PHOTOS:
            return [] if s["step"] not in ("photos", "m_photos") else [ask_any(s)]
        mid = await save_photo(message_id)
        if not mid:
            return [text("รูปนี้เปิดไม่ได้ครับ ลองส่งใหม่อีกครั้ง")]
        # one atomic push: a person often sends 3 photos at once and they arrive as 3 events
        s = await db.line_sessions.find_one_and_update({"user": user}, {"$push": {"media": mid}, "$set": {"updated_at": now()}}, projection={"_id": 0}, return_document=True)
        if s["step"] in ("category", "m_category"):
            return []  # the kind question is still on screen; the photo is kept
        return [ask_any(s)]  # "ได้รูปแล้ว n รูป · ส่งเพิ่ม หรือ ต่อไป"

    async def handle(ev: dict):
        user = (ev.get("source") or {}).get("userId")
        tok = ev.get("replyToken")
        if not user or not tok or (ev.get("source") or {}).get("type") != "user":
            return
        out: list = []
        try:
            home = await home_of(user)
            if home and home.get("menu_ver") != MENU_VER and home.get("soi"):  # an older menu image: redraw it quietly
                try:
                    await set_menu(user, home["house"], home["soi"])
                except Exception as e:
                    await db.line_log.insert_one({"at": now(), "error": f"menu refresh: {type(e).__name__}: {e}"[:400]})
            if ev["type"] == "message":
                m = ev["message"]
                if m["type"] == "text":
                    out = await on_text(user, m.get("text", ""))
                elif m["type"] == "image":
                    out = await on_image(user, m["id"])
            elif ev["type"] == "follow" and not await home_of(user):
                # the OA greeting has already said hello; this only asks for the house (a reply, so free)
                out = [text("อีกนิดครับ 🏠 บอกบ้านเลขที่ครั้งเดียว (เช่น 4/917)\nแล้วถามเรื่องรถขยะ ปัญหาในซอย หรือแจ้งหาย จะได้คำตอบของซอยคุณเลย",
                            qr(("🏠 ใส่บ้านเลขที่", "ใส่บ้านเลขที่"), ("ไว้ก่อน", "ไว้ก่อน")))]
            elif ev["type"] == "postback":
                data = (ev.get("postback") or {}).get("data", "")
                if data in ("publish", "publish_market", "publish_order"):
                    s = await session(user)
                    if s and s["step"] == "confirm":
                        out = await publish(user, s)
                    elif s and s["step"] == "m_confirm":
                        out = await market_publish(user, s)
                    elif s and s["step"] == "o_confirm":
                        out = await order_publish(user, s)
                    elif data == "publish_order":
                        out = [text("หมดเวลาแล้วครับ พิมพ์ " + '"ตลาด"' + " แล้วกด 🛒 สั่ง อีกครั้ง")]
                    else:
                        out = [text("หมดเวลาแล้วครับ เริ่มใหม่ได้ด้วยการพิมพ์ " + ("\"ลงขาย\"" if data == "publish_market" else "\"แจ้งหาย\""))]
                elif data.startswith("order:"):
                    out = await order_start(user, data[6:])
                elif data.startswith("odone:"):
                    item_id, _, entry_id = data[6:].partition(":")
                    out = await order_done(user, item_id, entry_id)
                elif data.startswith("close:"):
                    out = await close(user, data[6:])
                elif data.startswith("sold:"):
                    out = await market_close(user, data[5:])
        except Exception as e:  # never let one bad event break the webhook
            await db.line_log.insert_one({"at": now(), "error": f"{type(e).__name__}: {e}"[:400]})
            out = [text("ขอโทษครับ ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง หรือแจ้งที่ serithai57.com/#lost")]
        if out and not await session(user):
            try:  # a seller with orders they haven't seen: one line on top of whatever we answer (a reply, so free)
                n = 0 if out[0].get("text", "").startswith("📋 ออเดอร์") else await unseen_orders(user)
                if n and len(out) < 5:
                    out.insert(0, text(f"🛎️ มีออเดอร์ใหม่ {n} รายการ · พิมพ์ \"ออเดอร์\" ดูชื่อ เบอร์ จำนวน"))
            except Exception:
                pass
            home = await home_of(user)
            chip = (f"🏠 {home['house']} · ซ.{home['soi']}", "บ้านฉัน") if home else ("🏠 ใส่บ้านเลขที่", "ใส่บ้านเลขที่")
            last = out[-1]
            items = (last.get("quickReply") or {}).get("items", [])
            same = [i for i in items if i["action"].get("text") == chip[1]]
            if same:
                same[0]["action"]["label"] = chip[0][:20]  # e.g. "🏠 บ้านฉัน" → "🏠 4/917 · ซ.16"
            else:
                last["quickReply"] = {"items": (qr(chip)["items"] + items)[:13]}
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
        return {"configured": bool(c.get("set_at")), "events": c.get("events", 0), "last_event_at": c.get("last_event_at"), "errors": errors,
                "houses_linked": await db.line_users.count_documents({})}

    return router
