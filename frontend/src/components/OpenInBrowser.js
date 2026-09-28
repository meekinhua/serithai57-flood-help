import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../motion";

// Links shared to staff arrive in LINE / Messenger chats and open in the chat app's own browser.
// There GPS stops as soon as the chat closes, the screen can't be kept on, and the login stays
// stuck inside that app. This detects it, opens the real browser where the platform allows it,
// and otherwise shows an animated how-to.

export function detectInApp() {
  // ?inapp=line-ios / messenger-android … previews the screens from a normal browser (testing, demos)
  const [fApp, fOs] = (new URLSearchParams(window.location.search).get("inapp") || "").split("-");
  if (fApp) return { app: fApp, os: fOs || "ios" };
  const ua = navigator.userAgent || "";
  const os = /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "other";
  const app = / Line\//i.test(ua)
    ? "line"
    : /Messenger|FB_IAB\/MESSENGER|FBAN\/Messenger/i.test(ua)
      ? "messenger"
      : /FBAN|FBAV|FB_IAB/i.test(ua)
        ? "facebook"
        : /Instagram/i.test(ua)
          ? "instagram"
          : null;
  return { app, os };
}

// LINE opens a URL with this parameter in the phone's default browser by itself.
export function withExternal(url) {
  const u = new URL(url, window.location.origin);
  u.searchParams.set("openExternalBrowser", "1");
  return u.toString();
}

// Android: ask the system to open the page in Chrome (falls back to the normal URL).
function chromeIntent(url) {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

// Try to leave the in-app browser. Returns false when only the user can do it (iPhone Messenger/Facebook).
export function openExternally(url, { app, os }) {
  if (app === "line") {
    window.location.href = withExternal(url);
    return true;
  }
  if (os === "android") {
    window.location.href = chromeIntent(url);
    return true;
  }
  return false;
}

const APPS = {
  line: { name: "LINE", color: "#06C755" },
  messenger: { name: "Messenger", color: "#0866FF" },
  facebook: { name: "Facebook", color: "#0866FF" },
  instagram: { name: "Instagram", color: "#C13584" },
};

// Menu wording differs a little between versions/languages; show the usual Thai + English.
function stepsFor(app, os) {
  const browser = os === "ios" ? "Safari" : "Chrome";
  const dots = os === "ios" && app !== "line" ? "⋯" : "⋮";
  if (app === "line") {
    return {
      dots,
      menu: ["แชร์", "คัดลอกลิงก์", `เปิดในเบราว์เซอร์อื่น`, "รีเฟรช"],
      pick: 2,
      pickHint: "Open in other browser / เปิดในเบราว์เซอร์",
      browser,
    };
  }
  return {
    dots,
    menu: ["คัดลอกลิงก์", os === "ios" ? "เปิดใน Safari" : "เปิดใน Chrome", "รีเฟรช", "รายงานปัญหา"],
    pick: 1,
    pickHint: os === "ios" ? "Open in Safari / เปิดในเบราว์เซอร์ภายนอก" : "Open in Chrome / เปิดในเบราว์เซอร์",
    browser,
  };
}

// Phone mock-up: 0 chat link → 1 tap ⋮ → 2 menu, tap "open in browser" → 3 real browser with GPS
function PhoneDemo({ app, os }) {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = prefersReducedMotion();
  useEffect(() => {
    setStep(0);
    setPaused(false);
  }, [app, os]);
  useEffect(() => {
    if (reduced || paused) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 4), 1900);
    return () => clearInterval(t);
  }, [app, os, reduced, paused]);
  const s = stepsFor(app, os);
  const a = APPS[app] || APPS.line;
  const Finger = ({ className }) => (
    <span className={`g-tap pointer-events-none absolute text-2xl ${className}`} style={{ animationDuration: "1.9s" }} aria-hidden="true">
      👆
    </span>
  );
  return (
    <div>
    <div className="mx-auto w-52 rounded-[2rem] border-[6px] border-neutral-800 bg-neutral-800 shadow-lg" aria-hidden="true">
      <div className="relative h-80 overflow-hidden rounded-[1.5rem] bg-white text-left">
        {/* in-app browser chrome */}
        {step < 3 ? (
          <div className="flex items-center gap-1 px-2 py-2 text-white" style={{ background: a.color }}>
            <span className="text-sm">✕</span>
            <span className="min-w-0 flex-1 truncate text-center text-[11px]">serithai57.com</span>
            <span className={`relative rounded px-1 text-lg leading-none ${step === 1 ? "bg-white/40" : ""}`}>
              {s.dots}
              {step === 1 && <Finger className="-bottom-7 -left-1" />}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1 bg-neutral-100 px-2 py-2">
            <span className="text-xs">🔒</span>
            <span className="min-w-0 flex-1 truncate rounded-full bg-white px-2 text-center text-[11px]">serithai57.com/staff</span>
            <span className="text-[10px] font-bold">{s.browser}</span>
          </div>
        )}
        <div className="p-2">
          {step === 0 && (
            <div className="g-drop-in space-y-2">
              <p className="rounded-lg bg-yellow-100 p-2 text-[11px] font-semibold">⚠️ กำลังเปิดอยู่ใน {a.name}</p>
              <p className="text-[11px] text-neutral-600">GPS จะหยุดทันทีที่ปิดแชต · จอค้างไม่ได้</p>
              <div className="h-16 rounded-lg bg-neutral-100" />
              <div className="h-10 rounded-lg bg-neutral-100" />
            </div>
          )}
          {step === 1 && (
            <div className="space-y-2">
              <p className="g-drop-in rounded-lg bg-black p-2 text-center text-[11px] font-bold text-white">แตะ {s.dots} มุมขวาบน</p>
              <div className="h-16 rounded-lg bg-neutral-100" />
            </div>
          )}
          {step === 2 && (
            <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-2 shadow-[0_-4px_16px_rgba(0,0,0,.25)] g-drop-in">
              {s.menu.map((m, i) => (
                <p key={m} className={`relative my-1 rounded-lg px-2 py-2 text-[12px] ${i === s.pick ? "bg-emerald-100 font-bold ring-2 ring-emerald-500" : ""}`}>
                  {m}
                  {i === s.pick && <Finger className="right-2 top-1" />}
                </p>
              ))}
              <p className="text-center text-[10px] text-neutral-500">{s.pickHint}</p>
            </div>
          )}
          {step === 3 && (
            <div className="g-drop-in space-y-2">
              <p className="rounded-lg bg-emerald-100 p-2 text-[11px] font-semibold text-emerald-900">✅ เปิดใน {s.browser} แล้ว</p>
              <p className="text-[11px]">📡 GPS ทำงานต่อ · 🔆 จอเปิดค้างได้</p>
              <div className="rounded-lg bg-black p-2 text-center text-[11px] font-bold text-white">เริ่มทำงาน</div>
            </div>
          )}
        </div>
      </div>
    </div>
    {/* tap a step to hold it (for slow readers); ▶ to play again */}
    <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
      {["เปิดลิงก์", `แตะ ${s.dots}`, "เลือกเมนู", "เสร็จ"].map((label, i) => (
        <button
          key={label}
          type="button"
          data-step={i}
          onClick={() => {
            setStep(i);
            setPaused(true);
          }}
          aria-pressed={step === i}
          className={`min-h-[36px] rounded-full px-2 text-xs font-semibold ${step === i ? "bg-black text-white" : "bg-neutral-100"}`}
        >
          {i + 1}. {label}
        </button>
      ))}
      {paused && !reduced && (
        <button type="button" onClick={() => setPaused(false)} aria-label="เล่นต่อ" className="min-h-[36px] min-w-[36px] rounded-full bg-neutral-100 text-xs">
          ▶
        </button>
      )}
    </div>
    </div>
  );
}

