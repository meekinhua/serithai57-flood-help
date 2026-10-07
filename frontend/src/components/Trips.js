import { useEffect, useRef, useState } from "react";
import { api, load, save } from "../api";
import { MISSIONS, PHASES, VEHICLES, timeAgo } from "../config";
import noSleepMedia from "nosleep.js/src/media";

const btn = "min-h-[48px] rounded-xl px-3 font-semibold disabled:opacity-50";
const SEND_EVERY_MS = 25000; // at least this often
const SEND_EVERY_M = 20; // or whenever we moved this far

// Fallback for browsers without the Wake Lock API (many LINE / Messenger in-app browsers):
// a muted, inline, looping 1-second video keeps the screen from sleeping. Needs a tap to start.
let noSleepVideo = null;
function playNoSleepVideo() {
  if (!noSleepVideo) {
    noSleepVideo = document.createElement("video");
    noSleepVideo.setAttribute("playsinline", "");
    noSleepVideo.setAttribute("muted", "");
    noSleepVideo.muted = true;
    noSleepVideo.loop = true;
    for (const type of ["webm", "mp4"]) {
      const src = document.createElement("source");
      src.src = noSleepMedia[type];
      src.type = `video/${type}`;
      noSleepVideo.appendChild(src);
    }
  }
  return noSleepVideo.play();
}

const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 108000);

// ---------------- staff side: one GPS watcher for the whole /staff console ----------------
// Anyone with /staff open shows up on the public map ("online"); on a trip the same position
// moves their boat/truck instead. Lives in StaffApp so switching tabs doesn't stop it.
export function useStaffLocation(user, onTrip) {
  const [sharing, setSharingState] = useState(() => load("shareLocation", true));
  const [gps, setGps] = useState({ state: "idle" }); // idle | waiting | ok | denied | error | off
  const [lastSent, setLastSent] = useState(null);
  const [where, setWhere] = useState(null); // last reply: { soi, km, far }
  const [error, setError] = useState("");
  const [awake, setAwake] = useState("off"); // on | off (waiting for a tap) | denied (tried, this browser can't)
  const lastRef = useRef(null);
  const active = !!user && (sharing || onTrip); // a trip always shares

  const setSharing = (on) => {
    save("shareLocation", on);
    setSharingState(on);
    if (!on && !onTrip) api("/staff/presence", { method: "DELETE" }).catch(() => {});
  };

  useEffect(() => {
    if (!active) {
      setGps({ state: user ? "off" : "idle" });
      return;
    }
    if (!navigator.geolocation) {
      setGps({ state: "error", msg: "เครื่องนี้ไม่มี GPS" });
      return;
    }
    let stopped = false;
    let wake = null;
    // A web page gets no GPS while the screen is off or the browser is in the background, so while
    // sharing keep the screen on. Some browsers only grant it after a tap: retry on the next touch.
    let video = false;
    const keepAwake = async (tapped = false) => {
      if (document.visibilityState !== "visible" || (wake && !wake.released) || (video && !noSleepVideo?.paused)) return;
      if ("wakeLock" in navigator) {
        try {
          wake = await navigator.wakeLock.request("screen");
          setAwake("on");
          wake.addEventListener("release", () => !stopped && setAwake("off"));
          return;
        } catch {} // in-app browsers often have the API but refuse: try the video
      }
      try {
        await playNoSleepVideo();
        video = true;
        setAwake("on");
      } catch {
        // autoplay needs a tap; only a failure after a real tap means this browser can't do it
        setAwake(tapped ? "denied" : "off");
      }
    };
    keepAwake();
    const onTouch = () => keepAwake(true);
    document.addEventListener("pointerdown", onTouch);
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      keepAwake();
      // back from a locked screen: report where we are now instead of waiting for the next fix
      navigator.geolocation.getCurrentPosition(
        (pos) => send(pos, true),
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
      );
    };
    document.addEventListener("visibilitychange", onVis);

    setGps({ state: "waiting" });
    const send = async (pos, force = false) => {
      const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const last = lastRef.current;
      if (!force && last && Date.now() - last.at < SEND_EVERY_MS && metres(last, here) < SEND_EVERY_M) return;
      lastRef.current = { ...here, at: Date.now() };
      try {
        const r = await api("/staff/presence", { method: "POST", body: JSON.stringify({ ...here, accuracy: pos.coords.accuracy }) });
        if (!stopped && !r.throttled) {
          setLastSent(new Date());
          setWhere(r);
          setError("");
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
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    // standing still still needs a heartbeat, or the public map drops us
    const beat = setInterval(() => latest && send(latest, true), SEND_EVERY_MS * 2);
    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watch);
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("pointerdown", onTouch);
      wake?.release?.().catch(() => {});
      if (video) noSleepVideo?.pause();
      setAwake("off");
    };
  }, [active, user]);

  return { gps, lastSent, where, error, sharing, setSharing, awake };
}

