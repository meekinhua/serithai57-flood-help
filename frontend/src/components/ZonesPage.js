import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { createBaseMap } from "./MapView";

// /zones — the village split into zones A, B, C… (so relief teams don't overlap) and one truck
// drop point per zone on the main road (big trucks can't enter the small sois). Printable.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// /zones?poster=1 — the same page without buttons, for a printable image / LINE post
const QS = new URLSearchParams(window.location.search);
const POSTER = QS.has("poster");
const FOCUS = (QS.get("zone") || "").toUpperCase() || null; // /zones?zone=D — one zone per sheet
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 110540, (a[1] - b[1]) * 108000);
const fmtDist = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} ม.` : `${(m / 1000).toFixed(1)} กม.`);
const navUrl = (d) => `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;

const GREY = "#9ca3af";
// where the drop point is, in words: the shop the teams use, else the soi mouth
export const placeOf = (z) => z.drop.place || `ปากซอย ${z.drop.soi}`;
// zones that share one drop point (F·G·H) work as one block: one card, one team, one case list.
// The group keeps the first zone's id (its drop point record) and adds ids / label / all sois.
export function zoneGroups(zones) {
  const out = [];
  for (const z of zones || []) {
    const ids = z.drop.shared || [z.id];
    if (ids[0] !== z.id) continue;
    const members = ids.map((id) => zones.find((x) => x.id === id)).filter(Boolean);
    out.push({ ...z, ids, label: ids.join("·"), sois: members.flatMap((m) => m.sois).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b)), houses: members.reduce((a, m) => a + m.houses, 0) });
  }
  return out;
}
const sharedWith = (z) => (z.drop.shared || [z.id]).filter((id) => id !== z.id);

export function drawZones(map, data, { houses = true, labels = true, pane, focus } = {}) {
  const group = L.layerGroup().addTo(map);
  const P = pane ? { pane } : {}; // Leaflet breaks on pane: undefined
  // main road: the only road trucks can use
  L.polyline(data.main_road, { color: "#111", weight: 12, opacity: 0.35, interactive: false, ...P }).addTo(group);
  L.polyline(data.main_road, { color: "#facc15", weight: 5, opacity: 0.95, interactive: false, ...P }).addTo(group);
  if (houses) {
    for (const [lat, lng, zi] of data.houses) {
      const mine = !focus || data.zones[zi].id === focus; // single-zone sheet: other zones greyed out
      L.circleMarker([lat, lng], { ...P, radius: mine ? (focus ? 4 : 3) : 2.5, stroke: false, fillColor: mine ? data.zones[zi].color : GREY, fillOpacity: mine ? 0.9 : 0.5, interactive: false }).addTo(group);
    }
  }
  for (const z of data.zones) {
    const mine = !focus || z.id === focus;
    for (const s of z.sois) {
      const lines = data.soiLines?.[s] || [];
      for (const line of lines) L.polyline(line, { color: mine ? z.color : GREY, weight: mine ? (focus ? 6 : 4) : 3, opacity: mine ? 0.9 : 0.5, interactive: false, ...P }).addTo(group);
      if (focus && mine && lines.length) {
        // soi number on the soi itself, for printed sheets
        const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
        const mid = longest[Math.floor(longest.length / 2)];
        L.marker(mid, { ...P, interactive: false, icon: L.divIcon({ className: "", iconSize: [60, 26], iconAnchor: [30, 13], html: `<div class="soi-tag" style="--c:${z.color}">ซ.${esc(s)}</div>` }) }).addTo(group);
      }
    }
    if (labels && (!focus || mine)) {
      L.marker(z.center, {
        ...P,
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: [58, 58], iconAnchor: [29, 29], html: `<div class="zone-label" style="--c:${z.color}">${z.id}</div>` }),
      }).addTo(group);
    }
    // zones sharing one drop point (F·G·H) get one pin, drawn with the first zone of the group
    const shared = z.drop.shared || [z.id];
    if (shared[0] !== z.id) continue;
    const pinMine = !focus || shared.includes(focus);
    const pins = [{ ...z.drop, tag: shared.join("·") }, ...(z.drop.extra || []).map((x, i) => ({ ...x, tag: `${z.id}${i + 2}`, second: true }))];
    for (const d of pins) {
      L.marker([d.lat, d.lng], {
        ...P,
        zIndexOffset: pinMine ? 2000 : 1000,
        icon: L.divIcon({
          className: "",
          iconSize: [shared.length > 1 ? 96 : 64, 40],
          iconAnchor: [shared.length > 1 ? 48 : 32, 20],
          html: `<div class="drop-pin${pinMine ? "" : " faded"}${d.second ? " second" : ""}" style="--c:${pinMine ? z.color : GREY}">🚚 ${esc(d.tag)}</div>`,
        }),
      })
        .bindPopup(
          `<b>🚚 จุดลงของ ${esc(d.tag)}</b><br>${esc(d.place || `ปากซอย ${d.soi}`)}<br>${
            shared.length > 1 ? `จุดรวมของโซน ${esc(shared.join(", "))} — ทีมที่จุดนี้แบ่งของเข้าแต่ละโซน` : `โซน ${z.id} · ${z.houses} หลัง · ซอย ${esc(z.sois.join(", "))}`
          }<br>รถใหญ่จอดริมถนนหลัก แล้วทีมขนเข้าซอย<br><a href="${navUrl(d)}" target="_blank" rel="noreferrer">🧭 นำทางไปจุดนี้</a> · <a href="/ops#${z.id}">👤 ใครอยู่จุดนี้</a>`
        )
        .addTo(group);
    }
  }
  return group;
}

