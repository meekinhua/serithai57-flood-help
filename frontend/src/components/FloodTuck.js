// 💧 Flood tools (water level, report water / canal / leaks) are tucked away now the water is gone (9 Oct 2026).
// One switch per phone ("floodTools", off by default); the pages show a one-line chip in their place.
// The first time a phone sees it, a short scene plays: the water drains, the sun comes out, the box folds
// into the chip, so people know where the tools went.
import { useEffect, useState } from "react";
import { load, save } from "../api";
import { prefersReducedMotion } from "../motion";

const EV = "flood-tools";

export function useFloodTools() {
  const [on, setOnState] = useState(() => load("floodTools", false));
  useEffect(() => {
    const sync = () => setOnState(load("floodTools", false));
    window.addEventListener(EV, sync);
    return () => window.removeEventListener(EV, sync);
  }, []);
  const setOn = (v) => {
    save("floodTools", v);
    window.dispatchEvent(new Event(EV));
  };
  return [on, setOn];
}

// the "drain" scene: water level falls, drops rise and fade, sun climbs; ~3.6 s, then it folds away
function DryScene({ onDone }) {
  const [phase, setPhase] = useState(0); // 0 water up · 1 draining · 2 dry + words · 3 folding
  useEffect(() => {
    if (prefersReducedMotion()) {
      setPhase(2);
      const t = setTimeout(onDone, 3500);
      return () => clearTimeout(t);
    }
    const ts = [setTimeout(() => setPhase(1), 250), setTimeout(() => setPhase(2), 2000), setTimeout(() => setPhase(3), 4300), setTimeout(onDone, 4900)];
    return () => ts.forEach(clearTimeout);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const level = phase === 0 ? 34 : 112; // the water's top edge (svg y): high → gone
  return (
    <div className={`dry-scene card mt-2 overflow-hidden ${phase === 3 ? "dry-fold" : ""}`} role="status" aria-live="polite">
      <svg viewBox="0 0 320 120" className="block h-[120px] w-full" aria-hidden="true">
        <defs>
          <linearGradient id="dry-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={phase >= 2 ? "#CFE8F7" : "#AFC4D1"} style={{ transition: "stop-color 1.4s" }} />
            <stop offset="1" stopColor="#F2F4F1" />
          </linearGradient>
        </defs>
        <rect width="320" height="120" fill="url(#dry-sky)" />
        {/* sun */}
        <g style={{ transform: `translateY(${phase >= 1 ? 0 : 60}px)`, transition: "transform 1.8s cubic-bezier(.2,.8,.2,1)" }}>
          <circle cx="262" cy="34" r="16" fill="#F5B301" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line
              key={a}
              x1="262"
              y1="34"
              x2={262 + 26 * Math.cos((a * Math.PI) / 180)}
              y2={34 + 26 * Math.sin((a * Math.PI) / 180)}
              stroke="#F5B301"
              strokeWidth="3"
              strokeLinecap="round"
              opacity="0.7"
              className="dry-ray"
            />
          ))}
        </g>
        {/* house */}
        <g fill="#15201A">
          <path d="M96 70 L126 46 L156 70 Z" />
          <rect x="102" y="70" width="48" height="36" />
          <rect x="120" y="84" width="12" height="22" fill="#F2F4F1" />
        </g>
        <rect x="0" y="104" width="320" height="16" fill="#C9B79C" />
        {/* water */}
        <g style={{ transform: `translateY(${level}px)`, transition: "transform 1.7s cubic-bezier(.5,0,.3,1)" }}>
          <path className="dry-wave" d="M0 6 Q20 0 40 6 T80 6 T120 6 T160 6 T200 6 T240 6 T280 6 T320 6 T360 6 T400 6 V140 H0 Z" fill="#3B82C4" opacity="0.75" />
        </g>
        {/* drops that evaporate */}
        {phase === 1 && [40, 70, 190, 220, 300].map((x, i) => <circle key={x} cx={x} cy="96" r="3" fill="#3B82C4" className="dry-drop" style={{ animationDelay: `${i * 0.18}s` }} />)}
      </svg>
      <div className="px-3 py-2.5" style={{ opacity: phase >= 2 ? 1 : 0, transform: `translateY(${phase >= 2 ? 0 : 8}px)`, transition: "all .5s" }}>
        <b className="block text-base">☀️ น้ำแห้งแล้ว</b>
        <span className="block text-sm text-[#45504A]">เครื่องมือน้ำท่วม (ระดับน้ำ แจ้งน้ำ คลอง รูรั่ว) เก็บไว้ตรงนี้ก่อนนะ · กดเปิดได้ทุกเมื่อ</span>
      </div>
    </div>
  );
}

export default function FloodTuck({ on, setOn, className = "" }) {
  const [scene, setScene] = useState(() => !on && !load("floodTuckSeen", false));
  const [hop, setHop] = useState(false);
  if (on)
    return (
      <button onClick={() => setOn(false)} className={`min-h-[40px] text-sm font-bold text-[#45504A] underline ${className}`}>
        ☀️ น้ำแห้งแล้ว · ซ่อนเครื่องมือน้ำท่วม
      </button>
    );
  return (
    <>
      {scene && (
        <DryScene
          onDone={() => {
            save("floodTuckSeen", true);
            setScene(false);
            setHop(true);
          }}
        />
      )}
      <button onClick={() => setOn(true)} className={`card mt-2 flex min-h-[52px] w-full items-center gap-2.5 p-2 pr-3 text-left text-[15px] ${hop ? "anim-hop" : ""} ${className}`}>
        <span className="ic ic-sm bg-[#E3EDF9]" aria-hidden="true">
          💧
        </span>
        <span className="min-w-0 flex-1 truncate">
          <b>เครื่องมือน้ำท่วม</b> · ซ่อนไว้ (น้ำแห้งแล้ว)
        </span>
        <span className="shrink-0 font-bold text-[#1F5FA8]">เปิด ▾</span>
      </button>
    </>
  );
}
