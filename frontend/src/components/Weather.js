import { useState } from "react";
import { VILLAGE_CENTER } from "../config";

// Windy's free embed: animated wind particles, rain, clouds, thunderstorms. Loaded only on demand (heavy on data).
const WINDY_LAYERS = [
  ["wind", "🌬️ ลม"],
  ["rain", "🌧️ ฝน"],
  ["clouds", "☁️ เมฆ"],
  ["thunder", "⛈️ พายุฟ้าคะนอง"],
];

function windyUrl(overlay, zoom) {
  const [lat, lon] = VILLAGE_CENTER;
  const p = new URLSearchParams({
    type: "map", location: "coordinates", metricRain: "mm", metricTemp: "°C", metricWind: "km/h",
    zoom: String(zoom), overlay, product: "ecmwf", level: "surface", lat: String(lat), lon: String(lon),
    detailLat: String(lat), detailLon: String(lon), marker: "true", message: "true",
  });
  return `https://embed.windy.com/embed.html?${p}`;
}

export function WindyMap() {
  const [overlay, setOverlay] = useState("rain");
  const [zoom, setZoom] = useState(8);
  const [lat, lon] = VILLAGE_CENTER;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {WINDY_LAYERS.map(([key, text]) => (
          <button
            key={key}
            onClick={() => setOverlay(key)}
            aria-pressed={overlay === key}
            className={`min-h-[44px] rounded-lg border-2 border-black px-2 font-semibold ${overlay === key ? "bg-black text-white" : "bg-white"}`}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="flex gap-2 text-sm">
        {[
          [11, "ใกล้ (เขต)"],
          [8, "ภาค"],
          [5, "ภูมิภาค (ดูพายุ)"],
        ].map(([z, t]) => (
          <button key={z} onClick={() => setZoom(z)} aria-pressed={zoom === z} className={`min-h-[40px] flex-1 rounded-lg border px-2 ${zoom === z ? "border-black font-semibold" : "border-neutral-300 text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-300 bg-neutral-100">
        <iframe key={`${overlay}-${zoom}`} title="แผนที่สภาพอากาศ Windy" src={windyUrl(overlay, zoom)} className="block h-[60vh] w-full" allow="fullscreen" />
      </div>
      <p className="text-xs text-neutral-500">
        ภาพเคลื่อนไหวจาก{" "}
        <a className="underline" href={`https://www.windy.com/?${lat},${lon},10`} target="_blank" rel="noreferrer">
          Windy.com
        </a>{" "}
        (โมเดล ECMWF) · แผนที่นี้ใช้อินเทอร์เน็ตค่อนข้างมาก
      </p>
    </div>
  );
}

// Automatic warnings in ONE compact box, so the 🆘 button stays near the top of a phone screen.
// Danger items show their advice; warnings show a one-line title (advice behind "คำแนะนำ").
export function WeatherAlerts({ weather, onOpenMap }) {
  const [open, setOpen] = useState(false);
  const alerts = weather?.alerts || [];
  if (!alerts.length) return null;
  const danger = alerts.some((a) => a.level === "danger");
  return (
    <section
      aria-label="เตือนสภาพอากาศอัตโนมัติ"
      role={danger ? "alert" : "status"}
      className={`rounded-xl border-4 px-3 py-2 shadow-md ${danger ? "announce-flash border-red-800 bg-red-600 text-white" : "border-black bg-yellow-300 text-black"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold tracking-wide sm:text-sm">🌦️ เตือนสภาพอากาศอัตโนมัติ · {danger ? "อันตราย" : "เฝ้าระวัง"}</p>
        <button onClick={onOpenMap} className="min-h-[36px] shrink-0 text-xs font-semibold underline sm:text-sm">
          แผนที่ฝน/ลม ›
        </button>
      </div>
      <ul className="mt-0.5 space-y-1">
        {alerts.map((a) => (
          <li key={a.title} className="flex items-start gap-2">
            <span className="text-xl leading-tight" aria-hidden="true">
              {a.icon}
            </span>
            <div className="min-w-0">
              <p className="font-bold leading-snug sm:text-lg">{a.title}</p>
              {(a.level === "danger" || open) && <p className="text-sm">{a.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
      {alerts.some((a) => a.level !== "danger") && (
        <button onClick={() => setOpen((v) => !v)} className="min-h-[32px] text-xs font-semibold underline">
          {open ? "ซ่อนคำแนะนำ" : "คำแนะนำ"}
        </button>
      )}
    </section>
  );
}

function ageText(minutes) {
  if (minutes == null) return "ก่อนหน้านี้";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  return `${Math.round(minutes / 60)} ชม.ที่แล้ว`;
}

function rainColor(mm) {
  if (mm >= 10) return "#7e22ce";
  if (mm >= 5) return "#dc2626";
  if (mm >= 2) return "#f59e0b";
  if (mm > 0.2) return "#38bdf8";
  return "#e5e5e5";
}

// Compact "now + next 12 hours" card with animated rain bars.
// One-line "now" strip for the sticky header; colour follows the worst active warning.
export function WeatherTopBar({ weather, onOpen }) {
  if (!weather) return null;
  if (!weather.current) {
    return (
      <button onClick={onOpen} className="block w-full border-t border-white/20 bg-neutral-800 text-left text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-2 whitespace-nowrap px-3 py-1 text-sm sm:px-4">
          <span aria-hidden="true">🌦️</span>
          <span className="truncate">ข้อมูลอากาศไม่พร้อมชั่วคราว</span>
          <span className="ml-auto shrink-0 underline">แผนที่ Windy ›</span>
        </div>
      </button>
    );
  }
  const c = weather.current;
  const alerts = weather.alerts || [];
  const level = alerts.some((a) => a.level === "danger") ? "danger" : alerts.length ? "warning" : "ok";
  const tone = {
    danger: "bg-red-600 text-white",
    warning: "bg-yellow-300 text-black",
    ok: "bg-neutral-800 text-white",
  }[level];
  return (
    <button
      onClick={onOpen}
      aria-label={`สภาพอากาศตอนนี้: ${c.text} ${Math.round(c.temp)} องศา${alerts.length ? ` มีคำเตือน ${alerts.length} รายการ` : ""} แตะเพื่อดูแผนที่ลมและฝน`}
      className={`block w-full border-t border-white/20 text-left ${tone}`}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-hidden whitespace-nowrap px-3 py-1 text-sm sm:px-4">
        <span aria-hidden="true">{c.icon}</span>
        <b>{Math.round(c.temp)}°C</b>
        <span className="truncate">{c.text}</span>
        <span className="opacity-60">·</span>
        <span className="shrink-0">💨 {Math.round(c.wind)}{c.gust >= 30 ? `–${Math.round(c.gust)}` : ""} กม./ชม.</span>
        {weather.stale && <span className="shrink-0 rounded bg-black/20 px-1 text-xs">ข้อมูล {ageText(weather.age_minutes)}</span>}
        <span className="hidden opacity-60 min-[400px]:inline">·</span>
        <span className="hidden shrink-0 min-[400px]:inline">☔ 6 ชม. {weather.rain_next_6h} มม.</span>
        {level !== "ok" && <span className="ml-auto shrink-0 rounded bg-black/20 px-1.5 text-xs font-bold">⚠️ {alerts.length}</span>}
        <span className={`${level === "ok" ? "ml-auto" : ""} shrink-0 opacity-70`} aria-hidden="true">
          ›
        </span>
      </div>
    </button>
  );
}

export function WeatherCard({ weather, onOpenMap }) {
  if (!weather) return null;
  if (!weather.current) {
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-xl bg-white p-3" aria-label="สภาพอากาศ">
        <span className="text-3xl" aria-hidden="true">🌦️</span>
        <p className="min-w-0 flex-1 text-sm text-neutral-600">
          ข้อมูลสภาพอากาศไม่พร้อมชั่วคราว ระบบกำลังลองใหม่อัตโนมัติ · ดูภาพฝน/ลมสดได้จากแผนที่ Windy
        </p>
        <button onClick={onOpenMap} className="min-h-[44px] w-full rounded-lg border-2 border-black px-3 text-sm font-semibold active:bg-neutral-100 sm:w-auto">
          🌬️ แผนที่ลม/ฝน/เมฆ
        </button>
      </section>
    );
  }
  const c = weather.current;
  const hours = weather.hours || [];
  const max = Math.max(5, ...hours.map((h) => h.precip));
  return (
    <section className="rounded-xl bg-white p-3" aria-label="สภาพอากาศ">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="g-float text-4xl leading-none" aria-hidden="true">
          {c.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">
            {c.text} · {Math.round(c.temp)}°C
          </p>
          <p className="text-sm text-neutral-600">
            ลม{c.wind_dir} {Math.round(c.wind)} กม./ชม.{c.gust ? ` (กระโชก ${Math.round(c.gust)})` : ""} · ฝน 6 ชม.ข้างหน้า {weather.rain_next_6h} มม.
          </p>
        </div>
        <button onClick={onOpenMap} className="min-h-[44px] w-full rounded-lg border-2 border-black px-3 text-sm font-semibold active:bg-neutral-100 sm:w-auto">
          🌬️ แผนที่ลม/ฝน/เมฆ
        </button>
      </div>
      {hours.length > 0 && (
        <div className="mt-3">
          <div className="flex h-16 items-end gap-1" role="img" aria-label={`ปริมาณฝนรายชั่วโมง ${hours.map((h) => `${h.time.slice(11, 13)} น. ${h.precip} มม.`).join(", ")}`}>
            {hours.map((h, i) => (
              <div key={h.time} className="flex h-full flex-1 flex-col items-center justify-end">
                <span className="text-[10px] leading-none text-neutral-500">{h.precip >= 0.5 ? h.precip.toFixed(h.precip < 10 ? 1 : 0) : ""}</span>
                <div
                  className="bar-grow w-full rounded-t"
                  style={{ height: `${Math.max(4, (h.precip / max) * 100)}%`, background: rainColor(h.precip), animationDelay: `${i * 50}ms` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {hours.map((h, i) => (
              <span key={h.time} className="flex-1 text-center text-[10px] text-neutral-500">
                {i % 2 === 0 ? h.time.slice(11, 13) : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] text-neutral-400">
        ปริมาณฝน (มม.) 12 ชม.ข้างหน้า · ข้อมูล {weather.source === "MET Norway" ? "MET Norway (CC BY 4.0)" : weather.source}
        {weather.stale ? ` · ข้อมูลเมื่อ ${ageText(weather.age_minutes)} ระบบกำลังลองดึงใหม่` : ""}
      </p>
    </section>
  );
}
