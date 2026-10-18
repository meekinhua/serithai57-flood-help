"""Contact board: people and shops offering services during the flood
(electricians, trucks, car hire, porters, boats...), paid or free.

Anyone can list themselves without an account and gets an edit key (kept in
their browser) to mark themselves available/busy or remove the listing.
Residents can flag a number that doesn't work; admins verify, pin or delete.
"""
import hashlib
import re
import secrets
import uuid
from datetime import datetime, timezone

import push
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

SERVICE_CATEGORIES = [
    "electrician", "plumber", "truck", "rental", "boat", "porter",
    "cleaning", "repair", "food", "supplies", "pets", "other",
    # after the flood (repair mode)
    "ac", "appliance", "carpenter", "painter", "roof", "pest", "vehicle", "junk",
    # the village marketplace after the flood (7 Oct)
    "shop", "beauty", "tutor",
    # 17 Oct: ตลาด › รับทำ·บริการ and the new ช่าง groups (frontend config.js SERVICE_GROUPS / REPAIR_GROUPS)
    "photo", "homehelp", "online", "errand", "doors", "net", "handyman",
]
import catalog  # noqa: E402  18 Oct: new category keys come from the catalog (no deploy)


@catalog.on_change
def _cats(doc):
    SERVICE_CATEGORIES.extend(k for k in doc["service_labels"] if k not in SERVICE_CATEGORIES)


Pricing = Literal["paid", "free", "ask"]
HIDDEN = {"_id": 0, "edit_key_hash": 0, "reporters": 0, "reviews.who": 0}


def _now():
    return datetime.now(timezone.utc)


YOUTUBE = re.compile(r"^https?://(?:www\.|m\.)?(?:youtube\.com/(?:watch\?v=|shorts/|live/)|youtu\.be/)[\w-]{6,}[^\s]*$")


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class ServiceCreate(BaseModel):
    category: str
    name: str = Field(min_length=1, max_length=80)  # คน / ร้าน
    phone: str = Field(min_length=3, max_length=40)
    line_id: str = Field("", max_length=40)
    detail: str = Field("", max_length=500)
    pricing: Pricing = "paid"
    price: str = Field("", max_length=100)  # e.g. "300 บาท/เที่ยว"
    area: str = Field("", max_length=100)  # e.g. "ในหมู่บ้าน", "ทั่วบึงกุ่ม"
    media_ids: list[str] = Field(default_factory=list, max_length=3)  # 7 Oct: photos of the shop / the work
    youtube: str = Field("", max_length=200)  # 17 Oct: a clip of the work on YouTube (better quality than an upload here)
    lat: Optional[float] = Field(None, ge=13.5, le=14.1)  # 16 Oct: where the shop is (optional pin; shops can be outside the village)
    lng: Optional[float] = Field(None, ge=100.4, le=101.0)


class ServiceUpdate(BaseModel):
    available: Optional[bool] = None
    detail: Optional[str] = Field(None, max_length=500)
    price: Optional[str] = Field(None, max_length=100)
    media_ids: Optional[list[str]] = Field(None, max_length=3)  # replaces the photos
    youtube: Optional[str] = Field(None, max_length=200)


class ServiceAdminUpdate(BaseModel):
    category: Optional[str] = None
    local: Optional[bool] = None  # ร้านเพื่อนบ้าน: shown in เพื่อนบ้าน too
    line_good: Optional[int] = Field(None, ge=0, le=500)  # praise counted outside the site (LINE group, FB page, word of mouth)
    good_note: Optional[str] = Field(None, max_length=60)  # where that praise came from, e.g. "ชมในกลุ่ม LINE หมู่บ้าน"
    verified: Optional[bool] = None
    pinned: Optional[bool] = None
    media_ids: Optional[list[str]] = Field(None, max_length=3)
    lat: Optional[float] = Field(None, ge=13.5, le=14.1)  # admin can place / move the shop pin
    lng: Optional[float] = Field(None, ge=100.4, le=101.0)


