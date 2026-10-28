"""🔒 เอกสารทีม (21 Oct 2026): long internal documents for the volunteer team (e.g. the co-op / Village 4 finance and
legal brief) that must NOT be public. The content lives only in the database — never in the frontend bundle — and is
served as a standalone page at a secret link:

  GET    /api/b/{slug}/{key}                 → the page (anyone holding the link; wrong key = 404)
  GET    /api/b/{slug}                       → 28 Oct: the page without a key, only when it was published `public`
                                               (the residents' copies, short links serithai57.com/k4 … in the frontend)
  PUT    /api/admin/briefs/{slug}            {title, html}   (admin) — create / replace; keeps the existing key
  GET    /api/admin/briefs                   (admin) — list with their links
  POST   /api/admin/briefs/{slug}/rotate     (admin) — new key: the old link stops working at once
  DELETE /api/admin/briefs/{slug}            (admin)

Pages are sent with noindex / no-store / no-referrer so search engines don't keep them and the link doesn't leak
through the Referer header. tools/brief_publish.py uploads a local HTML file.
"""
import hmac
import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,40}$")
HEADERS = {"X-Robots-Tag": "noindex, nofollow, noarchive", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer"}


class BriefBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    html: str = Field(..., min_length=20, max_length=3_000_000)
    public: bool = False  # 28 Oct: also served at /api/b/{slug} with no key


def build_router(db, require_admin, audit) -> APIRouter:
    router = APIRouter(prefix="/api")

    def check(slug: str):
        if not SLUG.match(slug):
            raise HTTPException(400, "slug ต้องเป็น a-z 0-9 -")

    @router.put("/admin/briefs/{slug}")
    async def put_brief(slug: str, body: BriefBody, admin: dict = Depends(require_admin)):
        check(slug)
        old = await db.briefs.find_one({"slug": slug}, {"_id": 0, "key": 1})
        key = (old or {}).get("key") or secrets.token_urlsafe(18)
        await db.briefs.update_one({"slug": slug}, {"$set": {"slug": slug, "title": body.title, "html": body.html, "key": key,
                                                             "public": body.public, "updated_at": datetime.now(timezone.utc), "by": admin.get("name")}}, upsert=True)
        await audit(admin, "brief", slug, body.title)
        return {"ok": True, "path": f"/api/b/{slug}" if body.public else f"/api/b/{slug}/{key}", "new": not old}

    @router.get("/admin/briefs")
    async def list_briefs(admin: dict = Depends(require_admin)):
        rows = await db.briefs.find({}, {"_id": 0, "html": 0}).sort("updated_at", -1).to_list(100)
        return [{**r, "path": f"/api/b/{r['slug']}/{r['key']}"} for r in rows]

    @router.post("/admin/briefs/{slug}/rotate")
    async def rotate(slug: str, admin: dict = Depends(require_admin)):
        key = secrets.token_urlsafe(18)
        r = await db.briefs.update_one({"slug": slug}, {"$set": {"key": key}})
        if not r.matched_count:
            raise HTTPException(404, "ไม่พบเอกสาร")
        await audit(admin, "brief_rotate", slug, "")
        return {"ok": True, "path": f"/api/b/{slug}/{key}"}

    @router.delete("/admin/briefs/{slug}")
    async def delete(slug: str, admin: dict = Depends(require_admin)):
        await db.briefs.delete_one({"slug": slug})
        await audit(admin, "brief_delete", slug, "")
        return {"ok": True}

    @router.get("/b/{slug}", response_class=HTMLResponse)
    async def view_public(slug: str):
        doc = await db.briefs.find_one({"slug": slug, "public": True}, {"_id": 0, "html": 1}) if SLUG.match(slug) else None
        if not doc:
            raise HTTPException(404, "ไม่พบหน้านี้")
        return HTMLResponse(doc["html"], headers={**HEADERS, "Cache-Control": "public, max-age=300"})

    @router.get("/b/{slug}/{key}", response_class=HTMLResponse)
    async def view(slug: str, key: str):
        doc = await db.briefs.find_one({"slug": slug}, {"_id": 0, "html": 1, "key": 1}) if SLUG.match(slug) else None
        if not doc or not hmac.compare_digest(key.encode(), doc["key"].encode()):
            raise HTTPException(404, "ไม่พบหน้านี้")
        return HTMLResponse(doc["html"], headers=HEADERS)

    return router
