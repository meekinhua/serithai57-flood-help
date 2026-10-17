import { useEffect, useRef, useState } from "react";
import { formatDuration, mediaUrl } from "../media";

// 17 Oct: one viewer for every photo / clip on the site (was: the file opened in a new browser tab — hard to go
// through several). Full screen, swipe or ← → between them, "2/5", tap a photo to zoom, Esc / ✕ / the phone's back
// button closes. Anything calls openMedia(list, index); a link with data-media="id[,id…]" (map popups) works too.
// <MediaViewerHost /> is mounted once in index.js.
export function openMedia(media, index = 0) {
  const list = (media || []).filter((m) => m && m.id);
  if (list.length) window.dispatchEvent(new CustomEvent("media-view", { detail: { media: list, index: Math.max(0, Math.min(index, list.length - 1)) } }));
}

function Viewer({ media, start, onClose }) {
  const ref = useRef(null);
  const [at, setAt] = useState(start);
  const [zoom, setZoom] = useState(false);
  const go = (k) => {
    const el = ref.current;
    if (!el) return;
    const n = Math.max(0, Math.min(k, media.length - 1));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = start * el.clientWidth;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    document.addEventListener("keydown", onKey);
    const body = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = body;
    };
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-[1200] flex flex-col bg-black" role="dialog" aria-modal="true" aria-label="ดูรูปและคลิป">
      <div className="flex h-14 shrink-0 items-center justify-between px-2 text-white">
        <span className="px-2 text-base font-semibold">{media.length > 1 ? `${at + 1} / ${media.length}` : ""}</span>
        <button onClick={onClose} aria-label="ปิด" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-2xl">
          ✕
        </button>
      </div>
      <div
        ref={ref}
        onScroll={(e) => {
          const n = Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth));
          if (n !== at) {
            setAt(n);
            setZoom(false);
          }
        }}
        className={`flex min-h-0 flex-1 snap-x snap-mandatory [scrollbar-width:none] ${zoom ? "overflow-hidden" : "overflow-x-auto"}`}
      >
        {media.map((m, i) => (
          <div key={m.id} className={`flex h-full w-full shrink-0 snap-center items-center justify-center ${zoom && i === at ? "overflow-auto" : ""}`}>
            {m.type === "video" ? (
              i === at ? (
                <video controls autoPlay playsInline src={mediaUrl(m.id, "file")} poster={mediaUrl(m.id, "thumb")} className="max-h-full max-w-full" />
              ) : (
                <img src={mediaUrl(m.id, "thumb")} alt="" className="max-h-full max-w-full object-contain opacity-60" />
              )
            ) : (
              <img
                src={Math.abs(i - at) <= 1 ? mediaUrl(m.id, "file") : mediaUrl(m.id, "thumb")}
                alt=""
                onClick={() => i === at && setZoom((z) => !z)}
                className={zoom && i === at ? "max-w-none cursor-zoom-out" : "max-h-full max-w-full cursor-zoom-in object-contain"}
                style={zoom && i === at ? { width: "200%" } : undefined}
              />
            )}
          </div>
        ))}
      </div>
      {media.length > 1 && (
        <div className="flex shrink-0 justify-center gap-2 overflow-x-auto p-2">
          {media.map((m, i) => (
            <button key={m.id} onClick={() => go(i)} aria-label={`ไปที่ ${i + 1}`} className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-md ${i === at ? "ring-2 ring-white" : "opacity-50"}`}>
              <img src={mediaUrl(m.id, "thumb")} alt="" className="h-full w-full object-cover" />
              {m.type === "video" && <span className="absolute inset-0 flex items-center justify-center text-white drop-shadow">▶</span>}
            </button>
          ))}
        </div>
      )}
      {media.length > 1 && (
        <>
          <button onClick={() => go(at - 1)} disabled={at === 0} aria-label="ก่อนหน้า" className="absolute left-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white disabled:opacity-20 sm:flex">
            ‹
          </button>
          <button onClick={() => go(at + 1)} disabled={at === media.length - 1} aria-label="ถัดไป" className="absolute right-2 top-1/2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-2xl text-white disabled:opacity-20 sm:flex">
            ›
          </button>
        </>
      )}
      <p className="shrink-0 pb-2 text-center text-xs text-white/50">{zoom ? "แตะรูปอีกครั้งเพื่อย่อ" : media.length > 1 ? "ปัดซ้าย-ขวาดูรูปถัดไป · แตะรูปเพื่อขยาย" : "แตะรูปเพื่อขยาย"}</p>
    </div>
  );
}

export function MediaViewerHost() {
  const [v, setV] = useState(null);
  useEffect(() => {
    const onOpen = (e) => {
      setV(e.detail);
      window.history.pushState({ mediaViewer: true }, ""); // the phone's back button closes the viewer, not the page
    };
    const onPop = () => setV(null);
    const onClick = (e) => {
      const a = e.target.closest?.("a[data-media]");
      if (!a) return;
      e.preventDefault();
      openMedia(a.dataset.media.split(",").map((id) => ({ id, type: "image" })));
    };
    window.addEventListener("media-view", onOpen);
    window.addEventListener("popstate", onPop);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("media-view", onOpen);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("click", onClick);
    };
  }, []);
  if (!v) return null;
  return <Viewer key={v.media.map((m) => m.id).join()} media={v.media} start={v.index} onClose={() => (window.history.state?.mediaViewer ? window.history.back() : setV(null))} />;
}

// a tappable thumbnail that opens the viewer (for cards that show one photo of a set)
export function MediaButton({ media, index = 0, className = "", children }) {
  return (
    <button type="button" onClick={() => openMedia(media, index)} className={`block ${className}`} aria-label={media[index]?.type === "video" ? "เล่นคลิป" : "ดูรูป"}>
      {children}
    </button>
  );
}

export default function MediaGallery({ media = [] }) {
  if (!media.length) return null;
  const videos = media.filter((m) => m.type === "video");
  const images = media.filter((m) => m.type === "image");
  const all = [...videos, ...images];
  return (
    <div className="space-y-2">
      {videos.map((m, i) => (
        <button key={m.id} type="button" onClick={() => openMedia(all, i)} aria-label="เล่นคลิป" className="relative block w-full overflow-hidden rounded-lg bg-black">
          <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="max-h-80 w-full object-contain" />
          <span className="absolute inset-0 flex items-center justify-center text-5xl text-white drop-shadow-lg">▶</span>
        </button>
      ))}
      {images.length > 0 && (
        <div className={`grid gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {images.map((m, i) => (
            <button key={m.id} type="button" onClick={() => openMedia(all, videos.length + i)} className="overflow-hidden rounded-lg bg-neutral-100">
              <img src={mediaUrl(m.id, "thumb")} alt="รูปที่แนบ" loading="lazy" className={`w-full object-cover ${images.length === 1 ? "max-h-80" : "aspect-square"}`} />
            </button>
          ))}
        </div>
      )}
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
      {first.type === "video" && first.duration ? <span className="absolute bottom-0 left-0 rounded-tr bg-black/75 px-1 text-[10px] text-white">{formatDuration(first.duration)}</span> : null}
    </span>
  );
}

// 7 Oct: a row of small thumbnails for cards (shops, รอบบ้าน); a tap opens the photo or plays the clip
export function MediaStrip({ media = [], size = 72 }) {
  if (!media.length) return null;
  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {media.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => openMedia(media, i)}
          aria-label={m.type === "video" ? "เล่นคลิป" : "ดูรูป"}
          className="relative shrink-0 overflow-hidden rounded-lg bg-neutral-200"
          style={{ width: size, height: size }}
        >
          <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="h-full w-full object-cover" />
          {m.type === "video" && <span className="absolute inset-0 flex items-center justify-center text-2xl text-white drop-shadow">▶</span>}
        </button>
      ))}
    </div>
  );
}
