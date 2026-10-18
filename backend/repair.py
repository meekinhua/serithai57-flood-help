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
- lost   หาย · เจอ — lost dogs/cats/things and found ones, photos, sightings, "ได้คืนแล้ว"

2 Oct afternoon: heavy rain again right after the water dried. Water levels, canal reports, leaks and pump
status stay OPEN in repair mode (the watch panel on the home page), only the request board and the
volunteer-ops tools are frozen. Jobs also cover rides out of the village, errands and hiring a tradesman.

Site mode: settings {id: "site_mode", mode: "repair"|"flood"}. In repair mode the flood write routes
answer 423 for everyone but admins; an admin can switch back to flood mode if the water returns.
"""
import hashlib
import math
import re
import secrets
import uuid

import push
from datetime import datetime, timezone
from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

LendKind = Literal["lend", "give", "want", "sell"]  # ให้ยืม · ให้ฟรี · ตามหา/อยากยืม · ขาย (7 Oct: the marketplace after the flood)
LEND_CATEGORIES = [
    "washer", "pump", "vacuum", "dryer", "ladder", "cleaning", "tools", "cart", "power", "furniture", "supplies",
    "food", "clothes", "electronics", "kids", "plants", "other",
    "homemade", "dessert", "drinks", "handmade",  # ตลาดเพื่อนบ้าน (sell): อาหารทำเอง · ขนม·เบเกอรี่ · เครื่องดื่ม · งานฝีมือ
    "preserved", "catering", "cosmetics", "petgoods",  # 17 Oct: ของฝาก·แปรรูป · รับจัดเลี้ยง · ความงาม · ของสัตว์เลี้ยง
]
import catalog  # noqa: E402  18 Oct: new market category keys come from the catalog (no deploy)


@catalog.on_change
def _lend_cats(doc):
    LEND_CATEGORIES.extend(k for k in doc["lend_labels"] if k not in LEND_CATEGORIES)


LendStatus = Literal["available", "lent", "closed"]  # ว่าง · มีคนยืมอยู่ · ปิด (คืนเจ้าของ/ให้ไปแล้ว/หาได้แล้ว)
JobKind = Literal["need", "offer"]  # ขอแรง · อาสาพร้อมไปช่วย
JOB_TYPES = ["clean", "move", "trash", "fix", "check", "elderly", "ride", "errand", "hire", "other"]
JobStatus = Literal["open", "scheduled", "done"]
ISSUE_TYPES = ["trash", "cover", "danger", "drain", "light", "road", "tree", "wire", "water", "smell", "other"]  # cover/danger: 9 Oct quick report
IssueStatus = Literal["open", "reported", "fixed"]
SiteMode = Literal["repair", "flood"]
LostKind = Literal["lost", "found"]
LOST_CATEGORIES = ["dog", "cat", "pet", "item", "document", "vehicle", "other"]
LostStatus = Literal["open", "reunited"]

# Writes that belong to the flood board: closed in repair mode (admins can still fix things).
# Water / canal / leak / pump reports stay open: the rain came back (2 Oct) and the village watches the water.
# Staff stay open too (live tracking of the helpers' boats and trucks), except the LINE import into the request board.
FLOOD_WRITES = ("/api/posts", "/api/ops", "/api/team", "/api/staff/import", "/api/zones")
YOUTUBE = re.compile(r"^https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)[\w-]{6,}[^\s]*$")
HIDDEN = {"_id": 0, "edit_key_hash": 0, "phone": 0, "house": 0, "voters": 0, "pet_house": 0}


def now():
    return datetime.now(timezone.utc)


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _clean(d: dict) -> dict:
    return {k: v.strip() if isinstance(v, str) else v for k, v in d.items()}


def _soi_key(soi: str):
    """ "ซ.48/2" → the soi we have on the map: "48/2" if known, else the main soi "48"."""
    import staff  # noqa: E402 (the soi centres)

    s = re.sub(r"^(ซอย|ซ\.?)\s*", "", (soi or "").strip())
    if s in staff.SOIS:
        return s
    m = re.match(r"\d+", s)
    return m.group() if m and m.group() in staff.SOIS else None


def soi_spot(soi: str, seed: str) -> dict:
    """Only the soi known: a point at the soi's middle (a little apart from the others there), marked approx."""
    import staff  # noqa: E402

    k = _soi_key(soi)
    c = (staff.SOIS.get(k) or {}).get("center") if k else None
    if not c:
        return {}
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:4], 16)
    return {"lat": round(c[0] + ((h % 21) - 10) * 0.000012, 6), "lng": round(c[1] + ((h // 21 % 21) - 10) * 0.000012, 6), "approx": True}


# the village outline (same points as VILLAGE_BOUNDARY in frontend/src/config.js)
VILLAGE_BOUNDARY = [(13.8045107, 100.6649608), (13.8021235, 100.6650218), (13.8023053, 100.6658692), (13.7992588, 100.6662844), (13.7980021, 100.6666275), (13.7960034, 100.6674634), (13.79303, 100.6689847), (13.7928924, 100.6689603), (13.7927455, 100.6687709), (13.7924425, 100.6687764), (13.786371, 100.6723076), (13.7877058, 100.6731558), (13.7889926, 100.6750347), (13.7903221, 100.6744911), (13.7912586, 100.674232), (13.7929105, 100.6740703), (13.7944681, 100.6736678), (13.794661, 100.673675), (13.794385, 100.672623), (13.794, 100.671282), (13.7942871, 100.6711636), (13.7965257, 100.6702901), (13.7982259, 100.6698609), (13.7985382, 100.6705193), (13.7999105, 100.6698604), (13.8008781, 100.6696271), (13.8007251, 100.6692087), (13.8030013, 100.668275), (13.8029673, 100.6680454), (13.8052466, 100.6676938), (13.8045107, 100.6649608)]


def _in_outline(lat, lng) -> bool:
    c = False
    for (y1, x1), (y2, x2) in zip(VILLAGE_BOUNDARY, VILLAGE_BOUNDARY[-1:] + VILLAGE_BOUNDARY[:-1]):
        if (y1 > lat) != (y2 > lat) and lng < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c


def _seg_m(lat, lng, a1, b1, a2, b2) -> float:
    """Metres from a point to the segment (a1,b1)-(a2,b2) (lat,lng pairs), flat-earth (fine at this scale)."""
    kx = 111_320 * math.cos(math.radians(lat))
    ax, ay, bx, by, px, py = b1 * kx, a1 * 111_320, b2 * kx, a2 * 111_320, lng * kx, lat * 111_320
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


# 9 Oct: หาย·เจอ also counts the neighbours just outside (ชุมชนโต๊ะบาง, นวธานี…): pets and things cross the line
NEAR_M = 300


def in_village(lat, lng, within_m: float = 40, near_m: float = 0) -> bool:
    """A pin counts when it is inside the village outline, or right next to one of its sois (a house on the edge).
    near_m > 0: also anywhere within that many metres of the outline (the neighbouring communities)."""
    import staff  # noqa: E402

    if _in_outline(lat, lng):
        return True
    if near_m and any(_seg_m(lat, lng, *a, *b) <= near_m for a, b in zip(VILLAGE_BOUNDARY, VILLAGE_BOUNDARY[-1:] + VILLAGE_BOUNDARY[:-1])):
        return True

    kx = 111_320 * math.cos(math.radians(lat))
    best = 1e9
    for v in staff.SOIS.values():
        for line in v.get("lines") or []:
            for (a1, b1), (a2, b2) in zip(line, line[1:]):
                # point-to-segment distance in metres
                ax, ay, bx, by, px, py = b1 * kx, a1 * 111_320, b2 * kx, a2 * 111_320, lng * kx, lat * 111_320
                dx, dy = bx - ax, by - ay
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy or 1)))
                best = min(best, math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
                if best <= within_m:
                    return True
    return False


def place(d: dict, seed: str, near_m: float = 0) -> dict:
    """Where a post goes on the map: its own pin if that is in the village, else its soi (approx), else nowhere."""
    if d.get("lat") is not None and in_village(d["lat"], d["lng"], near_m=near_m):
        return {}
    spot = soi_spot(d.get("soi", ""), seed)
    return spot or ({"lat": None, "lng": None} if d.get("lat") is not None else {})


def with_spot(docs: list, near_m: float = 0) -> list:
    """On the way out (not stored): no pin → the soi's spot; a pin outside the village → its soi instead."""
    for d in docs:
        d.update(place(d, d.get("id", ""), near_m))
    return docs


class Contact(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    phone: str = Field("", max_length=40)


class MenuOption(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)  # "ขนมชั้น กล่องเล็ก"
    price: str = Field("", max_length=24)  # "35 บาท"


def baht(p: str) -> str:
    """ "35" → "35 บาท" (a bare number on a menu row); anything else as typed."""
    p = (p or "").strip()
    return f"{p} บาท" if re.fullmatch(r"\d[\d,.]*", p) else p


def clean_options(opts: list[dict]) -> list[dict]:
    return [{"name": o["name"].strip(), "price": baht(o.get("price", ""))[:24]} for o in opts if o["name"].strip()]


def clean_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        t = re.sub(r"\s+", " ", (t or "").strip().lstrip("#"))[:24]
        if t and t not in out:
            out.append(t)
    return out[:5]


class LendCreate(Contact):
    kind: LendKind = "lend"
    category: str
    title: str = Field(..., min_length=2, max_length=80)  # "เครื่องฉีดน้ำแรงดันสูง Karcher"
    detail: str = Field("", max_length=400)  # condition, how long, deposit, pick up where
    soi: str = Field("", max_length=12)
    price: str = Field("", max_length=60)  # for sale: "150 บาท", "ต่อรองได้"
    pickup: str = Field("", max_length=80)  # for sale: "รับที่บ้าน ซ.16 / ส่งในหมู่บ้าน"
    when: str = Field("", max_length=80)  # for sale: "ทุกเช้า 7–9 โมง · สั่งล่วงหน้า 1 วัน"
    preorder: bool = False  # for sale (16 Oct): made to order — neighbours press "สั่ง / จอง" and the seller cooks after
    no_orders: bool = False  # for sale (17 Oct): no 🛒 สั่ง/จอง — e.g. the admin posted it for a shop that won't read orders here
    notify_endpoint: str = Field("", max_length=600)  # the seller's own push subscription: a new order pings that phone only
    lat: Optional[float] = Field(None, ge=13.5, le=14.1)  # for sale (16 Oct): optional pin where to pick it up
    lng: Optional[float] = Field(None, ge=100.4, le=101.0)
    youtube: str = Field("", max_length=200)  # for sale (16 Oct): a YouTube link (how it's made, a shop clip)
    media_ids: list[str] = Field(default_factory=list, max_length=8)  # for sale: up to 8 photos / clips; others 3
    # for sale (17 Oct) — for sellers who put work into it: a shop name, a few selling points, a menu with prices
    shop_name: str = Field("", max_length=60)  # "ครัวป้าแดง"
    tags: list[str] = Field(default_factory=list, max_length=5)  # "ทำสดทุกวัน", "ไม่ใส่ผงชูรส"
    options: list[MenuOption] = Field(default_factory=list, max_length=12)  # the menu / sizes, each with its price


class LendUpdate(BaseModel):
    status: Optional[LendStatus] = None
    lent_to: Optional[str] = Field(None, max_length=60)  # who has it now (name only)
    until: Optional[str] = Field(None, max_length=40)  # "คืนเสาร์ 4 ต.ค."
    detail: Optional[str] = Field(None, max_length=400)
    # for sale (17 Oct): the seller edits the post from the phone that made it (edit key) — new photos, prices, menu
    title: Optional[str] = Field(None, min_length=2, max_length=80)
    price: Optional[str] = Field(None, max_length=60)
    pickup: Optional[str] = Field(None, max_length=80)
    when: Optional[str] = Field(None, max_length=80)
    preorder: Optional[bool] = None
    no_orders: Optional[bool] = None
    youtube: Optional[str] = Field(None, max_length=200)
    shop_name: Optional[str] = Field(None, max_length=60)
    tags: Optional[list[str]] = Field(None, max_length=5)
    options: Optional[list[MenuOption]] = Field(None, max_length=12)
    media_ids: Optional[list[str]] = Field(None, max_length=8)  # the full new list, in order (kept + newly uploaded)
    lat: Optional[float] = Field(None, ge=13.5, le=14.1)
    lng: Optional[float] = Field(None, ge=100.4, le=101.0)


class QueueJoin(Contact):
    phone: str = Field(..., min_length=3, max_length=40)  # the owner has to be able to call back
    note: str = Field("", max_length=160)  # "ขอใช้ครึ่งวัน พรุ่งนี้เช้า"
    qty: str = Field("", max_length=40)  # an order (kind sell): "2 กล่อง"
    pick: str = Field("", max_length=60)  # an order: when they'd like it — "พรุ่งนี้เช้า", "เสาร์ 18 ต.ค."


class JobCreate(Contact):
    kind: JobKind = "need"
    type: str
    detail: str = Field(..., min_length=3, max_length=400)
    soi: str = Field("", max_length=12)
    house: str = Field("", max_length=20)  # shown only with the phone
    when: str = Field("", max_length=60)  # "เสาร์นี้ 9 โมง"
    people: int = Field(2, ge=1, le=30)


class LostCreate(Contact):
    kind: LostKind = "lost"
    category: str
    title: str = Field(..., min_length=2, max_length=80)  # "หมาพันธุ์ไทย สีน้ำตาล ปลอกคอแดง ชื่อโบ้"
    detail: str = Field("", max_length=400)
    soi: str = Field("", max_length=12)
    when_seen: str = Field("", max_length=60)  # "หายตั้งแต่ 29 ก.ย. ตอนน้ำขึ้น"
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)  # 9 Oct: where it was lost / seen (the pin)
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)
    media_ids: list[str] = Field(default_factory=list, max_length=3)  # 17 Oct: photos or a short clip
    youtube: str = Field("", max_length=200)  # 17 Oct: a longer clip on YouTube


class Sighting(BaseModel):
    name: str = Field("", max_length=60)
    note: str = Field(..., min_length=2, max_length=200)  # "เห็นแถวปากซอย 24 เมื่อเช้า"


class LostStatusBody(BaseModel):
    status: LostStatus
    note: str = Field("", max_length=160)


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


class WasteRound(BaseModel):
    when: str = Field(..., min_length=1, max_length=60)  # "ทุกวันอังคาร 8:00" / "เสาร์ 4 ต.ค. เช้า"
    area: str = Field("", max_length=80)  # "ซอย 1–35" / "ทั้งหมู่บ้าน"
    kind: str = Field("", max_length=60)  # "ขยะชิ้นใหญ่" / "ขยะทั่วไป"
    note: str = Field("", max_length=160)


class WasteSection(BaseModel):
    title: str = Field(..., min_length=1, max_length=60)
    items: list[str] = Field(default_factory=list, max_length=12)


class WasteContact(BaseModel):
    label: str = Field(..., min_length=1, max_length=80)
    phone: str = Field("", max_length=40)


class WasteBody(BaseModel):
    notice: str = Field("", max_length=300)
    schedule: list[WasteRound] = Field(default_factory=list, max_length=40)
    guide: list[WasteSection] = Field(default_factory=list, max_length=15)
    contacts: list[WasteContact] = Field(default_factory=list, max_length=10)
    media: Optional[list[dict]] = Field(None, max_length=4)  # None = keep (the page's editor doesn't send it)  # 7 Oct: photo / clip previews (attached via /admin/media/claim)
    # 7 Oct: the regular rounds by soi parity for บ้านฉัน, e.g. {"even": "จันทร์ · พฤหัส", "odd": "พุธ · เสาร์"}
    # None = keep what is stored (the page's editor doesn't send it)
    rounds: Optional[Dict[str, str]] = None  # 16 Oct: also per soi, e.g. {"33": "อังคาร · ศุกร์"} (wins over the parity)


# How to sort flood waste until the district's own guidance arrives; admins edit it on the page.
WASTE_DEFAULT = {
    "notice": "ยังไม่มีตารางรถเก็บขยะของเขต จะอัปเดตเมื่อได้ข้อมูล · ระหว่างนี้แยกขยะตามด้านล่าง กองหน้าบ้านให้เรียบร้อย",
    "schedule": [],
    "guide": [
        {"title": "🛋️ ขยะชิ้นใหญ่ (ฟูก โซฟา ตู้ เฟอร์นิเจอร์พัง)", "items": [
            "วางหน้าบ้านริมถนน ไม่ขวางทางรถและไม่ทับฝาท่อระบายน้ำ",
            "รวมกองกับเพื่อนบ้านในซอยเดียวกัน รถเก็บได้เร็วขึ้น",
            "ห้ามเผา",
        ]},
        {"title": "🍱 ขยะเปียก เศษอาหาร ของเน่าเสีย", "items": [
            "ใส่ถุงดำ มัดปากให้แน่น แยกจากกองชิ้นใหญ่ (กลิ่น หนู แมลงวัน)",
            "ทิ้งตามรอบรถเก็บขยะปกติ อย่ากองค้างไว้หลายวัน",
        ]},
        {"title": "☣️ ขยะอันตราย", "items": [
            "หลอดไฟ ถ่าน แบตเตอรี่ กระป๋องสเปรย์ น้ำยาเคมี ยาหมดอายุ",
            "แยกใส่ถุงหรือกล่อง เขียนว่า “ขยะอันตราย” อย่าปนกับกองใหญ่",
        ]},
        {"title": "📺 เครื่องใช้ไฟฟ้าเสีย", "items": [
            "ตู้เย็น ทีวี แอร์ เครื่องซักผ้า แยกกองไว้ต่างหาก",
            "ตู้เย็นเทน้ำออก ปิดประตูและมัดไว้ (กันเด็กเข้าไปติด)",
            "ร้านรับซื้อของเก่าบางร้านรับ ลองถามก่อนทิ้ง",
        ]},
        {"title": "🧱 เศษวัสดุ (ฝ้า ไม้ กระเบื้อง ยิปซัม)", "items": [
            "แยกกอง ใส่กระสอบ ไม่ปนกับขยะเปียก",
            "ปริมาณมาก อาจต้องจ้างรถขน ดูในแท็บ “ช่าง · ร้าน” หมวดรับขนขยะ",
        ]},
        {"title": "♻️ ขายได้ / รีไซเคิล", "items": [
            "ขวด กระป๋อง เหล็ก สายไฟ กระดาษที่แห้ง แยกไว้ให้ซาเล้งหรือร้านรับซื้อ",
        ]},
        {"title": "🔪 ของมีคม", "items": [
            "แก้วแตก กระจก ตะปู ห่อหนังสือพิมพ์หรือใส่กล่อง เขียนว่า “ของมีคม”",
        ]},
        {"title": "🧤 ป้องกันตัวเอง", "items": [
            "ใส่ถุงมือ รองเท้าบู๊ท หน้ากาก ตอนขนขยะ ล้างมือทุกครั้ง",
            "กองขยะค้างนาน แจ้งในแท็บ “ปัญหาซอย” เพื่อนบ้านช่วยกดว่าเจอด้วย",
        ]},
    ],
    "contacts": [{"label": "กทม. สายด่วน (แจ้งขยะค้าง)", "phone": "1555"}],
}


class HubBlock(BaseModel):
    on: bool = True
    title: str = Field("", max_length=80)  # "ศูนย์อาสา · จุดแจกของ: ร้านมู้ด ซอย 5"
    sub: str = Field("", max_length=160)  # "จุดแจกของที่ยังเปิดอยู่ 1 จุด · แตะเพื่อนำทาง"
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)


