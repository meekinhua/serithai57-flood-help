"""ตลาด categories as data (18 Oct): change groups / labels / shelves / LINE buttons without a deploy.

The defaults below are what the code shipped with; the admin can replace any part of them:
    PUT /api/admin/catalog  {..partial or whole catalog..}   → stored in db.settings {"id": "catalog"}
    GET /api/catalog                                          → the merged catalog (the web app loads it at start)
    tools/catalog.py show | set <file.json>                   → from the admin's machine
Every instance re-reads the stored catalog every minute (prod runs more than one), and `apply()` updates the
lists other modules already hold *in place* (services.SERVICE_CATEGORIES, repair.LEND_CATEGORIES, line_bot's
SERVICE_GROUPS / SVC_CHOICES / MKT_CATS / SHELF_CATS …), so nothing else needs to re-import.

Keys of categories are stored on listings: renaming a label is safe; removing a key only hides it from forms.
"""
import asyncio
import copy
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

log = logging.getLogger("catalog")

DEFAULT = {
    # label of every category key: [emoji, Thai name]. Merged over the code's own labels.
    "service_labels": {"health": ["🩺", "สุขภาพ · กายภาพ · ดูแลผู้ป่วย"]},
    "lend_labels": {"health": ["🩺", "สุขภาพ · กายภาพ"]},
    # the market's three shelves: [emoji, name] (18 Oct: รับทำ → บริการ)
    "shelf_labels": {"food": ["🍲", "ของกิน"], "goods": ["🧺", "ของใช้"], "service": ["🙋", "บริการ"]},
    # 🙋 บริการ shelf: the groups people see (cats = service directory keys)
    "service_groups": [
        {"key": "health", "label": "🩺 สุขภาพ·กายภาพ", "hint": "กายภาพบำบัด คลินิก นวดบำบัด ดูแลผู้ป่วย·ผู้สูงอายุ", "cats": ["health"]},
        {"key": "beauty", "label": "💇 สวยงาม", "hint": "ตัดผม แต่งหน้า ทำเล็บ นวด สปา ฟิตเนส", "cats": ["beauty"]},
        {"key": "event", "label": "📸 ถ่ายรูป·อีเวนต์", "hint": "สตูดิโอ ช่างภาพ เช่าชุด จัดดอกไม้ MC", "cats": ["photo"]},
        {"key": "tutor", "label": "📚 สอน·ติว", "hint": "ติวเตอร์ ภาษา ดนตรี ว่ายน้ำ คอมพิวเตอร์", "cats": ["tutor"]},
        {"key": "home", "label": "🏠 ช่วยงานบ้าน", "hint": "แม่บ้าน ทำความสะอาด ซักรีด ทำสวน เลี้ยงเด็ก", "cats": ["homehelp", "cleaning"]},
        {"key": "pets", "label": "🐾 สัตว์เลี้ยง", "hint": "รับฝาก ให้อาหาร อาบน้ำ ตัดขน", "cats": ["pets"]},
        {"key": "move", "label": "🚗 รับส่ง·ขนย้าย", "hint": "รับส่งคน/เด็ก รถเช่า ขนของ ย้ายบ้าน", "cats": ["rental", "porter", "truck", "boat"]},
        {"key": "online", "label": "💻 ออนไลน์·เอกสาร", "hint": "ออกแบบ ไอที ซ่อมคอม บัญชี แปล", "cats": ["online"]},
        {"key": "general", "label": "🙋 รับจ้างทั่วไป", "hint": "ฝากซื้อ ต่อคิว เฝ้าบ้าน งานอื่นๆ", "cats": ["errand", "other"]},
    ],
    # the web form's order when listing a service (ตลาด › รับทำ)
    "service_form": ["health", "beauty", "photo", "tutor", "homehelp", "cleaning", "pets", "rental", "porter", "online", "errand"],
    # market posts (lend kind "sell") by shelf — "service" = posts shown on the 🙋 รับทำ shelf (rich cards: gallery, clip, price list)
    "shelves": {
        "food": ["homemade", "dessert", "drinks", "preserved", "catering"],
        "goods": ["handmade", "plants", "clothes", "cosmetics", "petgoods", "electronics", "furniture", "kids", "other"],
        "service": ["health"],
    },
    # LINE: buttons when listing (ลงขาย) — [label, key]
    "line_sell": [["🍲 อาหารทำเอง", "homemade"], ["🧁 ขนม·เบเกอรี่", "dessert"], ["🧋 เครื่องดื่ม", "drinks"],
                  ["🫙 ของฝาก·แปรรูป", "preserved"], ["🎉 รับจัดเลี้ยง", "catering"], ["🧶 งานฝีมือ", "handmade"], ["🪴 ต้นไม้", "plants"],
                  ["👕 เสื้อผ้า", "clothes"], ["💄 ความงาม", "cosmetics"], ["🦴 ของสัตว์เลี้ยง", "petgoods"], ["📦 ของมือสอง/อื่นๆ", "other"]],
    "line_service": [["🩺 สุขภาพ·กายภาพ", "health"], ["💇 ตัดผม·แต่งหน้า·นวด", "beauty"], ["📸 ถ่ายรูป·สตูดิโอ", "photo"], ["📚 สอน·ติว", "tutor"],
                     ["🏠 แม่บ้าน·ซักรีด", "homehelp"], ["🧹 ทำความสะอาด", "cleaning"], ["🐾 สัตว์เลี้ยง", "pets"], ["🚗 รับส่ง·รถเช่า", "rental"],
                     ["💪 ขนของ·ย้ายบ้าน", "porter"], ["💻 ออนไลน์·เอกสาร", "online"], ["🙋 รับจ้างทั่วไป", "errand"]],
    # words people type instead of tapping a button → key (LINE; also used to guess the shelf). Regex, Thai.
    "words": {
        "health": "กายภาพ|รักษา|คลินิก|ปวด|นวดบำบัด|ฝังเข็ม|พยาบาล|ดูแลผู้ป่วย|ดูแลผู้สูงอายุ|สุขภาพ",
        "beauty": "ตัดผม|ทำผม|แต่งหน้า|ทำเล็บ|ต่อขนตา|สปา|นวด|beauty|ความสวย|สวยงาม",
        "photo": "ถ่ายรูป|ช่างภาพ|สตูดิโอ|อีเวนต์|เช่าชุด|ดอกไม้",
        "tutor": "ติว|สอน|ภาษา|ดนตรี|ว่ายน้ำ",
        "homehelp": "แม่บ้าน|ซักรีด|รีดผ้า|ทำสวน|เลี้ยงเด็ก",
        "cleaning": "ทำความสะอาด|ล้างบ้าน",
        "pets": "สัตว์|หมา|แมว|อาบน้ำหมา|ตัดขน",
        "rental": "รับส่ง|รถเช่า|เช่ารถ",
        "porter": "ขนของ|ย้ายบ้าน",
        "online": "ออกแบบ|ไอที|คอม|บัญชี|แปล|เอกสาร|ออนไลน์",
        "drinks": "เครื่องดื่ม|กาแฟ|ชา|มัทฉะ|โกโก้|น้ำผลไม้|ชานม|น้ำปั่น",
        "dessert": "ขนม|เบเกอรี่|เค้ก|คุกกี้|บราวนี่",
        "homemade": "อาหาร|กับข้าว|ข้าว|ก๋วยเตี๋ยว|ของกิน|หมูปิ้ง|ลูกชิ้น|ผัด",
        "preserved": "ของฝาก|แปรรูป|น้ำพริก|ดอง",
        "catering": "จัดเลี้ยง|สั่งงาน|ข้าวกล่อง",
        "handmade": "งานฝีมือ|ถัก|เย็บ",
        "plants": "ต้นไม้|กระถาง",
        "clothes": "เสื้อ|ผ้า|กางเกง|รองเท้า",
        "cosmetics": "สกินแคร์|เครื่องสำอาง|ครีม",
        "petgoods": "อาหารหมา|อาหารแมว|ของสัตว์",
    },
}

