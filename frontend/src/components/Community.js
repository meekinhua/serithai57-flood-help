import { useEffect, useMemo, useState } from "react";
import { api, load, save } from "../api";
import { MediaStrip } from "./MediaGallery";
import { JOB_TYPES, LEND_CATEGORIES, LEND_KINDS, SERVICE_CATEGORIES, timeAgo } from "../config";
import { FORUM_CATEGORIES } from "./Forum";

// 7 Oct 2026: "เพื่อนบ้านช่วยกัน", redesigned with Claude Design for first-time users (an older neighbour who
// opens the link from LINE). The most common job, finding a tradesman's number, is one tap from the home page;
// then two doors (ask for help / recommend, give or sell), a feed whose cards act directly (call, "I'll help"),
// and plain words everywhere. Built to grow into the village marketplace once the flood is over: shops and
// home businesses sit with the tradesmen, and the lend board also takes things for sale.

const FEED_DAYS = 7; // requests, lends and sales drop off the feed after a week (they stay on their boards)

// The groups shown on the home page, in the words people search with.
export const PRO_GROUPS = [
  { key: "electric", label: "ช่างไฟ", cats: ["electrician"] },
  { key: "plumb", label: "ประปา ปั๊มน้ำ", cats: ["plumber"] },
  { key: "fix", label: "ซ่อมแอร์ เครื่องใช้", cats: ["ac", "appliance", "repair"] },
  { key: "clean", label: "ล้างบ้าน", cats: ["cleaning"] },
  { key: "junk", label: "ขนขยะ", cats: ["junk", "porter", "truck"] },
  { key: "build", label: "ช่างไม้ ทาสี", cats: ["carpenter", "painter", "roof", "pest"] },
  { key: "car", label: "ซักพรม ซ่อมรถ", cats: ["vehicle", "rental", "boat"] },
  { key: "shop", label: "ร้านในหมู่บ้าน", cats: ["shop", "food", "supplies", "beauty", "tutor", "pets"] },
];
const groupOf = (cat) => PRO_GROUPS.find((g) => g.cats.includes(cat));

export const NEED_CHOICES = [
  { group: "หาคนทำให้", label: "เบอร์ช่าง หรือ ร้าน", hint: "ดูเบอร์ที่เพื่อนบ้านแนะนำ", go: { tab: "pros" } },
  { group: "หาคนทำให้", label: "ประกาศหาช่าง (มีค่าจ้าง)", hint: "ช่างที่ว่างจะติดต่อกลับ", go: { sheet: { type: "jobForm", kind: "need", jobType: "hire" } } },
  { group: "ขอแรงเพื่อนบ้าน", label: "ช่วยล้างบ้าน", hint: "ขัดโคลน เก็บกวาด", go: { sheet: { type: "jobForm", kind: "need", jobType: "clean" } } },
  { group: "ขอแรงเพื่อนบ้าน", label: "ช่วยยกของ", hint: "ขนของพังออกหน้าบ้าน", go: { sheet: { type: "jobForm", kind: "need", jobType: "move" } } },
  { group: "ขอแรงเพื่อนบ้าน", label: "ติดรถ / ฝากซื้อ", hint: "ออกไปข้างนอก ยา ของใช้", go: { sheet: { type: "jobForm", kind: "need", jobType: "ride" } } },
  { group: "ขอแรงเพื่อนบ้าน", label: "อย่างอื่น", hint: "พิมพ์เล่าได้เลย", go: { sheet: { type: "jobForm", kind: "need", jobType: "" } } },
  { group: "หาของ", label: "ยืม / หาซื้อของ", hint: "เครื่องฉีดน้ำ บันได ของมือสอง", go: { sheet: { type: "lendForm", kind: "want" } } },
];
export const OFFER_CHOICES = [
  { group: "แนะนำ", label: "ช่าง หรือ ร้าน ที่เคยใช้แล้วดี", hint: "หรือฉันเป็นช่าง / มีร้าน รับงานได้", go: { sheet: { type: "serviceForm" } } },
  { group: "ให้", label: "มีของให้ยืม", hint: "เครื่องมือ บันได ปั๊ม", go: { sheet: { type: "lendForm", kind: "lend" } } },
  { group: "ให้", label: "มีของให้ฟรี", hint: "ของใช้ที่ไม่ได้ใช้แล้ว", go: { sheet: { type: "lendForm", kind: "give" } } },
  { group: "ให้", label: "ไปช่วยแรงได้ / มีรถ", hint: "บ้านที่ขอแรงจะเห็นชื่อคุณ", go: { sheet: { type: "jobForm", kind: "offer", jobType: "" } } },
  { group: "ขาย", label: "ขายของ / ของมือสอง", hint: "ตั้งราคาเอง นัดรับในหมู่บ้าน", go: { sheet: { type: "lendForm", kind: "sell" } } },
];

