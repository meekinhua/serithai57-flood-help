import { useEffect, useState } from "react";
import { ANNOUNCEMENT_LEVELS, timeAgo } from "../config";
import { load, save } from "../api";

function expiryText(iso) {
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Admin announcements: big, high-contrast, not dismissible. Unseen ones get a "ใหม่" tag and a flash.
export default function Announcements({ items, preview = false }) {
  const [seen, setSeen] = useState(() => (preview ? [] : load("seenAnnouncements", [])));

  useEffect(() => {
    if (preview || !items.length) return;
    // Mark as seen after they've been on screen a moment, so the flash is noticeable first.
    const t = setTimeout(() => {
      const ids = items.map((a) => a.id);
      setSeen(ids);
      save("seenAnnouncements", ids);
    }, 8000);
    return () => clearTimeout(t);
  }, [items, preview]);

  if (!items.length) return null;

  return (
    <section aria-label="ประกาศจากผู้ดูแลหมู่บ้าน" className="space-y-2">
      {items.map((a) => {
        const lv = ANNOUNCEMENT_LEVELS[a.level] || ANNOUNCEMENT_LEVELS.info;
        const isNew = !preview && !seen.includes(a.id);
        return (
          <div
            key={a.id}
            role={a.level === "danger" ? "alert" : "status"}
            className={`rounded-xl border-4 p-3 shadow-md sm:p-4 ${lv.cls} ${isNew || a.level === "danger" ? "announce-flash" : ""}`}
          >
            <div className="flex items-start gap-3">
              <span className="text-3xl leading-none sm:text-4xl" aria-hidden="true">
                {lv.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-xs font-bold tracking-wide sm:text-sm">
                  <span>ประกาศจากผู้ดูแลหมู่บ้าน · {lv.label}</span>
                  {isNew && <span className="rounded bg-white px-1.5 py-0.5 text-black">ใหม่</span>}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-lg font-bold leading-snug sm:text-2xl">{a.text}</p>
                <p className="mt-1 text-xs opacity-90 sm:text-sm">
                  {a.created_by} · {a.created_at ? timeAgo(a.created_at) : "ตัวอย่าง"}
                  {a.expires_at && ` · แสดงถึง ${expiryText(a.expires_at)}`}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
