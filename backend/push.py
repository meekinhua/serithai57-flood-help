"""Web Push (the phone's own notifications) for บ้านฉัน — no app store, no LINE OA, no outside service.

A phone opts in from บ้านฉัน; its subscription is kept with the house's soi and the topics it chose:
  lost   หาย·เจอ: a pet lost / found / back home → the whole village; things → the same soi       (default on)
  waste  "พรุ่งนี้รถขยะเข้าซอยคุณ" the evening before (18:00)                                      (default on)
  news   ประกาศจากทีม (admin broadcast, tools/site.py push)                                        (default on)
  help   เพื่อนบ้านในซอย: ขอแรง · ยืม/ให้/ขาย                                                     (option)
  map    แผนที่หมู่บ้าน: จุดปัญหาใหม่ในซอยคุณ (ขยะ ฝาท่อ จุดอันตราย …)                           (option)
  shop   ช่าง·ร้านใหม่ในหมู่บ้าน (at most one every 3 hours)                                         (option)
  forum  กระทู้ใหม่ในกระดานคุยกัน (at most one every 3 hours)                                      (option)

  GET    /api/push/key                       → {key} (VAPID public key, generated once and kept in settings)
  POST   /api/push/subscribe                 {sub, house?, topics}
  POST   /api/push/unsubscribe               {endpoint}
  POST   /api/push/test                      {endpoint} → one test notification to this phone
  POST   /api/admin/push                     {title, body, url?, sois?, topic?} → {sent, gone}
  GET    /api/admin/push/stats               → phones, houses, per topic

Encryption is RFC 8291 (aes128gcm) and VAPID is RFC 8292, done with `cryptography` only.
"""
import asyncio
import base64
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from urllib.parse import urlparse

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

BKK = timezone(timedelta(hours=7))
TOPICS = {"lost", "waste", "news", "help", "map", "shop", "forum", "market"}  # market (17 Oct): new things in ตลาด, whole village
DEFAULT_TOPICS = ["lost", "waste", "news"]
PETS = {"dog", "cat", "pet"}
SUBJECT = "https://serithai57.com"
# only the browsers' own push services: a subscription can't make us call anywhere else
PUSH_HOSTS = re.compile(r"^(fcm\.googleapis\.com|[a-z0-9.-]*\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]*\.notify\.windows\.com|push\.services\.mozilla\.com)$")

_db = None  # set by build_router; fire() is a no-op before that


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _hkdf(salt: bytes, info: bytes, ikm: bytes, n: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)


