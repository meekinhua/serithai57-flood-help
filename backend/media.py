"""Photo / video attachments, stored in MongoDB GridFS.

Upload is chunked (<= 1 MB per request) so it survives flaky mobile networks and
proxy body-size limits:  POST /api/media -> PUT /api/media/{id}/chunk/{i} ... ->
POST /api/media/{id}/complete -> poll GET /api/media/{id} until status == "ready".

Chunks wait in MongoDB (db.media_parts), not on local disk (17 Oct): prod runs more than one backend instance, and a
chunk that landed on one while /complete hit another made ~1 in 3 uploads fail ("ข้อมูลยังไม่ครบ") — phones retried
and retried, which felt like very slow uploads. Only the processing step uses a temp dir, on whichever instance runs it.

Every file is re-encoded on the server, whatever the client sent:
- images: EXIF-rotated, EXIF/GPS stripped, max 1600 px, JPEG q78 (+ 480 px thumb)
- videos: first 60 s, long edge <= 854 px (480p), H.264/AAC MP4 ~1 Mbit/s (+ poster)
"""
import asyncio
import io
import logging
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from bson import Binary, ObjectId
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorGridFSBucket
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

log = logging.getLogger("media")

CHUNK_SIZE = 1024 * 1024
MAX_UPLOAD = {"image": 30 * 1024 * 1024, "video": 250 * 1024 * 1024}
IMAGE_MAX_EDGE = 1600
THUMB_EDGE = 480
VIDEO_MAX_SECONDS = 60
VIDEO_MAX_EDGE = 854
UPLOAD_DIR = Path(tempfile.gettempdir()) / "flood-uploads"
RANGE_MAX = 2 * 1024 * 1024  # bytes per 206 response

MediaType = Literal["image", "video"]
VIDEO_SLOTS = asyncio.Semaphore(1)


def _now():
    return datetime.now(timezone.utc)


class MediaInit(BaseModel):
    type: MediaType
    size: int = Field(gt=0)
    mime: str = Field("", max_length=100)


def public_media(m: dict) -> dict:
    return {k: m.get(k) for k in ("id", "type", "status", "error", "width", "height", "duration", "size")}


def attachment(m: dict) -> dict:
    """What a post / water report stores about each attachment."""
    return {k: m.get(k) for k in ("id", "type", "width", "height", "duration")}


def _ffmpeg() -> str:
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def _process_image(src: Path) -> tuple[bytes, bytes, int, int]:
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)  # apply phone rotation, then EXIF (incl. GPS) is dropped on save
        im = im.convert("RGB")
        im.thumbnail((IMAGE_MAX_EDGE, IMAGE_MAX_EDGE), Image.LANCZOS)
        main = io.BytesIO()
        im.save(main, "JPEG", quality=78, optimize=True, progressive=True)
        w, h = im.size
        im.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
        thumb = io.BytesIO()
        im.save(thumb, "JPEG", quality=72, optimize=True)
    return main.getvalue(), thumb.getvalue(), w, h


async def _run(*args: str, timeout: int = 600) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, "timeout"
    return proc.returncode, err.decode(errors="replace")[-2000:]


