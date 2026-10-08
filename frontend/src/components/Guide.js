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
        {[
          [12, 8],
          [90, 8],
          [190, 8],
          [12, 55],
          [90, 55],
          [190, 55],
          [12, 118],
          [90, 118],
          [190, 118],
        ].map(([x, y]) => (
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
        <div className="g-press rounded-xl bg-[#1E6B47] px-5 py-3 text-lg font-bold text-white shadow">🆘 ขอความช่วยเหลือ</div>
        <span className="g-tap absolute -bottom-3 right-2 text-3xl" aria-hidden="true">
          👆
        </span>
      </div>
      <div className="relative">
        <MiniMap>
          <circle className="g-ripple" cx="120" cy="72" r="16" fill="none" stroke="#dc2626" strokeWidth="3" />
          <g className="g-drop">
            <circle cx="120" cy="72" r="15" fill="#000" stroke="#fff" strokeWidth="3" />
            <text x="120" y="78" textAnchor="middle" fontSize="15">
              🚣
            </text>
          </g>
        </MiniMap>
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
        <span className="g-ring inline-block text-6xl" aria-hidden="true">
          ☎️
        </span>
        <div className="space-y-1 text-sm">
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1 font-semibold">🛡️ รปภ. ป้อมหน้า</p>
          <p className="rounded-lg border border-neutral-200 bg-white px-3 py-1 font-semibold text-red-700">🚑 1669 · 🚒 199</p>
        </div>
      </div>
    </div>
  );
}

// A boat that sails along a road on the mini map (SVG SMIL: runs everywhere, no JS timers).
function MovingBoat({ path, dur = "6s" }) {
  return (
    <>
      <path d={path} fill="none" stroke="#2563eb" strokeWidth="3" strokeDasharray="6 6" opacity="0.6" />
      <g>
        <animateMotion dur={dur} repeatCount="indefinite" path={path} />
        <circle r="14" fill="#fff" stroke="#2563eb" strokeWidth="4" />
        <text y="6" textAnchor="middle" fontSize="15">
          🚤
        </text>
      </g>
    </>
  );
}

function usePhaseCycle(playing, n, ms = 1500) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setI((x) => (x + 1) % n), ms);
    return () => clearInterval(t);
  }, [playing, n, ms]);
  return i;
}

const PHASE_STEPS = [
  ["🚀 กำลังไป", "bg-sky-600 text-white"],
  ["📍 ถึงแล้ว / กำลังแจก", "bg-emerald-600 text-white"],
  ["⛔ ของหมดแล้ว", "bg-neutral-500 text-white"],
  ["↩️ กำลังกลับฐาน", "bg-neutral-700 text-white"],
];

function SceneTrips({ playing }) {
  const i = usePhaseCycle(playing, PHASE_STEPS.length, 1600);
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col gap-2">
      <div className="min-h-0 flex-1">
        <MiniMap>
          <MovingBoat path="M20 40 H70 V105 H170 V40 H230" />
        </MiniMap>
      </div>
      <div className="rounded-xl border-2 border-blue-600 bg-white p-2 text-sm shadow">
        <p className="font-bold">🚚 กำลังให้บริการตอนนี้</p>
        <p>🚤 เรือทีมต้น · 🍱 แจกข้าว · อยู่ซอย 24</p>
        <span key={i} className={`anim-pop mt-1 inline-block rounded px-2 py-0.5 text-xs font-semibold ${PHASE_STEPS[i][1]}`}>
          {PHASE_STEPS[i][0]}
        </span>
      </div>
    </div>
  );
}

function SceneBoard() {
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-3">
      <div className="rounded-xl border-2 border-black bg-white p-3 shadow">
        <p className="font-bold">📇 บอร์ดติดต่อ: ช่าง · รถ · รับจ้าง</p>
        <div className="g-float mt-2 flex gap-2 overflow-hidden text-sm">
          {["⚡ ช่างไฟ 2", "🛻 รถยกสูง 3", "💪 ขนของ 4", "🚤 เรือ 1"].map((c) => (
            <span key={c} className="whitespace-nowrap rounded-full border border-black px-3 py-1 font-semibold">
              {c}
            </span>
          ))}
        </div>
      </div>
      <div className="relative rounded-xl border border-neutral-200 bg-white p-3 shadow">
        <p className="font-bold">
          🛻 รถยกสูงพี่ดำ <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">🟢 ว่างรับงาน</span>
        </p>
        <p className="text-sm">💰 300 บาท/เที่ยว · ในหมู่บ้าน</p>
        <div className="g-press mt-2 rounded-xl bg-[#1E6B47] py-2 text-center font-bold text-white">📞 081-xxx-xxxx</div>
        <span className="g-tap absolute bottom-0 right-6 text-3xl" aria-hidden="true">
          👆
        </span>
      </div>
    </div>
  );
}