def encrypt(p256dh: str, auth: str, payload: bytes) -> bytes:
    """RFC 8291 aes128gcm body for one subscription."""
    ua_pub = unb64u(p256dh)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    as_priv = ec.generate_private_key(ec.SECP256R1())
    as_pub = as_priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    secret = as_priv.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(unb64u(auth), b"WebPush: info\x00" + ua_pub + as_pub, secret, 32)
    salt = os.urandom(16)
    cek = _hkdf(salt, b"Content-Encoding: aes128gcm\x00", ikm, 16)
    nonce = _hkdf(salt, b"Content-Encoding: nonce\x00", ikm, 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + body


class Vapid:
    def __init__(self, priv_b64: str):
        self.priv = ec.derive_private_key(int.from_bytes(unb64u(priv_b64), "big"), ec.SECP256R1())
        self.pub = b64u(self.priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        self._jwt = {}

    def header(self, endpoint: str) -> str:
        u = urlparse(endpoint)
        aud = f"{u.scheme}://{u.netloc}"
        tok, exp = self._jwt.get(aud, ("", 0))
        if exp - time.time() < 3600:
            exp = int(time.time()) + 12 * 3600
            head = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}).encode())
            claims = b64u(json.dumps({"aud": aud, "exp": exp, "sub": SUBJECT}).encode())
            r, s = decode_dss_signature(self.priv.sign(f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
            tok = f"{head}.{claims}.{b64u(r.to_bytes(32, 'big') + s.to_bytes(32, 'big'))}"
            self._jwt[aud] = (tok, exp)
        return f"vapid t={tok}, k={self.pub}"


_vapid: Optional[Vapid] = None


async def vapid() -> Vapid:
    global _vapid
    if _vapid is None:
        doc = await _db.settings.find_one({"id": "vapid"})
        if not doc:
            k = ec.generate_private_key(ec.SECP256R1())
            doc = {"id": "vapid", "priv": b64u(k.private_numbers().private_value.to_bytes(32, "big")), "at": datetime.now(timezone.utc)}
            await _db.settings.update_one({"id": "vapid"}, {"$setOnInsert": doc}, upsert=True)
            doc = await _db.settings.find_one({"id": "vapid"})
        _vapid = Vapid(doc["priv"])
    return _vapid


def _post(endpoint: str, body: bytes, auth: str, ttl: int, urgency: str) -> int:
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={"Authorization": auth, "TTL": str(ttl), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Urgency": urgency},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception:
        return 0


async def send(query: dict, title: str, body: str, url: str = "/", tag: str = "", ttl: int = 24 * 3600, urgency: str = "normal") -> dict:
    """Send one notification to every subscription matching `query`. Dead ones (404/410) are dropped."""
    if _db is None:
        return {"sent": 0, "gone": 0}
    v = await vapid()
    payload = json.dumps({"title": title[:80], "body": body[:180], "url": url, "tag": tag}, ensure_ascii=False).encode()
    subs = await _db.push_subs.find(query, {"_id": 0, "endpoint": 1, "keys": 1}).to_list(5000)
    sem = asyncio.Semaphore(8)
    out = {"sent": 0, "gone": 0}

    async def one(s):
        async with sem:
            try:
                data = encrypt(s["keys"]["p256dh"], s["keys"]["auth"], payload)
            except Exception:
                code = 410  # keys we can't use: treat as gone
            else:
                code = await asyncio.to_thread(_post, s["endpoint"], data, v.header(s["endpoint"]), ttl, urgency)
            if code in (200, 201, 202):
                out["sent"] += 1
                await _db.push_subs.update_one({"endpoint": s["endpoint"]}, {"$set": {"last_ok": datetime.now(timezone.utc), "fails": 0}})
            elif code in (404, 410):
                out["gone"] += 1
                await _db.push_subs.delete_one({"endpoint": s["endpoint"]})
            else:
                await _db.push_subs.update_one({"endpoint": s["endpoint"]}, {"$inc": {"fails": 1}})

    await asyncio.gather(*(one(s) for s in subs))
    return out


def fire(coro_fn, *a, **kw):
    """Fire and forget from a request handler: a slow push service never slows the neighbour posting."""
    if _db is None:
        return

    async def run():
        try:
            await coro_fn(*a, **kw)
        except Exception:
            pass

    asyncio.create_task(run())


# ---------- what each event sends ----------
async def on_lost(doc: dict):
    pet = doc.get("category") in PETS
    q = {"topics": "lost"}
    if not pet:
        if not doc.get("soi"):
            return
        q["soi"] = doc["soi"]  # a lost wallet matters to its soi, not to the whole village
    head = ("😢 " + ("สัตว์เลี้ยงหาย" if pet else "ของหาย")) if doc.get("kind") == "lost" else ("🙌 มีคนเจอ" + ("สัตว์" if pet else "ของ") + " หาเจ้าของ")
    where = f" · ซ.{doc['soi']}" if doc.get("soi") else ""
    await send(q, f"{head}{where}", f"{doc.get('title', '')} · เห็นไหม? แตะดูรูป", f"/#lost-{doc['id']}", tag=f"lost-{doc['id']}", urgency="high")


async def on_reunited(doc: dict):
    if doc.get("category") not in PETS:
        return
    await send({"topics": "lost"}, "🎉 กลับบ้านแล้ว", f"{doc.get('title', '')} · ขอบคุณทุกคนที่ช่วยกันดู", f"/#lost-{doc['id']}", tag=f"lost-{doc['id']}")


ISSUE_WORDS = {
    "trash": "🗑️ กองขยะตกค้าง",
    "cover": "🕳️ ฝาท่อแตก",
    "danger": "⚠️ จุดอันตราย",
    "drain": "🌀 ท่อตัน",
    "light": "💡 ไฟถนนดับ",
    "road": "🚧 ถนนพัง",
    "tree": "🌳 ต้นไม้ล้ม",
    "wire": "⚠️ สายไฟห้อย",
    "water": "🚰 น้ำประปา",
    "smell": "🦟 น้ำขัง",
}
_quiet: dict = {}  # topic → when it last went to the whole village (anyone can post a shop / a topic: never a stream)


def _quiet_ok(topic: str, hours: float = 3) -> bool:
    if time.time() - _quiet.get(topic, 0) < hours * 3600:
        return False
    _quiet[topic] = time.time()
    return True


async def on_issue(doc: dict):
    if not doc.get("soi"):
        return
    head = ISSUE_WORDS.get(doc.get("type"), "📍 จุดปัญหา")
    await send({"topics": "map", "soi": doc["soi"]}, f"{head} · ซ.{doc['soi']}", (doc.get("detail") or "มีคนแจ้งจุดปัญหาใหม่ในซอยคุณ") + " · แตะดูบนแผนที่", f"/#issue-{doc['id']}", tag=f"issue-{doc['id']}")


MARKET_SHOPS = ("food", "shop", "supplies")  # directory shops that are listed in ตลาด (services.py categories)
_market_pending: list = []  # (title, url) waiting for the next ตลาด notification
_market_timer: list = []


async def _market_flush():
    items, _market_pending[:] = list(_market_pending), []
    if not items:
        return
    if len(items) == 1:
        await send({"topics": "market"}, "🛍️ ของใหม่ในตลาด", items[0][0], items[0][1], tag="market")
    else:
        await send({"topics": "market"}, f"🛍️ ของใหม่ในตลาด {len(items)} รายการ", " · ".join(t for t, _ in items[:3]) + (" …" if len(items) > 3 else ""), "/#market", tag="market")


async def _market_later():
    try:
        await asyncio.sleep(max(60, 3 * 3600 - (time.time() - _quiet.get("market", 0))))
        _quiet["market"] = time.time()
        await _market_flush()
    finally:
        _market_timer.clear()


async def market_news(title: str, url: str):
    """17 Oct: something new to buy (a neighbour's item or a shop) → everyone who chose ตลาด, at most once in 3 hours;
    whatever comes in between goes out together at the end of the window ("ของใหม่ในตลาด 3 รายการ")."""
    _market_pending.append((title[:60], url))
    if _quiet_ok("market"):
        await _market_flush()
    elif not _market_timer:
        _market_timer.append(asyncio.create_task(_market_later()))


async def on_lend(doc: dict):
    if doc.get("kind") == "sell":  # ตลาด: the whole village (topic market) instead of the soi
        name = f"{doc['shop_name']} · " if doc.get("shop_name") else ""
        await market_news(f"{name}{doc.get('title', '')}" + (f" · {doc['price']}" if doc.get("price") else ""), f"/#market-{doc['id']}")
        return
    if not doc.get("soi"):
        return
    word = {"want": "อยากยืม", "give": "แจกให้", "sell": "ขาย"}.get(doc.get("kind"), "ให้ยืม")
    await send({"topics": "help", "soi": doc["soi"]}, f"🧰 เพื่อนบ้าน ซ.{doc['soi']} {word}", doc.get("title") or doc.get("name") or "", f"/#{'market' if doc.get('kind') == 'sell' else 'lend'}-{doc['id']}", tag=f"lend-{doc['id']}")


async def on_order(doc: dict, entry: dict):
    """ตลาด: someone ordered / reserved — only the seller's own phone (the endpoint saved with the item), never the soi."""
    ep = doc.get("notify_endpoint")
    if not ep:
        return
    what = " · ".join(x for x in (entry.get("qty", ""), entry.get("pick", "")) if x)
    await send({"endpoint": ep}, f"🛎️ ออเดอร์ใหม่ · {doc.get('title', '')}"[:80], f"{entry.get('name', '')} {what}".strip() + " · แตะดูเบอร์",
               f"/#market-{doc['id']}", tag=f"order-{doc['id']}", urgency="high")


async def on_shop(doc: dict):
    if doc.get("category") in MARKET_SHOPS:  # 17 Oct: ร้านอาหาร / ร้านค้า live in ตลาด now
        await market_news(f"🏪 ร้านใหม่ · {doc.get('name', '')}", "/#market")
        return
    if not _quiet_ok("shop"):
        return
    await send({"topics": "shop"}, "🔧 ช่าง·บริการใหม่ในหมู่บ้าน", doc.get("name", ""), f"/#shop-{doc['id']}", tag="shop")


async def on_forum(doc: dict):
    if not _quiet_ok("forum"):
        return
    await send({"topics": "forum"}, "💬 กระทู้ใหม่ในกระดานคุยกัน", doc.get("title", ""), f"/#forum-{doc['id']}", tag="forum")


async def on_need(doc: dict):
    if doc.get("type") == "hire" or doc.get("kind") != "need" or not doc.get("soi"):
        return
    await send({"topics": "help", "soi": doc["soi"]}, f"🙋 เพื่อนบ้าน ซ.{doc['soi']} ขอแรง", doc.get("detail", ""), f"/#jobs-{doc['id']}", tag=f"job-{doc['id']}")


def build_router(db, rate_limit, require_admin, audit, locate_house, norm_house, soi_parity, waste_rounds, thai_days):
    global _db
    _db = db
    router = APIRouter(prefix="/api")

    class Keys(BaseModel):
        p256dh: str = Field(..., max_length=200)
        auth: str = Field(..., max_length=60)

    class Sub(BaseModel):
        endpoint: str = Field(..., max_length=800)
        keys: Keys

    class SubBody(BaseModel):
        sub: Sub
        house: str = Field("", max_length=20)
        topics: List[str] = Field(default_factory=lambda: list(DEFAULT_TOPICS))

    class EndBody(BaseModel):
        endpoint: str = Field(..., max_length=800)

    class Broadcast(BaseModel):
        title: str = Field(..., min_length=2, max_length=80)
        body: str = Field("", max_length=180)
        url: str = Field("/", max_length=200)
        sois: str = Field("", max_length=200)  # "" = everyone, "14" / "1-10,21"
        topic: str = "news"

    def check_endpoint(ep: str):
        u = urlparse(ep)
        if u.scheme != "https" or not PUSH_HOSTS.match(u.hostname or ""):
            raise HTTPException(422, "ช่องทางแจ้งเตือนนี้ใช้ไม่ได้")

    @router.get("/push/key")
    async def key():
        return {"key": (await vapid()).pub}

    count_cache = {"at": 0.0, "houses": 0}

    @router.get("/push/count")
    async def count():
        if time.time() - count_cache["at"] > 300:
            count_cache.update(at=time.time(), houses=len([h for h in await db.push_subs.distinct("house") if h]))
        return {"houses": count_cache["houses"]}

    @router.post("/push/subscribe")
    async def subscribe(body: SubBody, request: Request):
        rate_limit(request, "push", limit=30, window_s=600)
        check_endpoint(body.sub.endpoint)
        topics = sorted({t for t in body.topics if t in TOPICS})
        h, soi = "", ""
        if body.house.strip():
            h = norm_house(body.house)
            try:
                soi = str((await locate_house(h)).get("soi") or "")
            except Exception:
                soi = ""
        t = datetime.now(timezone.utc)
        await db.push_subs.update_one(
            {"endpoint": body.sub.endpoint},
            {
                "$set": {"keys": body.sub.keys.model_dump(), "house": h, "soi": soi, "parity": soi_parity(soi) or "", "topics": topics, "updated_at": t, "ua": request.headers.get("user-agent", "")[:120]},
                "$setOnInsert": {"created_at": t, "fails": 0},
            },
            upsert=True,
        )
        return {"ok": True, "house": h, "soi": soi, "topics": topics}

    @router.post("/push/unsubscribe")
    async def unsubscribe(body: EndBody, request: Request):
        rate_limit(request, "push", limit=30, window_s=600)
        await db.push_subs.delete_one({"endpoint": body.endpoint})
        return {"ok": True}

    @router.post("/push/test")
    async def test(body: EndBody, request: Request):
        rate_limit(request, "push-test", limit=5, window_s=600)
        if not await db.push_subs.find_one({"endpoint": body.endpoint}, {"_id": 1}):
            raise HTTPException(404, "ยังไม่ได้เปิดแจ้งเตือน")
        r = await send({"endpoint": body.endpoint}, "🔔 แจ้งเตือนใช้ได้แล้ว", "เรื่องสำคัญของบ้านคุณจะเด้งแบบนี้ · เสรีไทย 57", "/", tag="test")
        return r

    def soi_list(spec: str) -> List[str]:
        out = []
        for part in re.split(r"[,\s]+", spec.strip()):
            m = re.fullmatch(r"(\d+)-(\d+)", part)
            if m:
                out += [str(i) for i in range(int(m.group(1)), int(m.group(2)) + 1)]
            elif part:
                out.append(part)
        return out

    @router.post("/admin/push")
    async def broadcast(body: Broadcast, admin: dict = Depends(require_admin)):
        if body.topic not in TOPICS:
            raise HTTPException(422, "หัวข้อไม่ถูกต้อง")
        q = {"topics": body.topic}
        if body.sois.strip():
            q["soi"] = {"$in": soi_list(body.sois)}
        r = await send(q, body.title, body.body, body.url or "/", tag=f"news-{int(time.time())}")
        await audit(admin, "push", body.title, f"sois={body.sois or 'all'} sent={r['sent']} gone={r['gone']}")
        return r

    @router.get("/admin/push/stats")
    async def stats(admin: dict = Depends(require_admin)):
        phones = await db.push_subs.count_documents({})
        houses = len([h for h in await db.push_subs.distinct("house") if h])
        per = {t: await db.push_subs.count_documents({"topics": t}) for t in sorted(TOPICS)}
        return {"phones": phones, "houses": houses, "topics": per}

    async def waste_evening():
        """18:00 Bangkok: "พรุ่งนี้รถขยะเข้าซอยคุณ" to the sois whose round is tomorrow (once a day)."""
        while True:
            try:
                t = datetime.now(BKK)
                if t.hour == 18:
                    today = t.date().isoformat()
                    mark = await db.settings.find_one({"id": "push_waste"}, {"_id": 0, "date": 1})
                    if (mark or {}).get("date") != today:
                        await db.settings.update_one({"id": "push_waste"}, {"$set": {"id": "push_waste", "date": today}}, upsert=True)
                        rounds = {**waste_rounds, **((await db.settings.find_one({"id": "waste"}, {"_id": 0, "rounds": 1}) or {}).get("rounds") or {})}
                        day = thai_days[(t.date() + timedelta(days=1)).weekday()]
                        from myhome import waste_days  # per soi (16 Oct), falling back to the soi parity
                        sois = [s for s in await db.push_subs.distinct("soi", {"topics": "waste"}) if s and day in (waste_days(s, rounds) or "")]
                        if sois:
                            await send({"topics": "waste", "soi": {"$in": sois}}, "🚛 พรุ่งนี้รถขยะเข้าซอยคุณ", f"วัน{day} · มัดถุงวางหน้าบ้านคืนนี้", "/", tag="waste", ttl=12 * 3600)
            except Exception:
                pass
            await asyncio.sleep(600)

    async def start():
        await db.push_subs.create_index("endpoint", unique=True)
        await db.push_subs.create_index([("topics", 1), ("soi", 1)])
        return asyncio.create_task(waste_evening())

    router.start = start  # server.py startup calls it
    return router