async def _process_video(src: Path, workdir: Path) -> tuple[Path, Path, int, int, float]:
    out, poster = workdir / "out.mp4", workdir / "poster.jpg"
    edge = VIDEO_MAX_EDGE
    scale = f"scale='if(gte(iw,ih),min({edge},iw),-2)':'if(gte(iw,ih),-2,min({edge},ih))'"
    code, err = await _run(
        _ffmpeg(), "-y", "-hide_banner", "-i", str(src), "-t", str(VIDEO_MAX_SECONDS),
        "-vf", f"{scale},scale=trunc(iw/2)*2:trunc(ih/2)*2", "-r", "30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "1200k", "-bufsize", "2400k",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-movflags", "+faststart", str(out),
    )
    if code != 0 or not out.exists():
        log.warning("ffmpeg failed (%s): %s", code, err[-500:])
        raise ValueError("เปิดไฟล์คลิปนี้ไม่ได้ ลองถ่ายใหม่หรือเลือกคลิปอื่น")
    for ss in ("1", "0"):
        code, _ = await _run(_ffmpeg(), "-y", "-hide_banner", "-ss", ss, "-i", str(out), "-frames:v", "1", "-vf", f"scale={THUMB_EDGE}:-2", str(poster), timeout=60)
        if code == 0 and poster.exists() and poster.stat().st_size:
            break
    with Image.open(poster) as im:
        w, h = im.size
    # Duration / size of the result, from ffmpeg's own probe output
    _, info = await _run(_ffmpeg(), "-hide_banner", "-i", str(out), timeout=60)
    duration = 0.0
    for line in info.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            hms = line.split(",")[0].split("Duration:")[1].strip()
            try:
                hh, mm, ss_ = hms.split(":")
                duration = int(hh) * 3600 + int(mm) * 60 + float(ss_)
            except ValueError:
                pass
        if "Video:" in line and "x" in line:
            for tok in line.replace(",", " ").split():
                if "x" in tok and tok.split("x")[0].isdigit() and tok.split("x")[1].isdigit():
                    w, h = int(tok.split("x")[0]), int(tok.split("x")[1])
                    break
    return out, poster, w, h, round(duration, 1)


