import { useMemo, useState } from "react";
import { JOB_TYPES, LEND_CATEGORIES, LEND_KINDS, SERVICE_CATEGORIES, timeAgo } from "../config";
import { FORUM_CATEGORIES } from "./Forum";

// 6 Oct 2026: the neighbours' community, rebuilt around what people want to do. Three doors
// ("I need…", "I can help / have…", "ask"), then one question that routes to the right board,
// so nobody has to know which tab a post belongs to. Below, one feed of everything, newest first.

// Each choice opens an existing form (or board) in RepairApp: { sheet } or { tab }.
export const NEED_CHOICES = [
  { emoji: "🧑‍🔧", label: "หาช่าง / ร้าน", hint: "ดูช่างที่เพื่อนบ้านแนะนำ", go: { tab: "pros" } },
  { emoji: "📣", label: "ประกาศหาช่าง (มีค่าจ้าง)", hint: "ช่างที่ว่างจะติดต่อมา", go: { sheet: { type: "jobForm", kind: "need", jobType: "hire" } } },
  { emoji: "🧽", label: "คนช่วยล้างบ้าน / ขัดโคลน", hint: "อาสาหรือเพื่อนบ้านมาช่วย", go: { sheet: { type: "jobForm", kind: "need", jobType: "clean" } } },
  { emoji: "📦", label: "คนช่วยยกของ / ขนของพัง", hint: "", go: { sheet: { type: "jobForm", kind: "need", jobType: "move" } } },
  { emoji: "🔎", label: "ยืมของ / หาของ", hint: "เครื่องฉีดน้ำ บันได ปั๊ม …", go: { sheet: { type: "lendForm", kind: "want" } } },
  { emoji: "🚗", label: "ติดรถ / ฝากซื้อของ", hint: "", go: { sheet: { type: "jobForm", kind: "need", jobType: "ride" } } },
  { emoji: "🙋", label: "อย่างอื่น", hint: "", go: { sheet: { type: "jobForm", kind: "need", jobType: "" } } },
];
export const OFFER_CHOICES = [
  { emoji: "⭐", label: "แนะนำช่าง / ร้านที่ใช้แล้วดี", hint: "หรือฉันเป็นช่าง รับงานได้", go: { sheet: { type: "serviceForm" } } },
  { emoji: "🤝", label: "มีของให้ยืม", hint: "", go: { sheet: { type: "lendForm", kind: "lend" } } },
  { emoji: "🎁", label: "มีของให้ฟรี", hint: "", go: { sheet: { type: "lendForm", kind: "give" } } },
  { emoji: "💪", label: "ไปช่วยแรงได้ / มีรถ", hint: "บ้านที่ขอแรงจะเห็นชื่อคุณ", go: { sheet: { type: "jobForm", kind: "offer", jobType: "" } } },
];

export function CommunityIntro({ onNeed, onOffer, onAsk }) {
  return (
    <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
      <h2 className="text-xl font-bold">🏘️ ชุมชนเสรีไทย 57</h2>
      <p className="text-sm text-neutral-600">เพื่อนบ้านช่วยกัน · ขอ · ให้ · แนะนำ · ถาม</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button onClick={onNeed} className="flex min-h-[84px] flex-col items-start justify-center rounded-xl bg-black px-3 py-2 text-left text-white active:bg-neutral-800">
          <span className="text-lg font-bold">🙋 ฉันต้องการ…</span>
          <span className="text-sm text-neutral-300">ช่าง · คนช่วย · ยืมของ</span>
        </button>
        <button onClick={onOffer} className="flex min-h-[84px] flex-col items-start justify-center rounded-xl border-2 border-black bg-white px-3 py-2 text-left active:bg-neutral-100">
          <span className="text-lg font-bold">🤝 ฉันช่วยได้…</span>
          <span className="text-sm text-neutral-600">แนะนำร้าน · มีของ · ช่วยแรง</span>
        </button>
      </div>
      <button onClick={onAsk} className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-black bg-white font-semibold active:bg-neutral-100">
        💬 ถามเพื่อนบ้าน / แชร์ความรู้
      </button>
    </section>
  );
}

