import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { createBaseMap } from "./MapView";

// /cleanup — Big Cleaning Day (Sun 4 Oct 2026): which truck takes which zone, from the team's
// hand-written plan. 8 rubbish trucks by zone (A+B share truck 1), 4 water trucks by odd/even inner sois.
// /cleanup?poster=1 — the same without buttons, for a LINE image.
const POSTER = new URLSearchParams(window.location.search).has("poster");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TRUCKS = [
  { n: 1, zones: ["A", "B"], sois: "1–12" },
  { n: 2, zones: ["C"], sois: "13–17" },
  { n: 3, zones: ["D"], sois: "18–21" },
  { n: 4, zones: ["E"], sois: "22–33" },
  { n: 5, zones: ["F"], sois: "30–45" },
  { n: 6, zones: ["G"], sois: "36–57" },
  { n: 7, zones: ["H"], sois: "42–67" },
  { n: 8, zones: ["I"], sois: "52–83" },
];
const odd = (s) => parseInt(s, 10) % 2 === 1;
const even = (s) => !odd(s);
// water trucks: "ซอยใน" by odd / even numbers in these zones (the plan's wording)
const WATER = [
  { n: 1, color: "#dc2626", text: "ซอยเลขคี่ โซน G และโซน C–D", pick: [["G", odd], ["C", odd], ["D", odd]] },
  { n: 2, color: "#2563eb", text: "ซอยเลขคู่ โซน A–D", pick: [["A", even], ["B", even], ["C", even], ["D", even]] },
  { n: 3, color: "#16a34a", text: "ซอยเลขคู่ โซน E–F", pick: [["E", even], ["F", even]] },
  { n: 4, color: "#9333ea", text: "ซอยเลขคู่ โซน G–H–I", pick: [["G", even], ["H", even], ["I", even]] },
];
// the inner roads (parallel to the main road, through the middle of the sois) each water truck drives,
// as marked by the team on the plan — geometry © OpenStreetMap contributors (ODbL)
const INNER = {"1": [[[13.792372, 100.672938], [13.79288, 100.67269], [13.793362, 100.672462], [13.793874, 100.672222]], [[13.794319, 100.672671], [13.793604, 100.672978]], [[13.798637, 100.67029], [13.798803, 100.670206], [13.79917, 100.670033], [13.79949, 100.66989], [13.799827, 100.669761], [13.800185, 100.66967], [13.800592, 100.669556], [13.800689, 100.669526]]], "2": [[[13.787343, 100.672801], [13.787856, 100.672496], [13.788077, 100.672365], [13.788109, 100.672344], [13.788553, 100.672054], [13.789013, 100.671776], [13.789478, 100.671483], [13.789958, 100.671234], [13.790444, 100.670939], [13.790892, 100.670659], [13.791356, 100.670356], [13.791801, 100.670084], [13.792263, 100.669789], [13.792691, 100.66948], [13.793014, 100.669291]]], "3": [[[13.793107, 100.669236], [13.793475, 100.669107], [13.793851, 100.668999], [13.794179, 100.668879], [13.794395, 100.668796], [13.794496, 100.668758], [13.794857, 100.668637], [13.794908, 100.668619], [13.795182, 100.66852], [13.795409, 100.668437], [13.795556, 100.668378], [13.795882, 100.668256]], [[13.795882, 100.668256], [13.795928, 100.668241], [13.796389, 100.668058], [13.796745, 100.667916]]], "4": [[[13.796745, 100.667916], [13.797099, 100.667787], [13.797432, 100.667667], [13.797801, 100.667544], [13.798156, 100.667437], [13.798697, 100.667318], [13.799204, 100.667218], [13.799723, 100.667123], [13.800124, 100.667025], [13.800302, 100.666995], [13.800483, 100.666954], [13.800844, 100.6669], [13.801219, 100.666807], [13.801342, 100.666782], [13.801567, 100.666745], [13.801872, 100.666687], [13.801949, 100.666666], [13.802309, 100.666601], [13.802397, 100.666594], [13.802913, 100.666483]]]};
const circled = (n) => "①②③④⑤⑥⑦⑧"[n - 1];

function waterSois(zones) {
  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  return WATER.map((w) => ({ ...w, sois: w.pick.flatMap(([id, f]) => (byId[id]?.sois || []).filter(f)) }));
}

