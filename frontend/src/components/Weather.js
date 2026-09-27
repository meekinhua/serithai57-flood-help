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

function rainColor(mm) {
  if (mm >= 10) return "#7e22ce";
  if (mm >= 5) return "#dc2626";
  if (mm >= 2) return "#f59e0b";
  if (mm > 0.2) return "#38bdf8";
  return "#e5e5e5";
}

// Compact "now + next 12 hours" card with animated rain bars.
export function WeatherCard({ weather, onOpenMap }) {
  if (!weather) return null;
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
            ลม{c.wind_dir} {Math.round(c.wind)} กม./ชม. (กระโชก {Math.round(c.gust)}) · ฝน 6 ชม.ข้างหน้า {weather.rain_next_6h} มม.
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
        ปริมาณฝน (มม.) 12 ชม.ข้างหน้า · ข้อมูล Open-Meteo{weather.stale ? " (ข้อมูลเก่า เชื่อมต่อไม่ได้ชั่วคราว)" : ""}
      </p>
    </section>
  );
}
