"""แบบสำรวจ (3 Oct 2026): short sign-up lists the team needs from residents, e.g. "บ้านไหนอยากให้ช่างไฟตรวจ"
when the Ministry of Defence electricians come on 5–7 Oct.

A survey is a settings row (title, details, on/off, the checklist of problems) switched from the chat with Claude
(tools/site.py survey …) or /admin, so a new one needs no deploy. Residents sign once per house (signing again
updates their answer). Phone numbers and notes are for the team only: the public sees the title, details and how
many houses have signed. The team gets the list (and a CSV) as admin.
"""
import csv
import hashlib
import io
import re
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

HOUSE_RE = re.compile(r"^\d{1,3}/\d{1,5}(/\d{1,3})?$")  # 4/917
KEY_RE = r"^[a-z0-9-]{2,30}$"

# the first survey: Ministry of Defence electricians, 5–7 Oct 2026
SURVEYS_DEFAULT = [{
    "key": "electric",
    "on": False,
    "title": "ลงชื่อขอช่างไฟตรวจบ้าน (ฟรี) จ.–พ. 5–7 ต.ค.",
    "details": "ช่างไฟฟ้าจากสำนักงานปลัดกระทรวงกลาโหม 8–10 ท่าน เข้ามาตรวจระบบไฟในหมู่บ้าน 3 วัน · บ้านไหนไม่มั่นใจความปลอดภัยของระบบไฟหลังน้ำท่วม ลงชื่อไว้ ทีมจะรวบรวมรายชื่อส่งให้ช่าง",
    "options": ["ไฟรั่ว / ไฟดูด", "เบรกเกอร์ตัดบ่อย", "ปลั๊ก-สวิตช์โดนน้ำ", "ตู้ไฟ/มิเตอร์โดนน้ำ", "ปั๊มน้ำ", "แอร์ / เครื่องทำน้ำอุ่น", "ไฟดับบางจุดในบ้าน", "อื่นๆ"],
}]


def now():
    return datetime.now(timezone.utc)


class Survey(BaseModel):
    key: str = Field(..., pattern=KEY_RE)
    on: bool = False
    title: str = Field(..., min_length=1, max_length=100)
    details: str = Field("", max_length=600)
    options: List[str] = Field(default_factory=list, max_length=15)


class TeamEntry(BaseModel):
    """Added by the team / Claude from a LINE message (phone may be missing there)."""
    house: str = Field(..., max_length=20)
    soi: str = Field("", max_length=20)
    name: str = Field("", max_length=60)
    phone: str = Field("", max_length=20)
    picks: List[str] = Field(default_factory=list, max_length=15)
    note: str = Field("", max_length=300)
    source: str = Field("line", max_length=20)


class SurveysBody(BaseModel):
    surveys: List[Survey] = Field(default_factory=list, max_length=10)


class Answer(BaseModel):
    house: str = Field(..., max_length=20)
    soi: str = Field("", max_length=20)
    name: str = Field("", max_length=60)
    phone: str = Field(..., min_length=9, max_length=20)
    picks: List[str] = Field(default_factory=list, max_length=15)
    note: str = Field("", max_length=300)