function GpsLine({ live }) {
  const { gps, lastSent, where, error } = live;
  const tone = gps.state === "ok" ? "bg-emerald-50 text-emerald-800" : gps.state === "waiting" ? "bg-yellow-50" : gps.state === "off" ? "bg-neutral-100 text-neutral-600" : "bg-red-50 text-red-700";
  return (
    <div className={`rounded-lg p-2 text-sm font-semibold ${tone}`}>
      {gps.state === "ok" && `📡 GPS ใช้ได้ (แม่นยำ ~${gps.accuracy} ม.)`}
      {gps.state === "waiting" && "📡 กำลังหาสัญญาณ GPS… (ถ้ามือถือถาม ให้กด “อนุญาต”)"}
      {gps.state === "off" && "⏸ ปิดแชร์ตำแหน่งอยู่ ชาวบ้านไม่เห็นคุณบนแผนที่"}
      {gps.state === "denied" && "⚠️ ไม่ได้อนุญาตตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เว็บนี้ในตั้งค่าเบราว์เซอร์ แล้วรีเฟรช"}
      {gps.state === "error" && `⚠️ GPS มีปัญหา: ${gps.msg || ""}`}
      {lastSent && (
        <span className="block font-normal">
          ส่งตำแหน่งล่าสุด {timeAgo(lastSent)}
          {where?.soi ? ` · ใกล้ซอย ${where.soi}` : where?.km > 3 ? ` · ห่างหมู่บ้าน ${where.km} กม.` : " · นอกซอยในหมู่บ้าน"}
        </span>
      )}
      {gps.accuracy > 500 && <span className="block">⚠️ ตำแหน่งยังหยาบ (~{gps.accuracy} ม.) เปิด GPS/ตำแหน่งแม่นยำสูงในมือถือ หรือออกไปที่โล่ง</span>}
      {where?.far && <span className="block">⚠️ ตอนนี้อยู่ห่างหมู่บ้าน {where.km} กม. ชาวบ้านจะเห็นแค่ชื่อ ยังไม่ขึ้นบนแผนที่</span>}
      {error && <span className="block text-red-700">ส่งตำแหน่งไม่สำเร็จ: {error}</span>}
    </div>
  );
}

