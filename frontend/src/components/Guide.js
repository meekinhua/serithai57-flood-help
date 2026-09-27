import { useCallback, useEffect, useRef, useState } from "react";
import { WATER_LEVELS } from "../config";
import { prefersReducedMotion } from "../motion";
import WaterGauge from "./WaterGauge";

// ---------- illustrations (SVG + CSS keyframes from index.css) ----------

function MiniMap({ children }) {
  return (
    <svg viewBox="0 0 240 150" className="h-full w-full">
      <rect width="240" height="150" rx="14" fill="#f1efe9" />
      <g stroke="#ffffff" strokeWidth="10" strokeLinecap="round">
        <path d="M-10 40 H250" />
        <path d="M-10 105 H250" />
        <path d="M70 -10 V160" />
        <path d="M170 -10 V160" />
      </g>
      <g fill="#dcd8cf">
        {[[12, 8], [90, 8], [190, 8], [12, 55], [90, 55], [190, 55], [12, 118], [90, 118], [190, 118]].map(([x, y]) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="45" height="24" rx="3" />
        ))}
      </g>
      <path d="M40 22 L150 12 L205 70 L180 140 L30 130 Z" fill="none" stroke="#000" strokeWidth="1.5" strokeDasharray="5 5" />
      {children}
    </svg>
  );
}

function SceneNeed() {
  return (
    <div className="relative mx-auto grid h-full max-w-sm grid-rows-[auto_1fr] gap-3">
      <div className="relative mx-auto">
        <div className="g-press rounded-xl bg-black px-5 py-3 text-lg font-bold text-white shadow">🆘 ขอความช่วยเหลือ</div>
        <span className="g-tap absolute -bottom-3 right-2 text-3xl" aria-hidden="true">👆</span>
      </div>
      <div className="relative">
        <MiniMap>
          <circle className="g-ripple" cx="120" cy="72" r="16" fill="none" stroke="#dc2626" strokeWidth="3" />
          <g className="g-drop">
            <circle cx="120" cy="72" r="15" fill="#000" stroke="#fff" strokeWidth="3" />
            <text x="120" y="78" textAnchor="middle" fontSize="15">🚣</text>
          </g>
        </MiniMap>
      </div>
    </div>
  );
}

const STATUS_STEPS = [
  { text: "รอความช่วยเหลือ", cls: "bg-neutral-100 text-neutral-700", by: "" },
  { text: "🙋 มีคนกำลังไปช่วย", cls: "bg-black text-white", by: "สมชาย กดรับเรื่อง" },
  { text: "✅ ช่วยเสร็จแล้ว", cls: "border border-neutral-300 text-neutral-500", by: "ปลอดภัยแล้ว" },
];

function SceneHelp({ playing }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => (s + 1) % STATUS_STEPS.length), 1600);
    return () => clearInterval(t);
  }, [playing]);
  const s = STATUS_STEPS[step];
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-3">
      <div className="rounded-xl border-2 border-red-500 bg-white p-3 shadow">
        <div className="flex items-center gap-2 text-sm">
          <span className="rounded bg-red-600 px-1.5 font-bold text-white">ด่วน</span>
          <span className="font-semibold">👵 ผู้สูงอายุติดบ้าน</span>
        </div>
        <p className="mt-1 text-sm text-neutral-700">ยาย 1 คน อยู่ชั้นล่าง น้ำถึงเข่า ต้องการเรือ</p>
        <div className="mt-2 flex items-center gap-2">
          <span key={step} className={`anim-pop rounded px-2 py-0.5 text-sm font-semibold ${s.cls}`}>{s.text}</span>
          {s.by && <span key={`b${step}`} className="anim-fade text-xs text-neutral-500">{s.by}</span>}
        </div>
      </div>
      <div className="g-float flex items-center justify-center gap-2 text-sm">
        <span className="rounded-lg border-2 border-black bg-white px-3 py-1 font-semibold">🤝 ฉันช่วยได้</span>
        <span className="rounded-lg border-2 border-black bg-white px-3 py-1 font-semibold">📇 ช่าง · รถ · รับจ้าง</span>
      </div>
    </div>
  );
}