def build_router(db, rate_limit, require_admin, audit, client_ip, claim_media=None, delete_media=None) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def swap_media(service_id: str, ids: list[str]) -> list:
        """The listing's photos become exactly `ids`: kept ones stay, dropped ones are deleted, new ones claimed."""
        old = (await db.services.find_one({"id": service_id}, {"_id": 0, "media": 1}) or {}).get("media") or []
        keep = [m for m in old if m["id"] in ids]
        if delete_media:
            await delete_media([m["id"] for m in old if m["id"] not in ids])
        new_ids = [i for i in ids if i not in {m["id"] for m in keep}]
        return keep + (await claim_media(new_ids, f"service:{service_id}", {"image", "video"}) if claim_media else [])

    @router.get("/services")
    async def list_services(category: Optional[str] = None):
        q = {"category": category} if category else {}
        cursor = db.services.find(q, HIDDEN).sort([("pinned", -1), ("verified", -1), ("available", -1), ("updated_at", -1)])
        return await cursor.to_list(1000)

    @router.post("/services", status_code=201)
    async def create_service(body: ServiceCreate, request: Request):
        rate_limit(request, "service", limit=10, window_s=600)
        if body.category not in SERVICE_CATEGORIES:
            raise HTTPException(422, "หมวดหมู่ไม่ถูกต้อง")
        if body.youtube.strip() and not YOUTUBE.match(body.youtube.strip()):
            raise HTTPException(422, "ลิงก์ YouTube ไม่ถูกต้อง (เช่น https://youtu.be/xxxx)")
        edit_key = secrets.token_urlsafe(18)
        t = _now()
        sid = str(uuid.uuid4())
        doc = {
            "id": sid,
            **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude={"media_ids"}).items()},
            "media": await claim_media(body.media_ids, f"service:{sid}", {"image", "video"}) if claim_media and body.media_ids else [],
            "price": body.price.strip() if body.pricing == "paid" else "",
            "available": True,
            "verified": False,
            "pinned": False,
            "reports": 0,
            "reporters": [],
            "created_at": t,
            "updated_at": t,
            "edit_key_hash": _hash(edit_key),
        }
        await db.services.insert_one(dict(doc))
        push.fire(push.on_shop, doc)
        for k in ("edit_key_hash", "reporters"):
            doc.pop(k)
        return {**doc, "edit_key": edit_key}

    @router.patch("/services/{service_id}")
    async def update_service(service_id: str, body: ServiceUpdate, x_edit_key: str = Header(...)):
        changes = {k: v for k, v in body.model_dump(exclude={"media_ids"}).items() if v is not None}
        if changes.get("youtube") and not YOUTUBE.match(changes["youtube"].strip()):
            raise HTTPException(422, "ลิงก์ YouTube ไม่ถูกต้อง (เช่น https://youtu.be/xxxx)")
        if body.media_ids is not None:
            if not await db.services.find_one({"id": service_id, "edit_key_hash": _hash(x_edit_key)}, {"_id": 1}):
                raise HTTPException(403, "แก้ไขได้เฉพาะเจ้าของ (จากเครื่องที่ลงชื่อไว้)")
            changes["media"] = await swap_media(service_id, body.media_ids)
        if not changes:
            raise HTTPException(422, "ไม่มีข้อมูลที่จะแก้ไข")
        doc = await db.services.find_one_and_update(
            {"id": service_id, "edit_key_hash": _hash(x_edit_key)},
            {"$set": {**changes, "updated_at": _now()}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            raise HTTPException(403, "แก้ไขได้เฉพาะเจ้าของ (จากเครื่องที่ลงชื่อไว้)")
        return doc

    @router.delete("/services/{service_id}", status_code=204)
    async def delete_service(service_id: str, x_edit_key: str = Header(...)):
        result = await db.services.delete_one({"id": service_id, "edit_key_hash": _hash(x_edit_key)})
        if not result.deleted_count:
            raise HTTPException(403, "ลบได้เฉพาะเจ้าของ (จากเครื่องที่ลงชื่อไว้)")

    @router.post("/services/{service_id}/report")
    async def report_service(service_id: str, request: Request):
        """'Number doesn't work' flag. One report per IP per listing."""
        rate_limit(request, "service-report", limit=20, window_s=600)
        who = _hash(client_ip(request))
        doc = await db.services.find_one_and_update(
            {"id": service_id, "reporters": {"$ne": who}},
            {"$inc": {"reports": 1}, "$push": {"reporters": who}},
            projection=HIDDEN,
            return_document=True,
        )
        if not doc:
            existing = await db.services.find_one({"id": service_id}, HIDDEN)
            if not existing:
                raise HTTPException(404, "ไม่พบรายการ")
            return existing  # already reported from here: no double count
        return doc

    @router.patch("/admin/services/{service_id}")
    async def admin_update_service(service_id: str, body: ServiceAdminUpdate, admin: dict = Depends(require_admin)):
        if body.category is not None and body.category not in SERVICE_CATEGORIES:
            raise HTTPException(422, "หมวดไม่ถูกต้อง")
        changes = {k: v for k, v in body.model_dump(exclude={"media_ids"}).items() if v is not None}
        if body.media_ids is not None:
            changes["media"] = await swap_media(service_id, body.media_ids)
        if not changes:
            raise HTTPException(422, "ไม่มีข้อมูลที่จะแก้ไข")
        doc = await db.services.find_one_and_update({"id": service_id}, {"$set": changes}, projection=HIDDEN, return_document=True)
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await audit(admin, "update_service", service_id, f"{doc['name']}: {changes}")
        return doc

    @router.delete("/admin/services/{service_id}", status_code=204)
    async def admin_delete_service(service_id: str, admin: dict = Depends(require_admin)):
        doc = await db.services.find_one_and_delete({"id": service_id})
        if not doc:
            raise HTTPException(404, "ไม่พบรายการ")
        await audit(admin, "delete_service", service_id, f"{doc['name']} {doc['phone']}")

    return router