function useMap(el, data, draw, visible = true) {
  const mapRef = useRef(null);
  useEffect(() => {
    // a map created while hidden has no size: measure again and re-fit when its tab is shown
    if (visible && mapRef.current)
      setTimeout(() => {
        const m = mapRef.current;
        if (!m) return;
        m.invalidateSize();
        if (m._fit) m.fitBounds(m._fit, { padding: [12, 12], animate: false });
      }, 50);
  }, [visible]);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    if (!data || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomSnap = 0.25;
    map.options.zoomAnimation = !POSTER;
    if (POSTER) {
      map.eachLayer((l) => l instanceof L.TileLayer && map.removeLayer(l));
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, maxNativeZoom: 18, attribution: "&copy; OpenStreetMap" }).addTo(map);
    }
    L.polyline(data.main_road, { color: "#111", weight: 12, opacity: 0.35, interactive: false }).addTo(map);
    L.polyline(data.main_road, { color: "#facc15", weight: 5, opacity: 0.95, interactive: false }).addTo(map);
    mapRef.current = map;
    drawRef.current(map);
    const pts = data.houses.map(([lat, lng]) => [lat, lng]);
    // no zoom animation: switching tabs removes the map, and Leaflet crashes if an animation is still running
    map._fit = L.latLngBounds(pts);
    map.fitBounds(map._fit, { padding: [12, 12], animate: false });
    return () => {
      mapRef.current = null;
      map.stop();
      map.off();
      map.remove();
    };
  }, [data, el]); // draw once per data: re-creating the map on every render broke its zoom
}

function TruckMap({ data, visible }) {
  const el = useRef(null);
  const draw = (map) => {
    for (const [lat, lng, zi] of data.houses) L.circleMarker([lat, lng], { radius: 3, stroke: false, fillColor: data.zones[zi].color, fillOpacity: 0.85, interactive: false }).addTo(map);
    for (const z of data.zones) for (const s of z.sois) for (const line of data.soiLines[s] || []) L.polyline(line, { color: z.color, weight: 4, opacity: 0.9, interactive: false }).addTo(map);
    for (const t of TRUCKS) {
      const zs = t.zones.map((id) => data.zones.find((z) => z.id === id)).filter(Boolean);
      const w = zs.reduce((a, z) => a + z.houses, 0) || 1;
      const c = [0, 1].map((k) => zs.reduce((a, z) => a + z.center[k] * z.houses, 0) / w);
      L.marker(c, {
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: [110, 40], iconAnchor: [55, 20], html: `<div class="zone-label" style="--c:${zs[0].color};font-size:16px;padding:2px 8px">🚛${circled(t.n)} ${esc(t.zones.join("+"))}</div>` }),
      }).addTo(map);
    }
  };
  useMap(el, data, draw, visible);
  return <div ref={el} className="h-[70vh] min-h-[420px] w-full rounded-xl border" />;
}

function WaterMap({ data, visible }) {
  const el = useRef(null);
  const draw = (map) => {
    const ws = waterSois(data.zones);
    const owner = {};
    ws.forEach((w) => w.sois.forEach((s) => (owner[s] = w)));
    for (const z of data.zones)
      for (const s of z.sois) {
        const w = owner[s];
        const lines = data.soiLines[s] || [];
        for (const line of lines) L.polyline(line, { color: w ? w.color : "#9ca3af", weight: w ? 7 : 3, opacity: w ? 0.95 : 0.5, interactive: false }).addTo(map);
        if (w && lines.length) {
          const longest = lines.reduce((a, b) => (b.length > a.length ? b : a));
          L.marker(longest[Math.floor(longest.length / 2)], { interactive: false, icon: L.divIcon({ className: "", iconSize: [66, 24], iconAnchor: [33, 12], html: `<div class="soi-tag" style="--c:${w.color};font-size:12px">💧${w.n} ซ.${esc(s)}</div>` }) }).addTo(map);
        }
      }
    // the inner road each water truck runs along (vertical lines the team drew on the plan)
    for (const w of ws) {
      const roads = INNER[w.n] || [];
      for (const road of roads) {
        L.polyline(road, { color: "#fff", weight: 13, opacity: 0.95, interactive: false }).addTo(map);
        L.polyline(road, { color: w.color, weight: 8, opacity: 1, dashArray: "14 8", interactive: false }).addTo(map);
      }
      if (!roads.length) continue;
      const longest = roads.reduce((a, b) => (b.length > a.length ? b : a));
      const at = longest[Math.floor(longest.length / 2)];
      // one tag per truck, beside its road (to the outer side, away from the soi tags)
      L.marker(at, { interactive: false, zIndexOffset: 500, icon: L.divIcon({ className: "", iconSize: [96, 24], iconAnchor: [w.n === 1 ? -8 : 104, 12], html: `<div class="soi-tag" style="--c:${w.color};font-size:13px;background:${w.color};color:#fff">💧${w.n} ถนนใน</div>` }) }).addTo(map);
    }
  };
  useMap(el, data, draw, visible);
  return <div ref={el} className="h-[70vh] min-h-[420px] w-full rounded-xl border" />;
}