function SceneWater({ playing }) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setLevel((l) => (l + 1) % WATER_LEVELS.length), 900);
    return () => clearInterval(t);
  }, [playing]);
  return (
    <div className="mx-auto flex h-full max-w-sm items-center justify-center gap-3">
      <WaterGauge level={level} className="h-full max-h-56 w-auto rounded-xl shadow" />
      <div className="flex flex-col gap-1 text-xs">
        {WATER_LEVELS.map((w) => (
          <span key={w.level} className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${w.level === level ? "bg-black font-bold text-white" : "text-neutral-500"}`}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: w.color }} />
            {w.label}
          </span>
        ))}
      </div>
    </div>
  );
}

const BLOBS = [
  [60, 40, 5, 0],
  [110, 60, 5, 250],
  [150, 45, 4, 500],
  [80, 100, 3, 750],
  [175, 110, 2, 1000],
  [125, 120, 1, 1250],
];

function SceneMap({ cycle }) {
  return (
    <div className="mx-auto h-full max-w-sm">
      <MiniMap>
        <defs>
          {WATER_LEVELS.map((w) => (
            <radialGradient key={w.level} id={`blob${w.level}`}>
              <stop offset="0%" stopColor={w.color} stopOpacity="0.9" />
              <stop offset="100%" stopColor={w.color} stopOpacity="0" />
            </radialGradient>
          ))}
        </defs>
        {/* key={cycle} restarts the sequence each time the slide is shown */}
        <g key={cycle}>
          {BLOBS.map(([x, y, l, d]) => (
            <circle key={`b${x}`} className="g-blob" style={{ animationDelay: `${d + 400}ms` }} cx={x} cy={y} r="48" fill={`url(#blob${l})`} />
          ))}
          {BLOBS.map(([x, y, l, d]) => (
            <circle key={`d${x}`} className="g-dot" style={{ animationDelay: `${d}ms` }} cx={x} cy={y} r="6" fill={WATER_LEVELS[l].color} stroke="#fff" strokeWidth="2" />
          ))}
        </g>
      </MiniMap>
    </div>
  );
}

function SceneAlerts() {
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col gap-3 overflow-hidden">
      <div className="g-banner rounded-xl border-4 border-black bg-yellow-300 p-3 text-black shadow">
        <p className="text-xs font-bold">ประกาศจากผู้ดูแลหมู่บ้าน · เตือน</p>
        <p className="font-bold">⚠️ ศูนย์พักพิงเปิดที่สโมสรหมู่บ้าน</p>
      </div>
      <div className="flex flex-1 items-center justify-center gap-4">
        <span className="g-ring inline-block text-6xl" aria-hidden="true">☎️</span>
        <div className="space-y-1 text-sm">
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1 font-semibold">🛡️ รปภ. ป้อมหน้า</p>
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1 font-semibold text-red-700">🚑 1669 · 🚒 199</p>
        </div>
      </div>
    </div>
  );
}

const SLIDES = [
  { title: "🆘 ต้องการความช่วยเหลือ", text: "กดปุ่มดำ เลือกเรื่องที่ต้องการ ปักหมุดบ้านคุณ แนบรูปได้ แล้วกดส่ง ทุกคนในหมู่บ้านจะเห็นทันที", Scene: SceneNeed },
  { title: "🤝 ช่วยได้ · 📇 หาช่าง/รถ/คนรับจ้าง", text: "หาช่างไฟ รถยกสูง คนขนของ ดูที่ “บอร์ดติดต่อ” ใต้ปุ่มหลัก กดโทรได้เลย ถ้าคุณรับจ้างได้ กด “ลงชื่อรับงาน” · เปิดคำขอของเพื่อนบ้านแล้วกด “ฉันจะไปช่วย”", Scene: SceneHelp },
  { title: "💧 แจ้งระดับน้ำ", text: "เลือกระดับน้ำเทียบกับร่างกาย จากตาตุ่มถึงอก ถ่ายรูปแนบได้ ยิ่งหลายคนแจ้ง แผนที่ยิ่งแม่น", Scene: SceneWater },
  { title: "🌊 ดูภาพรวมบนแผนที่", text: "สีบนแผนที่เกลี่ยจากรายงานของทุกคน เขียว = แห้ง แดง/ม่วง = ลึก แตะแผนที่ตรงไหนก็ได้เพื่อดูระดับน้ำโดยประมาณ", Scene: SceneMap },
  { title: "📢 ประกาศ และ ☎️ เบอร์ฉุกเฉิน", text: "ประกาศสำคัญจากผู้ดูแลอยู่บนสุดเสมอ เบอร์ รปภ. และสายด่วนอยู่ที่ปุ่มแดงมุมขวาบน อันตรายถึงชีวิตโทร 1669 / 199 ทันที", Scene: SceneAlerts },
];

