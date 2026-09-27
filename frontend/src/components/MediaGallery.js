import { useEffect, useState } from "react";
import { formatDuration, mediaUrl } from "../media";

function Lightbox({ src, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/90 p-2" onClick={onClose} role="dialog" aria-label="ดูรูป">
      <img src={src} alt="" className="max-h-full max-w-full object-contain" />
      <button onClick={onClose} aria-label="ปิด" className="absolute right-2 top-2 flex h-12 w-12 items-center justify-center rounded-full bg-white/20 text-2xl text-white">
        ✕
      </button>
    </div>
  );
}

export default function MediaGallery({ media = [] }) {
  const [open, setOpen] = useState(null);
  if (!media.length) return null;
  const images = media.filter((m) => m.type === "image");
  const videos = media.filter((m) => m.type === "video");
  return (
    <div className="space-y-2">
      {videos.map((m) => (
        <video
          key={m.id}
          controls
          playsInline
          preload="none"
          poster={mediaUrl(m.id, "thumb")}
          src={mediaUrl(m.id, "file")}
          className="max-h-[70vh] w-full rounded-lg bg-black"
        />
      ))}
      {images.length > 0 && (
        <div className={`grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((m) => (
            <button key={m.id} onClick={() => setOpen(mediaUrl(m.id, "file"))} className="overflow-hidden rounded-lg bg-neutral-100">
              <img src={mediaUrl(m.id, "thumb")} alt="รูปที่แนบ" loading="lazy" className={`w-full object-cover ${images.length === 1 ? "max-h-80" : "aspect-square"}`} />
            </button>
          ))}
        </div>
      )}
      {open && <Lightbox src={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

// Small thumbnail for list rows: first attachment + count
export function MediaThumb({ media = [] }) {
  if (!media.length) return null;
  const first = media[0];
  return (
    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-neutral-200">
      <img src={mediaUrl(first.id, "thumb")} alt="" loading="lazy" className="h-full w-full object-cover" />
      {first.type === "video" && <span className="absolute inset-0 flex items-center justify-center text-xl text-white drop-shadow">▶</span>}
      {media.length > 1 && <span className="absolute bottom-0 right-0 rounded-tl bg-black/75 px-1 text-xs text-white">+{media.length - 1}</span>}
      {first.type === "video" && first.duration ? (
        <span className="absolute bottom-0 left-0 rounded-tr bg-black/75 px-1 text-[10px] text-white">{formatDuration(first.duration)}</span>
      ) : null}
    </span>
  );
}
