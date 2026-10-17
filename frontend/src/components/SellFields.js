import { useState } from "react";

// 🛍️ ตลาด (17 Oct): the extra fields for a seller who puts work into it — a shop name, a few selling points and a
// menu with prices. Used by the new-item form (RepairBoards LendForm) and the seller's edit form (Market.js).
// All optional: a quick "ขนมกล้วย 50 บาท" post stays as quick as before.

const field = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
export const TAG_PRESETS = ["ทำสดทุกวัน", "สูตรที่บ้าน", "ไม่ใส่ผงชูรส", "ไม่ใส่สารกันบูด", "ส่งในหมู่บ้าน", "มังสวิรัติ/เจได้", "หวานน้อยได้", "ของฝาก"];

export function TagsField({ tags, onChange }) {
  const [own, setOwn] = useState("");
  const toggle = (t) => onChange(tags.includes(t) ? tags.filter((x) => x !== t) : tags.length < 5 ? [...tags, t] : tags);
  const add = () => {
    const t = own.trim().replace(/^#/, "").slice(0, 24);
    if (t && !tags.includes(t) && tags.length < 5) onChange([...tags, t]);
    setOwn("");
  };
  return (
    <div>
      <p className="mb-1 block font-medium">จุดเด่น (เลือกได้ 5 · ไม่บังคับ)</p>
      <div className="flex flex-wrap gap-1.5">
        {[...TAG_PRESETS, ...tags.filter((t) => !TAG_PRESETS.includes(t))].map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => toggle(t)}
            aria-pressed={tags.includes(t)}
            className={`min-h-[40px] rounded-full px-3 text-sm ${tags.includes(t) ? "bg-[#1E6B47] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
          >
            {tags.includes(t) ? "✓ " : ""}
            {t}
          </button>
        ))}
      </div>
      {tags.length < 5 && (
        <div className="mt-1.5 flex gap-2">
          <input
            maxLength={24}
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className={field}
            placeholder="พิมพ์จุดเด่นเอง เช่น ใช้เนยแท้"
          />
          <button type="button" onClick={add} className="min-h-[44px] shrink-0 rounded-lg border-2 border-[#15201A] px-3 font-semibold">
            + เพิ่ม
          </button>
        </div>
      )}
    </div>
  );
}

export function OptionsField({ options, onChange }) {
  const set = (i, p) => onChange(options.map((o, j) => (j === i ? { ...o, ...p } : o)));
  return (
    <div>
      <p className="mb-1 block font-medium">เมนู · ขนาด · ราคา (ไม่บังคับ · ถึง 12 รายการ)</p>
      <p className="mb-1.5 text-sm text-neutral-600">มีหลายอย่างหรือหลายขนาด ใส่แยกราคา ให้คนซื้อดูง่าย</p>
      <div className="space-y-1.5">
        {options.map((o, i) => (
          <div key={i} className="space-y-1.5 rounded-lg bg-[#FFFBF0] p-2">
            <input maxLength={40} value={o.name} onChange={(e) => set(i, { name: e.target.value })} className={field} placeholder={i ? "เช่น กล่องใหญ่" : "เช่น ขนมชั้น กล่องเล็ก"} aria-label={`เมนู ${i + 1}`} />
            <div className="flex gap-1.5">
              <input maxLength={24} inputMode="text" value={o.price} onChange={(e) => set(i, { price: e.target.value })} className={field} placeholder="ราคา เช่น 35" aria-label={`ราคา ${i + 1}`} />
              <button type="button" onClick={() => onChange(options.filter((_, j) => j !== i))} aria-label="ลบรายการนี้" className="min-h-[44px] shrink-0 rounded-lg border border-neutral-300 px-3 text-sm">
                ✕ ลบ
              </button>
            </div>
          </div>
        ))}
      </div>
      {options.length < 12 && (
        <button type="button" onClick={() => onChange([...options, { name: "", price: "" }])} className="mt-1.5 min-h-[44px] w-full rounded-lg border-2 border-dashed border-[#1E6B47] font-semibold text-[#1E6B47]">
          + เพิ่มเมนู / ขนาด
        </button>
      )}
    </div>
  );
}

export function ShopNameField({ value, onChange, id = "sell-shop" }) {
  return (
    <div>
      <label className="mb-1 block font-medium" htmlFor={id}>
        ชื่อร้าน / แบรนด์ (ไม่บังคับ)
      </label>
      <input id={id} maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} className={field} placeholder="เช่น ครัวป้าแดง, ขนมบ้านน้องมิ้นท์" />
    </div>
  );
}

// the cleaned-up values to send (empty menu rows dropped)
export const richBody = (f) => ({ shop_name: (f.shop_name || "").trim(), tags: f.tags || [], options: (f.options || []).filter((o) => o.name.trim()) });

// 17 Oct: clips. For ตลาด / ช่าง a YouTube link is the better way (full length, sharp); an upload here is cut to
// 60 s at 480p so it loads fast on phones. For หาย·เจอ either is fine — whatever is quickest to post.
export const youtubeId = (u) => (u || "").match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{6,})/)?.[1] || "";

// 17 Oct: plays right in the card — thumbnail first (fast page), the player only loads on tap · Shorts stand up 9:16
export function YouTubeThumb({ url, className = "" }) {
  const [play, setPlay] = useState(false);
  const id = youtubeId(url);
  if (!id) return null;
  const tall = /\/shorts\//.test(url);
  const box = `relative mx-auto block w-full overflow-hidden rounded-xl bg-black ${tall ? "aspect-[9/16] max-w-[340px]" : "aspect-video"} ${className}`;
  if (play)
    return (
      <div className={box}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&playsinline=1&rel=0`}
          title="คลิป YouTube"
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  return (
    <button type="button" onClick={() => setPlay(true)} aria-label="เล่นคลิป YouTube" className={box}>
      <img src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#FF0000] text-3xl text-white shadow-lg">▶</span>
      </span>
    </button>
  );
}

export function YouTubeField({ value, onChange, id = "yt", strong = false }) {
  const bad = value && !youtubeId(value);
  return (
    <div>
      <label className="mb-1 block font-medium" htmlFor={id}>
        🎬 ลิงก์คลิป YouTube {strong ? "(แนะนำ)" : "(ไม่บังคับ)"}
      </label>
      {strong ? (
        <p className="mb-1.5 rounded-lg bg-[#FFF4D6] p-2.5 text-sm leading-relaxed text-[#5C3B00]">
          มีคลิปยาวๆ หรืออยากให้ภาพคมชัด <b>ลง YouTube แล้วเอาลิงก์มาวางตรงนี้ดีกว่า</b> — คลิปที่อัปตรงนี้ระบบจะตัดเหลือ 60 วินาทีและลดความคมชัด (480p) ให้โหลดเร็ว · ไม่อยากให้คนทั่วไปเห็นช่อง ตั้งเป็น “ไม่เป็นสาธารณะ (Unlisted)” ก็ได้
        </p>
      ) : (
        <p className="mb-1.5 text-sm text-neutral-600">อัปคลิปสั้นด้านบนได้เลย หรือมีคลิปใน YouTube วางลิงก์ตรงนี้ก็ได้</p>
      )}
      <input
        id={id}
        type="url"
        inputMode="url"
        maxLength={200}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        className={field}
        placeholder="เช่น https://youtu.be/xxxx หรือ youtube.com/shorts/xxxx"
      />
      {bad && <p className="mt-1 text-sm text-red-700">ลิงก์นี้ไม่ใช่ YouTube · คัดลอกจากปุ่ม “แชร์” ในแอป YouTube</p>}
      {youtubeId(value) && <YouTubeThumb url={value} className="mt-2" />}
    </div>
  );
}
