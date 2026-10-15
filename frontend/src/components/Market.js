import { useState } from "react";
import { api } from "../api";
import { LEND_CATEGORIES, MARKET_FILTERS, timeAgo } from "../config";
import { mediaUrl } from "../media";
import { notify } from "../notify";
import { ContactButton, useKeys } from "./RepairBoards";

// 🛍️ ตลาดเพื่อนบ้าน (15 Oct 2026): homemade food, sweets, drinks, handmade things and second-hand goods from
// neighbours. These are the lend items of kind "sell" (backend/repair.py) — no new collection, no money through
// the site. Big photo first, the price, when and where to get it, then the seller's phone behind one tap.
// #market-<id> (the LINE bot's cards, notifications) opens here and flashes that item.

export const LINE_SELL = "https://line.me/R/oaMessage/@004forpb/?%E0%B8%A5%E0%B8%87%E0%B8%82%E0%B8%B2%E0%B8%A2"; // "ลงขาย" typed in

export const marketOpen = (lend) => lend.filter((x) => x.kind === "sell" && x.status !== "closed");

const inFilter = (x, f) => {
  if (f === "all") return true;
  const row = MARKET_FILTERS.find(([k]) => k === f);
  if (row?.[2]) return row[2].includes(x.category);
  const named = MARKET_FILTERS.flatMap(([, , cats]) => cats || []);
  return !named.includes(x.category); // มือสอง / อื่นๆ
};

function MarketCard({ item: x, editKey, admin, onClosed }) {
  const [emoji, catText] = LEND_CATEGORIES[x.category] || ["📦", "อื่นๆ"];
  const photos = (x.media || []).filter((m) => m.type !== "video");
  const [busy, setBusy] = useState(false);
  async function close() {
    if (!window.confirm("ขายหมดแล้ว / ปิดร้าน? รายการจะหายจากตลาด")) return;
    setBusy(true);
    try {
      onClosed(await api(`/lend/${x.id}`, { method: "PATCH", headers: { "X-Edit-Key": editKey || "" }, body: JSON.stringify({ status: "closed" }) }));
      notify("ปิดแล้ว ขอบคุณที่ขายให้เพื่อนบ้าน 🙏");
    } catch (e) {
      notify(e.message);
      setBusy(false);
    }
  }
  return (
    <li data-item={x.id} className="card anim-row scroll-mt-36 overflow-hidden">
      {photos[0] ? (
        <a href={mediaUrl(photos[0].id)} target="_blank" rel="noreferrer" className="block">
          <img src={mediaUrl(photos[0].id, "thumb")} alt={x.title} loading="lazy" className="aspect-[4/3] w-full bg-[#F2F4F1] object-cover" />
        </a>
      ) : (
        <div className="flex h-28 items-center justify-center bg-[#FFF4D6] text-5xl" aria-hidden="true">
          {emoji}
        </div>
      )}
      <div className="space-y-1.5 p-3">
        <p className="text-sm text-[#45504A]">
          <span className="rounded-full bg-[#FDE7E4] px-2 py-0.5 font-bold text-[#8F2A1C]">
            {emoji} {catText}
          </span>
          {editKey && <span className="ml-1 rounded-full bg-[#FFE39A] px-2 py-0.5 font-bold">ของฉัน</span>} · {timeAgo(x.created_at)}
        </p>
        <h3 className="break-words text-xl font-bold leading-snug">{x.title}</h3>
        {x.price && <p className="text-xl font-bold text-[#8F2A1C]">{x.price}</p>}
        {(x.soi || x.when) && <p className="text-[15px]">{[x.soi && `📍 ซ.${x.soi}`, x.when && `🕒 ${x.when}`].filter(Boolean).join(" · ")}</p>}
        {x.pickup && <p className="text-[15px]">🛵 {x.pickup}</p>}
        {x.detail && <p className="line-clamp-4 whitespace-pre-wrap break-words text-[15px] text-[#33403A]">{x.detail}</p>}
        {photos.length > 1 && (
          <div className="flex gap-2 pt-1">
            {photos.slice(1).map((m) => (
              <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        <p className="text-[15px] text-[#45504A]">👤 {x.name}</p>
        <div className="pt-1">
          <ContactButton path={`/lend/${x.id}/contact`} text="📞 ติดต่อผู้ขาย" />
        </div>
        {(editKey || admin) && (
          <button disabled={busy} onClick={close} className="min-h-[48px] w-full rounded-xl border-2 border-[#15201A] font-bold disabled:opacity-60">
            ✅ ขายหมด / ปิดร้าน
          </button>
        )}
      </div>
    </li>
  );
}

export default function Market({ items, setItems, admin, onAdd }) {
  const [f, setF] = useState("all");
  const [keys] = useKeys("lendKeys");
  const open = marketOpen(items).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const shown = open.filter((x) => inFilter(x, f));
  const count = (k) => open.filter((x) => inFilter(x, k)).length;
  return (
    <div className="space-y-3">
      <p className="px-1 text-[15px] text-[#45504A]">ของกินทำเอง ขนม งานฝีมือ จากเพื่อนบ้าน · ระบบไม่รับเงิน ตกลงกันเอง</p>
      <button onClick={onAdd} className="min-h-[58px] w-full rounded-2xl bg-[#1E6B47] text-lg font-bold text-white shadow-sm active:bg-[#154D33]">
        + ลงขายของ
      </button>
      <a href={LINE_SELL} target="_blank" rel="noopener noreferrer" className="block text-center text-[15px] font-bold text-[#06A045] underline">
        💬 หรือ ลงขายผ่าน LINE ›
      </a>
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          {[["all", "ทั้งหมด"], ...MARKET_FILTERS].map(([k, t]) => {
            const n = k === "all" ? open.length : count(k);
            return (
              <button
                key={k}
                onClick={() => setF(k)}
                aria-pressed={f === k}
                className={`min-h-[44px] whitespace-nowrap rounded-full px-3 text-[15px] ${f === k ? "bg-[#15201A] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
              >
                {t}
                {n > 0 && k !== "all" ? ` ${n}` : ""}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {shown.map((x) => (
          <MarketCard
            key={x.id}
            item={x}
            editKey={keys[x.id]}
            admin={admin}
            onClosed={(y) => setItems((p) => p.map((z) => (z.id === y.id ? y : z)))}
          />
        ))}
      </ul>
      {!shown.length && (
        <p className="card p-4 text-center text-[15px] text-[#45504A]">
          {open.length ? "หมวดนี้ยังไม่มีของขาย" : "ยังไม่มีใครลงขาย · ทำขนม ทำกับข้าว หรือมีของเหลือใช้? ลงให้เพื่อนบ้านเห็นได้เลย"}
        </p>
      )}
    </div>
  );
}
