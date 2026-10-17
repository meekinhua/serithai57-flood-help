"""ลิงก์ร้านของฉัน (17 Oct 2026): one seller, several phones / apps, no account.

A post's edit key lives in the browser that made it (localStorage). A seller who opens the site in another phone, or
in Chrome instead of LINE's own browser, loses their posts and orders. The fix, as simple as it gets:

- the seller's browser makes a random "shop pass" (only the browser knows it) and turns it into a link
  serithai57.com/#shop-pass~<pass>;
- every post of theirs is registered under the pass: POST /api/seller/sync {kind, id, key} with X-Seller-Pass.
  The key is checked against the post, then kept here encrypted with a key derived from the pass (AES-GCM) —
  the server can't read it without the pass, the database only knows sha256(pass);
- any browser with the pass asks GET /api/seller/sync and gets the keys back, so it sees "ของฉัน", can edit and sees
  the orders. Posts made later on any of them are added the same way, so they all stay in step.
"""
import base64
import hashlib
import os
import re
from datetime import datetime, timezone
from typing import Literal

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

PASS_RE = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def _id(pw: str) -> str:
    return hashlib.sha256(f"seller:{pw}".encode()).hexdigest()


def _aes(pw: str) -> AESGCM:
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"serithai57-seller", info=b"v1").derive(pw.encode())
    return AESGCM(key)


class SyncAdd(BaseModel):
    kind: Literal["lend", "service"]
    id: str = Field(..., min_length=6, max_length=64)
    key: str = Field(..., min_length=10, max_length=100)


def build_router(db, rate_limit):
    router = APIRouter(prefix="/api/seller")

    def check(pw: str) -> str:
        if not PASS_RE.match(pw or ""):
            raise HTTPException(400, "ลิงก์ร้านไม่ถูกต้อง")
        return pw

    @router.post("/sync")
    async def add(body: SyncAdd, request: Request, x_seller_pass: str = Header("")):
        """Register one post (its key is checked first) under this shop pass."""
        rate_limit(request, "seller", limit=60, window_s=600)
        pw = check(x_seller_pass)
        coll = db.lend_items if body.kind == "lend" else db.services
        doc = await coll.find_one({"id": body.id}, {"_id": 0, "edit_key_hash": 1})
        if not doc or doc.get("edit_key_hash") != hashlib.sha256(body.key.encode()).hexdigest():
            raise HTTPException(403, "ไม่ใช่โพสต์ของเครื่องนี้")
        nonce = os.urandom(12)
        enc = base64.b64encode(nonce + _aes(pw).encrypt(nonce, body.key.encode(), body.id.encode())).decode()
        await db.seller_passes.update_one(
            {"id": _id(pw)},
            {"$set": {f"items.{body.id}": {"kind": body.kind, "enc": enc}, "updated_at": datetime.now(timezone.utc)},
             "$setOnInsert": {"id": _id(pw), "created_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
        return {"ok": True}

    @router.get("/sync")
    async def pull(request: Request, x_seller_pass: str = Header("")):
        """Every post under this shop pass with its key → the browser saves them as its own."""
        rate_limit(request, "seller", limit=60, window_s=600)
        pw = check(x_seller_pass)
        doc = await db.seller_passes.find_one({"id": _id(pw)}, {"_id": 0}) or {}
        aes, out = _aes(pw), {"lend": {}, "service": {}}
        for item_id, v in (doc.get("items") or {}).items():
            try:
                raw = base64.b64decode(v["enc"])
                out[v["kind"]][item_id] = aes.decrypt(raw[:12], raw[12:], item_id.encode()).decode()
            except Exception:
                continue
        return out

    return router
