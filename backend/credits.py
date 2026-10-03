"""End credits (3 Oct 2026): the /credits.html page can be replaced from the chat with Claude, without a deploy.

The built-in page ships in frontend/public/credits.html. When an admin has stored a newer copy here
(tools/site.py credits push), a tiny loader at the top of that file swaps the stored copy in. Delete the stored copy
(site.py credits reset) and the built-in page shows again.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

MAX_HTML = 400_000


class CreditsBody(BaseModel):
    html: str = Field(..., min_length=50, max_length=MAX_HTML)


def build_router(db, require_admin, audit):
    router = APIRouter(prefix="/api")

    async def stored():
        return await db.settings.find_one({"id": "credits"}, {"_id": 0})

    @router.get("/credits")
    async def get_credits():
        doc = await stored()
        return {"html": doc["html"], "at": doc["at"]} if doc else {"html": None, "at": None}

    @router.get("/credits/page", response_class=HTMLResponse)
    async def credits_page():
        doc = await stored()
        if not doc:
            raise HTTPException(404, "ยังไม่มีเครดิตฉบับแก้ไข · ดูที่ /credits.html")
        return HTMLResponse(doc["html"])

    @router.put("/admin/credits")
    async def put_credits(body: CreditsBody, admin: dict = Depends(require_admin)):
        if "/api/credits" in body.html:  # the copy with the loader in it would load itself forever
            raise HTTPException(422, "ใช้ไฟล์ต้นฉบับ (ไม่มีตัวโหลด /api/credits) ไม่ใช่ public/credits.html")
        at = datetime.now(timezone.utc).isoformat()
        await db.settings.update_one({"id": "credits"}, {"$set": {"id": "credits", "html": body.html, "by": admin["name"], "at": at}}, upsert=True)
        await audit(admin, "credits", "credits", f"{len(body.html):,} ตัวอักษร")
        return {"ok": True, "at": at, "size": len(body.html)}

    @router.delete("/admin/credits")
    async def reset_credits(admin: dict = Depends(require_admin)):
        await db.settings.delete_one({"id": "credits"})
        await audit(admin, "credits", "credits", "กลับไปใช้ฉบับในเว็บ")
        return {"ok": True}

    return router