// The how-to, with a picker so it also works as a manual for any app/phone.
export function BrowserHowTo({ initialApp, initialOs }) {
  const [app, setApp] = useState(initialApp && initialApp !== "instagram" ? (initialApp === "facebook" ? "messenger" : initialApp) : "line");
  const [os, setOs] = useState(initialOs === "android" ? "android" : "ios");
  const s = stepsFor(app, os);
  const pill = (on) => `min-h-[40px] rounded-full px-3 text-sm font-semibold ${on ? "bg-black text-white" : "bg-neutral-100"}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={pill(app === "line")} onClick={() => setApp("line")}>LINE</button>
        <button type="button" className={pill(app === "messenger")} onClick={() => setApp("messenger")}>Messenger / Facebook</button>
      </div>
      <div className="flex justify-center gap-2">
        <button type="button" className={pill(os === "ios")} onClick={() => setOs("ios")}>iPhone</button>
        <button type="button" className={pill(os === "android")} onClick={() => setOs("android")}>Android</button>
      </div>
      <PhoneDemo app={app} os={os} />
      <ol className="list-decimal space-y-1 pl-6 text-left text-sm">
        <li>
          แตะ <b>{s.dots}</b> ที่มุมขวาบนของหน้า
        </li>
        <li>
          เลือก <b>{s.menu[s.pick]}</b> <span className="text-neutral-500">({s.pickHint})</span>
        </li>
        <li>
          หน้าเว็บเปิดใน <b>{s.browser}</b> → ใช้งานต่อได้เลย
        </li>
      </ol>
      <p className="text-center text-xs text-neutral-500">หาเมนูไม่เจอ: กด “คัดลอกลิงก์” แล้วไปวางในแอป {s.browser}</p>
    </div>
  );
}

// Full-screen gate shown on /staff when opened inside a chat app.
export function InAppGate({ env, url, onContinue }) {
  const [copied, setCopied] = useState(false);
  const auto = env.app === "line" || env.os === "android";
  const name = (APPS[env.app] || APPS.line).name;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      window.prompt("คัดลอกลิงก์นี้ แล้วไปวางในเบราว์เซอร์", url);
    }
  };
  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-2xl bg-white p-5 text-center shadow">
      <h2 className="text-xl font-bold">📲 เปิดใน {env.os === "ios" ? "Safari" : "Chrome"} ก่อนนะ</h2>
      <p className="text-sm">
        ตอนนี้เปิดอยู่ใน <b>{name}</b> ซึ่ง <b>GPS จะหยุด</b> เมื่อปิดแชต และต้องใส่ชื่อใหม่ทุกครั้ง
      </p>
      {auto && (
        <button onClick={() => openExternally(url, env)} className="min-h-[52px] w-full rounded-xl bg-blue-600 text-lg font-bold text-white">
          🌐 เปิดใน{env.os === "ios" ? "เบราว์เซอร์" : " Chrome"} เลย
        </button>
      )}
      <BrowserHowTo initialApp={env.app} initialOs={env.os} />
      <button onClick={copy} className="min-h-[48px] w-full rounded-xl border-2 border-black font-semibold">
        {copied ? "✅ คัดลอกแล้ว ไปวางในเบราว์เซอร์" : "📋 คัดลอกลิงก์"}
      </button>
      <button onClick={onContinue} className="text-sm text-neutral-500 underline">
        ใช้ต่อใน {name} (ไม่แนะนำ)
      </button>
    </div>
  );
}