def build_router(db, rate_limit):
    """Returns (router, claim_media, delete_media, maintenance) bound to this database."""
    router = APIRouter(prefix="/api/media")
    bucket = AsyncIOMotorGridFSBucket(db, bucket_name="media")
    tasks: set[asyncio.Task] = set()

    async def process(media_id: str):
        workdir = UPLOAD_DIR / media_id
        try:
            m = await db.media.find_one({"id": media_id})
            workdir.mkdir(parents=True, exist_ok=True)
            src = workdir / "original"
            with open(src, "wb") as out:
                async for part in db.media_parts.find({"media": media_id}, {"_id": 0, "data": 1}).sort("i", 1):
                    out.write(part["data"])
            if m["type"] == "image":
                try:
                    main, thumb, w, h = await asyncio.to_thread(_process_image, src)
                except Exception:
                    raise ValueError("ไฟล์รูปนี้ไม่รองรับ (ลองถ่ายใหม่หรือแคปหน้าจอแล้วแนบ)")
                file_id = await bucket.upload_from_stream(f"{media_id}.jpg", main, metadata={"contentType": "image/jpeg"})
                thumb_id = await bucket.upload_from_stream(f"{media_id}-thumb.jpg", thumb, metadata={"contentType": "image/jpeg"})
                extra = {"width": w, "height": h, "duration": None, "size": len(main)}
            else:
                async with VIDEO_SLOTS:  # one ffmpeg at a time per instance, so photos and pages stay quick meanwhile
                    out, poster, w, h, dur = await _process_video(src, workdir)
                with open(out, "rb") as f:
                    file_id = await bucket.upload_from_stream(f"{media_id}.mp4", f, metadata={"contentType": "video/mp4"})
                with open(poster, "rb") as f:
                    thumb_id = await bucket.upload_from_stream(f"{media_id}-poster.jpg", f, metadata={"contentType": "image/jpeg"})
                extra = {"width": w, "height": h, "duration": dur, "size": out.stat().st_size}
            await db.media.update_one({"id": media_id}, {"$set": {"status": "ready", "file_id": file_id, "thumb_id": thumb_id, "ready_at": _now(), **extra}})
        except Exception as e:
            log.exception("media %s failed", media_id)
            msg = str(e) if isinstance(e, ValueError) else "ประมวลผลไฟล์ไม่สำเร็จ"
            await db.media.update_one({"id": media_id}, {"$set": {"status": "failed", "error": msg}})
        finally:
            shutil.rmtree(workdir, ignore_errors=True)
            await db.media_parts.delete_many({"media": media_id})

    @router.post("", status_code=201)
    async def init_upload(body: MediaInit, request: Request):
        rate_limit(request, "media", limit=40, window_s=600)
        if body.size > MAX_UPLOAD[body.type]:
            mb = MAX_UPLOAD[body.type] // (1024 * 1024)
            raise HTTPException(413, f"ไฟล์ใหญ่เกินไป (สูงสุด {mb} MB)" + (" ลองถ่ายคลิปให้สั้นลง" if body.type == "video" else ""))
        media_id = str(uuid.uuid4())
        chunks = -(-body.size // CHUNK_SIZE)
        await db.media.insert_one(
            {"id": media_id, "type": body.type, "mime": body.mime, "declared_size": body.size, "chunks": chunks, "status": "uploading", "attached_to": None, "created_at": _now()}
        )
        return {"id": media_id, "chunk_size": CHUNK_SIZE, "chunks": chunks}

    @router.put("/{media_id}/chunk/{index}", status_code=204)
    async def upload_chunk(media_id: str, index: int, request: Request):
        m = await db.media.find_one({"id": media_id, "status": "uploading"})
        if not m or not 0 <= index < m["chunks"]:
            raise HTTPException(404, "ไม่พบการอัปโหลด")
        data = await request.body()
        if not data or len(data) > CHUNK_SIZE:
            raise HTTPException(413, "ชิ้นข้อมูลไม่ถูกต้อง")
        await db.media_parts.update_one(  # idempotent: a retried chunk just overwrites
            {"media": media_id, "i": index}, {"$set": {"data": Binary(data), "size": len(data), "at": _now()}}, upsert=True
        )

    @router.post("/{media_id}/complete")
    async def complete_upload(media_id: str):
        m = await db.media.find_one({"id": media_id})
        if not m:
            raise HTTPException(404, "ไม่พบการอัปโหลด")
        if m["status"] != "uploading":
            return public_media(m)
        sizes = {p["i"]: p["size"] async for p in db.media_parts.find({"media": media_id}, {"_id": 0, "i": 1, "size": 1})}
        missing = [i for i in range(m["chunks"]) if i not in sizes]
        if missing:
            raise HTTPException(409, f"ข้อมูลยังไม่ครบ ({len(missing)} ชิ้น)")
        if sum(sizes.values()) != m["declared_size"]:
            raise HTTPException(409, "ขนาดไฟล์ไม่ตรงกัน")
        # only one /complete (a retried one, or one on another instance) starts the job
        claimed = await db.media.update_one({"id": media_id, "status": "uploading"}, {"$set": {"status": "processing", "processing_at": _now()}})
        if claimed.modified_count:
            start_processing(media_id)
        return {**public_media(m), "status": "processing"}

    @router.get("/{media_id}")
    async def media_status(media_id: str):
        m = await db.media.find_one({"id": media_id}, {"_id": 0})
        if not m:
            raise HTTPException(404, "ไม่พบไฟล์")
        return public_media(m)

    async def serve(file_id: ObjectId, request: Request):
        try:
            grid_out = await bucket.open_download_stream(file_id)
        except Exception:
            raise HTTPException(404, "ไม่พบไฟล์")
        size = grid_out.length
        ctype = (grid_out.metadata or {}).get("contentType", "application/octet-stream")
        headers = {"Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable"}
        rng = request.headers.get("range", "")
        if rng.startswith("bytes="):
            start_s, _, end_s = rng[6:].split(",")[0].partition("-")
            try:
                if start_s:
                    start = int(start_s)
                    end = int(end_s) if end_s else size - 1
                else:  # suffix range: last N bytes
                    start, end = max(size - int(end_s), 0), size - 1
            except ValueError:
                raise HTTPException(416, "Range ไม่ถูกต้อง")
            if start >= size or start > end:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
            end = min(end, size - 1, start + RANGE_MAX - 1)
            grid_out.seek(start)
            data = await grid_out.read(end - start + 1)
            return Response(data, status_code=206, media_type=ctype, headers={**headers, "Content-Range": f"bytes {start}-{end}/{size}"})

        async def stream():
            while chunk := await grid_out.readchunk():
                yield chunk

        return StreamingResponse(stream(), media_type=ctype, headers={**headers, "Content-Length": str(size)})

    @router.get("/{media_id}/file")
    async def media_file(media_id: str, request: Request):
        m = await db.media.find_one({"id": media_id, "status": "ready"})
        if not m:
            raise HTTPException(404, "ไม่พบไฟล์")
        return await serve(m["file_id"], request)

    @router.get("/{media_id}/thumb")
    async def media_thumb(media_id: str, request: Request):
        m = await db.media.find_one({"id": media_id, "status": "ready"})
        if not m:
            raise HTTPException(404, "ไม่พบไฟล์")
        return await serve(m["thumb_id"], request)

    async def claim_media(ids: list[str], owner: str, allowed: set[str]) -> list[dict]:
        """Attach uploaded media to a post / water report. Returns attachment summaries in the given order."""
        if len(set(ids)) != len(ids):
            raise HTTPException(422, "ไฟล์แนบซ้ำกัน")
        docs = {m["id"]: m async for m in db.media.find({"id": {"$in": ids}})}
        for i in ids:
            m = docs.get(i)
            if not m or m["attached_to"] is not None:
                raise HTTPException(422, "ไม่พบไฟล์แนบ กรุณาแนบใหม่")
            if m["status"] == "failed":
                raise HTTPException(422, m.get("error") or "ไฟล์แนบใช้ไม่ได้ กรุณาแนบใหม่")
            if m["status"] != "ready":
                raise HTTPException(422, "ไฟล์แนบยังประมวลผลไม่เสร็จ")
            if m["type"] not in allowed:
                raise HTTPException(422, "ประเภทไฟล์แนบไม่ถูกต้อง")
        if ids:
            await db.media.update_many({"id": {"$in": ids}}, {"$set": {"attached_to": owner}})
        return [attachment(docs[i]) for i in ids]

    async def delete_media(ids: list[str]):
        async for m in db.media.find({"id": {"$in": ids}}):
            for key in ("file_id", "thumb_id"):
                if m.get(key):
                    try:
                        await bucket.delete(m[key])
                    except Exception:
                        pass
        await db.media.delete_many({"id": {"$in": ids}})

    async def cleanup():
        """Drop uploads never attached to anything (abandoned forms) and stuck jobs."""
        cutoff = _now() - timedelta(hours=6)
        stale = [m["id"] async for m in db.media.find({"attached_to": None, "created_at": {"$lt": cutoff}}, {"id": 1})]
        if stale:
            await delete_media(stale)
            await db.media_parts.delete_many({"media": {"$in": stale}})
        await db.media_parts.delete_many({"at": {"$lt": cutoff}})
        await db.media.update_many(
            {"status": {"$in": ["uploading", "processing"]}, "created_at": {"$lt": _now() - timedelta(hours=1)}},
            {"$set": {"status": "failed", "error": "หมดเวลา"}},
        )

    async def _indexes():
        try:
            await db.media_parts.create_index([("media", 1), ("i", 1)], unique=True)
            await db.media_parts.create_index("at")
        except Exception:
            log.exception("media_parts index")

    def start_processing(media_id: str):
        task = asyncio.create_task(process(media_id))
        tasks.add(task)
        task.add_done_callback(tasks.discard)

    async def maintenance(first_run: bool = False):
        if first_run:
            await _indexes()
            # A restart killed in-flight jobs; their chunks are still in media_parts, so run them again. Jobs another
            # instance started in the last 15 min are left alone, and the claim below stops two restarts doing one twice.
            old = _now() - timedelta(minutes=15)
            async for m in db.media.find({"status": "processing", "processing_at": {"$not": {"$gt": old}}}, {"id": 1, "processing_at": 1}):
                if not await db.media_parts.find_one({"media": m["id"]}, {"_id": 1}):
                    await db.media.update_one({"id": m["id"]}, {"$set": {"status": "failed", "error": "กรุณาแนบใหม่"}})
                    continue
                claimed = await db.media.update_one({"id": m["id"], "processing_at": m.get("processing_at")}, {"$set": {"processing_at": _now()}})
                if claimed.modified_count:
                    start_processing(m["id"])
        await cleanup()

    return router, claim_media, delete_media, maintenance


os.makedirs(UPLOAD_DIR, exist_ok=True)
