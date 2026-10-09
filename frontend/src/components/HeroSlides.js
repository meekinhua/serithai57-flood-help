// 9 Oct 2026: the big slideshow at the top of each เพื่อนบ้าน tab — full-width card, big title, slides by itself,
// swipe to browse. หาย·เจอ, ช่วยกัน and คุยกัน all lead with one.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { JOB_TYPES, LEND_CATEGORIES, LEND_KINDS, timeAgo } from "../config";
import { mediaUrl } from "../media";
import { FORUM_CATEGORIES } from "./Forum";

const TONE = { red: ["#FDE8E6", "#B42318"], green: ["#E4F0E9", "#1E6B47"], amber: ["#FFF3D6", "#9A5B00"], blue: ["#E3ECFB", "#1D4ED8"], ink: ["#EEF0EE", "#15201A"] };

// slide: { key, img (media id), emoji, tone, badge, title, sub, onClick }
export default function HeroSlides({ slides }) {
  const box = useRef(null);
  const [i, setI] = useState(0);
  const hold = useRef(0); // a finger on it: no auto-slide for a while
  // one card's width (a phone shows 1, a wide screen 2–3 side by side, so photos never get huge)
  const step = () => box.current?.firstChild?.offsetWidth || box.current?.clientWidth || 1;
  const pages = () => Math.max(1, slides.length - Math.round((box.current?.clientWidth || 1) / step()) + 1);
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - hold.current < 8000 || !box.current || document.hidden || pages() < 2) return;
      const n = (Math.round(box.current.scrollLeft / step()) + 1) % pages();
      box.current.scrollTo({ left: n * step(), behavior: "smooth" });
    }, 4500);
    return () => clearInterval(t);
  }, [slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!slides.length) return null;
  const onScroll = () => box.current && setI(Math.round(box.current.scrollLeft / step()));
  const go = (n) => {
    hold.current = Date.now();
    box.current?.scrollTo({ left: Math.min(n, pages() - 1) * step(), behavior: "smooth" });
  };
  return (
    <div className="-mx-3 mt-3">
      <div
        ref={box}
        onScroll={onScroll}
        onPointerDown={() => (hold.current = Date.now())}
        onTouchStart={() => (hold.current = Date.now())}
        className="flex snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {slides.map((x) => {
          const [bg, fg] = TONE[x.tone] || TONE.ink;
          return (
            <button key={x.key} onClick={x.onClick} className="w-full shrink-0 snap-start px-3 text-left sm:w-1/2 sm:px-1.5 sm:first:pl-3 lg:w-1/3" aria-label={x.title}>
              <span className="relative block aspect-[4/3] overflow-hidden rounded-2xl" style={{ background: bg }}>
                {x.img ? (
                  <img src={mediaUrl(x.img)} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-[72%] items-center justify-center text-[88px]" aria-hidden="true">
                    {x.emoji}
                  </span>
                )}
                {x.badge && (
                  <span className="absolute left-3 top-3 rounded-lg px-2.5 py-1 text-[15px] font-bold text-white shadow" style={{ background: fg }}>
                    {x.badge}
                  </span>
                )}
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-3 pt-10 text-white">
                  <span className="line-clamp-2 block text-xl font-bold leading-snug">{x.title}</span>
                  {x.sub && <span className="block truncate text-[15px] opacity-90">{x.sub}</span>}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {slides.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden="true">
          {slides.slice(0, box.current ? pages() : slides.length).map((s, n) => (
            <button key={s.key} tabIndex={-1} onClick={() => go(n)} className={`h-2 rounded-full transition-all ${n === i ? "w-6 bg-[#15201A]" : "w-2 bg-[#C5CCC7]"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

function Head({ icon, tone, title, sub }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`ic ${tone}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        <p className="text-sm text-[#45504A]">{sub}</p>
      </div>
    </div>
  );
}

const newest = (a, b) => String(b.created_at).localeCompare(String(a.created_at));

// 🤝 ช่วยกัน: who needs a hand + what's up for lending / giving / sale, newest first
export function HelpHero({ jobs, lend, onOpen }) {
  const needs = jobs.filter((j) => j.type !== "hire" && j.status !== "done" && j.status !== "closed").sort(newest);
  const items = lend.filter((x) => !x.status || x.status === "available").sort(newest);
  const slides = [
    ...needs.slice(0, 5).map((j) => {
      const [emoji, what] = JOB_TYPES[j.type] || ["🙋", "ขอแรง"];
      const need = j.kind === "need";
      return {
        key: `j${j.id}`,
        emoji,
        tone: need ? "amber" : "green",
        badge: need ? `🙋 ขอแรง · ${what}` : `💪 ช่วยได้ · ${what}`,
        title: j.detail,
        sub: [j.name, j.soi && `ซ.${j.soi}`, j.when, timeAgo(j.created_at)].filter(Boolean).join(" · "),
        onClick: () => onOpen("jobs", j.id),
      };
    }),
    ...items.slice(0, 6).map((x) => {
      const k = LEND_KINDS[x.kind] || LEND_KINDS.lend;
      return {
        key: `l${x.id}`,
        img: x.media?.[0]?.id,
        emoji: (LEND_CATEGORIES[x.category] || ["🧰"])[0],
        tone: x.kind === "sell" ? "blue" : x.kind === "want" ? "amber" : "green",
        badge: `${k.emoji} ${k.label}${x.kind === "sell" && x.price ? ` · ${x.price}` : ""}`,
        title: x.title,
        sub: [x.name, x.soi && `ซ.${x.soi}`, timeAgo(x.created_at)].filter(Boolean).join(" · "),
        onClick: () => onOpen("lend", x.id),
      };
    }),
  ];
  return (
    <section className="card mb-3 p-3" aria-label="ช่วยกัน">
      <Head
        icon="🤝"
        tone="ic-green"
        title="ช่วยกัน ในหมู่บ้าน"
        sub={`${needs.filter((j) => j.kind === "need").length ? `ขอแรงอยู่ ${needs.filter((j) => j.kind === "need").length}` : "ตอนนี้ยังไม่มีใครขอแรง"} · ยืม·แจก·ขาย ${items.length}`}
      />
      <HeroSlides slides={slides} />
    </section>
  );
}

// 💬 คุยกัน: the latest topics, the ones still waiting for an answer first
export function TalkHero({ onOpen }) {
  const [topics, setTopics] = useState(null);
  useEffect(() => {
    api("/forum")
      .then((l) => setTopics(Array.isArray(l) ? l : l.items || []))
      .catch(() => setTopics([]));
  }, []);
  if (!topics) return null;
  const latest = [...topics].sort((a, b) => String(b.last_at || b.created_at).localeCompare(String(a.last_at || a.created_at))).slice(0, 8);
  const open = topics.filter((t) => !t.solved_reply).length;
  const slides = latest.map((t) => {
    const [emoji, cat] = FORUM_CATEGORIES[t.category] || ["💬", "คุยกัน"];
    return {
      key: t.id,
      img: t.media?.[0]?.id,
      emoji,
      tone: t.solved_reply ? "green" : t.reply_count ? "blue" : "amber",
      badge: t.solved_reply ? `✅ ได้คำตอบแล้ว · ${cat}` : t.reply_count ? `💬 ${t.reply_count} คำตอบ · ${cat}` : `❓ ยังไม่มีคนตอบ · ${cat}`,
      title: t.title,
      sub: [t.author?.name || (typeof t.author === "string" ? t.author : ""), timeAgo(t.last_at || t.created_at)].filter(Boolean).join(" · "),
      onClick: () => onOpen(t.id),
    };
  });
  return (
    <section className="card mb-3 p-3" aria-label="คุยกัน">
      <Head icon="💬" tone="ic-green" title="คุยกัน ในหมู่บ้าน" sub={`${topics.length} กระทู้${open ? ` · รอคำตอบ ${open}` : ""} · ถามเพื่อนบ้าน แนะนำ แลกเปลี่ยน`} />
      <HeroSlides slides={slides} />
    </section>
  );
}
