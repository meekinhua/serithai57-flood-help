"""สัตว์เลี้ยงบ้านฉัน: each house keeps its dogs and cats (photo, name, markings) ahead of time,
so the day one goes missing the owner posts it to หาย·เจอ in one tap — photo, soi and phone already there.

- GET    /api/myhome/pets?house=4/917
- PUT    /api/myhome/pets                 {house, pet: {id?, name, kind, desc, media_ids}}  add / edit one
- DELETE /api/myhome/pets/{pid}?house=…
- POST   /api/myhome/pets/{pid}/lost      {house, name, phone, when_seen, detail}  → a หาย·เจอ post (edit_key back)
- POST   /api/myhome/pets/{pid}/found?house=…  back home: closes that post

The photos belong to the pet; a lost post made from it shares them (pet_id on the post), so deleting the post
never deletes the pet's photos.
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

import push
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

Kind = Literal["dog", "cat", "pet"]
KIND_TH = {"dog": "หมา", "cat": "แมว", "pet": "สัตว์เลี้ยง"}


class Pet(BaseModel):
    id: Optional[str] = Field(None, max_length=12)
    name: str = Field(..., min_length=1, max_length=40)
    kind: Kind = "dog"
    desc: str = Field("", max_length=200)  # "พันธุ์ไทย สีน้ำตาล ปลอกคอแดง หางขาด"
    media_ids: list[str] = Field(default_factory=list, max_length=3)


class PetPut(BaseModel):
    house: str
    pet: Pet


class PetLost(BaseModel):
    house: str
    name: str = Field(..., min_length=1, max_length=60)  # the owner, as the finder will call them
    phone: str = Field(..., min_length=3, max_length=40)
    when_seen: str = Field("", max_length=60)
    detail: str = Field("", max_length=400)


def _now():
    return datetime.now(timezone.utc)


def build_router(db, rate_limit, clean, locate_house, claim_media, delete_media) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def pets_of(h: str) -> list:
        doc = await db.myhome_pets.find_one({"house": h}, {"_id": 0, "pets": 1})
        return (doc or {}).get("pets", [])

    @router.get("/myhome/pets")
    async def get_pets(house: str, request: Request):
        rate_limit(request, "pets-read", limit=300, window_s=600)
        h = clean(house)
        pets = await pets_of(h)
        # which of them are lost right now (an open หาย·เจอ post made from the pet)
        lost = {d["pet_id"]: d["id"] async for d in db.lost.find({"pet_house": h, "status": "open"}, {"_id": 0, "pet_id": 1, "id": 1})}
        return {"pets": [{**p, "lost_id": lost.get(p["id"])} for p in pets]}

    @router.put("/myhome/pets")
    async def put_pet(body: PetPut, request: Request):
        rate_limit(request, "pets", limit=30, window_s=600)
        h = clean(body.house)
        pets = await pets_of(h)
        p = body.pet
        old = next((x for x in pets if p.id and x["id"] == p.id), None)
        if not old and len(pets) >= 6:
            raise HTTPException(422, "ลงได้บ้านละ 6 ตัว")
        pid = old["id"] if old else uuid.uuid4().hex[:10]
        kept = [m for m in (old or {}).get("media", []) if m["id"] in p.media_ids]
        new_ids = [i for i in p.media_ids if i not in {m["id"] for m in kept}]
        added = await claim_media(new_ids, f"pet:{h}:{pid}", {"image"}) if new_ids else []
        dropped = [m["id"] for m in (old or {}).get("media", []) if m["id"] not in p.media_ids]
        if dropped:
            await delete_media(dropped)
        by_id = {m["id"]: m for m in kept + added}
        doc = {"id": pid, "name": p.name.strip(), "kind": p.kind, "desc": p.desc.strip(), "media": [by_id[i] for i in p.media_ids if i in by_id], "updated_at": _now()}
        pets = [doc if x["id"] == pid else x for x in pets] if old else pets + [doc]
        await db.myhome_pets.update_one({"house": h}, {"$set": {"house": h, "pets": pets}}, upsert=True)
        return {"pets": pets}

    @router.delete("/myhome/pets/{pid}")
    async def delete_pet(pid: str, house: str, request: Request):
        rate_limit(request, "pets", limit=30, window_s=600)
        h = clean(house)
        pets = await pets_of(h)
        gone = next((x for x in pets if x["id"] == pid), None)
        if not gone:
            raise HTTPException(404, "ไม่พบ")
        if await db.lost.find_one({"pet_house": h, "pet_id": pid, "status": "open"}):
            raise HTTPException(422, "น้องยังอยู่ในประกาศหาย · กด \"เจอแล้ว\" ก่อน")
        await db.myhome_pets.update_one({"house": h}, {"$set": {"pets": [x for x in pets if x["id"] != pid]}})
        await delete_media([m["id"] for m in gone.get("media", [])])
        return {"ok": True}

    @router.post("/myhome/pets/{pid}/lost", status_code=201)
    async def pet_lost(pid: str, body: PetLost, request: Request):
        """One tap: the pet's photo, name and markings, the house's soi, the owner's phone → หาย·เจอ."""
        rate_limit(request, "lost", limit=15, window_s=600)
        h = clean(body.house)
        pet = next((x for x in await pets_of(h) if x["id"] == pid), None)
        if not pet:
            raise HTTPException(404, "ไม่พบสัตว์เลี้ยงตัวนี้")
        if await db.lost.find_one({"pet_house": h, "pet_id": pid, "status": "open"}):
            raise HTTPException(422, "ประกาศหายตัวนี้อยู่แล้ว")
        soi = ""
        try:
            loc = await locate_house(h)
            soi = str((loc or {}).get("soi") or "")
        except Exception:
            pass
        key, item_id, t = secrets.token_urlsafe(18), str(uuid.uuid4()), _now()
        title = f"{KIND_TH[pet['kind']]}หาย ชื่อ{pet['name']}" + (f" · {pet['desc']}" if pet.get("desc") else "")
        doc = {
            "id": item_id,
            "kind": "lost",
            "category": pet["kind"],
            "title": title[:80],
            "detail": body.detail.strip() or pet.get("desc", ""),
            "soi": soi[:12],
            "when_seen": body.when_seen.strip(),
            "name": body.name.strip(),
            "phone": body.phone.strip(),
            "media": pet.get("media", []),
            "pet_id": pid,
            "pet_house": h,
            "has_phone": True,
            "sightings": [],
            "status": "open",
            "history": [{"by": body.name.strip(), "text": "แจ้งสัตว์เลี้ยงหาย (จากสัตว์เลี้ยงบ้านฉัน)", "at": t}],
            "created_at": t,
            "updated_at": t,
            "edit_key_hash": hashlib.sha256(key.encode()).hexdigest(),
        }
        await db.lost.insert_one(dict(doc))
        push.fire(push.on_lost, doc)
        hidden = {"_id", "edit_key_hash", "phone", "pet_house"}
        return {**{k: v for k, v in doc.items() if k not in hidden}, "edit_key": key}

    @router.post("/myhome/pets/{pid}/found")
    async def pet_found(pid: str, house: str, request: Request):
        """The owner, from บ้านฉัน on any phone of the house: back home 🎉 (closes the หาย·เจอ post)."""
        rate_limit(request, "pets", limit=30, window_s=600)
        h = clean(house)
        doc = await db.lost.find_one_and_update(
            {"pet_house": h, "pet_id": pid, "status": "open"},
            {"$set": {"status": "reunited", "updated_at": _now()}, "$push": {"history": {"by": "เจ้าของ", "text": "ได้คืนแล้ว 🎉", "at": _now()}}},
            projection={"_id": 0, "id": 1, "title": 1, "category": 1},
        )
        if not doc:
            raise HTTPException(404, "ไม่มีประกาศหายของน้องตัวนี้")
        push.fire(push.on_reunited, doc)
        return {"ok": True}

    return router