// what was done in a zone; keys match backend/zonelog.py
const ACTIONS = {
  boat: ["🚤", "ส่งเรือเข้าไปแจกของ"],
  truck_drop: ["🚛", "รถลงของที่จุดลงของ"],
  food: ["🍱", "แจกอาหารแล้ว"],
  water: ["💧", "แจกน้ำดื่มแล้ว"],
  evacuate: ["🚣", "รับคน / อพยพ"],
  medical: ["🩺", "หน่วยแพทย์ / ยา"],
  need: ["⚠️", "ยังขาด / ต้องการเพิ่ม"],
  other: ["📝", "อื่นๆ"],
};
const WHEN = [
  [0, "ตอนนี้"],
  [30, "30 นาทีก่อน"],
  [60, "1 ชม.ก่อน"],
  [120, "2 ชม.ก่อน"],
  [180, "3 ชม.ก่อน"],
];
const QUIET_H = 6; // no update for this long: flag the zone

function ZoneStatus({ zone, entries, onAdded }) {
  const [openLog, setOpenLog] = useState(false);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState(null);
  const [when, setWhen] = useState(0);
  const [note, setNote] = useState("");
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const [msg, setMsg] = useState("");
  const last = entries[0];
  const quietH = last ? (Date.now() - new Date(last.at).getTime()) / 3.6e6 : null;

  async function submit() {
    // say what's missing instead of a greyed-out button nobody understands
    if (!kind || !name.trim()) {
      setMsg(!kind ? "👆 เลือกก่อนว่าทำอะไร (ปุ่มด้านบน)" : "✍️ ใส่ชื่อหรือทีมของคุณก่อน");
      return;
    }
    setMsg("");
    try {
      await api(`/zones/${zone.id}/log`, { method: "POST", body: JSON.stringify({ kind, minutes_ago: when, note: note.trim(), name: name.trim() }) });
      save("contact", { ...load("contact", {}), name: name.trim() });
      setAdding(false);
      setKind(null);
      setNote("");
      setWhen(0);
      onAdded();
    } catch (e) {
      setMsg(e.message === "404" || e.message === "Not Found" ? "ระบบสถานะโซนยังไม่เปิดบนเว็บนี้ (ต้อง deploy รุ่นใหม่)" : e.message);
    }
  }

  const row = (e) => {
    const [emoji, label] = ACTIONS[e.kind] || ACTIONS.other;
    return (
      <li key={e.id} className="text-sm">
        <b>
          {emoji} {label}
        </b>{" "}
        · {timeAgo(e.at)}
        {e.note && <span className="block text-neutral-700">{e.note}</span>}
        <span className="block text-xs text-neutral-500">
          โดย {e.name}
          {e.staff ? " ✓ ทีม" : ""}
        </span>
      </li>
    );
  };

  return (
    <div className="mt-2 rounded-lg bg-neutral-50 p-2">
      <p className="text-xs font-semibold text-neutral-600">สถานะโซน</p>
      {last ? <ul>{row(last)}</ul> : <p className="text-sm text-neutral-600">ยังไม่มีใครแจ้งว่าเข้ามาช่วยโซนนี้</p>}
      {(quietH == null || quietH >= QUIET_H) && (
        <p className="mt-1 rounded bg-yellow-200 px-2 py-0.5 text-xs font-bold">⏰ {quietH == null ? "ยังไม่มีการแจ้ง" : `เงียบมา ${Math.floor(quietH)} ชม.`} — อาจยังไม่มีคนเข้าไป</p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => setOpenLog((v) => !v)} disabled={entries.length < 2} className="min-h-[40px] rounded-lg border border-neutral-300 bg-white text-sm disabled:opacity-40">
          📋 ประวัติ ({entries.length})
        </button>
        <button onClick={() => setAdding((v) => !v)} className="min-h-[40px] rounded-lg bg-blue-600 text-sm font-semibold text-white">
          ➕ แจ้งสถานะ
        </button>
      </div>
      {openLog && <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto border-t pt-2">{entries.slice(1).map(row)}</ul>}
      {adding && (
        <div className="mt-2 space-y-2 border-t pt-2">
          <p className={`text-sm font-semibold ${msg && !kind ? "text-red-700" : ""}`}>1. ทำอะไรในโซน {zone.id}?</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ACTIONS).map(([k, [e, t]]) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-[40px] rounded-full px-3 text-sm ${kind === k ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}>
                {e} {t}
              </button>
            ))}
          </div>
          <p className="text-sm font-semibold">2. เมื่อไหร่?</p>
          <div className="flex flex-wrap gap-1.5">
            {WHEN.map(([m, t]) => (
              <button key={m} type="button" onClick={() => setWhen(m)} aria-pressed={when === m} className={`min-h-[36px] rounded-full px-3 text-sm ${when === m ? "bg-black text-white" : "border border-neutral-300 bg-white"}`}>
                {t}
              </button>
            ))}
          </div>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="min-h-[44px] w-full rounded-lg border border-neutral-300 px-3" placeholder="รายละเอียด (ไม่ใส่ก็ได้) เช่น ข้าว 80 กล่อง ซอย 18–20" />
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`min-h-[44px] w-full rounded-lg border px-3 ${msg && kind && !name.trim() ? "border-2 border-red-500" : "border-neutral-300"}`} placeholder="3. ชื่อ / ทีม (จำเป็น) เช่น เรือทีมต้น" />
          {msg && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{msg}</p>}
          <button onClick={submit} className="min-h-[48px] w-full rounded-lg bg-black font-bold text-white">
            ส่งสถานะ
          </button>
        </div>
      )}
    </div>
  );
}