// The one question after a door: what exactly. Each row says what will happen.
export function IntentChoices({ choices, onPick }) {
  return (
    <ul className="space-y-2">
      {choices.map((c) => (
        <li key={c.label}>
          <button onClick={() => onPick(c.go)} className="flex min-h-[60px] w-full items-center gap-3 rounded-xl border-2 border-neutral-200 bg-white px-3 py-2 text-left active:border-black">
            <span className="text-2xl" aria-hidden="true">{c.emoji}</span>
            <span className="min-w-0 flex-1">
              <b className="block">{c.label}</b>
              {c.hint && <span className="block text-sm text-neutral-600">{c.hint}</span>}
            </span>
            <span className="text-xl text-neutral-400" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

const KIND = {
  jobs: { tag: "ขอแรง", cls: "bg-amber-100 text-amber-900" },
  offer: { tag: "ช่วยได้", cls: "bg-emerald-100 text-emerald-800" },
  pros: { tag: "ช่าง · ร้าน", cls: "bg-sky-100 text-sky-900" },
  lend: { tag: "ยืม · ของฟรี", cls: "bg-violet-100 text-violet-900" },
  forum: { tag: "ถาม-ตอบ", cls: "bg-neutral-200 text-neutral-800" },
};
const FILTERS = [
  ["all", "ทั้งหมด"],
  ["jobs", "🙋 ขอแรง"],
  ["pros", "🔧 ช่าง · ร้าน"],
  ["lend", "🧰 ยืม · ของฟรี"],
  ["forum", "💬 ถาม-ตอบ"],
];

// Everything in one list, newest first, each row tagged with where it lives; a tap opens that board.
export function CommunityFeed({ lend, jobs, services, topics, onOpen, onNeed }) {
  const [f, setF] = useState("all");
  const items = useMemo(() => {
    const out = [];
    for (const j of jobs) {
      if (j.status === "done") continue;
      const [emoji, text] = JOB_TYPES[j.type] || ["🙋", "ขอแรง"];
      out.push({ id: `j${j.id}`, tab: "jobs", k: j.kind === "offer" ? "offer" : "jobs", emoji, title: j.detail, sub: [text, j.soi && `ซ.${j.soi}`, j.name].filter(Boolean).join(" · "), at: j.created_at });
    }
    for (const s of services) {
      const [emoji, text] = SERVICE_CATEGORIES[s.category] || ["📞", "อื่นๆ"];
      out.push({ id: `s${s.id}`, tab: "pros", k: "pros", emoji, title: s.name, sub: [text, s.detail].filter(Boolean).join(" · "), at: s.updated_at || s.created_at });
    }
    for (const x of lend) {
      if (x.status === "closed") continue;
      const [emoji] = LEND_CATEGORIES[x.category] || ["🧰"];
      out.push({ id: `l${x.id}`, tab: "lend", k: "lend", emoji, title: x.title, sub: [LEND_KINDS[x.kind]?.verb, x.soi && `ซ.${x.soi}`, x.name].filter(Boolean).join(" · "), at: x.created_at });
    }
    for (const t of topics || []) {
      const [emoji, text] = FORUM_CATEGORIES[t.category] || ["💬", ""];
      out.push({ id: `t${t.id}`, tab: "forum", k: "forum", emoji, title: t.title, sub: [text, `💬 ${t.reply_count} คำตอบ`].filter(Boolean).join(" · "), at: t.last_at, topic: t.id });
    }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [lend, jobs, services, topics]);
  const count = (k) => items.filter((x) => x.tab === k).length;
  const shown = items.filter((x) => f === "all" || x.tab === f);

  return (
    <div className="space-y-2">
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          {FILTERS.map(([k, text]) => (
            <button key={k} onClick={() => setF(k)} aria-pressed={f === k} className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm ${f === k ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}>
              {text} {k !== "all" && <span className={f === k ? "text-neutral-300" : "text-neutral-500"}>({count(k)})</span>}
            </button>
          ))}
        </div>
      </div>
      {shown.length ? (
        <ul className="space-y-2">
          {shown.slice(0, 40).map((x) => (
            <li key={x.id}>
              <button onClick={() => onOpen(x)} className="flex w-full items-start gap-3 rounded-xl border bg-white p-3 text-left shadow-sm active:bg-neutral-50">
                <span className="text-2xl" aria-hidden="true">{x.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded px-1.5 font-semibold ${KIND[x.k].cls}`}>{KIND[x.k].tag}</span>
                    <span className="text-neutral-500">{timeAgo(x.at)}</span>
                  </span>
                  <b className="mt-0.5 line-clamp-2 block break-words leading-snug">{x.title}</b>
                  {x.sub && <span className="line-clamp-1 block break-words text-sm text-neutral-600">{x.sub}</span>}
                </span>
                <span className="self-center text-xl text-neutral-400" aria-hidden="true">›</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl bg-white p-4 text-center text-neutral-600">
          <p className="font-semibold">ยังไม่มีอะไรในหมวดนี้</p>
          <button onClick={onNeed} className="mt-2 min-h-[44px] rounded-lg bg-black px-4 font-semibold text-white">เริ่มลงเป็นคนแรก</button>
        </div>
      )}
    </div>
  );
}

// After a post: one tap to tell the LINE group, where everyone actually is.
export function PostedSheetBody({ text, onClose }) {
  const url = `https://line.me/R/share?text=${encodeURIComponent(`${text}\nดู / ติดต่อได้ที่ ${window.location.origin}`)}`;
  return (
    <div className="space-y-3 text-center">
      <p className="text-5xl" aria-hidden="true">✅</p>
      <p className="text-lg font-bold">ลงแล้ว เพื่อนบ้านเห็นแล้ว</p>
      <p className="text-neutral-600">บอกต่อในกลุ่ม LINE หมู่บ้าน จะมีคนเห็นเร็วขึ้น</p>
      <a href={url} target="_blank" rel="noreferrer" className="flex min-h-[56px] w-full items-center justify-center rounded-xl bg-[#06c755] text-lg font-bold text-white">
        แชร์ลง LINE
      </a>
      <button onClick={onClose} className="min-h-[48px] w-full rounded-xl border-2 border-black font-semibold">
        เสร็จแล้ว
      </button>
    </div>
  );
}
