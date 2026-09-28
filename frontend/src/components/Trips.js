import { useEffect, useRef, useState } from "react";
import { api, load, save } from "../api";
import { MISSIONS, PHASES, VEHICLES, timeAgo } from "../config";

const btn = "min-h-[48px] rounded-xl px-3 font-semibold disabled:opacity-50";
const SEND_EVERY_MS = 25000; // at least this often while the trip is active
const SEND_EVERY_M = 20; // or whenever we moved this far

const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 108000);

// ---------------- staff side: start a trip, share GPS, tap the phase ----------------
export function TripPanel({ user }) {
  const [trip, setTrip] = useState(undefined); // undefined = loading, null = none
  const [vehicle, setVehicle] = useState(() => load("tripVehicle", "boat"));
  const [mission, setMission] = useState("food");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [gps, setGps] = useState({ state: "idle" }); // idle | waiting | ok | denied | error
  const [lastSent, setLastSent] = useState(null);
  const [soi, setSoi] = useState(null);
  const [error, setError] = useState("");
  const lastRef = useRef(null);
  const wakeRef = useRef(null);

  useEffect(() => {
    api("/staff/trips/mine").then((t) => setTrip(t || null)).catch(() => setTrip(null));
  }, []);

  // While a trip is active: watch GPS, keep the screen awake, send positions.
  useEffect(() => {
    if (!trip?.id) return;
    if (!navigator.geolocation) {
      setGps({ state: "error", msg: "เครื่องนี้ไม่มี GPS" });
      return;
    }
    let stopped = false;
    const keepAwake = async () => {
      try {
        if ("wakeLock" in navigator && document.visibilityState === "visible") wakeRef.current = await navigator.wakeLock.request("screen");
      } catch {}
    };
    keepAwake();
    const onVis = () => document.visibilityState === "visible" && keepAwake();
    document.addEventListener("visibilitychange", onVis);

    setGps({ state: "waiting" });
    const send = async (pos, force = false) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const last = lastRef.current;
      if (!force && last && Date.now() - last.at < SEND_EVERY_MS && metres(last, here) < SEND_EVERY_M) return;
      lastRef.current = { ...here, at: Date.now() };
      try {
        const r = await api(`/staff/trips/${trip.id}/ping`, { method: "POST", body: JSON.stringify({ ...here, accuracy: pos.coords.accuracy }) });
        if (!stopped && !r.throttled) {
          setLastSent(new Date());
          setSoi(r.soi);
        }
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    };
    let latest = null;
    const watch = navigator.geolocation.watchPosition(
      (pos) => {
        latest = pos;
        setGps({ state: "ok", accuracy: Math.round(pos.coords.accuracy) });
        send(pos);
      },
      (err) => setGps({ state: err.code === 1 ? "denied" : "error", msg: err.message }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
    );
    // standing still still needs a heartbeat, or the public map hides us after 15 min
    const beat = setInterval(() => latest && send(latest, true), SEND_EVERY_MS * 2);
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      wakeRef.current?.release?.().catch(() => {});
    };
  }, [trip?.id]);

  async function start() {
    setError("");
    try {
      save("tripVehicle", vehicle);
      const t = await api("/staff/trips", {
        method: "POST",
        body: JSON.stringify({ vehicle, mission, label: label.trim() || `${VEHICLES[vehicle][1]} ${user.name}`, note: note.trim() }),
      });
      lastRef.current = null;
      setTrip(t);
    } catch (err) {
      setError(err.message);
    }
  }

  async function phase(p) {
    try {
      setTrip(await api(`/staff/trips/${trip.id}/phase`, { method: "POST", body: JSON.stringify({ phase: p, note: note.trim() || undefined }) }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function end() {
    if (!window.confirm("จบงานและหยุดแชร์ตำแหน่ง?")) return;
    await api(`/staff/trips/${trip.id}/end`, { method: "POST" }).catch(() => {});
    setTrip(null);
    setLastSent(null);
    setSoi(null);
    setGps({ state: "idle" });
  }

  if (trip === undefined) return <p className="p-6 text-center text-neutral-500">กำลังโหลด…</p>;

  if (!trip) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-white p-3 text-sm">
          เริ่มงานแล้ว <b>ชาวบ้านจะเห็นรถ/เรือของคุณบนหน้าแรก</b> ว่ามาทำอะไร อยู่ซอยไหน · ระหว่างออกงานให้เปิดหน้านี้ค้างไว้ (ระบบกันจอดับให้) ถ้าจอดับหรือสลับแอป ตำแหน่งจะหยุดอัปเดต
        </p>
        <fieldset>
          <legend className="mb-1 font-medium">ยานพาหนะ</legend>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(VEHICLES).map(([k, [e, t]]) => (
              <button key={k} type="button" onClick={() => setVehicle(k)} aria-pressed={vehicle === k} className={`${btn} flex flex-col items-center justify-center py-2 text-sm ${vehicle === k ? "bg-black text-white" : "border-2 border-neutral-200 bg-white"}`}>
                <span className="text-2xl">{e}</span>
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 font-medium">ภารกิจ</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(MISSIONS).map(([k, [e, t]]) => (
              <button key={k} type="button" onClick={() => setMission(k)} aria-pressed={mission === k} className={`${btn} text-left ${mission === k ? "bg-black text-white" : "border-2 border-neutral-200 bg-white"}`}>
                {e} {t}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} className="min-h-[48px] rounded-lg border border-neutral-300 px-3" placeholder={`ชื่อที่ชาวบ้านเห็น (เช่น ${VEHICLES[vehicle][1]}ทีม ${user.name})`} />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="min-h-[48px] rounded-lg border border-neutral-300 px-3" placeholder="รายละเอียด เช่น ข้าวกล่อง 80 / รับได้ 6 คน" />
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <button onClick={start} className={`${btn} w-full bg-blue-600 text-lg text-white`}>
          ▶️ เริ่มออกงาน และแชร์ตำแหน่ง
        </button>
      </div>
    );
  }

  const [ve] = VEHICLES[trip.vehicle];
  const [me, mt] = MISSIONS[trip.mission];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow">
        <p className="text-sm text-neutral-500">กำลังออกงาน · เริ่ม {timeAgo(trip.started_at)}</p>
        <p className="text-xl font-bold">
          {ve} {trip.label}
        </p>
        <p>
          {me} {mt} {trip.note && `· ${trip.note}`}
        </p>
        <p className={`mt-2 rounded-lg p-2 text-sm font-semibold ${gps.state === "ok" ? "bg-emerald-50 text-emerald-800" : gps.state === "waiting" ? "bg-yellow-50" : "bg-red-50 text-red-700"}`}>
          {gps.state === "ok" && `📡 GPS ใช้ได้ (แม่นยำ ~${gps.accuracy} ม.)`}
          {gps.state === "waiting" && "📡 กำลังหาสัญญาณ GPS…"}
          {gps.state === "denied" && "⚠️ ไม่ได้อนุญาตตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เว็บนี้ในตั้งค่าเบราว์เซอร์"}
          {gps.state === "error" && `⚠️ GPS มีปัญหา: ${gps.msg || ""}`}
          {lastSent && <span className="block font-normal">ส่งตำแหน่งล่าสุด {timeAgo(lastSent)}{soi ? ` · ใกล้ซอย ${soi}` : " · นอกซอยในหมู่บ้าน"}</span>}
        </p>
      </div>
      <fieldset>
        <legend className="mb-1 font-medium">ตอนนี้กำลัง… (ชาวบ้านเห็นทันที)</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PHASES).map(([k, [e, t, cls]]) => (
            <button key={k} onClick={() => phase(k)} aria-pressed={trip.phase === k} className={`${btn} min-h-[64px] text-left ${trip.phase === k ? `${cls} ring-4 ring-black` : "border-2 border-neutral-300 bg-white"}`}>
              {e} {t}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="min-h-[48px] rounded-lg border border-neutral-300 px-3" placeholder="อัปเดตข้อความ เช่น เหลือข้าว 20 กล่อง" />
        <button onClick={() => phase(trip.phase)} className={`${btn} border-2 border-black bg-white`}>ส่ง</button>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button onClick={end} className={`${btn} w-full bg-red-600 text-white`}>⏹ จบงาน / หยุดแชร์ตำแหน่ง</button>
    </div>
  );
}

// ---------------- public side: what's moving in the village right now ----------------
export function TripsStrip({ trips, onFocus }) {
  if (!trips.length) return null;
  return (
    <section aria-label="กำลังให้บริการตอนนี้" className="rounded-xl border-2 border-blue-600 bg-white p-3">
      <h2 className="mb-2 flex items-center gap-2 font-bold">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-600" />
        </span>
        🚚 กำลังให้บริการตอนนี้ ({trips.length})
      </h2>
      <div className="-mx-3 overflow-x-auto px-3">
        <div className="flex w-max gap-2">
          {trips.map((t) => {
            const [ve] = VEHICLES[t.vehicle] || ["🚗"];
            const [me, mt] = MISSIONS[t.mission] || ["🤝", ""];
            const [pe, pt, pcls] = PHASES[t.phase] || PHASES.enroute;
            return (
              <button key={t.id} onClick={() => onFocus(t)} className="w-64 shrink-0 rounded-xl border border-neutral-200 p-2 text-left active:bg-neutral-50">
                <p className="truncate font-bold">
                  {ve} {t.label}
                </p>
                <p className="truncate text-sm">
                  {me} {mt}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-semibold ${pcls}`}>
                    {pe} {pt}
                  </span>
                  <span className="text-neutral-600">{t.soi ? `อยู่ซอย ${t.soi}` : "นอกซอย/ถนนใหญ่"}</span>
                </p>
                {t.note && <p className="mt-0.5 truncate text-xs text-neutral-600">{t.note}</p>}
                <p className="text-xs text-neutral-400">อัปเดต {timeAgo(t.updated_at)} · แตะดูบนแผนที่</p>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
