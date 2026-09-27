import { API, api } from "./api";

export const MAX_VIDEO_MB = 250;
export const VIDEO_MAX_SECONDS = 60;

export function mediaUrl(id, part = "file") {
  return `${API}/media/${id}/${part}`;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Shrink photos on the phone before upload (long edge 1600 px, JPEG). The server re-encodes
// again and strips EXIF/GPS; this step is about saving mobile data during the flood.
export async function resizeImage(file, maxEdge = 1600, quality = 0.8) {
  try {
    let source;
    try {
      source = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      source = await loadImageElement(file);
    }
    const w = source.width;
    const h = source.height;
    const scale = Math.min(1, maxEdge / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
    source.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file; // e.g. HEIC on a browser that can't decode it: let the server try
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function putChunk(id, index, blob) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(`${API}/media/${id}/chunk/${index}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
      if (res.ok) return;
      if (res.status < 500 && res.status !== 429) throw Object.assign(new Error(`อัปโหลดไม่สำเร็จ (${res.status})`), { fatal: true });
    } catch (err) {
      if (err.fatal || attempt >= 5) throw err.fatal ? err : new Error("เน็ตหลุด อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง");
    }
    await sleep(1000 * 2 ** attempt); // flaky mobile data: back off and retry the same chunk
  }
}

// Chunked upload + wait for server-side processing. onProgress(stage, fraction)
export async function uploadMedia(blob, type, onProgress = () => {}) {
  const init = await api("/media", { method: "POST", body: JSON.stringify({ type, size: blob.size, mime: blob.type || "" }) });
  for (let i = 0; i < init.chunks; i++) {
    await putChunk(init.id, i, blob.slice(i * init.chunk_size, (i + 1) * init.chunk_size));
    onProgress("uploading", (i + 1) / init.chunks);
  }
  await api(`/media/${init.id}/complete`, { method: "POST" });
  onProgress("processing", 0);
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    await sleep(1500);
    let m;
    try {
      m = await api(`/media/${init.id}`);
    } catch {
      continue; // transient network error while polling
    }
    if (m.status === "ready") return m;
    if (m.status === "failed") throw new Error(m.error || "ประมวลผลไฟล์ไม่สำเร็จ");
  }
  throw new Error("ประมวลผลนานเกินไป ลองใหม่อีกครั้ง");
}

export function formatDuration(sec) {
  if (!sec) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
