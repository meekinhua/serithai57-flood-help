// 📲 "ติดตั้งบ้านฉันไว้หน้าจอ": why it's worth it first, then the steps for THIS phone (8 Oct 2026).
// Android Chrome: one tap (the browser's own prompt). iPhone: Share → Add to Home Screen, drawn step by step.
// Inside LINE / Facebook: get to the real browser first (LINE does it by itself with openExternalBrowser=1).
import { useEffect, useState } from "react";
import { api, load, save } from "../api";
import { notify } from "../notify";
import { detectInApp, openExternally } from "./OpenInBrowser";

let deferred = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    window.dispatchEvent(new Event("install:ready"));
  });
  window.addEventListener("appinstalled", () => {
    save("installed", Date.now());
    notify("📲 ติดตั้งแล้ว · เปิดจากไอคอน “บ้านฉัน” บนหน้าจอได้เลย");
    window.dispatchEvent(new Event("install:done"));
  });
}

export const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

// other parts of the app nudge at the right moment ("ติดตั้งไว้ จะรู้ทันทีเมื่อมีคนเห็นน้อง")
export function nudgeInstall(why) {
  window.dispatchEvent(new CustomEvent("install:nudge", { detail: why }));
}

const S = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
const ShareIcon = () => (
  <svg {...S}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);