class EventBlock(BaseModel):
    """A volunteer work call drawn on the home map, e.g. sandbagging a stretch of the canal bank."""
    on: bool = True
    title: str = Field(..., min_length=1, max_length=80)  # "นัดอาสาทำกระสอบทรายสันเขื่อน"
    sub: str = Field("", max_length=200)  # where / what to bring
    when: str = Field("", max_length=60)  # "เสาร์ 3 ต.ค. 09:00"
    line: List[List[float]] = Field(default_factory=list, max_length=60)  # [[lat, lng], …] the stretch of work
    lat: Optional[float] = Field(None, ge=13.7, le=13.9)  # meeting point; default = middle of the line
    lng: Optional[float] = Field(None, ge=100.6, le=100.8)
    tab: str = Field("", max_length=20)  # the box opens this tab (e.g. "waste") instead of the map
    items: List[str] = Field(default_factory=list, max_length=12)  # "what to do" bullets shown in full on the home page
    icon: str = Field("", max_length=8)  # 🧹 / 🧱 …
    link: str = Field("", max_length=200)  # e.g. "/cleanup" — a big button in the box
    media: List[dict] = Field(default_factory=list, max_length=4)  # 7 Oct: photo / clip previews (attached via /admin/media/claim)
    link_label: str = Field("", max_length=60)


