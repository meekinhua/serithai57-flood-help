import { useEffect, useState } from "react";
import { api } from "../api";
import { LEND_CATEGORIES, MARKET_FILTERS, SERVICE_CATEGORIES, timeAgo } from "../config";
import { mediaUrl } from "../media";
import { rememberCall } from "./Community";
import { mapLink } from "./PinField";
import { MediaStrip } from "./MediaGallery";
import { notify } from "../notify";
import { ContactButton, NameField, input, label, remember, savedContact, telHref, useKeys } from "./RepairBoards";

// 🛍️ ตลาดเพื่อนบ้าน (15 Oct 2026): homemade food, sweets, drinks, handmade things and second-hand goods from
// neighbours. These are the lend items of kind "sell" (backend/repair.py) — no new collection, no money through
// the site. Big photo first, the price, when and where to get it, then the seller's phone behind one tap.
// #market-<id> (the LINE bot's cards, notifications) opens here and flashes that item.
// 16 Oct: 🛒 สั่ง / จอง — homemade sellers cook to order, so a buyer leaves qty + when + name + phone in the item's
// queue (the LINE bot's order chat lands in the same queue); the seller sees the orders on this card from the phone
// they posted with. 16 Oct: shops open every day (ช่าง·ร้าน directory, categories food / shop / supplies) are listed
// here too under 🏪 ร้านประจำ — one place for things to eat and use; ช่าง·บริการ keeps the services.

export const LINE_SELL = "https://line.me/R/oaMessage/@004forpb/?%E0%B8%A5%E0%B8%87%E0%B8%82%E0%B8%B2%E0%B8%A2"; // "ลงขาย" typed in

export const marketOpen = (lend) => lend.filter((x) => x.kind === "sell" && x.status !== "closed");

const PICKS = ["วันนี้", "พรุ่งนี้เช้า", "พรุ่งนี้เย็น", "เสาร์-อาทิตย์", "ตามสะดวกผู้ขาย"];

// 16 Oct: a YouTube link on a thing for sale → its id for the thumbnail (the video itself opens in YouTube)
export const youtubeId = (u) => (u || "").match(/(?:youtu\.be\/|[?&]v=|shorts\/|live\/)([\w-]{6,})/)?.[1] || "";

function Cover({ x, media, emoji }) {
  const [play, setPlay] = useState(false);
  const m = media[0];
  if (!m)
    return (
      <div className="flex h-28 items-center justify-center bg-[#FFF4D6] text-5xl" aria-hidden="true">
        {emoji}
      </div>
    );
  if (m.type === "video")
    return play ? (
      <video controls autoPlay playsInline src={mediaUrl(m.id, "file")} poster={mediaUrl(m.id, "thumb")} className="aspect-[4/3] w-full bg-black object-contain" />
    ) : (
      <button type="button" onClick={() => setPlay(true)} aria-label="เล่นคลิป" className="relative block w-full">
        <img src={mediaUrl(m.id, "thumb")} alt={x.title} loading="lazy" className="aspect-[4/3] w-full bg-[#F2F4F1] object-cover" />
        <span className="absolute inset-0 flex items-center justify-center text-5xl text-white drop-shadow-lg">▶</span>
      </button>
    );
  return (
    <a href={mediaUrl(m.id)} target="_blank" rel="noreferrer" className="block">
      <img src={mediaUrl(m.id, "thumb")} alt={x.title} loading="lazy" className="aspect-[4/3] w-full bg-[#F2F4F1] object-cover" />
    </a>
  );
}

const dial = (p) => (p || "").replace(/[^\d+]/g, "");
// a shop from the directory: which market chips it shows under
const shopIn = (s, f) => f === "all" || f === "shops" || (f === "homemade" && s.category === "food");