export default function CleanupPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState(window.location.hash === "#water" ? "water" : "trucks");
  useEffect(() => {
    document.title = "แผนรถ Big Cleaning Day · เสรีไทย 57";
    Promise.all([api("/zones"), api("/sois")])
      .then(([z, s]) => setData({ ...z, soiLines: Object.fromEntries(Object.entries(s.sois).map(([k, v]) => [k, v.lines])) }))
      .catch((e) => setError(e.message));
  }, []);
  const ws = data ? waterSois(data.zones) : [];
  const zoneColor = (id) => data?.zones.find((z) => z.id === id)?.color || "#000";

  const trucksTable = (
    <ol className="grid gap-1 sm:grid-cols-2">
      {TRUCKS.map((t) => (
        <li key={t.n} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5">
          <span className="text-xl font-bold">🚛{circled(t.n)}</span>
          {t.zones.map((id) => (
            <span key={id} className="rounded px-2 font-bold text-white" style={{ background: zoneColor(id) }}>
              {id}
            </span>
          ))}
          <span className="font-semibold">ซอย {t.sois}</span>
        </li>
      ))}
    </ol>
  );
  const waterTable = (
    <ol className="space-y-1">
      {ws.map((w) => (
        <li key={w.n} className="rounded-lg bg-white px-2 py-1.5">
          <b style={{ color: w.color }}>💧 รถน้ำคันที่ {w.n}</b> · {w.text}
          <span className="block text-sm text-neutral-700">ซ. {w.sois.join(", ")}</span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="min-h-screen bg-stone-100 p-3 text-neutral-900">
      <div className="mx-auto max-w-5xl space-y-3">
        <header className="rounded-xl bg-black p-3 text-white">
          <h1 className="text-xl font-bold">🧹 แผนรถ Big Cleaning Day · หมู่บ้านสหกรณ์ เสรีไทย 57</h1>
          <p className="text-sm text-neutral-300">อาทิตย์ 4 ต.ค. 2569 · เริ่ม 9:00 น. · รถขยะ 8 คันตามโซน + รถน้ำ 4 คันตามซอยคู่/คี่ · เส้นเหลือง = ถนนเมน</p>
        </header>
        {error && <p className="rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
        {!POSTER && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1">
            {[
              ["trucks", "🚛 รถขยะ 8 คัน"],
              ["water", "💧 รถน้ำ 4 คัน"],
            ].map(([k, t]) => (
              <button key={k} onClick={() => setView(k)} className={`min-h-[48px] rounded-lg font-bold ${view === k ? "bg-black text-white" : ""}`}>
                {t}
              </button>
            ))}
          </div>
        )}
        {data && (
          <section className="space-y-2" hidden={!POSTER && view !== "trucks"}>
            <h2 className="text-lg font-bold">🚛 รถขยะ 8 คัน · เก็บขยะชิ้นใหญ่ที่ริมถนนเมน แยกตามโซน</h2>
            <TruckMap data={data} visible={POSTER || view === "trucks"} />
            {trucksTable}
          </section>
        )}
        {data && (
          <section className="space-y-2" hidden={!POSTER && view !== "water"}>
            <h2 className="text-lg font-bold">💧 รถน้ำ 4 คัน · วิ่งถนนใน (เส้นประหนา) แล้วล้างซอยตามสีคัน · ซอยสีเทา = ไม่มีรถน้ำเข้า</h2>
            <WaterMap data={data} visible={POSTER || view === "water"} />
            {waterTable}
          </section>
        )}
        {!POSTER && (
          <a href="/" className="block text-center underline">
            ← กลับหน้าหลัก
          </a>
        )}
      </div>
    </div>
  );
}