// ---------- staff scenes ----------
function SceneJoin({ cycle }) {
  return (
    <div key={cycle} className="mx-auto flex h-full max-w-xs flex-col justify-center gap-3">
      <div className="g-drop-in rounded-2xl rounded-bl-sm bg-emerald-100 p-3 text-sm shadow">
        🔗 serithai57.com/staff#invite=…
        <p className="text-xs text-neutral-600">ลิงก์เชิญจากผู้ดูแล (ส่งทางแชตส่วนตัว)</p>
      </div>
      <div className="g-late-1 rounded-xl bg-white p-3 shadow">
        <p className="text-sm font-semibold">ชื่อที่ทีมจะเห็น</p>
        <p className="mt-1 rounded-lg border border-neutral-300 px-2 py-2">
          <span className="g-typing inline-block overflow-hidden whitespace-nowrap align-bottom">ต้น (ทีมเรือ)</span>
        </p>
        <div className="g-late-2 mt-2 rounded-lg bg-[#1E6B47] py-2 text-center font-bold text-white">เริ่มทำงาน</div>
      </div>
    </div>
  );
}

function SceneImport({ cycle }) {
  const bubbles = ["1. 4/224 ข้าว 3 กล่อง", "1. 4/224 … 2. 4/63 …", "1. 4/224 … 2. 4/63 … 3. 4/102", "1. 4/224 … 2. 4/63 … 3. 4/102 … 4. 4/158", "📦 ชุดกันน้ำ ตัวละ 400 (ขายของ)"];
  return (
    <div key={cycle} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-1.5">
      {bubbles.map((b, i) => (
        <div key={b} className={`g-collapse rounded-xl px-3 py-1.5 text-xs shadow ${i === 4 ? "bg-red-50 line-through" : "bg-emerald-50"}`} style={{ animationDelay: `${i * 250}ms` }}>
          {b}
        </div>
      ))}
      <div className="g-late-3 mt-1 rounded-xl border-2 border-black bg-yellow-100 p-3 text-center">
        <p className="text-sm">1,418 ครั้งในแชต →</p>
        <p className="text-2xl font-black">75 หลังจริง</p>
        <p className="text-xs">ตัดซ้ำ · ข้ามโพสต์ขายของ · จัดตามซอย</p>
      </div>
    </div>
  );
}

function SceneClaim({ playing }) {
  const step = usePhaseCycle(playing, 3, 1700);
  const Card = ({ house, soi, state }) => (
    <div className={`rounded-xl border-2 bg-white p-2 text-sm ${state === "mine" ? "border-blue-600" : state === "other" ? "border-neutral-200 opacity-60" : "border-neutral-200"}`}>
      <p className="font-bold">
        {house} <span className="font-normal text-neutral-500">ซ.{soi} · 🍚 5 ที่</span>
      </p>
      {state === "free" && <div className="mt-1 rounded-lg bg-[#1E6B47] py-1.5 text-center font-bold text-white">🙋 รับงานนี้</div>}
      {state === "mine" && (
        <p key="m" className="anim-pop mt-1 font-semibold text-blue-700">
          👷 งานของคุณ
        </p>
      )}
      {state === "other" && (
        <p key="o" className="anim-pop mt-1 font-semibold text-neutral-600">
          🔒 บี รับไปแล้ว — กดซ้ำไม่ได้
        </p>
      )}
    </div>
  );
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col justify-center gap-2">
      <div className="flex items-center justify-between">
        <p className="font-bold">🛣️ ซอย 24 · 3 หลัง</p>
        <span className={`rounded-lg px-2 py-1 text-xs font-bold ${step === 0 ? "g-press bg-blue-600 text-white" : "bg-neutral-200"}`}>รับทั้งซอย</span>
      </div>
      <Card house="4/602" soi="24" state={step >= 1 ? "mine" : "free"} />
      <Card house="4/605" soi="24" state={step >= 2 ? "other" : "free"} />
      <Card house="4/611" soi="24" state="free" />
    </div>
  );
}