function ShopCard({ s }) {
  const [emoji, catText] = SERVICE_CATEGORIES[s.category] || ["🏪", "ร้าน"];
  const photo = (s.media || []).find((m) => m.type !== "video");
  return (
    <li className="card flex gap-3 p-3">
      {photo ? (
        <img src={mediaUrl(photo.id, "thumb")} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[#E3EDF9] text-4xl" aria-hidden="true">
          {emoji}
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-bold text-[#1F4F8A]">
          {emoji} {catText}
        </p>
        <b className="block break-words leading-snug">{s.name}</b>
        {s.detail && <p className="line-clamp-2 text-sm text-[#33403A]">{s.detail}</p>}
        {(s.area || s.price) && <p className="text-sm text-[#45504A]">{[s.price, s.area].filter(Boolean).join(" · ")}</p>}
        {mapLink(s) && (
          <a href={mapLink(s)} target="_blank" rel="noreferrer" className="inline-block text-sm font-semibold text-[#1F4F8A] underline">
            🗺️ ดูแผนที่ร้าน
          </a>
        )}
        {dial(s.phone).length >= 9 ? (
          <a href={`tel:${dial(s.phone)}`} onClick={() => rememberCall(s)} className="mt-1 flex min-h-[44px] items-center justify-center rounded-xl bg-[#15201A] font-bold text-white">
            📞 โทร {s.phone}
          </a>
        ) : (
          s.phone && <p className="text-sm">ติดต่อ: {s.phone}</p>
        )}
      </div>
    </li>
  );
}

const inFilter = (x, f) => {
  if (f === "all") return true;
  const row = MARKET_FILTERS.find(([k]) => k === f);
  if (row?.[2]) return row[2].includes(x.category);
  const named = MARKET_FILTERS.flatMap(([, , cats]) => cats || []);
  return !named.includes(x.category); // มือสอง / อื่นๆ
};

function OrderForm({ item: x, onDone, onCancel }) {
  const c = savedContact();
  const [form, setForm] = useState({ qty: "", pick: "", note: "", name: c.name || "", phone: c.phone || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const y = await api(`/lend/${x.id}/queue`, { method: "POST", body: JSON.stringify(form) });
      remember(form.name, form.phone);
      onDone(y);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border-2 border-[#15201A] p-3">
      <p className="font-bold">🛒 สั่ง / จอง {x.title}</p>
      <div>
        <label className={label} htmlFor={`o-qty-${x.id}`}>
          จำนวน *
        </label>
        <input id={`o-qty-${x.id}`} required maxLength={40} value={form.qty} onChange={(e) => set({ qty: e.target.value })} className={input} placeholder="เช่น 2 กล่อง, 1 ชุด ไม่เผ็ด" />
      </div>
      <div>
        <p className={label}>อยากได้เมื่อไหร่</p>
        <div className="flex flex-wrap gap-1.5">
          {PICKS.map((p) => (
            <button
              type="button"
              key={p}
              onClick={() => set({ pick: form.pick === p ? "" : p })}
              aria-pressed={form.pick === p}
              className={`min-h-[40px] rounded-full px-3 text-sm ${form.pick === p ? "bg-[#15201A] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
            >
              {p}
            </button>
          ))}
        </div>
        <input maxLength={60} value={form.pick} onChange={(e) => set({ pick: e.target.value })} className={`${input} mt-1.5`} placeholder="หรือพิมพ์เอง เช่น เสาร์ 8 โมง" />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <NameField id={`o-name-${x.id}`} value={form.name} onChange={(name) => set({ name })} />
        <div>
          <label className={label} htmlFor={`o-phone-${x.id}`}>
            เบอร์โทร *
          </label>
          <input id={`o-phone-${x.id}`} required type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
        </div>
      </div>
      <input maxLength={160} value={form.note} onChange={(e) => set({ note: e.target.value })} className={input} placeholder="ฝากบอกผู้ขาย (ไม่บังคับ) เช่น ไม่ใส่ผัก มารับเอง" />
      <p className="text-sm text-[#45504A]">ชื่อ/เบอร์ เห็นเฉพาะผู้ขาย · ผู้ขายจะโทรยืนยันราคาและเวลารับ ระบบไม่รับเงิน</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} className="min-h-[48px] rounded-xl border-2 border-[#15201A] font-semibold">
          ยกเลิก
        </button>
        <button disabled={busy} className="min-h-[48px] rounded-xl bg-[#1E6B47] font-bold text-white disabled:opacity-60">
          ส่งออเดอร์
        </button>
      </div>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </form>
  );
}

function SellerOrders({ item: x, editKey }) {
  const [full, setFull] = useState(null);
  const [err, setErr] = useState("");
  const headers = { "X-Edit-Key": editKey || "" };
  useEffect(() => {
    api(`/lend/${x.id}/owner`, { headers })
      .then(setFull)
      .catch((e) => setErr(e.message));
  }, [x.id, x.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = (full?.queue || []).filter((q) => !q.done);
  async function done(q) {
    try {
      setFull(await api(`/lend/${x.id}/queue/${q.id}/done`, { method: "POST", headers }));
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="space-y-1.5 rounded-xl bg-[#FFF4D6] p-2.5">
      <p className="font-bold">📋 ออเดอร์ของคุณ ({orders.length})</p>
      {orders.map((q) => (
        <div key={q.id} className="space-y-1 rounded-lg bg-white p-2 text-[15px]">
          <p>
            <b>{q.name}</b> · {timeAgo(q.at)}
            {q.via === "line" && <span className="ml-1 text-sm text-[#06A045]">ผ่าน LINE</span>}
          </p>
          {(q.qty || q.pick) && <p>🛒 {[q.qty, q.pick && `🕒 ${q.pick}`].filter(Boolean).join(" · ")}</p>}
          {q.note && <p className="text-[#45504A]">💬 {q.note}</p>}
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <a href={telHref(q.phone)} className="flex min-h-[44px] items-center justify-center rounded-lg bg-[#1E6B47] font-bold text-white">
              📞 {q.phone}
            </a>
            <button onClick={() => done(q)} className="min-h-[44px] rounded-lg border-2 border-[#15201A] font-semibold">
              ✅ ได้ของแล้ว
            </button>
          </div>
        </div>
      ))}
      {full && !orders.length && <p className="text-sm text-[#45504A]">ยังไม่มีออเดอร์ · มีคนสั่ง จะขึ้นที่นี่ (เปิดแจ้งเตือนในบ้านฉัน จะเด้งบอกทันที)</p>}
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

function MarketCard({ item: x, editKey, admin, onChanged }) {
  const [emoji, catText] = LEND_CATEGORIES[x.category] || ["📦", "อื่นๆ"];
  const media = x.media || [];
  const yt = youtubeId(x.youtube);
  const [busy, setBusy] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [ordered, setOrdered] = useState(false);
  async function close() {
    if (!window.confirm("ขายหมดแล้ว / ปิดร้าน? รายการจะหายจากตลาด")) return;
    setBusy(true);
    try {
      onChanged(await api(`/lend/${x.id}`, { method: "PATCH", headers: { "X-Edit-Key": editKey || "" }, body: JSON.stringify({ status: "closed" }) }));
      notify("ปิดแล้ว ขอบคุณที่ขายให้เพื่อนบ้าน 🙏");
    } catch (e) {
      notify(e.message);
      setBusy(false);
    }
  }
  return (
    <li data-item={x.id} className="card anim-row scroll-mt-36 overflow-hidden">
      <Cover x={x} media={media} emoji={emoji} />
      <div className="space-y-1.5 p-3">
        <p className="text-sm text-[#45504A]">
          <span className="rounded-full bg-[#FDE7E4] px-2 py-0.5 font-bold text-[#8F2A1C]">
            {emoji} {catText}
          </span>
          {editKey && <span className="ml-1 rounded-full bg-[#FFE39A] px-2 py-0.5 font-bold">ของฉัน</span>} · {timeAgo(x.created_at)}
        </p>
        <h3 className="break-words text-xl font-bold leading-snug">{x.title}</h3>
        {x.price && <p className="text-xl font-bold text-[#8F2A1C]">{x.price}</p>}
        {x.preorder && <p className="text-[15px] font-bold text-[#1E6B47]">📝 รับสั่งล่วงหน้า · ทำตามออเดอร์</p>}
        {(x.soi || x.when) && <p className="text-[15px]">{[x.soi && `📍 ซ.${x.soi}`, x.when && `🕒 ${x.when}`].filter(Boolean).join(" · ")}</p>}
        {x.pickup && <p className="text-[15px]">🛵 {x.pickup}</p>}
        {mapLink(x) && (
          <a href={mapLink(x)} target="_blank" rel="noreferrer" className="inline-block text-[15px] font-semibold text-[#1F4F8A] underline">
            🗺️ ดูแผนที่จุดรับของ
          </a>
        )}
        {x.detail && <p className="line-clamp-4 whitespace-pre-wrap break-words text-[15px] text-[#33403A]">{x.detail}</p>}
        {media.length > 1 && <MediaStrip media={media.slice(1)} size={64} />}
        {yt && (
          <a href={x.youtube} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-xl">
            <img src={`https://img.youtube.com/vi/${yt}/hqdefault.jpg`} alt="คลิป YouTube" loading="lazy" className="aspect-video w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-xl bg-[#FF0000] px-4 py-2 text-xl font-bold text-white">▶ YouTube</span>
            </span>
          </a>
        )}
        <p className="text-[15px] text-[#45504A]">
          👤 {x.name}
          {x.queue_count > 0 && <span className="ml-1 font-semibold text-[#1E6B47]">· มีคนสั่งอยู่ {x.queue_count}</span>}
        </p>
        {ordered && <p className="rounded-lg bg-emerald-50 p-2 text-[15px] font-semibold text-emerald-800">✅ ส่งออเดอร์แล้ว ผู้ขายจะโทรยืนยันกลับ</p>}
        {ordering ? (
          <OrderForm
            item={x}
            onCancel={() => setOrdering(false)}
            onDone={(y) => {
              onChanged(y);
              setOrdering(false);
              setOrdered(true);
            }}
          />
        ) : (
          !editKey && (
            <div className="grid gap-2 pt-1">
              <button onClick={() => setOrdering(true)} className="min-h-[52px] rounded-xl bg-[#1E6B47] text-lg font-bold text-white">
                🛒 สั่ง / จองไว้
              </button>
              <ContactButton path={`/lend/${x.id}/contact`} text="📞 หรือโทรหาผู้ขาย" />
            </div>
          )
        )}
        {editKey && <SellerOrders item={x} editKey={editKey} />}
        {(editKey || admin) && (
          <button disabled={busy} onClick={close} className="min-h-[48px] w-full rounded-xl border-2 border-[#15201A] font-bold disabled:opacity-60">
            ✅ ขายหมด / ปิดร้าน
          </button>
        )}
      </div>
    </li>
  );
}

export default function Market({ items, setItems, admin, onAdd, shops = [], onAddShop }) {
  const [f, setF] = useState("all");
  const [keys] = useKeys("lendKeys");
  const open = marketOpen(items).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const shown = f === "shops" ? [] : open.filter((x) => inFilter(x, f));
  const shownShops = shops.filter((s) => shopIn(s, f));
  const count = (k) => (k === "shops" ? shops.length : open.filter((x) => inFilter(x, k)).length);
  return (
    <div className="space-y-3">
      <p className="px-1 text-[15px] text-[#45504A]">ของทำเองจากเพื่อนบ้าน · กดสั่ง/จองไว้ได้</p>
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          {[["all", "ทั้งหมด"], ...MARKET_FILTERS, ...(shops.length ? [["shops", "🏪 ร้านประจำ"]] : [])].map(([k, t]) => {
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
          <MarketCard key={x.id} item={x} editKey={keys[x.id]} admin={admin} onChanged={(y) => setItems((p) => p.map((z) => (z.id === y.id ? y : z)))} />
        ))}
      </ul>
      {!shown.length && !shownShops.length && (
        <p className="card p-4 text-center text-[15px] text-[#45504A]">
          {open.length || shops.length ? "หมวดนี้ยังไม่มีของขาย" : "ยังไม่มีใครลงขาย · ทำขนม ทำกับข้าว หรือมีของเหลือใช้? ลงให้เพื่อนบ้านเห็นได้เลย"}
        </p>
      )}
      {shownShops.length > 0 && (
        <section className="space-y-2 pt-1">
          <h3 className="px-1 text-lg font-bold">🏪 ร้านประจำ ใกล้หมู่บ้าน ({shownShops.length})</h3>
          <p className="px-1 text-sm text-[#45504A]">ร้านอาหาร ร้านค้า วัสดุ ที่เปิดเป็นเวลา · โทรสั่งได้เลย</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shownShops.map((s) => (
              <ShopCard key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}
      {/* for sellers, at the bottom: buyers come to look, so the list comes first (16 Oct) */}
      <div className="card space-y-2 p-3">
        <p className="text-[15px] text-[#45504A]">
          <b className="text-[#15201A]">ทำขายเองไหม? มีร้าน?</b> ลงให้เพื่อนบ้านเห็นได้ฟรี · ระบบไม่รับเงิน ตกลงกันเอง
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onAdd} className="min-h-[48px] rounded-xl border-2 border-[#1E6B47] font-bold text-[#1E6B47]">
            + ลงขายของ
          </button>
          <a href={LINE_SELL} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center justify-center rounded-xl border-2 border-[#06A045] font-bold text-[#06A045]">
            💬 ลงผ่าน LINE
          </a>
        </div>
        {onAddShop && (
          <button onClick={onAddShop} className="min-h-[44px] w-full text-[15px] font-semibold text-[#1F4F8A] underline">
            🏪 มีร้านที่เปิดประจำ? ลงร้าน (เบอร์ เวลาเปิด)
          </button>
        )}
      </div>
    </div>
  );
}