def build_router(db, rate_limit, require_admin, audit, client_ip) -> APIRouter:
    router = APIRouter(prefix="/api")

    async def surveys() -> list:
        doc = await db.settings.find_one({"id": "surveys"}, {"_id": 0})
        return (doc or {}).get("surveys", SURVEYS_DEFAULT)

    @router.get("/surveys")
    async def list_surveys():
        out = []
        for s in await surveys():
            if s.get("on"):
                count = await db.survey_resp.count_documents({"survey": s["key"]})
                out.append({**s, "count": count})
        return out

    @router.post("/surveys/{key}", status_code=201)
    async def answer(key: str, body: Answer, request: Request):
        s = next((x for x in await surveys() if x["key"] == key and x.get("on")), None)
        if not s:
            raise HTTPException(404, "แบบสำรวจนี้ปิดแล้ว")
        rate_limit(request, "survey", limit=10, window_s=600)
        house = body.house.strip().replace(" ", "")
        if not HOUSE_RE.match(house):
            raise HTTPException(422, "ใส่บ้านเลขที่แบบ 4/917")
        phone = re.sub(r"[^\d+]", "", body.phone)
        if len(phone) < 9:
            raise HTTPException(422, "ใส่เบอร์โทรให้ครบ")
        picks = [p for p in body.picks if p in s.get("options", [])]
        doc = {
            "survey": key,
            "house": house,
            "soi": body.soi.strip(),
            "name": body.name.strip(),
            "phone": phone,
            "picks": picks,
            "note": body.note.strip(),
            "ip": hashlib.sha256(client_ip(request).encode()).hexdigest(),
            "updated_at": now(),
        }
        # one row per house: signing again replaces the answer
        res = await db.survey_resp.update_one({"survey": key, "house": house}, {"$set": doc, "$setOnInsert": {"id": str(uuid.uuid4()), "created_at": now()}}, upsert=True)
        count = await db.survey_resp.count_documents({"survey": key})
        return {"ok": True, "updated": res.matched_count > 0, "count": count}

    @router.get("/admin/surveys")
    async def admin_surveys(admin: dict = Depends(require_admin)):
        return {"surveys": await surveys()}

    @router.put("/admin/surveys")
    async def set_surveys(body: SurveysBody, admin: dict = Depends(require_admin)):
        data = [s.model_dump() for s in body.surveys]
        await db.settings.update_one({"id": "surveys"}, {"$set": {"id": "surveys", "surveys": data}}, upsert=True)
        await audit(admin, "surveys", "surveys", ", ".join(f"{s['key']}={'on' if s['on'] else 'off'}" for s in data))
        return {"surveys": data}

    @router.post("/admin/surveys/{key}/entries", status_code=201)
    async def team_entry(key: str, body: TeamEntry, admin: dict = Depends(require_admin)):
        s = next((x for x in await surveys() if x["key"] == key), None)
        if not s:
            raise HTTPException(404, "ไม่มีแบบสำรวจนี้")
        house = body.house.strip().replace(" ", "")
        if not HOUSE_RE.match(house):
            raise HTTPException(422, "บ้านเลขที่ไม่ถูกต้อง")
        old = await db.survey_resp.find_one({"survey": key, "house": house}, {"_id": 0})
        picks = [p for p in body.picks if p in s.get("options", [])]
        if old:  # never overwrite what the resident typed themselves; only fill gaps / add problems
            upd = {k: v for k, v in {"soi": body.soi.strip(), "name": body.name.strip(), "phone": re.sub(r"[^\d+]", "", body.phone)}.items() if v and not old.get(k)}
            upd["picks"] = old.get("picks", []) + [p for p in picks if p not in old.get("picks", [])]
            if body.note.strip() and body.note.strip() not in old.get("note", ""):
                upd["note"] = (old.get("note", "") + " | " + body.note.strip()).strip(" |")[:600]
            await db.survey_resp.update_one({"survey": key, "house": house}, {"$set": upd})
            return {"ok": True, "updated": True}
        await db.survey_resp.insert_one({
            "id": str(uuid.uuid4()), "survey": key, "house": house, "soi": body.soi.strip(), "name": body.name.strip(),
            "phone": re.sub(r"[^\d+]", "", body.phone), "picks": picks, "note": body.note.strip(), "source": body.source,
            "added_by": admin.get("name", ""), "created_at": now(), "updated_at": now(),
        })
        return {"ok": True, "updated": False}

    def soi_key(r):
        m = re.match(r"\d+", r.get("soi") or "")
        return (int(m.group()) if m else 999, r.get("soi") or "", r["house"])

    @router.get("/admin/surveys/{key}")
    async def responses(key: str, admin: dict = Depends(require_admin)):
        rows = await db.survey_resp.find({"survey": key}, {"_id": 0, "ip": 0}).to_list(5000)
        return sorted(rows, key=soi_key)

    @router.get("/admin/surveys/{key}/csv")
    async def responses_csv(key: str, admin: dict = Depends(require_admin)):
        rows = sorted(await db.survey_resp.find({"survey": key}, {"_id": 0, "ip": 0}).to_list(5000), key=soi_key)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["ซอย", "บ้านเลขที่", "ชื่อ", "เบอร์", "อาการ", "หมายเหตุ", "มาจาก", "ลงชื่อเมื่อ"])
        for r in rows:
            w.writerow([r.get("soi", ""), r["house"], r.get("name", ""), r["phone"], " / ".join(r.get("picks", [])), r.get("note", ""), "LINE" if r.get("source") == "line" else "เว็บ", r["updated_at"].strftime("%Y-%m-%d %H:%M")])
        return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="survey-{key}.csv"'})

    return router