// Always-visible bar on /staff: am I on the map, and what am I about to do (residents see this).
export function DutyBar({ live, onTrip }) {
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState("");
  const [open, setOpen] = useState(false);
  const [vehicle, setVehicle] = useState(() => load("tripVehicle", "walk"));
  useEffect(() => {
    api("/staff/presence/note")
      .then((r) => {
        setNote(r.note || "");
        setSaved(r.note || "");
        if (r.vehicle) setVehicle(r.vehicle);
      })
      .catch(() => {});
  }, []);
  async function pickVehicle(v) {
    setVehicle(v);
    save("tripVehicle", v); // also the default when starting a trip
    await api("/staff/presence/note", { method: "PUT", body: JSON.stringify({ vehicle: v }) }).catch(() => {});
  }
  async function saveNote(e) {
    e.preventDefault();
    const r = await api("/staff/presence/note", { method: "PUT", body: JSON.stringify({ note }) }).catch(() => null);
    if (r) {
      setSaved(r.note);
      setOpen(false);
    }
  }
  const on = live.sharing || onTrip;
  return (
    <section className="mb-3 rounded-xl bg-white p-3 shadow">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 shrink-0 rounded-full ${on && live.gps.state === "ok" ? "bg-emerald-500" : on ? "bg-yellow-400" : "bg-neutral-400"}`} />
        <p className="min-w-0 flex-1 text-sm">
          {onTrip ? <b>กำลังออกงาน · ชาวบ้านเห็นรถ/เรือของคุณ</b> : on ? <b>คุณอยู่บนแผนที่หน้าแรก (ทีมช่วยเหลือ/อาสา)</b> : <b>ไม่แชร์ตำแหน่ง</b>}
          <span className="block truncate text-neutral-600">{saved ? `บอกชาวบ้านว่า: ${saved}` : "ยังไม่ได้บอกว่ากำลังจะทำอะไร"}</span>
        </p>
        {!onTrip && (
          <button onClick={() => live.setSharing(!live.sharing)} className="min-h-[44px] shrink-0 rounded-lg border-2 border-neutral-300 px-2 text-sm font-semibold">
            {live.sharing ? "⏸ หยุดแชร์" : "▶️ แชร์"}
          </button>
        )}
      </div>
      {!onTrip && (
        <div className="-mx-1 mt-2 overflow-x-auto px-1">
          <div className="flex w-max gap-1" role="group" aria-label="ไอคอนของคุณบนแผนที่">
            {Object.entries(VEHICLES).map(([k, [e, t]]) => (
              <button
                key={k}
                type="button"
                onClick={() => pickVehicle(k)}
                aria-pressed={vehicle === k}
                title={t}
                className={`flex min-h-[44px] items-center gap-1 rounded-full px-3 text-sm font-semibold ${vehicle === k ? "bg-emerald-600 text-white" : "bg-neutral-100"}`}
              >
                <span className="text-lg">{k === "walk" ? "👷" : e}</span>
                {t.split(" /")[0]}
              </button>
            ))}
          </div>
        </div>
      )}
      {open ? (
        <form onSubmit={saveNote} className="mt-2 grid grid-cols-[1fr_auto] gap-2">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-3"
            placeholder="เช่น กำลังจะไปแจกข้าวซอย 30 / รับคนป่วยซอย 12"
          />
          <button className="min-h-[44px] rounded-lg bg-black px-3 font-semibold text-white">บันทึก</button>
        </form>
      ) : (
        <button onClick={() => setOpen(true)} className="mt-2 min-h-[44px] w-full rounded-lg bg-neutral-100 text-sm font-semibold">
          ✏️ {saved ? "แก้ข้อความ" : "บอกชาวบ้านว่ากำลังจะทำอะไร"}
        </button>
      )}
      {on && live.awake === "on" && <p className="mt-2 text-xs text-neutral-600">🔆 ระบบเปิดจอค้างไว้ให้ GPS ทำงานต่อ · อย่ากดปิดจอ/สลับแอปนาน · ต่อที่ชาร์จหรือพาวเวอร์แบงก์ถ้าทำได้</p>}
      {on && live.awake !== "on" && (
        <p className="mt-2 rounded-lg bg-yellow-50 p-2 text-xs">
          ⚠️ {live.awake === "denied" ? "เบราว์เซอร์นี้สั่งให้จอเปิดค้างไม่ได้" : "แตะหน้าจอ 1 ครั้ง เพื่อให้จอเปิดค้าง"} — ถ้าจอดับ ตำแหน่งจะหยุดส่ง
          <br />
          ตั้งค่ามือถือ: iPhone → การแสดงผลและความสว่าง → ล็อกอัตโนมัติ = <b>ไม่เลย</b> · Android → จอแสดงผล → ระยะหมดเวลาหน้าจอ = <b>นานสุด</b>
        </p>
      )}
      {on && live.gps.state !== "ok" && (
        <div className="mt-2">
          <GpsLine live={live} />
        </div>
      )}
    </section>
  );
}

// ---------------- staff side: start a trip, tap the phase ----------------
export function TripPanel({ user, live, trip, setTrip }) {
  const [vehicle, setVehicle] = useState(() => load("tripVehicle", "boat"));
  const [mission, setMission] = useState("food");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function start() {
    setError("");
    try {
      save("tripVehicle", vehicle);
      const t = await api("/staff/trips", {
        method: "POST",
        body: JSON.stringify({ vehicle, mission, label: label.trim() || `${VEHICLES[vehicle][1]} ${user.name}`, note: note.trim() }),
      });
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
    if (!window.confirm("จบงาน? (ยังแชร์ตำแหน่งแบบทีมช่วยเหลือ/อาสาต่อ ถ้าเปิดแชร์ไว้)")) return;
    await api(`/staff/trips/${trip.id}/end`, { method: "POST" }).catch(() => {});
    setTrip(null);
  }

  if (trip === undefined) return <p className="p-6 text-center text-neutral-500">กำลังโหลด…</p>;

  if (!trip) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-white p-3 text-sm">
          ออกไปแจกของ/รับคน กด <b>เริ่มออกงาน</b> ชาวบ้านจะเห็นรถ/เรือของคุณบนหน้าแรก ว่ามาทำอะไร อยู่ซอยไหน · ระหว่างออกงานให้เปิดหน้านี้ค้างไว้ (ระบบกันจอดับให้)
        </p>
        <fieldset>
          <legend className="mb-1 font-medium">ยานพาหนะ</legend>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(VEHICLES).map(([k, [e, t]]) => (
              <button
                key={k}
                type="button"
                onClick={() => setVehicle(k)}
                aria-pressed={vehicle === k}
                className={`${btn} flex flex-col items-center justify-center py-2 text-sm ${vehicle === k ? "bg-black text-white" : "border-2 border-neutral-200 bg-white"}`}
              >
                <span className="text-2xl">{e}</span>
                {t}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 font-medium">ภารกิจ</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(MISSIONS)
              .filter(([k]) => k !== "standby")
              .map(([k, [e, t]]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setMission(k)}
                  aria-pressed={mission === k}
                  className={`${btn} text-left ${mission === k ? "bg-black text-white" : "border-2 border-neutral-200 bg-white"}`}
                >
                  {e} {t}
                </button>
              ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            className="min-h-[48px] rounded-lg border border-neutral-300 px-3"
            placeholder={`ชื่อที่ชาวบ้านเห็น (เช่น ${VEHICLES[vehicle][1]}ทีม ${user.name})`}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="min-h-[48px] rounded-lg border border-neutral-300 px-3"
            placeholder="รายละเอียด เช่น ข้าวกล่อง 80 / รับได้ 6 คน"
          />
        </div>
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <button onClick={start} className={`${btn} w-full bg-blue-600 text-lg text-white`}>
          ▶️ เริ่มออกงาน
        </button>
      </div>
    );
  }

  const [ve] = VEHICLES[trip.vehicle] || ["🚗"];
  const [me, mt] = MISSIONS[trip.mission] || ["🤝", ""];
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl bg-white p-4 shadow">
        <p className="text-sm text-neutral-500">กำลังออกงาน · เริ่ม {timeAgo(trip.started_at)}</p>
        <p className="text-xl font-bold">
          {ve} {trip.label}
        </p>
        <p>
          {me} {mt} {trip.note && `· ${trip.note}`}
        </p>
        <GpsLine live={live} />
      </div>
      <fieldset>
        <legend className="mb-1 font-medium">ตอนนี้กำลัง… (ชาวบ้านเห็นทันที)</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PHASES)
            .filter(([k]) => k !== "standby")
            .map(([k, [e, t, cls]]) => (
              <button
                key={k}
                onClick={() => phase(k)}
                aria-pressed={trip.phase === k}
                className={`${btn} min-h-[64px] text-left ${trip.phase === k ? `${cls} ring-4 ring-black` : "border-2 border-neutral-300 bg-white"}`}
              >
                {e} {t}
              </button>
            ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          className="min-h-[48px] rounded-lg border border-neutral-300 px-3"
          placeholder="อัปเดตข้อความ เช่น เหลือข้าว 20 กล่อง"
        />
        <button onClick={() => phase(trip.phase)} className={`${btn} border-2 border-black bg-white`}>
          ส่ง
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button onClick={end} className={`${btn} w-full bg-red-600 text-white`}>
        ⏹ จบงาน
      </button>
    </div>
  );
}

// ---------------- public side: what's moving in the village, and who is on duty ----------------
export const tripWhere = (t) => (!t.has_fix ? "📡 กำลังหาตำแหน่ง" : t.far ? `อยู่นอกพื้นที่ (${t.km} กม.)` : t.soi ? `อยู่ซอย ${t.soi}` : t.km > 3 ? `ห่างหมู่บ้าน ${t.km} กม.` : "นอกซอย/ถนนใหญ่");

// no update for a few minutes: phone screen off / page closed; show the last known place, greyed
export const isQuiet = (t) => Date.now() - new Date(t.updated_at).getTime() > 3 * 60000;

export const tripClaims = (t) => (t.claimed ? `รับงานไว้ ${t.claimed} หลัง${t.claimed_sois?.length ? ` (ซ.${t.claimed_sois.join(", ")})` : ""}` : "");

export function TripsStrip({ trips, onFocus }) {
  const moving = trips.filter((t) => !t.presence);
  const online = trips.filter((t) => t.presence);
  if (!trips.length) return null;
  return (
    <section aria-label="กำลังให้บริการตอนนี้" className="rounded-xl border-2 border-blue-600 bg-white p-3">
      <h2 className="mb-2 flex items-center gap-2 font-bold">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-600" />
        </span>
        {moving.length ? `🚚 กำลังให้บริการตอนนี้ (${moving.length})` : "👷 ทีมช่วยเหลือ/อาสา"}
        {moving.length > 0 && online.length > 0 && <span className="text-sm font-normal text-neutral-600">· ทีมช่วยเหลือ/อาสา {online.length}</span>}
      </h2>
      <div className="-mx-3 overflow-x-auto px-3">
        <div className="flex w-max gap-2">
          {moving.map((t) => {
            const [ve] = VEHICLES[t.vehicle] || ["🚗"];
            const [me, mt] = MISSIONS[t.mission] || ["🤝", ""];
            const [pe, pt, pcls] = PHASES[t.phase] || PHASES.enroute;
            return (
              <button key={t.id} onClick={() => t.lat != null && onFocus(t)} className="w-64 shrink-0 rounded-xl border border-neutral-200 p-2 text-left active:bg-neutral-50">
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
                  <span className="text-neutral-600">{tripWhere(t)}</span>
                </p>
                {t.note && <p className="mt-0.5 truncate text-xs text-neutral-600">{t.note}</p>}
                <p className="text-xs text-neutral-400">
                  อัปเดต {timeAgo(t.updated_at)}
                  {t.lat != null ? " · แตะดูบนแผนที่" : ""}
                </p>
              </button>
            );
          })}
          {online.map((t) => (
            <button
              key={t.id}
              onClick={() => t.lat != null && onFocus(t)}
              className={`w-56 shrink-0 rounded-xl border p-2 text-left ${isQuiet(t) ? "border-neutral-300 opacity-60" : "border-emerald-300 bg-emerald-50/50 active:bg-emerald-50"}`}
            >
              <p className="truncate font-bold">👷 {t.label}</p>
              <p className="line-clamp-2 text-sm">{t.note || <span className="text-neutral-500">ออนไลน์ พร้อมช่วย</span>}</p>
              <p className="truncate text-xs text-neutral-600">
                {tripWhere(t)}
                {t.claimed ? ` · ${tripClaims(t)}` : ""}
              </p>
              {isQuiet(t) && <p className="text-xs text-neutral-500">ตำแหน่งล่าสุด {timeAgo(t.updated_at)}</p>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