function SceneStaffTrip({ playing }) {
  const i = usePhaseCycle(playing, PHASE_STEPS.length, 1500);
  return (
    <div className="mx-auto flex h-full max-w-sm flex-col gap-2">
      <div className="min-h-0 flex-1">
        <MiniMap>
          <MovingBoat path="M230 105 H170 V40 H70 V105 H20" dur="7s" />
        </MiniMap>
      </div>
      <p className="rounded-lg bg-emerald-50 p-1.5 text-center text-xs font-semibold text-emerald-800">📡 GPS ใช้ได้ · ส่งตำแหน่งอัตโนมัติ · จอไม่ดับ</p>
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        {PHASE_STEPS.map(([t, cls], k) => (
          <span key={t} className={`rounded-lg px-2 py-2 text-center font-semibold ${k === i ? `${cls} ring-2 ring-black` : "border border-neutral-300 bg-white"}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function SceneAddress({ cycle }) {
  const dots = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) dots.push([22 + c * 24, 18 + r * 36]);
  return (
    <div key={cycle} className="mx-auto flex h-full max-w-sm flex-col gap-2">
      <div className="min-h-0 flex-1">
        <MiniMap>
          {dots.map(([x, y], k) =>
            k === 20 ? (
              <g key={k}>
                <circle className="g-building-set" cx={x} cy={y} r="6" />
                <g className="g-late-2">
                  <rect x={x - 20} y={y - 30} width="40" height="16" rx="4" fill="#047857" />
                  <text x={x} y={y - 18} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">
                    4/158
                  </text>
                </g>
              </g>
            ) : (
              <circle key={k} cx={x} cy={y} r="5" fill="#cbd5e1" stroke="#475569" strokeWidth="1" />
            ),
          )}
          <text className="g-tap-svg" x={dots[20][0] + 4} y={dots[20][1] + 22} fontSize="22">
            👆
          </text>
        </MiniMap>
      </div>
      <p className="rounded-lg bg-white p-2 text-center text-sm font-semibold shadow">💾 บันทึก: จุดนี้คือบ้าน 4/158 → งานของบ้านนี้ย้ายมาที่นี่</p>
    </div>
  );
}

function SceneDone({ cycle }) {
  return (
    <div key={cycle} className="mx-auto flex h-full max-w-sm flex-col justify-center gap-2">
      <div className="rounded-xl border-2 border-blue-600 bg-white p-3">
        <p className="font-bold">
          4/224 <span className="font-normal text-neutral-500">ซ.11 · 🍚 3 ที่ · 👵</span>
        </p>
        <p className="font-semibold text-blue-700">👷 งานของคุณ</p>
        <div className="g-press mt-2 rounded-lg bg-emerald-600 py-2 text-center font-bold text-white">✅ เสร็จแล้ว</div>
        <p className="mt-2 rounded-lg border border-neutral-300 px-2 py-2 text-sm">
          <span className="g-typing g-typing-late inline-block overflow-hidden whitespace-nowrap align-bottom">ส่งข้าว 3 กล่อง น้ำ 1 แพ็ค</span>
        </p>
        <p className="g-late-3 mt-2 font-bold text-emerald-700">✅ เสร็จแล้ว โดย ต้น · ชาวบ้านเห็นสถานะทันที</p>
      </div>
      <p className="text-center text-xs text-neutral-600">📋 คัดลอก “งานของฉัน” ส่งเข้ามือถือ/แชตทีมได้</p>
    </div>
  );
}

export const USER_SLIDES = [
  {
    title: "🆘 ต้องการความช่วยเหลือ",
    text: "กดปุ่มดำ ถ้าด่วน (ผู้ป่วย ผู้สูงอายุ เด็กเล็ก) กดปุ่ม “ด่วนมาก” ด้านบนฟอร์ม เลือกเรื่อง ลากหมุดไปที่บ้าน แล้วกดส่ง",
    Scene: SceneNeed,
  },
  {
    title: "🚚 ดูรถ/เรือที่กำลังมา",
    text: "เจ้าหน้าที่ออกงานเมื่อไหร่ จะเห็นทันทีว่า “เรือแจกข้าว อยู่ซอยไหน กำลังแจกหรือของหมดแล้ว” แตะเพื่อดูบนแผนที่",
    Scene: SceneTrips,
  },
  {
    title: "📇 หาช่าง · รถ · คนรับจ้าง",
    text: "เลื่อนลงล่างสุดของหน้าแรก มี “บอร์ดติดต่อ” กดโทรได้เลย ถ้าคุณรับจ้างได้ กด “ลงชื่อรับงาน” · เห็นคำขอของเพื่อนบ้าน กด “ฉันจะไปช่วย”",
    Scene: SceneBoard,
  },
  { title: "💧 แจ้งระดับน้ำ", text: "เลือกระดับเทียบกับร่างกาย หรือใส่เป็นเซนติเมตร บอกว่าน้ำขึ้นหรือลด ถ่ายรูปแนบได้", Scene: SceneWater },
  {
    title: "🌊 ดูภาพรวมบนแผนที่",
    text: "กดปุ่ม “💧 ระดับน้ำ” บนแผนที่ สีเกลี่ยจากรายงานของทุกคน เขียว = แห้ง แดง/ม่วง = ลึก แตะตรงไหนก็ได้ หรือกด “📍 น้ำตรงที่ฉันอยู่” เพื่อดูระดับน้ำ",
    Scene: SceneMap,
  },
  {
    title: "📢 ประกาศ และ ☎️ เบอร์ฉุกเฉิน",
    text: "ประกาศและเตือนสภาพอากาศอยู่บนสุด เบอร์ รปภ. และสายด่วนอยู่ที่ปุ่มแดง อันตรายถึงชีวิตโทร 1669 / 199 ทันที",
    Scene: SceneAlerts,
  },
  {
    title: "🗺️ โซน A–I · จุดลงของ",
    text: "ปุ่มเหลือง “แผนที่โซน” บนหน้าแรก: หมู่บ้านแบ่ง 9 โซนตามถนนหลัก แต่ละโซนมีจุดลงของ 🚚 ริมถนนหลักให้รถใหญ่จอด (เข้าซอยเล็กไม่ได้) · มีแผ่นพิมพ์แยกโซน",
    Scene: SceneMap,
  },
];

export const STAFF_SLIDES = [
  { title: "👷 เข้าร่วมทีม", text: "สแกน QR หรือเปิดลิงก์เชิญ ใส่ชื่อ (และหน่วยที่มา) ใช้งานได้ทันที ไม่ต้องจำรหัสผ่าน · ชวนเพื่อนต่อได้ที่แท็บ “👥 ชวนทีม”", Scene: SceneJoin },
  {
    title: "📍 ชาวบ้านเห็นคุณบนแผนที่",
    text: "เปิดหน้านี้ไว้ = ขึ้นเป็น 👷 ทีมช่วยเหลือ/อาสาบนหน้าแรก กด “✏️ บอกชาวบ้านว่ากำลังจะทำอะไร” ชาวบ้านแตะหมุดคุณแล้วเห็นข้อความ + งานที่รับไว้ · หยุดแชร์ได้ตลอด",
    Scene: SceneStaffTrip,
  },
  {
    title: "📥 งานจาก LINE เข้ามาเอง",
    text: "ส่วนกลางนำเข้าแชต LINE ให้ ไม่ต้องทำเอง ระบบตัดรายการที่ก๊อปซ้ำ ข้ามโพสต์ขายของ จัดตามซอย แล้วขึ้นในแท็บ “งาน” พร้อมป้าย “จาก LINE”",
    Scene: SceneImport,
  },
  {
    title: "📋 แบ่งงานตามซอย ไม่ซ้ำกัน",
    text: "กด “รับงานนี้” หรือ “รับทั้งซอย” งานที่คนอื่นรับแล้วจะล็อก กดซ้ำไม่ได้ ไม่มีสองทีมไปบ้านเดียวกัน",
    Scene: SceneClaim,
  },
  {
    title: "🚤 ออกงาน + แชร์ตำแหน่ง",
    text: "ออกไปแจกของ/รับคน: แท็บ “ออกงาน” เลือกเรือ/รถ และภารกิจ หมุดของคุณเปลี่ยนเป็นรถ/เรือ กดบอกสถานะ: กำลังไป → กำลังแจก → ของหมด → กลับฐาน",
    Scene: SceneStaffTrip,
  },
  {
    title: "🏠 ถึงบ้านแล้ว ตั้งตำแหน่ง",
    text: "งานที่ขึ้น “≈ ซอย” ยังไม่รู้ตำแหน่งบ้านจริง พอไปถึง กด “ตั้งตำแหน่งบ้าน” แล้วแตะอาคารบนแผนที่ ครั้งต่อไปทุกคนหาเจอทันที",
    Scene: SceneAddress,
  },
  {
    title: "✅ เสร็จแล้วกดปิดงาน",
    text: "กด “เสร็จแล้ว” พิมพ์สั้น ๆ ว่าให้อะไรไป งานจะหายจากรายการ และถ้าแชตยังก๊อปบ้านนี้ต่อ ระบบจะไม่สร้างงานซ้ำใน 24 ชม.",
    Scene: SceneDone,
  },
];

const SLIDE_MS = 7000;

export default function Guide({ onClose, slides = USER_SLIDES, heading = "วิธีใช้งาน" }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [cycle, setCycle] = useState(0);
  const reduced = prefersReducedMotion();
  const startX = useRef(null);
  const last = index === slides.length - 1;

  const go = useCallback(
    (next) => {
      if (next >= slides.length) return onClose();
      setIndex(Math.max(0, next));
      setCycle((c) => c + 1);
    },
    [onClose, slides.length],
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

  const { title, text, Scene } = slides[index];

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
          {slides.map((_, i) => (
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
          <p className="text-sm font-semibold text-neutral-500">
            {heading} · {index + 1}/{slides.length}
          </p>
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
          <button onClick={() => go(index + 1)} className="min-h-[52px] rounded-xl bg-[#1E6B47] text-lg font-bold text-white active:scale-[0.98]">
            {last ? "เริ่มใช้งาน 👍" : "ถัดไป ›"}
          </button>
        </div>
      </div>
    </div>
  );
}