const SLIDE_MS = 7000;

export default function Guide({ onClose }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const reduced = prefersReducedMotion();
  const startX = useRef(null);
  const last = index === SLIDES.length - 1;

  const go = useCallback(
    (next) => {
      if (next >= SLIDES.length) return onClose();
      setIndex(Math.max(0, next));
      setCycle((c) => c + 1);
    },
    [onClose]
  );

  // Auto-advance like a story (stays put on the last slide, when paused, or with reduced motion)
  useEffect(() => {
    if (paused || reduced || last) return;
    const t = setTimeout(() => go(index + 1), SLIDE_MS);
    return () => clearTimeout(t);
  }, [index, paused, reduced, last, go]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, go, onClose]);

  const { title, text, Scene } = SLIDES[index];

  return (
    <div className="anim-fade fixed inset-0 z-[1300] flex items-end justify-center bg-black/70 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="วิธีใช้งาน">
      <div
        className="anim-sheet flex h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:h-[640px] sm:max-w-md sm:rounded-2xl"
        onPointerDown={(e) => {
          startX.current = e.clientX;
          setPaused(true);
        }}
        onPointerUp={(e) => {
          setPaused(false);
          const dx = startX.current == null ? 0 : e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1)); // swipe
        }}
        onPointerCancel={() => setPaused(false)}
      >
        {/* story progress */}
        <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
          {SLIDES.map((_, i) => (
            <div key={i} className="h-1 flex-1 overflow-hidden rounded bg-neutral-200">
              {i < index && <div className="h-full w-full bg-black" />}
              {i === index && (
                <div
                  key={`${index}-${cycle}`}
                  className={`h-full w-full bg-black ${reduced || last ? "" : "story-fill"}`}
                  style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? "paused" : "running" }}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-4 pt-2">
          <p className="text-sm font-semibold text-neutral-500">วิธีใช้งาน · {index + 1}/{SLIDES.length}</p>
          <button onClick={onClose} className="min-h-[44px] px-2 font-semibold text-neutral-600 underline">
            ข้าม
          </button>
        </div>

        <div key={`${index}-${cycle}`} className="anim-fade flex min-h-0 flex-1 flex-col px-5 pb-2">
          <div className="min-h-0 flex-1 py-3">
            <Scene playing={!paused} cycle={cycle} />
          </div>
          <h2 className="text-2xl font-bold">{title}</h2>
          <p className="mt-2 text-lg leading-relaxed text-neutral-700">{text}</p>
        </div>

        <div className="grid grid-cols-[auto_1fr] gap-2 p-4">
          <button
            onClick={() => go(index - 1)}
            disabled={index === 0}
            aria-label="ย้อนกลับ"
            className="min-h-[52px] min-w-[52px] rounded-xl border-2 border-black text-xl font-bold disabled:opacity-30"
          >
            ‹
          </button>
          <button onClick={() => go(index + 1)} className="min-h-[52px] rounded-xl bg-black text-lg font-bold text-white active:scale-[0.98]">
            {last ? "เริ่มใช้งาน 👍" : "ถัดไป ›"}
          </button>
        </div>
      </div>
    </div>
  );
}