# 7 Oct: how each home-page block looks and where it sits, set from the chat with Claude (tools/site.py layout)
# so the team can re-order and re-colour the home page without a redeploy. Fixed palettes only, never raw colours.
LAYOUT_KEYS = ["events", "announce", "pros", "myhome", "watch", "fund", "water", "community", "survey", "hub", "archive"]


class BlockLook(BaseModel):
    order: Optional[int] = Field(None, ge=0, le=99)  # smaller = higher on the page
    tone: Optional[Literal["green", "blue", "orange", "red", "yellow", "gray"]] = None
    border: Optional[Literal["none", "thin", "thick"]] = None
    fill: Optional[Literal["white", "soft", "solid"]] = None  # solid: a coloured title bar with white text
    open: Optional[bool] = None  # foldable blocks: open or folded when the page loads


class HomeBody(BaseModel):
    watch_on: bool = True  # the "ฝนตกอีกรอบ · เฝ้าระวังน้ำ" panel
    watch_title: str = Field("", max_length=80)  # empty = the built-in heading
    hub: HubBlock = HubBlock()
    fund_on: bool = False  # the 💰 /fund card on the home page (off until the user says so)
    tabs_on: bool = False  # the board tabs (ช่าง·ร้าน, ยืม, ขอแรง…); hidden until the team is ready to answer them
    events: List[EventBlock] = Field(default_factory=list, max_length=5)
    layout: Optional[Dict[str, BlockLook]] = None  # None = keep what is stored (the /admin page doesn't send it)