const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const PhoneIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);
// a phone number becomes a call link; a LINE id / Facebook name (no number to dial) stays text
const digits = (s) => (s || "").replace(/[^\d+]/g, "");
const isPhone = (s) => digits(s).length >= 9;
const pretty = (s) => {
  const d = digits(s);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : s;
};
const ageDays = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
const ageText = (iso) => (ageDays(iso) >= 1 ? `ลงไว้ ${ageDays(iso)} วันแล้ว` : timeAgo(iso));

// remembered on the phone so บ้านฉัน can ask "how was it?" later (HomePlus ReviewPrompt)
export function rememberCall(s) {
  if (!s?.id) return;
  const calls = load("calls", []).filter((c) => c.id !== s.id);
  save("calls", [...calls.slice(-20), { id: s.id, name: s.name, at: Date.now() }]);
}

function CallButton({ phone, label, onCall }) {
  if (!phone) return null;
  if (!isPhone(phone)) return <p className="flex-1 rounded-xl bg-[#F2F4F1] px-3 py-2 text-[15px]">ติดต่อ: {phone}</p>;
  return (
    <a
      href={`tel:${digits(phone)}`}
      onClick={onCall}
      className="flex min-h-[50px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#15201A] px-3 text-[17px] font-bold text-white active:bg-black"
    >
      <PhoneIcon /> {label || `โทร ${pretty(phone)}`}
    </a>
  );
}