const PlusIcon = () => (
  <svg {...S}>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const Dots = () => (
  <svg {...S}>
    <circle cx="12" cy="5" r="1.3" />
    <circle cx="12" cy="12" r="1.3" />
    <circle cx="12" cy="19" r="1.3" />
  </svg>
);

function Steps({ items }) {
  return (
    <ol className="space-y-2">
      {items.map(([icon, text], i) => (
        <li key={i} className="flex items-center gap-3 rounded-xl bg-[#F7F8F6] p-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#15201A] text-sm font-bold text-white">{i + 1}</span>
          <span className="min-w-0 flex-1 text-[15px] leading-snug">{text}</span>
          {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#D5DBD6] bg-white text-[#1F5FA8]">{icon}</span>}
        </li>
      ))}
    </ol>
  );
}

function howTo(env, canPrompt) {
  const { app, os } = env;
  if (app) {
    const name = { line: "LINE", facebook: "Facebook", messenger: "Messenger", instagram: "Instagram" }[app] || app;
    return {
      kind: "inapp",
      note: `ตอนนี้เปิดอยู่ใน ${name} · ต้องเปิดใน${os === "ios" ? " Safari" : " Chrome"} ก่อนถึงจะติดตั้งได้`,
      steps: [
        [<Dots key="d" />, `กดปุ่ม ⋯ หรือ ⋮ มุมขวาบนของ ${name}`],
        [null, `เลือก “เปิดใน${os === "ios" ? " Safari" : "เบราว์เซอร์"}”`],
        [null, "แล้วกดติดตั้งที่การ์ดนี้อีกครั้ง"],
      ],
    };
  }
  if (os === "ios")
    return {
      kind: "ios",
      steps: [
        [<ShareIcon key="s" />, "กดปุ่มแชร์ ด้านล่างจอ (สี่เหลี่ยมมีลูกศรชี้ขึ้น)"],
        [<PlusIcon key="p" />, "เลื่อนลง เลือก “เพิ่มไปยังหน้าจอโฮม”"],
        [null, "กด “เพิ่ม” มุมขวาบน · ไอคอนบ้านฉันจะอยู่บนหน้าจอ"],
      ],
    };
  if (canPrompt) return { kind: "prompt" };
  return {
    kind: "android",
    steps: [
      [<Dots key="d" />, "กดปุ่ม ⋮ มุมขวาบนของ Chrome"],
      [<PlusIcon key="p" />, "เลือก “ติดตั้งแอป” หรือ “เพิ่มลงในหน้าจอหลัก”"],
      [null, "กด “ติดตั้ง” · ไอคอนบ้านฉันจะอยู่บนหน้าจอ"],
    ],
  };
}

export default function InstallApp({ inSheet = false, why: whyProp = "" }) {
  const [env] = useState(() => {
    const e = detectInApp();
    // iPadOS asks for the desktop site and says "Macintosh": a Mac with a touch screen is an iPad
    if (e.os === "other" && /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return { ...e, os: "ios" };
    return e;
  });
  const [, force] = useState(0);
  const [open, setOpen] = useState(inSheet || Date.now() - load("installLater", 0) > 7 * 864e5);
  const [steps, setSteps] = useState(inSheet);
  const [why, setWhy] = useState(whyProp);
  const [houses, setHouses] = useState(0);
  useEffect(() => {
    const re = () => force((n) => n + 1);
    const nudge = (e) => {
      setWhy(e.detail || "");
      setOpen(true);
    };
    window.addEventListener("install:ready", re);
    window.addEventListener("install:done", re);
    window.addEventListener("install:nudge", nudge);
    api("/push/count")
      .then((r) => setHouses(r.houses || 0))
      .catch(() => {});
    return () => {
      window.removeEventListener("install:ready", re);
      window.removeEventListener("install:done", re);
      window.removeEventListener("install:nudge", nudge);
    };
  }, []);
  if (isStandalone() || (env.os === "other" && !env.app && !deferred)) return null; // already an app, or a computer
  const how = howTo(env, !!deferred);

  async function install() {
    if (how.kind === "prompt" && deferred) {
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => null);
      deferred = null;
      if (r?.outcome !== "accepted") setSteps(true);
      return force((n) => n + 1);
    }
    if (how.kind === "inapp" && openExternally(window.location.href, env)) return;
    setSteps(true);
  }
  const later = () => {
    save("installLater", Date.now());
    setOpen(false);
    setSteps(false);
  };

  if (!open)
    return (
      <button id={inSheet ? undefined : "myhome-install"} onClick={() => setOpen(true)} className="card mt-2 flex min-h-[56px] w-full items-center gap-2.5 p-2 pr-3 text-left text-[15px]">
        <span className="ic ic-sm ic-green" aria-hidden="true">
          📲
        </span>
        <span className="min-w-0 flex-1 truncate">
          <b>ติดตั้งบ้านฉันไว้หน้าจอ</b> · เด้งเตือนของหาย รถขยะ
        </span>
        <span className="shrink-0 font-bold text-[#1E6B47]">ดู ▾</span>
      </button>
    );

  return (
    <div id={inSheet ? undefined : "myhome-install"} className={inSheet ? "rounded-2xl border border-[#E3E7E2] p-3" : "card anim-in mt-2 p-3"}>
      <div className="flex items-start gap-2.5">
        <span className="ic ic-green" aria-hidden="true">
          📲
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-base leading-snug">ติดตั้ง “บ้านฉัน” ไว้หน้าจอมือถือ</b>
          <span className="block text-sm text-[#45504A]">ฟรี ไม่ต้องโหลดจาก App Store · ไม่กินเครื่อง</span>
        </div>
      </div>
      {why && <p className="anim-in mt-2 rounded-xl bg-[#E4F0E9] p-2.5 text-[15px] font-bold text-[#154D33]">{why}</p>}
      <ul className="mt-2.5 space-y-1.5 text-[15px] leading-snug">
        <li className="flex gap-2">
          <span aria-hidden="true">🔎</span>
          <span>ของหาย·เจอ มือถือเด้งเตือนพร้อมรูป · หมาแมวทั้งหมู่บ้าน · กระเป๋าตัง มือถือ กุญแจ ในซอยคุณ</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">🚛</span>
          <span>เตือนคืนก่อนรถขยะเข้าซอยคุณ</span>
        </li>
        <li className="flex gap-2">
          <span aria-hidden="true">👆</span>
          <span>เปิดจากไอคอนได้เลย ไม่ต้องหาลิงก์ในแชท LINE</span>
        </li>
      </ul>
      {houses >= 5 && <p className="mt-2 text-sm font-bold text-[#1E6B47]">เพื่อนบ้าน {houses} หลังเปิดรับเตือนแล้ว</p>}

      {steps && how.steps ? (
        <div className="anim-in mt-3 space-y-2">
          {how.note && <p className="text-sm font-bold text-[#7A4104]">{how.note}</p>}
          <Steps items={how.steps} />
          {env.os === "ios" && !env.app && <p className="text-sm text-[#45504A]">ถ้าไม่เห็นปุ่มแชร์ เลื่อนหน้าขึ้นเล็กน้อยให้แถบด้านล่างโผล่</p>}
        </div>
      ) : (
        <button onClick={install} className="mt-3 min-h-[54px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white">
          {how.kind === "prompt" ? "📲 ติดตั้งเลย" : how.kind === "inapp" ? "เปิดในเบราว์เซอร์ แล้วติดตั้ง" : "📲 ดูวิธีติดตั้ง (3 ขั้น)"}
        </button>
      )}
      {!inSheet && (
        <button onClick={later} className="mt-1 min-h-[44px] w-full text-sm text-[#45504A] underline">
          {steps ? "ทำแล้ว / ไว้ทีหลัง" : "ไว้ทีหลัง"}
        </button>
      )}
    </div>
  );
}