# The highlight boxes on top of the home page; admins switch them on/off and edit them on /admin.
HOME_DEFAULT = {
    "watch_on": True,
    "watch_title": "",
    "hub": {"on": True, "title": "ศูนย์อาสา · จุดแจกของ: ร้านมู้ด ซอย 5", "sub": "จุดแจกของที่ยังเปิดอยู่ 1 จุด · แตะเพื่อนำทาง", "lat": 13.789872, "lng": 100.673517},
    "fund_on": False,
    "layout": {},
    "tabs_on": False,
    "events": [],
}


# 7 Oct: wording on the page (titles, prompts, buttons) changed from the chat without a redeploy (tools/site.py text).
# The page carries its own default for every key; only the changed ones are stored.
TEXT_KEY = re.compile(r"^[a-z0-9_.]{1,60}$")


class TextsBody(BaseModel):
    set: Dict[str, Optional[str]]  # key -> new wording, or null to go back to the page's own


class SiteBody(BaseModel):
    mode: SiteMode


async def site_mode(db) -> str:
    doc = await db.settings.find_one({"id": "site_mode"}, {"_id": 0})
    return (doc or {}).get("mode", "repair")


async def add_to_queue(db, item_id: str, data: dict, via: str = "", line_user: str = "") -> Optional[dict]:
    """One queue entry — for a thing for sale, an order / reservation (สั่ง · จอง). The site's form and the LINE bot's
    order chat both come here. An order pings the seller's own phone when they posted from a phone with notifications
    on; LINE sellers see it the next time they write to the bot (the bot never pushes)."""
    entry = {"id": uuid.uuid4().hex[:10], **data, "at": now(), "done": False, "seen": False,
             **({"via": via} if via else {}), **({"line_user": line_user} if line_user else {})}
    kind = (await db.lend_items.find_one({"id": item_id}, {"_id": 0, "kind": 1}) or {}).get("kind")
    what = (f"สั่ง/จอง {data.get('qty', '')}".strip() if kind == "sell" else "ขอคิวยืม") + (" (ผ่าน LINE)" if via == "line" else "")
    doc = await db.lend_items.find_one_and_update(
        {"id": item_id, "status": {"$ne": "closed"}},
        {"$push": {"queue": entry, "history": {"at": now(), "by": (data.get("name") or "ไม่ระบุชื่อ")[:60], "text": what[:200]}},
         "$set": {"updated_at": now()}},
        projection={"_id": 0},
        return_document=True,
    )
    if doc and kind == "sell":
        push.fire(push.on_order, doc, entry)
    return doc


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
        out = {k: v for k, v in d.items() if k not in ("_id", "edit_key_hash", "phone", "queue", "notify_endpoint")}
        out["queue_count"] = len([q for q in d.get("queue", []) if not q.get("done")])
        out["has_phone"] = bool(d.get("phone"))
        out.setdefault("pickup", "")  # older items have no pickup / when
        out.setdefault("when", "")
        out.setdefault("preorder", False)
        out.setdefault("no_orders", False)
        out.setdefault("youtube", "")
        out.setdefault("shop_name", "")
        out.setdefault("tags", [])
        out.setdefault("options", [])
        return out

    def owner_queue(d: dict) -> list:
        return [{k: v for k, v in q.items() if k != "line_user"} for q in d.get("queue", [])]  # the buyer's LINE id stays ours

    # ---------------- site mode ----------------
    @router.get("/site")
    async def get_site():
        return {"mode": await site_mode(db)}

    @router.put("/admin/site")
    async def set_site(body: SiteBody, admin: dict = Depends(require_admin)):
        await db.settings.update_one({"id": "site_mode"}, {"$set": {"id": "site_mode", "mode": body.mode, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "site_mode", body.mode)
        return {"mode": body.mode}

    # ---------------- highlight boxes on the home page ----------------
    @router.get("/home")
    async def get_home():
        doc = await db.settings.find_one({"id": "home"}, {"_id": 0, "id": 0})
        texts = await db.settings.find_one({"id": "texts"}, {"_id": 0})
        return {**HOME_DEFAULT, **(doc or {}), "texts": (texts or {}).get("texts", {})}

    @router.put("/admin/home")
    async def set_home(body: HomeBody, admin: dict = Depends(require_admin)):
        data = body.model_dump()
        data["watch_title"] = data["watch_title"].strip()
        data["hub"]["title"] = data["hub"]["title"].strip()
        data["hub"]["sub"] = data["hub"]["sub"].strip()
        if data["layout"] is None:
            data.pop("layout")
        else:
            bad = [k for k in data["layout"] if k not in LAYOUT_KEYS]
            if bad:
                raise HTTPException(422, f"ไม่รู้จักกล่อง {bad} · มี {LAYOUT_KEYS}")
            data["layout"] = {k: {f: v for f, v in look.items() if v is not None} for k, look in data["layout"].items()}
        await db.settings.update_one({"id": "home"}, {"$set": {"id": "home", **data, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "home_blocks", "home", f"watch={data['watch_on']} hub={data['hub']['on']} {data['hub']['title']}")
        return data

    @router.put("/admin/texts")
    async def set_texts(body: TextsBody, admin: dict = Depends(require_admin)):
        bad = [k for k in body.set if not TEXT_KEY.match(k)]
        if bad:
            raise HTTPException(422, f"ชื่อข้อความไม่ถูกต้อง {bad}")
        doc = await db.settings.find_one({"id": "texts"}, {"_id": 0}) or {}
        texts = doc.get("texts", {})
        for k, v in body.set.items():
            if v is None or not v.strip():
                texts.pop(k, None)
            else:
                texts[k] = v.strip()[:300]
        await db.settings.update_one({"id": "texts"}, {"$set": {"id": "texts", "texts": texts, "by": admin["name"], "at": now()}}, upsert=True)
        await audit(admin, "texts", ",".join(body.set)[:200])
        return texts

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
        data = _clean(body.model_dump(exclude={"media_ids"}))
        sell = body.kind == "sell"
        data["tags"] = clean_tags(data["tags"])
        data["options"] = clean_options(data["options"])
        if not sell:
            data.update(preorder=False, no_orders=False, youtube="", shop_name="", tags=[], options=[])
            if len(body.media_ids) > 3:
                raise HTTPException(422, "ใส่รูปได้ไม่เกิน 3 รูป")
        if data["youtube"] and not YOUTUBE.match(data["youtube"]):
            raise HTTPException(422, "ลิงก์ YouTube ไม่ถูกต้อง (เช่น https://youtu.be/xxxx)")
        if not data["notify_endpoint"].startswith("https://"):
            data["notify_endpoint"] = ""
        doc = {
            "id": item_id,
            **data,
            "media": await claim_media(body.media_ids, f"lend:{item_id}", {"image", "video"} if sell else {"image"}),
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
        push.fire(push.on_lend, doc)
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
        """'I'd like to borrow it': the owner sees who is waiting, in order, with phone numbers.
        For a thing for sale the same queue holds the orders / reservations (สั่ง · จอง): qty + when they want it."""
        rate_limit(request, "lend-queue", limit=20, window_s=600)
        if await db.lend_items.find_one({"id": item_id, "no_orders": True}, {"_id": 1}):
            raise HTTPException(422, "ร้านนี้ไม่รับสั่งผ่านระบบ โทรหรือทักผู้ขายได้เลย")
        doc = await add_to_queue(db, item_id, _clean(body.model_dump()))
        if not doc:
            raise HTTPException(404, "รายการนี้ปิดไปแล้ว")
        return public_lend(doc)

    @router.get("/lend/{item_id}/owner")
    async def lend_owner(item_id: str, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lend_items, item_id, x_edit_key, request)
        if any(not q.get("seen") for q in doc.get("queue", [])):
            await db.lend_items.update_one({"id": item_id}, {"$set": {"queue.$[q].seen": True}}, array_filters=[{"q.seen": False}])
        return {**public_lend(doc), "queue": owner_queue(doc), "phone": doc.get("phone", "")}

    @router.patch("/lend/{item_id}")
    async def update_lend(item_id: str, body: LendUpdate, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lend_items, item_id, x_edit_key, request)
        changes = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items() if v is not None}
        if not changes:
            raise HTTPException(422, "ไม่มีข้อมูลที่จะแก้ไข")
        sell_only = {"title", "price", "pickup", "when", "preorder", "no_orders", "youtube", "shop_name", "tags", "options", "media_ids", "lat", "lng"}
        if doc.get("kind") != "sell" and sell_only & changes.keys():
            raise HTTPException(422, "แก้ได้เฉพาะรายการในตลาด")
        if changes.get("youtube") and not YOUTUBE.match(changes["youtube"]):
            raise HTTPException(422, "ลิงก์ YouTube ไม่ถูกต้อง (เช่น https://youtu.be/xxxx)")
        if "tags" in changes:
            changes["tags"] = clean_tags(changes["tags"])
        if "options" in changes:
            changes["options"] = clean_options(changes["options"])
        if "media_ids" in changes:  # keep the ones still listed, attach the new uploads, delete the ones taken out
            ids = changes.pop("media_ids")
            have = {m["id"]: m for m in doc.get("media", [])}
            new = await claim_media([i for i in ids if i not in have], f"lend:{item_id}", {"image", "video"})
            got = {**have, **{m["id"]: m for m in new}}
            changes["media"] = [got[i] for i in ids if i in got]
            gone = [i for i in have if i not in ids]
            if gone:
                await delete_media(gone)
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
        await delete_media([m["id"] for m in doc.get("media", [])])

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
        push.fire(push.on_need, doc)
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
        # full: enough helpers for a request, or every seat taken on a ride someone offers
        counted = doc["kind"] == "need" or doc.get("type") == "ride"
        status = "scheduled" if counted and len(helpers) >= doc.get("people", 1) else doc["status"]
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

    # ---------------- lost & found: pets and things ----------------
    @router.get("/lost")
    async def list_lost(include_closed: bool = False):
        q = {} if include_closed else {"status": "open"}
        return with_spot(await db.lost.find(q, HIDDEN).sort([("status", 1), ("updated_at", -1)]).to_list(1000), NEAR_M)

    @router.post("/lost", status_code=201)
    async def create_lost(body: LostCreate, request: Request):
        rate_limit(request, "lost", limit=15, window_s=600)
        if body.category not in LOST_CATEGORIES:
            raise HTTPException(422, "หมวดหมู่ไม่ถูกต้อง")
        if len(body.phone.strip()) < 3:
            raise HTTPException(422, "ใส่เบอร์โทรให้คนที่เจอติดต่อได้")
        key, item_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), now()
        spot = place(body.model_dump(), item_id, NEAR_M)
        if body.lat is not None and spot.get("lat", 0) is None:
            raise HTTPException(422, "หมุดอยู่นอกหมู่บ้าน · ลากหมุดกลับเข้ามาตรงจุด หรือใส่ซอยแทน")
        if body.youtube.strip() and not YOUTUBE.match(body.youtube.strip()):
            raise HTTPException(422, "ลิงก์ YouTube ไม่ถูกต้อง (เช่น https://youtu.be/xxxx)")
        doc = {
            "id": item_id,
            **_clean(body.model_dump(exclude={"media_ids"})),
            **spot,
            "media": await claim_media(body.media_ids, f"lost:{item_id}", {"image", "video"}),
            "has_phone": True,
            "sightings": [],
            "status": "open",
            "history": [log(body.name, "แจ้งของหาย" if body.kind == "lost" else "แจ้งเจอของ")],
            "created_at": t,
            "updated_at": t,
            "edit_key_hash": _hash(key),
        }
        await db.lost.insert_one(dict(doc))
        push.fire(push.on_lost, doc)
        return {**{k: v for k, v in doc.items() if k not in HIDDEN}, "edit_key": key}

    @router.get("/lost/{item_id}/contact")
    async def lost_contact(item_id: str, request: Request):
        rate_limit(request, "contact", limit=40, window_s=600)
        doc = await db.lost.find_one({"id": item_id}, {"_id": 0, "phone": 1, "name": 1})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        return {"phone": doc.get("phone", ""), "name": doc.get("name", "")}

    @router.post("/lost/{item_id}/seen")
    async def lost_seen(item_id: str, body: Sighting, request: Request):
        """'I saw it near soi 24 this morning' — public, so everyone looking can follow the trail."""
        rate_limit(request, "lost-seen", limit=20, window_s=600)
        entry = {"name": body.name.strip()[:60] or "ไม่ระบุชื่อ", "note": body.note.strip(), "at": now()}
        doc = await db.lost.find_one_and_update(
            {"id": item_id, "status": "open"},
            {"$push": {"sightings": {"$each": [entry], "$slice": -30}}, "$set": {"updated_at": now()}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            raise HTTPException(404, "รายการนี้ปิดไปแล้ว")
        return doc

    @router.post("/lost/{item_id}/status")
    async def lost_status(item_id: str, body: LostStatusBody, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lost, item_id, x_edit_key, request)
        text = {"open": "ยังตามหาอยู่", "reunited": "ได้คืนแล้ว 🎉"}[body.status]
        doc = await db.lost.find_one_and_update(
            {"id": item_id},
            {"$set": {"status": body.status, "updated_at": now()}, "$push": {"history": log(doc["name"], f"{text}{(' · ' + body.note.strip()) if body.note.strip() else ''}")}},
            projection=HIDDEN,
            return_document=True,
        )
        if body.status == "reunited":
            push.fire(push.on_reunited, doc)
        return doc

    @router.delete("/lost/{item_id}", status_code=204)
    async def delete_lost(item_id: str, request: Request, x_edit_key: str = Header("")):
        doc = await owned(db.lost, item_id, x_edit_key, request)
        await db.lost.delete_one({"id": item_id})
        if not doc.get("pet_id"):  # a post made from สัตว์เลี้ยงบ้านฉัน shares the pet's photos
            await delete_media([m["id"] for m in doc.get("media", [])])

    # ---------------- soi issues ----------------
    @router.get("/issues")
    async def list_issues(include_fixed: bool = False):
        q = {} if include_fixed else {"status": {"$ne": "fixed"}}
        return with_spot(await db.issues.find(q, HIDDEN).sort([("status", 1), ("votes", -1), ("created_at", -1)]).to_list(1000))

    @router.post("/issues", status_code=201)
    async def create_issue(body: IssueCreate, request: Request):
        rate_limit(request, "issue", limit=20, window_s=600)
        if body.type not in ISSUE_TYPES:
            raise HTTPException(422, "ประเภทปัญหาไม่ถูกต้อง")
        if body.lat is None and not body.soi.strip():
            raise HTTPException(422, "บอกซอย หรือปักหมุดตำแหน่ง")
        issue_id, t = str(uuid.uuid4()), now()
        where = place(body.model_dump(), issue_id)  # no pin / a pin outside the village → its soi, "approx"
        if body.lat is not None and where.get("lat", 0) is None:
            raise HTTPException(422, "หมุดอยู่นอกหมู่บ้าน · ลากหมุดกลับเข้ามาตรงจุด หรือใส่ซอยแทน")
        doc = {
            "id": issue_id,
            **_clean(body.model_dump(exclude={"media_ids"})),
            **where,
            "media": await claim_media(body.media_ids, f"issue:{issue_id}", {"image"}),
            "status": "open",
            "votes": 1,
            "voters": [_hash(client_ip(request))],
            "history": [log(body.name, "แจ้งปัญหา")],
            "created_at": t,
            "updated_at": t,
        }
        await db.issues.insert_one(dict(doc))
        push.fire(push.on_issue, doc)
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

    class WhereBody(BaseModel):
        lat: Optional[float] = Field(None, ge=13.7, le=13.9)
        lng: Optional[float] = Field(None, ge=100.6, le=100.8)
        soi: str = Field("", max_length=12)
        clear: bool = False  # drop the pin, show it at the soi's middle

    async def move_pin(coll, item_id: str, body: WhereBody, admin: dict, what: str):
        if not body.clear and (body.lat is None or body.lng is None):
            raise HTTPException(422, "ลากหมุดก่อน")
        if not body.clear and not in_village(body.lat, body.lng, near_m=NEAR_M if what == "lost" else 0):
            raise HTTPException(422, "หมุดอยู่นอกหมู่บ้าน")
        upd = {"soi": body.soi.strip()[:12], "updated_at": now()}
        upd.update({"lat": None, "lng": None, "approx": False} if body.clear else {"lat": body.lat, "lng": body.lng, "approx": False})
        doc = await coll.find_one_and_update(
            {"id": item_id},
            {"$set": upd, "$push": {"history": log(admin.get("name", "ผู้ดูแล"), "ย้ายหมุด (ผู้ดูแล)" if not body.clear else "ใช้ตำแหน่งกลางซอย (ผู้ดูแล)")}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await audit(admin, f"move_pin_{what}", item_id, f"{body.lat},{body.lng} soi={body.soi}")
        return with_spot([doc], NEAR_M if what == "lost" else 0)[0]

    @router.post("/admin/issues/{item_id}/where")
    async def admin_move_issue(item_id: str, body: WhereBody, admin: dict = Depends(require_admin)):
        return await move_pin(db.issues, item_id, body, admin, "issue")

    @router.post("/admin/lost/{item_id}/where")
    async def admin_move_lost(item_id: str, body: WhereBody, admin: dict = Depends(require_admin)):
        return await move_pin(db.lost, item_id, body, admin, "lost")

    @router.delete("/admin/issues/{issue_id}", status_code=204)
    async def admin_delete_issue(issue_id: str, admin: dict = Depends(require_admin)):
        doc = await db.issues.find_one_and_delete({"id": issue_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await delete_media([m["id"] for m in doc.get("media", [])])
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

    # ---------------- waste: truck rounds + how to sort (admins edit it on the page) ----------------
    @router.get("/waste")
    async def get_waste():
        doc = await db.settings.find_one({"id": "waste"}, {"_id": 0, "id": 0})
        return doc or {**WASTE_DEFAULT, "updated_at": None, "by": ""}

    @router.put("/admin/waste")
    async def set_waste(body: WasteBody, admin: dict = Depends(require_admin)):
        data = body.model_dump()
        data["schedule"] = [_clean(r) for r in data["schedule"]]
        data["guide"] = [{"title": g["title"].strip(), "items": [i.strip()[:200] for i in g["items"] if i.strip()]} for g in data["guide"]]
        data["contacts"] = [_clean(c) for c in data["contacts"]]
        if data["rounds"] is None:
            data.pop("rounds")
        else:
            bad = [k for k in data["rounds"] if k not in ("even", "odd") and not re.fullmatch(r"\d{1,3}(/\d{1,2})?", k)]
            if bad:
                raise HTTPException(422, f"คีย์รอบรถไม่ถูกต้อง {bad} · ใช้ even / odd หรือเลขซอย")
            data["rounds"] = {k: v.strip()[:60] for k, v in data["rounds"].items() if v.strip()}
        if data["media"] is None:
            data.pop("media")
        doc = {**data, "notice": data["notice"].strip(), "updated_at": now(), "by": admin["name"]}
        await db.settings.update_one({"id": "waste"}, {"$set": {"id": "waste", **doc}}, upsert=True)
        await audit(admin, "update_waste", "waste", f"{len(doc['schedule'])} rounds, {len(doc['guide'])} sections")
        return doc

    return router