export default function ZonesPage() {
  const el = useRef(null);
  const mapRef = useRef(null);
  const [data, setData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");
  const [log, setLog] = useState([]);
  const [hazards, setHazards] = useState([]); // live ⚡/🌳 warnings from /ops
  const loadLog = () => {
    api("/zones/log").then(setLog).catch(() => {});
    api("/ops")
      .then((b) => setHazards(b.hazards.filter((h) => !h.cleared_at)))
      .catch(() => {});
  };
  useEffect(() => {
    if (FOCUS) return;
    loadLog();
    const t = setInterval(() => document.visibilityState === "visible" && loadLog(), 60000);
    return () => clearInterval(t);
  }, []);
  // "where am I": live GPS dot on the map, which zone that is, and the nearest truck drop point
  const [me, setMe] = useState(null); // { lat, lng, acc }
  const [locMsg, setLocMsg] = useState("");
  const watchRef = useRef(null);
  const meLayer = useRef(null);
  const centred = useRef(false);
  useEffect(() => () => watchRef.current != null && navigator.geolocation?.clearWatch(watchRef.current), []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me) return;
    meLayer.current?.remove();
    meLayer.current = L.layerGroup([
      L.circle([me.lat, me.lng], { radius: Math.min(me.acc, 300), color: "#2563eb", weight: 1, fillColor: "#3b82f6", fillOpacity: 0.12, interactive: false }),
      L.circleMarker([me.lat, me.lng], { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip("คุณอยู่ที่นี่", { permanent: true, direction: "top", offset: [0, -10] }),
    ]).addTo(map);
    if (!centred.current) {
      centred.current = true;
      map.setView([me.lat, me.lng], Math.max(map.getZoom(), 17), { animate: false });
    }
  }, [me]);
  const here = useMemo(() => {
    if (!me || !data) return null;
    const p = [me.lat, me.lng];
    let best = null;
    for (const h of data.houses) {
      const d = metres(p, h);
      if (!best || d < best.d) best = { d, zi: h[2] };
    }
    const zone = best && best.d < 150 ? data.zones[best.zi] : null; // outside the village: no zone
    const drops = data.zones.map((z) => ({ z, d: metres(p, [z.drop.lat, z.drop.lng]) })).sort((a, b) => a.d - b.d);
    return { zone, own: zone && drops.find((x) => x.z.id === zone.id), nearest: drops[0] };
  }, [me, data]);
  function locate() {
    if (!navigator.geolocation) return setLocMsg("เครื่องนี้หาตำแหน่งไม่ได้");
    if (watchRef.current != null) {
      centred.current = false; // tapped again: recentre on me
      if (me) setMe({ ...me });
      return;
    }
    setLocMsg("กำลังหาตำแหน่ง… (ถ้ามือถือถาม ให้กด “อนุญาต”)");
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setLocMsg("");
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy || 0 });
      },
      (err) => {
        setLocMsg(err.code === 1 ? "ไม่ได้อนุญาตตำแหน่ง — เปิดสิทธิ์ตำแหน่งให้เว็บนี้ในตั้งค่าเบราว์เซอร์" : "หาตำแหน่งไม่ได้ ลองออกไปที่โล่ง");
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  useEffect(() => {
    Promise.all([api("/zones"), api("/sois")])
      .then(([z, s]) => setData({ ...z, soiLines: Object.fromEntries(Object.entries(s.sois).map(([k, v]) => [k, v.lines])) }))
      .catch((e) => setError(e.message));
    api("/posts?kind=need")
      .then((p) => setPosts(Array.isArray(p) ? p : p.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!data || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomSnap = 0.25; // the village is a long strip: whole-number zooms leave it tiny
    if (POSTER) {
      // printed/shared images: never request z19 tiles (they often don't arrive in time for a headless render)
      map.eachLayer((l) => l instanceof L.TileLayer && map.removeLayer(l));
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
    }
    mapRef.current = map;
    drawZones(map, data, { focus: FOCUS });
    const fz = FOCUS && data.zones.findIndex((z) => z.id === FOCUS);
    const pts = data.houses.filter((h) => !FOCUS || h[2] === fz).map((h) => [h[0], h[1]]);
    const bounds = L.latLngBounds(pts.length ? pts : data.houses.map((h) => [h[0], h[1]])).pad(FOCUS ? Number(QS.get("pad")) || 0.08 : 0.03); // &pad= widens a sheet's view
    // keep the whole village in view while the page lays out (a background tab starts at 0×0),
    // until the person touches the map
    let touched = false;
    const stop = () => (touched = true);
    el.current.addEventListener("pointerdown", stop);
    el.current.addEventListener("wheel", stop);
    const fit = () => {
      map.invalidateSize();
      // no animation: a refit or unmount mid-zoom crashes Leaflet (_leaflet_pos of undefined)
      if (!touched && map.getSize().x > 50) map.fitBounds(bounds, { animate: false });
    };
    fit();
    const t = setTimeout(fit, 300);
    const ro = new ResizeObserver(fit);
    ro.observe(el.current);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove(); // removes the zone layers too; removing them first leaves a canvas redraw queued on a dead context
    };
  }, [data]);

  // open requests per zone, so donors see where things are needed
  const need = useMemo(() => {
    const out = {};
    if (!data) return out;
    for (const p of posts) {
      if (p.status === "done") continue;
      const z = data.soi_zone[p.soi || ""];
      if (!z) continue;
      out[z] = out[z] || { open: 0, urgent: 0 };
      out[z].open += 1;
      if (p.urgent) out[z].urgent += 1;
    }
    return out;
  }, [data, posts]);

  // one printable sheet per zone: /zones?zone=D (&poster=1 hides buttons)
  const fzone = FOCUS && data?.zones.find((z) => z.id === FOCUS);
  if (FOCUS) {
    return (
      <div className={`zone-sheet flex h-screen flex-col bg-white${POSTER ? " poster" : ""}`}>
        <header className="flex items-center gap-4 px-6 py-4 text-white" style={{ background: fzone?.color || "#111" }}>
          <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-white text-6xl font-black" style={{ color: fzone?.color }}>
            {FOCUS}
          </span>
          <div className="min-w-0">
            <p className="text-4xl font-black">โซน {FOCUS}{fzone ? ` · ~${fzone.houses} หลัง` : ""}</p>
            <p className="text-2xl font-semibold">ซอย {fzone?.sois.join(", ")}</p>
            <p className="text-lg opacity-90">หมู่บ้านสหกรณ์เคหะสถาน 4 · เสรีไทย 57</p>
          </div>
        </header>
        <div className="grid grid-cols-2 gap-3 px-6 py-3 text-lg">
          <div className="rounded-xl border-4 border-yellow-400 bg-yellow-50 p-3">
            <p className="text-2xl font-black">🚚 จุดลงของ: {fzone && placeOf(fzone)}</p>
            {fzone && sharedWith(fzone).length > 0 && <p className="font-bold">ใช้ร่วมกับโซน {sharedWith(fzone).join(", ")}</p>}
            {fzone?.drop.extra?.map((x) => (
              <p key={x.soi} className="font-bold">+ จุดที่ 2: {x.place}</p>
            ))}
            <p>รถใหญ่จอด<b>ริมถนนหลัก (เส้นเหลือง)</b> ที่ป้าย 🚚 {FOCUS} เข้าซอยเล็กไม่ได้</p>
          </div>
          <div className="rounded-xl border-4 p-3" style={{ borderColor: fzone?.color }}>
            <p className="text-2xl font-black">👷 ทีมโซน {FOCUS}</p>
            <p>ขนของจากจุดลงของเข้าซอย · รับงาน/กดเสร็จที่ <b>serithai57.com/staff</b> เลือก “โซน {FOCUS}”</p>
          </div>
        </div>
        {error && <p className="mx-6 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <div ref={el} className="zones-map mx-6 min-h-0 flex-1 overflow-hidden rounded-xl border-2 border-neutral-300" />
        <p className="px-6 py-3 text-center text-lg font-bold">ดูแผนที่ออนไลน์ + นำทาง: serithai57.com/zones · สีเทา = โซนอื่น</p>
      </div>
    );
  }

  const focus = (z) => {
    mapRef.current?.setView([z.drop.lat, z.drop.lng], 18, { animate: false });
    el.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={`zones-page min-h-screen bg-neutral-100${POSTER ? " poster" : ""}`}>
      <header className="bg-black px-4 py-3 text-white print:bg-white print:text-black">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <div className="min-w-[12rem] flex-1">
            <h1 className="text-xl font-bold">🗺️ แผนที่โซน · จุดลงของ</h1>
            <p className="text-sm text-neutral-300 print:text-neutral-700">หมู่บ้านสหกรณ์เคหะสถาน 4 · เสรีไทย 57</p>
          </div>
          {!POSTER && <a href="/ops" className="min-h-[44px] rounded-lg bg-green-600 px-3 py-2.5 text-sm font-semibold print:hidden">🤝 ประสานงาน</a>}
          <button onClick={() => window.print()} className="min-h-[44px] rounded-lg bg-white/10 px-3 text-sm font-semibold print:hidden">🖨️ พิมพ์</button>
          <a href="/" className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2.5 text-sm print:hidden">หน้าหลัก</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-3 px-3 py-3">
        {hazards.length > 0 && !POSTER && (
          <a href="/ops#hazards" className="block rounded-xl bg-red-600 p-3 font-semibold text-white shadow print:hidden">
            <span className="text-lg font-black">⚠️ ระวัง! จุดอันตราย</span>
            {hazards.slice(0, 4).map((h) => (
              <span key={h.id} className="block">
                {h.kind === "power" ? "⚡ ไฟรั่ว" : h.kind === "tree" ? "🌳 ต้นไม้ล้ม" : h.kind === "deep" ? "🌊 น้ำลึก" : h.kind === "closed" ? "🚧 ห้ามเข้า" : "⚠️"}
                {h.soi && ` ซ.${h.soi}`}
                {h.note && ` — ${h.note}`}
              </span>
            ))}
          </a>
        )}
        <section className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border-4 border-yellow-400 bg-yellow-50 p-3">
            <p className="text-lg font-bold">🚚 รถใหญ่ / คนนำของมาบริจาค</p>
            <p>รถใหญ่เข้าได้<b>เฉพาะถนนหลัก (เส้นเหลือง)</b> เข้าซอยเล็กไม่ได้ · เลือก<b>จุดลงของ 🚚</b> ที่สะดวก จอดลงของริมถนนหลัก แล้วทีมในโซนนั้นขนเข้าซอยต่อ</p>
          </div>
          <div className="rounded-xl border-4 border-emerald-500 bg-emerald-50 p-3">
            <p className="text-lg font-bold">👷 ทีมช่วยเหลือ / อาสา</p>
            <p>ตกลงกันว่า<b>ทีมไหนดูแลโซนไหน</b> (A, B, C…) แล้วรับงานเฉพาะในโซนตัวเอง ไม่ไปบ้านซ้ำกัน · ในหน้า /staff เลือกกรองงานตามโซนได้</p>
          </div>
        </section>

        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <div className="relative">
          <div ref={el} className="zones-map h-[70vh] w-full overflow-hidden rounded-xl border border-neutral-300 bg-white print:h-[180mm]" />
          {!POSTER && (
            <button onClick={locate} className="absolute right-2 top-2 z-[500] min-h-[48px] rounded-full border-2 border-blue-600 bg-white px-4 text-sm font-bold text-blue-700 shadow-lg print:hidden">
              📍 {me ? "กลับมาที่ฉัน" : "ฉันอยู่ตรงไหน"}
            </button>
          )}
        </div>
        {(locMsg || here) && !POSTER && (
          <section className="rounded-xl border-2 border-blue-600 bg-blue-50 p-3 print:hidden">
            {locMsg && <p className="font-semibold">{locMsg}</p>}
            {here && (
              <>
                <p className="text-lg font-bold">
                  {here.zone ? (
                    <>
                      📍 คุณอยู่ใน{" "}
                      <span className="rounded-lg px-2 text-white" style={{ background: here.zone.color }}>
                        โซน {here.zone.id}
                      </span>
                    </>
                  ) : (
                    "📍 คุณอยู่นอกหมู่บ้าน"
                  )}
                  {me?.acc > 100 && <span className="ml-2 text-sm font-normal text-neutral-600">(GPS คลาดเคลื่อน ~{Math.round(me.acc)} ม.)</span>}
                </p>
                {here.own && (
                  <p>
                    🚚 จุดลงของโซน {here.own.z.id}: {placeOf(here.own.z)} · ห่าง {fmtDist(here.own.d)}
                  </p>
                )}
                {(!here.own || here.nearest.z.id !== here.own.z.id) && (
                  <p>
                    🚚 จุดลงของที่ใกล้สุด: <b>{here.nearest.z.id}</b> {placeOf(here.nearest.z)} · ห่าง {fmtDist(here.nearest.d)}
                  </p>
                )}
                <a href={navUrl((here.own || here.nearest).z.drop)} target="_blank" rel="noreferrer" className="mt-2 inline-flex min-h-[44px] items-center rounded-lg bg-black px-4 font-semibold text-white">
                  🧭 นำทางไปจุดลงของ {(here.own || here.nearest).z.id}
                </a>
              </>
            )}
          </section>
        )}

        {data && (
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.zones.map((z) => {
              const n = need[z.id];
              return (
                <div key={z.id} className="zone-card rounded-xl border-l-8 bg-white p-3 shadow" style={{ borderColor: z.color }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-black text-white" style={{ background: z.color }}>
                      {z.id}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold">โซน {z.id} · ~{z.houses} หลัง</p>
                      <p className="text-sm text-neutral-600">ซอย {z.sois.join(", ")}</p>
                    </div>
                  </div>
                  <p className="mt-2 font-semibold">🚚 จุดลงของ: {placeOf(z)}</p>
                  {sharedWith(z).length > 0 && <p className="text-sm font-semibold text-neutral-700">🤝 จุดรวมกับโซน {sharedWith(z).join(", ")}</p>}
                  {z.drop.extra?.map((x) => (
                    <p key={x.soi} className="text-sm font-semibold">
                      🚚 จุดที่ 2: {x.place}
                    </p>
                  ))}
                  {n && !POSTER && (
                    <p className="text-sm">
                      🆘 คำขอค้าง {n.open}
                      {n.urgent ? <span className="ml-1 rounded bg-red-600 px-1.5 font-bold text-white">ด่วน {n.urgent}</span> : null}
                    </p>
                  )}
                  {!POSTER && <ZoneStatus zone={z} entries={log.filter((e) => e.zone === z.id)} onAdded={loadLog} />}
                  <div className="mt-2 grid grid-cols-2 gap-2 print:hidden">
                    <button onClick={() => focus(z)} className="min-h-[44px] rounded-lg border-2 border-black text-sm font-semibold">📍 ดูบนแผนที่</button>
                    <a href={navUrl(z.drop)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center justify-center rounded-lg bg-black text-sm font-semibold text-white">
                      🧭 นำทาง
                    </a>
                    <a href={`/zones?zone=${z.id}`} className="col-span-2 flex min-h-[40px] items-center justify-center rounded-lg border border-neutral-300 text-sm">
                      🖨️ แผ่นแผนที่โซน {z.id} (พิมพ์แจก)
                    </a>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        {POSTER && <p className="rounded-xl bg-black p-3 text-center text-lg font-bold text-white">ดูแผนที่ออนไลน์ + นำทาง: serithai57.com/zones</p>}
        <p className="text-xs text-neutral-500">
          แบ่งโซนจากจำนวนบ้านจริง ~{data?.target_per_zone || 170} หลังต่อโซน (ข้อมูลอาคาร/ซอยจาก © OpenStreetMap contributors) · จุดลงของเลือกปากซอยบนถนนหลักที่อยู่กลางโซน
        </p>
      </main>
    </div>
  );
}
