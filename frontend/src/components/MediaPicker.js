import { useEffect, useRef } from "react";
import { MAX_VIDEO_MB, VIDEO_MAX_SECONDS, mediaUrl, resizeImage, uploadMedia } from "../media";

let seq = 0;

// items: [{key, type, status: "preparing"|"uploading"|"processing"|"ready"|"error", progress, error, preview, media}]
export default function MediaPicker({ items, setItems, max = 4, allowVideo = true }) {
  const photoInput = useRef(null);
  const videoInput = useRef(null);
  const queue = useRef(Promise.resolve()); // one upload at a time: kinder to a weak mobile connection
  const previews = useRef([]);

  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const update = (key, patch) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  function addFiles(fileList, type) {
    const room = max - items.length;
    const files = [...fileList].slice(0, Math.max(room, 0));
    for (const file of files) {
      const key = `m${++seq}`;
      let preview = null;
      if (type === "image") {
        preview = URL.createObjectURL(file);
        previews.current.push(preview);
      }
      const tooBig = type === "video" && file.size > MAX_VIDEO_MB * 1024 * 1024;
      setItems((prev) => [...prev, { key, type, status: tooBig ? "error" : "preparing", progress: 0, preview, error: tooBig ? `คลิปใหญ่เกิน ${MAX_VIDEO_MB} MB ลองถ่ายให้สั้นลง` : "" }]);
      if (tooBig) continue;
      queue.current = queue.current.then(async () => {
        try {
          const blob = type === "image" ? await resizeImage(file) : file;
          update(key, { status: "uploading" });
          const media = await uploadMedia(blob, type, (stage, fraction) => update(key, { status: stage, progress: fraction }));
          update(key, { status: "ready", media });
        } catch (err) {
          update(key, { status: "error", error: err.message });
        }
      });
    }
  }

  const remove = (key) => setItems((prev) => prev.filter((it) => it.key !== key));
  const full = items.length >= max;
  const btn = "flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-neutral-400 bg-white px-3 font-semibold active:bg-neutral-50 disabled:opacity-40";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={full} onClick={() => photoInput.current.click()} className={btn}>
          📷 แนบรูป
        </button>
        {allowVideo && (
          <button type="button" disabled={full} onClick={() => videoInput.current.click()} className={btn}>
            🎬 แนบคลิป
          </button>
        )}
      </div>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple={max > 1}
        hidden
        onChange={(e) => {
          addFiles(e.target.files, "image");
          e.target.value = "";
        }}
      />
      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          addFiles(e.target.files, "video");
          e.target.value = "";
        }}
      />
      <p className="mt-1 text-sm text-neutral-500">
        แนบได้ {max} ไฟล์ · ระบบย่อรูปให้อัตโนมัติ{allowVideo && ` · คลิปเก็บ ${VIDEO_MAX_SECONDS} วินาทีแรก ย่อเหลือ 480p`}
      </p>

      {items.length > 0 && (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {items.map((it) => (
            <li key={it.key} className="relative overflow-hidden rounded-lg border border-neutral-300 bg-neutral-100">
              <div className="flex aspect-square items-center justify-center">
                {it.status === "ready" ? (
                  <img src={mediaUrl(it.media.id, "thumb")} alt="" className="h-full w-full object-cover" />
                ) : it.preview ? (
                  <img src={it.preview} alt="" className="h-full w-full object-cover opacity-60" />
                ) : (
                  <span className="text-4xl">🎬</span>
                )}
              </div>
              {it.type === "video" && it.status === "ready" && <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-xs text-white">▶ คลิป</span>}
              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-xs text-white">
                {it.status === "preparing" && "กำลังย่อ…"}
                {it.status === "uploading" && `อัปโหลด ${Math.round(it.progress * 100)}%`}
                {it.status === "processing" && (it.type === "video" ? "กำลังแปลงคลิป…" : "กำลังประมวลผล…")}
                {it.status === "ready" && "✓ พร้อม"}
                {it.status === "error" && <span className="text-red-300">✕ {it.error}</span>}
                {(it.status === "uploading" || it.status === "processing") && (
                  <div className="mt-0.5 h-1 overflow-hidden rounded bg-white/30">
                    <div className={`h-full bg-white ${it.status === "processing" ? "w-full animate-pulse" : ""}`} style={it.status === "uploading" ? { width: `${it.progress * 100}%` } : undefined} />
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(it.key)}
                aria-label="เอาไฟล์นี้ออก"
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-lg text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function mediaState(items) {
  return {
    ids: items.filter((it) => it.status === "ready").map((it) => it.media.id),
    busy: items.some((it) => ["preparing", "uploading", "processing"].includes(it.status)),
  };
}