// ---------- 7 Oct: near the top of home — find a tradesman or a shop in one tap (the village's own market) ----------
export function ProsQuick({ services, onOpen, look }) {
  const count = (g) => services.filter((s) => g.cats.includes(s.category)).length;
  return (
    <section className="mb-3 rounded-[20px] border border-[#DCE2DD] bg-white p-3" style={look?.frame}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-display text-lg font-bold">ช่าง · ร้าน ในหมู่บ้าน</h2>
        <span className="text-sm text-[#45504A]">{services.length} ราย</span>
      </div>
      <button onClick={() => onOpen("", true)} className="mt-2 flex min-h-[52px] w-full items-center gap-2 rounded-xl border border-[#A9B4AD] bg-white px-3 text-left text-base text-[#45504A]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#45504A" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        หาช่าง ร้าน เช่น แอร์ ปั๊ม ขนขยะ
      </button>
      <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
        {PRO_GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => onOpen(g.key)}
            className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full border border-[#C9D1CB] bg-[#F2F4F1] px-3.5 text-[15px] font-bold active:bg-[#E4F0E9]"
          >
            {g.label}
            <span className="font-normal text-[#45504A]">{count(g) || ""}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// ---------- the top of the block: find a number, then the two doors ----------
export function CommunityIntro({ services, onGroup, onAll, onNeed, onOffer, onAsk, showPros = true }) {
  const counts = useMemo(() => {
    const c = {};
    for (const s of services) {
      const g = groupOf(s.category);
      if (g) c[g.key] = (c[g.key] || 0) + 1;
    }
    return c;
  }, [services]);
  return (
    <div className="space-y-4">
      {showPros && (
        <div>
          <h3 className="mb-2 text-lg font-bold">หาเบอร์ช่าง / ร้าน</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {PRO_GROUPS.map((g) => (
              <button
                key={g.key}
                onClick={() => onGroup(g.key)}
                className="flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-[#F2F4F1] px-1 py-2 text-center active:bg-[#E4EAE6]"
              >
                <span className="text-[15px] font-bold leading-tight">{g.label}</span>
                <span className="text-sm text-[#45504A]">{counts[g.key] ? `${counts[g.key]} ราย` : "ยังไม่มี"}</span>
              </button>
            ))}
            <button onClick={onAll} className="flex min-h-[76px] flex-col items-center justify-center rounded-2xl border-2 border-[#1E6B47] px-1 text-center text-[15px] font-bold text-[#1E6B47]">
              ดูทั้งหมด
              <span className="text-sm font-normal">{services.length} ราย · ค้นหา</span>
            </button>
          </div>
        </div>
      )}
      {showPros && <div className="border-t border-[#E6EBE7]" />}
      <div className="grid grid-cols-2 gap-2.5">
        <button onClick={onNeed} className="flex min-h-[108px] flex-col justify-between rounded-2xl bg-[#1E6B47] p-3.5 text-left text-white active:bg-[#154D33]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 11V6a2 2 0 0 1 4 0v4M11 10V4a2 2 0 0 1 4 0v6M15 9a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.6-2.8L3 15a2 2 0 0 1 3-2.6l1 1.3" />
          </svg>
          <span>
            <span className="font-display block text-[17px] font-bold leading-tight min-[400px]:text-lg">ขอความช่วยเหลือ</span>
            <span className="block text-sm text-[#D4EADC]">ขอแรง · ยืมของ · หาช่าง</span>
          </span>
        </button>
        <button onClick={onOffer} className="flex min-h-[108px] flex-col justify-between rounded-2xl border-2 border-[#15201A] bg-white p-3 text-left active:bg-[#F2F4F1]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 10v11M15 5.9L14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4-8a3 3 0 0 1 4 3.9z" />
          </svg>
          <span>
            <span className="font-display block text-[17px] font-bold leading-tight min-[400px]:text-lg">แนะนำ / ให้ / ขาย</span>
            <span className="block text-sm text-[#45504A]">ช่างที่เคยใช้ · ของให้ยืม · ขายของ</span>
          </span>
        </button>
      </div>
      <button onClick={onAsk} className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#F2F4F1] text-base font-bold active:bg-[#E4EAE6]">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        ถามเพื่อนบ้าน
      </button>
    </div>
  );
}

// The one question after a door, grouped, each row saying what it leads to.
export function IntentChoices({ need, choices, onPick }) {
  const groups = [...new Set(choices.map((c) => c.group))];
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-[#45504A]">{need ? "อยากให้ช่วยเรื่องอะไร เลือกข้อเดียว" : "อยากแนะนำ ให้ หรือขายอะไร เลือกข้อเดียว"}</p>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-1.5 text-sm font-bold text-[#45504A]">{g}</h3>
          <ul className="space-y-2">
            {choices
              .filter((c) => c.group === g)
              .map((c) => (
                <li key={c.label}>
                  <button
                    onClick={() => onPick(c.go)}
                    className="flex min-h-[62px] w-full items-center gap-3 rounded-2xl border border-[#DCE2DD] bg-white px-3.5 py-2 text-left active:border-[#15201A]"
                  >
                    <span className="min-w-0 flex-1">
                      <b className="block text-base">{c.label}</b>
                      {c.hint && <span className="block text-sm text-[#45504A]">{c.hint}</span>}
                    </span>
                    <span className="text-[#45504A]">
                      <Chevron />
                    </span>
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const TAG = {
  need: ["ขอแรง", "bg-[#FCEFD9] text-[#7A4104]"],
  offer: ["ช่วยได้", "bg-[#E4F0E9] text-[#154D33]"],
  pros: ["ช่าง · ร้าน", "bg-[#E3EDF9] text-[#1F4F8A]"],
  lend: ["ยืม · ให้", "bg-[#EEE8F7] text-[#5B3A92]"],
  sell: ["ขาย", "bg-[#FDE7E4] text-[#8F2A1C]"],
  forum: ["ถาม-ตอบ", "bg-[#ECEFEC] text-[#33403A]"],
};

// Everything at once, newest first; each card does its job right there (call, "I'll help", open the topic).
export function CommunityFeed({ lend, jobs, services, topics, onTab, onTopic, onJoin, onNeed }) {
  const items = useMemo(() => {
    const out = [];
    const fresh = (iso) => ageDays(iso) < FEED_DAYS;
    for (const j of jobs) {
      if (j.status === "done" || !fresh(j.created_at)) continue;
      const [, text] = JOB_TYPES[j.type] || ["", "ขอแรง"];
      out.push({
        id: `j${j.id}`,
        tab: "jobs",
        k: j.kind === "offer" ? "offer" : "need",
        job: j,
        media: j.media || [],
        title: j.detail,
        sub: [text, j.soi && `ซ.${j.soi}`, j.house && `บ้าน ${j.house}`].filter(Boolean).join(" · "),
        at: j.created_at,
      });
    }
    for (const s of services) {
      const g = groupOf(s.category);
      out.push({ id: `s${s.id}`, tab: "pros", k: "pros", svc: s, media: s.media || [], title: s.name, sub: g ? g.label : SERVICE_CATEGORIES[s.category]?.[1] || "", at: s.created_at });
    }
    for (const x of lend) {
      if (x.status === "closed" || !fresh(x.created_at)) continue;
      out.push({
        id: `l${x.id}`,
        tab: "lend",
        k: x.kind === "sell" ? "sell" : "lend",
        media: x.media || [],
        title: x.title,
        price: x.price,
        sub: [LEND_KINDS[x.kind]?.verb, LEND_CATEGORIES[x.category]?.[1], x.soi && `ซ.${x.soi}`].filter(Boolean).join(" · "),
        at: x.created_at,
      });
    }
    for (const t of topics || []) {
      out.push({
        id: `t${t.id}`,
        tab: "forum",
        k: "forum",
        topic: t.id,
        media: t.media || [],
        title: t.title,
        sub: [FORUM_CATEGORIES[t.category]?.[1], `${t.reply_count} คำตอบ`].filter(Boolean).join(" · "),
        at: t.last_at,
      });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [lend, jobs, services, topics]);
  const shown = items; // the tab row above already filters by kind

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">ประกาศล่าสุด</h3>
        <span className="text-sm text-[#45504A]">ขอแรง ยืม ขาย หายเองใน {FEED_DAYS} วัน</span>
      </div>
      {shown.length ? (
        <ul className="space-y-2.5">
          {shown.slice(0, 30).map((x) => (
            <li key={x.id} className="space-y-2 rounded-2xl border border-[#DCE2DD] bg-white p-3.5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-md px-2 py-0.5 font-bold ${TAG[x.k][1]}`}>{TAG[x.k][0]}</span>
                <span className="text-[#45504A]">{x.k === "pros" ? x.sub : ageText(x.at)}</span>
              </div>
              <b className="block break-words text-[17px] leading-snug">{x.title}</b>
              <MediaStrip media={x.media || []} />
              {x.price && <p className="text-lg font-bold text-[#8F2A1C]">{x.price}</p>}
              {x.k === "pros" && x.svc.detail && <p className="line-clamp-2 break-words text-[15px] text-[#33403A]">{x.svc.detail}</p>}
              {x.k !== "pros" && x.sub && <p className="break-words text-[15px] text-[#33403A]">{x.sub}</p>}
              {x.k === "pros" && <Trust s={x.svc} />}
              {x.k === "pros" && (
                <div className="flex gap-2">
                  <CallButton phone={x.svc.phone} onCall={() => rememberCall(x.svc)} />
                </div>
              )}
              {x.k === "need" && (
                <button
                  onClick={() => onJoin(x.job)}
                  className="flex min-h-[52px] w-full flex-col items-center justify-center rounded-xl bg-[#1E6B47] text-base font-bold leading-tight text-white active:bg-[#154D33]"
                >
                  ฉันไปช่วยได้
                  <span className="text-[13px] font-medium text-[#D4EADC]">แล้วโทรนัดกับเจ้าของบ้าน</span>
                </button>
              )}
              {x.k === "offer" && (
                <button onClick={() => onJoin(x.job)} className="min-h-[50px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold">
                  ขอให้มาช่วยบ้านฉัน
                </button>
              )}
              {(x.k === "lend" || x.k === "sell") && (
                <button onClick={() => onTab("lend")} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-base font-bold">
                  ดูรายละเอียด / ติดต่อ
                </button>
              )}
              {x.k === "forum" && (
                <button onClick={() => onTopic(x.topic)} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-base font-bold">
                  อ่าน / ตอบ
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl bg-[#F2F4F1] p-4 text-center">
          <p className="font-bold">ยังไม่มีประกาศในหมวดนี้</p>
          <button onClick={onNeed} className="mt-2 min-h-[48px] rounded-xl bg-[#1E6B47] px-4 font-bold text-white">
            ลงเป็นคนแรก
          </button>
        </div>
      )}
    </div>
  );
}

function Trust({ s }) {
  const good = s.good || 0;
  return <p className="text-sm font-bold text-[#1E6B47]">{good ? `เพื่อนบ้าน ${good} คนบอกว่าดี` : /แนะนำ/.test(s.detail || "") ? "เพื่อนบ้านแนะนำ" : "ยังไม่มีคนบอกว่าเคยใช้"}</p>;
}

// ---------- the tradesmen & shops board: search, groups, a big call button, "เคยใช้ ดี" ----------
export function ProsList({ services, setServices, group, setGroup, onAdd, query: q0, autoFocus, hires = [], onHire, onHires }) {
  const [q, setQ] = useState(q0 || "");
  const [msg, setMsg] = useState("");
  const [voted, setVoted] = useState(() => load("prosVoted", []));
  const query = q.trim().toLowerCase();
  const g = PRO_GROUPS.find((x) => x.key === group);
  const shown = services
    .filter(
      (s) =>
        (!g || g.cats.includes(s.category)) &&
        (!query || `${s.name} ${s.detail} ${s.area} ${SERVICE_CATEGORIES[s.category]?.[1] || ""} ${groupOf(s.category)?.label || ""}`.toLowerCase().includes(query)),
    )
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.good || 0) - (a.good || 0) || (a.reports || 0) - (b.reports || 0));
  async function good(s) {
    setMsg("");
    try {
      const doc = await api(`/services/${s.id}/review`, { method: "POST", body: JSON.stringify({ name: load("contact", {}).name || "เพื่อนบ้าน", good: true, text: "" }) });
      setServices((list) => list.map((x) => (x.id === s.id ? { ...x, ...doc } : x)));
      const v = [...voted, s.id];
      setVoted(v);
      save("prosVoted", v);
      setMsg("ขอบคุณที่บอกต่อ เพื่อนบ้านจะเห็นว่ามีคนเคยใช้");
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[15px] text-[#45504A]">เบอร์ที่เพื่อนบ้านแชร์กันมา · ตกลงราคากันเอง</p>
        <button onClick={onAdd} className="min-h-[44px] shrink-0 rounded-xl bg-[#1E6B47] px-3 text-[15px] font-bold text-white">
          + แนะนำ
        </button>
      </div>
      <label className="flex min-h-[50px] items-center gap-2 rounded-xl border border-[#C9D1CB] bg-white px-3">
        <span className="sr-only">ค้นหาช่างหรือร้าน</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#45504A" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
          placeholder="พิมพ์ เช่น แอร์ ปั๊ม ซักพรม ร้านกาแฟ"
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {[{ key: "", label: "ทั้งหมด" }, ...PRO_GROUPS].map((x) => (
          <button
            key={x.key || "all"}
            onClick={() => setGroup(x.key)}
            aria-pressed={(group || "") === x.key}
            className={`min-h-[42px] rounded-full px-3.5 text-[15px] ${(group || "") === x.key ? "bg-[#15201A] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {msg && <p className="rounded-xl bg-[#E4F0E9] p-3 text-[15px] font-bold text-[#154D33]">{msg}</p>}
      {shown.length ? (
        <ul className="space-y-2.5">
          {shown.map((s) => (
            <li key={s.id} className="space-y-1.5 rounded-2xl border border-[#DCE2DD] bg-white p-3.5">
              <p className="text-sm font-bold text-[#1F4F8A]">{groupOf(s.category)?.label || SERVICE_CATEGORIES[s.category]?.[1] || "อื่นๆ"}</p>
              <b className="block break-words text-lg leading-snug">{s.name}</b>
              <MediaStrip media={s.media || []} />
              {s.detail && <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-[#33403A]">{s.detail}</p>}
              {(s.price || s.area) && <p className="text-sm text-[#45504A]">{[s.price, s.area].filter(Boolean).join(" · ")}</p>}
              <Trust s={s} />
              {s.reports > 0 && <p className="text-sm text-[#B42318]">มีคนแจ้งว่าโทรไม่ติด {s.reports} ครั้ง</p>}
              <div className="flex gap-2 pt-1">
                <CallButton phone={s.phone} onCall={() => rememberCall(s)} />
                {s.line_id && !/search|ค้นหา/i.test(s.line_id) && (
                  <a
                    href={`https://line.me/R/ti/p/~${encodeURIComponent(s.line_id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-[50px] items-center rounded-xl bg-[#E4F6EA] px-3 font-bold text-[#0B6B33]"
                  >
                    LINE
                  </a>
                )}
                <button
                  onClick={() => good(s)}
                  disabled={voted.includes(s.id)}
                  className="min-h-[50px] shrink-0 rounded-xl border border-[#C9D1CB] px-3 text-sm font-bold leading-tight disabled:opacity-50"
                >
                  {voted.includes(s.id) ? (
                    "บอกแล้ว"
                  ) : (
                    <>
                      เคยใช้
                      <br />
                      ดี
                    </>
                  )}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl bg-[#F2F4F1] p-4 text-center">
          <p className="font-bold">{query || g ? "ยังไม่มีในหมวดนี้" : "ยังไม่มีเบอร์"}</p>
          <p className="mt-1 text-[15px] text-[#45504A]">ถ้ารู้จักช่างหรือร้านดีๆ แนะนำให้เพื่อนบ้านได้เลย</p>
          <button onClick={onAdd} className="mt-2 min-h-[48px] rounded-xl bg-[#1E6B47] px-4 font-bold text-white">
            แนะนำ
          </button>
        </div>
      )}
      {/* the end of the list: can't find one? say so; tradesmen see who is looking — quietly, not as an alert */}
      {onHire && (
        <div className="mt-2 space-y-2 rounded-2xl border border-dashed border-[#A9B4AD] p-3">
          <p className="text-[15px] font-bold">หาไม่เจอ?</p>
          <button onClick={onHire} className="min-h-[48px] w-full rounded-xl border-2 border-[#15201A] bg-white text-[15px] font-bold">
            🙋 ประกาศหาช่าง ให้ช่างในหมู่บ้านเห็น
          </button>
          {hires.length > 0 && (
            <button onClick={onHires} className="min-h-[44px] w-full text-left text-[15px] text-[#45504A] underline">
              เพื่อนบ้านกำลังหาช่าง {hires.length} เรื่อง · เป็นช่าง? ดูงาน ›
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- "ฉันไปช่วยได้": put your name down, then call the house to agree a time ----------
export function JoinSheetBody({ job, onJoined, onClose }) {
  const [name, setName] = useState(load("contact", {}).name || "");
  const [contact, setContact] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const need = job.kind === "need";
  const showContact = () =>
    api(`/jobs/${job.id}/contact`)
      .then(setContact)
      .catch((e) => setErr(e.message));
  async function join(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const doc = await api(`/jobs/${job.id}/join`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      save("contact", { ...load("contact", {}), name: name.trim() });
      save("jobsJoined", [...load("jobsJoined", []), job.id]);
      onJoined(doc);
      await showContact();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }
  useEffect(() => {
    if (load("jobsJoined", []).includes(job.id)) showContact();
  }, [job.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-[#F2F4F1] p-3.5 text-base leading-relaxed">{job.detail}</p>
      {contact ? (
        <div className="space-y-3">
          {load("jobsJoined", []).includes(job.id) && <p className="text-base font-bold text-[#1E6B47]">ลงชื่อแล้ว เจ้าของประกาศเห็นชื่อคุณแล้ว</p>}
          <p className="text-[15px]">
            {need ? "โทรนัดวันเวลากับเจ้าของบ้านได้เลย" : "โทรคุยกันได้เลย"}
            {contact.house ? ` · บ้าน ${contact.house}` : ""}
          </p>
          <div className="flex">{contact.phone ? <CallButton phone={contact.phone} /> : <p className="text-[15px]">ไม่ได้ใส่เบอร์ไว้</p>}</div>
          <button onClick={onClose} className="min-h-[50px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold">
            เสร็จแล้ว
          </button>
        </div>
      ) : (
        <form onSubmit={join} className="space-y-3">
          <ol className="space-y-2 text-[15px]">
            <li className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E6B47] text-sm font-bold text-white">1</span>
              {need ? "ใส่ชื่อเล่น เจ้าของบ้านจะเห็นว่าคุณจะไปช่วย" : "ใส่ชื่อเล่น เจ้าของประกาศจะเห็นชื่อคุณ"}
            </li>
            <li className="flex gap-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1E6B47] text-sm font-bold text-white">2</span>
              {need ? "กดโทรนัดวันเวลากับเจ้าของบ้าน" : "กดโทรคุยรายละเอียด"}
            </li>
          </ol>
          <label className="block">
            <span className="mb-1 block text-base font-bold">ชื่อเล่น</span>
            <input
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ต้น ซ.12"
              className="min-h-[52px] w-full rounded-xl border border-[#A9B4AD] px-3.5 text-[17px]"
            />
          </label>
          {err && <p className="rounded-xl bg-red-50 p-3 text-red-700">{err}</p>}
          <button type="submit" disabled={busy} className="min-h-[56px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-60">
            {busy ? "กำลังส่ง…" : "ยืนยัน แล้วดูเบอร์"}
          </button>
          <button type="button" onClick={showContact} className="min-h-[48px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold">
            ยังไม่แน่ใจ ขอดูเบอร์ไว้ก่อน
          </button>
        </form>
      )}
    </div>
  );
}

// ---------- after a post: tell the LINE group ----------
export function PostedSheetBody({ text, onClose }) {
  const url = `https://line.me/R/share?text=${encodeURIComponent(`${text}\nดู / ติดต่อได้ที่ ${window.location.origin}`)}`;
  return (
    <div className="space-y-3 text-center">
      <div className="mx-auto flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#E4F0E9] text-[#1E6B47]">
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <p className="font-display text-2xl font-bold">ลงแล้ว เพื่อนบ้านเห็นแล้ว</p>
      <p className="text-[15px] text-[#45504A]">บอกต่อในกลุ่ม LINE หมู่บ้าน จะมีคนเห็นเร็วขึ้น</p>
      <p className="whitespace-pre-line rounded-2xl bg-[#F2F4F1] p-3 text-left text-[15px]">{text}</p>
      <a href={url} target="_blank" rel="noreferrer" className="flex min-h-[56px] w-full items-center justify-center rounded-xl bg-[#06c755] text-lg font-bold text-white">
        แชร์ลง LINE
      </a>
      <button onClick={onClose} className="min-h-[50px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold">
        เสร็จแล้ว
      </button>
      <p className="text-[15px] text-[#45504A]">
        ถ้าจะแก้หรือปิดประกาศ ทักแอดมินที่เพจหมู่บ้านได้เลย
        <br />
        ขอแรง ยืม ขาย จะหายจากหน้าแรกเองใน {FEED_DAYS} วัน
      </p>
    </div>
  );
}

// ---------- the bottom bar: the four things people come back for ----------
// 7 Oct: badges = {home|pros|community|map: "important" | "general" | null}
// important: a red "!" that pulses (act on it: a check-in, today's thing, the water) · general: a green dot (something new)
export function BottomNav({ page, badges = {}, onGo, onHotline }) {
  const items = [
    ["home", "บ้านฉัน", <path key="p" d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />],
    ["pros", "ช่าง · ร้าน", <path key="p" d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" />],
    [
      "community",
      "เพื่อนบ้าน",
      <g key="p">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20a6 6 0 0 1 12 0" />
        <circle cx="17" cy="9" r="2.6" />
        <path d="M15.5 14.2A5 5 0 0 1 21 19" />
      </g>,
    ],
    [
      "map",
      "แผนที่น้ำ",
      <g key="p">
        <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2z" />
        <path d="M9 4v14M15 6v14" />
      </g>,
    ],
  ];
  return (
    <nav aria-label="เมนูหลัก" className="sticky top-0 z-[950] border-b border-[#DCE2DD] bg-white pt-[env(safe-area-inset-top)] shadow-sm">
      <div className="mx-auto grid h-[64px] max-w-5xl grid-cols-5">
        {items.map(([key, label, icon]) => {
          const on = page === key;
          return (
            <button
              key={key}
              onClick={() => onGo(key)}
              aria-current={on ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-0.5 text-[14px] ${on ? "font-bold text-[#1E6B47]" : "text-[#45504A]"}`}
            >
              {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-[#1E6B47]" aria-hidden="true" />}
              <span className="relative">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {icon}
                </svg>
                {badges[key] === "important" && (
                  <span
                    className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-white bg-[#B42318] text-[11px] font-bold leading-none text-white"
                    aria-label="มีเรื่องสำคัญ"
                  >
                    <span className="absolute inset-0 animate-ping rounded-full bg-[#B42318] opacity-60" aria-hidden="true" />
                    <span className="relative">!</span>
                  </span>
                )}
                {badges[key] === "general" && !on && <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#1E9E5A]" aria-label="มีอัปเดตใหม่" />}
                {badges[key] === "muted" && (
                  <span className="absolute -right-1 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#B42318] opacity-35" aria-label="มีเรื่องที่ยังค้าง (ล้างแจ้งเตือนแล้ว)" />
                )}
              </span>
              <span className="whitespace-nowrap">{label}</span>
            </button>
          );
        })}
        <button onClick={onHotline} className="flex flex-col items-center justify-center gap-0.5 text-[14px] font-bold text-[#B42318]">
          <PhoneIcon size={24} />
          ฉุกเฉิน
        </button>
      </div>
    </nav>
  );
}

// A home-page block that folds to one line: icon, title, one-line summary, "ย่อ / ดู".
// Kept mounted once opened (Leaflet maps don't like being torn down).
export function FoldBox({ icon, title, sub, open, onToggle, boxRef, look, children }) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (!open) return;
    setMounted(true);
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60); // maps re-measure after unhiding
    return () => clearTimeout(t);
  }, [open]);
  return (
    <section ref={boxRef} className="mb-3 scroll-mt-28 overflow-hidden rounded-[20px] border border-[#DCE2DD] bg-white" style={look?.frame}>
      <button onClick={onToggle} aria-expanded={open} className="flex min-h-[64px] w-full items-center gap-3 px-4 py-3 text-left" style={look?.head || undefined}>
        {icon}
        <span className="min-w-0 flex-1">
          <b className="font-display block break-words text-xl leading-snug">{title}</b>
          {sub && <span className={`block text-[15px] ${look?.solid ? "text-white/85" : "text-[#45504A]"}`}>{sub}</span>}
        </span>
        <span className={`shrink-0 text-[15px] font-bold ${look?.solid ? "text-white" : "text-[#45504A]"}`}>{open ? "ย่อ" : "ดู"}</span>
      </button>
      {mounted && (
        <div className={`px-4 pb-4 ${look?.solid ? "bg-white pt-4" : ""}`} hidden={!open}>
          {children}
        </div>
      )}
    </section>
  );
}

export const WaterIcon = (
  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E3EDF9] text-[#1F5FA8]">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
    </svg>
  </span>
);
export const PeopleIcon = (
  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E4F0E9] text-[#1E6B47]">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6" />
    </svg>
  </span>
);