_state = {"doc": copy.deepcopy(DEFAULT), "at": None}
_targets = []  # callables(catalog) registered by modules that keep their own lists


def current() -> dict:
    return _state["doc"]


def on_change(fn):
    """A module registers how to update its own lists in place; called now and on every change."""
    _targets.append(fn)
    try:
        fn(_state["doc"])
    except Exception:
        log.exception("catalog apply")
    return fn


def merge(stored: dict) -> dict:
    out = copy.deepcopy(DEFAULT)
    for k, v in (stored or {}).items():
        if k in ("service_labels", "lend_labels", "words", "shelves", "shelf_labels") and isinstance(v, dict):
            out[k] = {**out[k], **v}
        elif k in DEFAULT:
            out[k] = v
    return out


def apply(doc: dict):
    _state["doc"] = doc
    for fn in _targets:
        try:
            fn(doc)
        except Exception:
            log.exception("catalog apply")


def word_key(text: str, keys=None):
    """What category a typed word means ("รับรักษา" → health), limited to `keys` if given."""
    for k, rx in current().get("words", {}).items():
        if (keys is None or k in keys) and rx and re.search(rx, text or "", re.I):
            return k
    return None


def _check(doc: dict):
    labels = {**doc["service_labels"], **doc["lend_labels"]}
    for k, v in labels.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]{1,24}", k) or not (isinstance(v, list) and len(v) == 2):
            raise HTTPException(422, f"label ไม่ถูกต้อง: {k}")
    for g in doc["service_groups"]:
        if not {"key", "label", "cats"} <= set(g):
            raise HTTPException(422, "service_groups ต้องมี key, label, cats")
    for name in ("line_sell", "line_service"):
        if len(doc[name]) > 12:
            raise HTTPException(422, f"{name}: LINE ใส่ปุ่มได้ไม่เกิน 12 (รวมยกเลิก 13)")
    for k, rx in doc["words"].items():
        try:
            re.compile(rx)
        except re.error:
            raise HTTPException(422, f"words.{k}: regex ผิด")


def build_router(db, require_admin, audit) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def load():
        s = await db.settings.find_one({"id": "catalog"}, {"_id": 0})
        at = (s or {}).get("at")
        if at != _state["at"]:
            _state["at"] = at
            apply(merge((s or {}).get("catalog")))

    @router.get("/catalog")
    async def get_catalog():
        return current()

    @router.put("/admin/catalog")
    async def put_catalog(body: dict, admin: dict = Depends(require_admin)):
        s = await db.settings.find_one({"id": "catalog"}, {"_id": 0}) or {}
        stored = {**(s.get("catalog") or {}), **body}
        doc = merge(stored)
        _check(doc)
        at = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"id": "catalog"}, {"$set": {"id": "catalog", "catalog": stored, "at": at, "by": admin.get("name")}}, upsert=True)
        _state["at"] = at
        apply(doc)
        await audit(admin, "catalog", "catalog", ", ".join(sorted(body))[:200])
        return doc

    @router.delete("/admin/catalog")
    async def reset_catalog(admin: dict = Depends(require_admin)):
        await db.settings.delete_one({"id": "catalog"})
        _state["at"] = None
        apply(copy.deepcopy(DEFAULT))
        await audit(admin, "catalog", "catalog", "reset")
        return current()

    async def loop():
        while True:
            try:
                await load()
            except Exception:
                log.exception("catalog load")
            await asyncio.sleep(60)

    router.catalog_loop = loop
    return router
