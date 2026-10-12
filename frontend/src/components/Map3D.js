// 🏙️ 3D village map (12–13 Oct 2026): a toy-town model of the village. Every house is an OpenStreetMap outline
// raised by its number of floors, with a coloured roof cap; walls take a pastel colour per soi, worked out from the
// address book that members filled in (house pins + their soi) and from the soi lines (including the ones the admin
// drew). Parks, pitches and ponds come from OSM, places (shops, activity areas, routes) from /admin › สถานที่.
// MapLibre is loaded from a CDN only when someone opens it, so the app bundle stays small.
// With `edit` (/admin › ที่อยู่ › อาคาร) the admin fixes the model: tap a house to set floors or remove it, tap a red
// (removed) one to bring it back, or switch to ➕ and tap an empty spot to add a house shaped like its neighbour.
import { useEffect, useRef, useState } from "react";
import { api, load } from "../api";
import { VILLAGE_BOUNDARY, VILLAGE_CENTER } from "../config";

const CDN = [
  ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"],
  ["https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js", "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css"],
];
let loading = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (loading) return loading;
  const tryOne = (i) =>
    new Promise((resolve, reject) => {
      const [js, css] = CDN[i];
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = css;
      document.head.appendChild(l);
      const s = document.createElement("script");
      s.src = js;
      s.onload = () => (window.maplibregl ? resolve(window.maplibregl) : reject(new Error("no maplibre")));
      s.onerror = () => reject(new Error("load failed"));
      document.head.appendChild(s);
    }).catch((e) => (i + 1 < CDN.length ? tryOne(i + 1) : Promise.reject(e)));
  loading = tryOne(0).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const FLOOR_M = 3;
const ROOF_M = 1.6;
// toy palette: [wall, roof] per soi
const PALETTE = [
  ["#FFD9C2", "#E8735A"],
  ["#CDEBD8", "#3E9C6B"],
  ["#DCD6F7", "#7B68C8"],
  ["#FFF0B8", "#E0A21B"],
  ["#CFE7F7", "#3D8CC4"],
  ["#F9D3DF", "#D9577F"],
  ["#E3EDC8", "#7FA23A"],
  ["#FFE1B3", "#D9822B"],
];
const NO_SOI = ["#F4EEE3", "#8A97A6"];
const hash = (s) => [...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const colours = (soi) => (soi ? PALETTE[hash(String(soi).split("/")[0]) % PALETTE.length] : NO_SOI);

const centroid = (g) => [g.reduce((a, p) => a + p[0], 0) / g.length, g.reduce((a, p) => a + p[1], 0) / g.length];
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * 0.9715);
const ring = (g) => [...g.map(([la, ln]) => [ln, la]), [g[0][1], g[0][0]]];
const inset = (g, k) => {
  const c = centroid(g);
  return g.map(([a, b]) => [c[0] + (a - c[0]) * k, c[1] + (b - c[1]) * k]);
};
// a round-ish blob (for tree canopies and trunks)
const blob = (lat, lng, r, n = 8) => Array.from({ length: n }, (_, i) => [lat + (Math.sin((i / n) * 2 * Math.PI) * r) / 111320, lng + (Math.cos((i / n) * 2 * Math.PI) * r) / (111320 * 0.9715)]);

function inPoly([y, x], g) {
  let c = false;
  for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
    const [yi, xi] = g[i];
    const [yj, xj] = g[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function houseGeo(list, soiOf, mine) {
  const walls = [];
  const roofs = [];
  for (const b of list) {
    const soi = soiOf[b.id] || null;
    const [wall, roof] = b.id === mine ? ["#FFFFFF", "#FF3B5C"] : colours(soi);
    const h = b.lv * FLOOR_M;
    const props = { id: b.id, lv: b.lv, h, s: b.s || "osm", wall: b.s === "added" ? "#C9F2D5" : wall, roof, soi: soi || "" };
    walls.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring(b.g)] } });
    if (b.s !== "removed") roofs.push({ type: "Feature", properties: { ...props, top: h + ROOF_M }, geometry: { type: "Polygon", coordinates: [ring(inset(b.g, 0.78))] } });
  }
  return [
    { type: "FeatureCollection", features: walls },
    { type: "FeatureCollection", features: roofs },
  ];
}

function natureGeo(green, places) {
  const flat = [];
  const trees = [];
  const trunks = [];
  let seed = 57;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const plant = (g, every) => {
    const lats = g.map((p) => p[0]);
    const lngs = g.map((p) => p[1]);
    const [y0, y1, x0, x1] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const n = Math.min(60, Math.max(2, Math.round((((y1 - y0) * 111320 * (x1 - x0) * 108000) / every) | 0)));
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const p = [y0 + rnd() * (y1 - y0), x0 + rnd() * (x1 - x0)];
      if (!inPoly(p, g)) continue;
      i++;
      const r = 2.2 + rnd() * 1.6;
      trees.push({ type: "Feature", properties: { base: 2.2, top: 2.2 + r * 2, c: rnd() < 0.5 ? "#6CC07B" : "#4FA866" }, geometry: { type: "Polygon", coordinates: [ring(blob(p[0], p[1], r))] } });
      trunks.push({ type: "Feature", properties: { base: 0, top: 2.4, c: "#9C6B43" }, geometry: { type: "Polygon", coordinates: [ring(blob(p[0], p[1], 0.45, 6))] } });
    }
  };
  for (const a of green || []) {
    const c = a.k === "water" ? "#9FD8F5" : a.k === "pitch" ? "#B6E3A8" : "#C6EBB4";
    flat.push({ type: "Feature", properties: { c, o: 0.95 }, geometry: { type: "Polygon", coordinates: [ring(a.g)] } });
    if (a.k === "green") plant(a.g, 220);
  }
  for (const p of places || []) {
    if (p.kind === "area" && p.geometry?.length > 2) {
      flat.push({ type: "Feature", properties: { c: p.color || "#1E6B47", o: 0.35 }, geometry: { type: "Polygon", coordinates: [ring(p.geometry)] } });
      if (/สวน|park|ต้นไม้/i.test(p.name)) plant(p.geometry, 160);
    }
  }
  return {
    flat: { type: "FeatureCollection", features: flat },
    trees: { type: "FeatureCollection", features: [...trunks, ...trees] },
  };
}

export default function Map3D({ edit = false, onClose, className = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const data = useRef([]);
  const soiRef = useRef({});
  const mineRef = useRef(null);
  const toolRef = useRef("select");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState("select");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [flat, setFlat] = useState(false);
  const [mine, setMine] = useState(null);
  toolRef.current = tool;

  const path = edit ? "/admin/buildings3d" : "/buildings3d";

  function paint(list) {
    data.current = list;
    const m = map.current;
    if (!m || !m.getSource("walls")) return;
    const [w, r] = houseGeo(list, soiRef.current, mineRef.current);
    m.getSource("walls").setData(w);
    m.getSource("roofs").setData(r);
  }

  async function reload(note) {
    const r = await api(path);
    paint(r.buildings);
    if (note) setMsg(note);
  }

  async function call(p, body, note) {
    setBusy(true);
    setMsg("");
    try {
      await api(p, { method: "POST", body: JSON.stringify(body) });
      await reload(note);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const myHouse = load("myHouse", "");
        const [ml, b, so, sm, pl, me, hs] = await Promise.all([
          loadMapLibre(),
          api(path),
          api("/sois").catch(() => ({ sois: {} })),
          api("/map3d/sois").catch(() => ({ sois: {} })),
          api("/places").catch(() => []),
          myHouse && !edit ? api(`/map3d/me?house=${encodeURIComponent(myHouse)}`).catch(() => ({})) : Promise.resolve({}),
          edit ? api("/admin/map3d/houses").catch(() => ({ houses: {} })) : Promise.resolve({ houses: {} }),
        ]);
        if (dead || !el.current) return;
        data.current = b.buildings;
        soiRef.current = sm.sois || {};
        mineRef.current = me.id ?? null;
        setMine(me.id ?? null);
        const nature = natureGeo(b.green, pl);
        const [walls, roofs] = houseGeo(b.buildings, soiRef.current, mineRef.current);
        const m = new ml.Map({
          container: el.current,
          center: [VILLAGE_CENTER[1], VILLAGE_CENTER[0]],
          zoom: 16.8,
          pitch: 60,
          bearing: -24,
          maxPitch: 78,
          attributionControl: { compact: true },
          style: {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            light: { anchor: "map", position: [1.4, 200, 35], color: "#FFF6E8", intensity: 0.42 },
            sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
            layers: [
              { id: "ground", type: "background", paint: { "background-color": "#DCEFD6" } },
              { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.28, "raster-saturation": -1, "raster-contrast": -0.3 } },
            ],
          },
        });
        map.current = m;
        m.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");
        m.on("load", () => {
          // lawns, pitches, ponds and place areas
          m.addSource("flat", { type: "geojson", data: nature.flat });
          m.addLayer({ id: "flat", type: "fill", source: "flat", paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } });
          // roads: the soi lines (incl. the ones drawn in /admin) as fat white toy roads
          const soiLines = [];
          for (const [k, s] of Object.entries(so.sois || {}))
            for (const ln of s.lines || []) soiLines.push({ type: "Feature", properties: { k }, geometry: { type: "LineString", coordinates: ln.map(([a, c]) => [c, a]) } });
          m.addSource("soi", { type: "geojson", data: { type: "FeatureCollection", features: soiLines } });
          const w = (n) => ["interpolate", ["exponential", 2], ["zoom"], 15, n / 4, 19, n * 4];
          m.addLayer({ id: "road-edge", type: "line", source: "soi", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#C8D3CB", "line-width": w(9) } });
          m.addLayer({ id: "road", type: "line", source: "soi", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": w(7.5) } });
          m.addSource("edge", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [...VILLAGE_BOUNDARY, VILLAGE_BOUNDARY[0]].map(([a, c]) => [c, a]) } } });
          m.addLayer({ id: "edge", type: "line", source: "edge", paint: { "line-color": "#5B7A66", "line-width": 2, "line-dasharray": [2, 2] } });
          // routes from places
          const routes = (pl || [])
            .filter((p) => p.kind === "route" && p.geometry?.length > 1)
            .map((p) => ({ type: "Feature", properties: { c: p.color || "#7B68C8" }, geometry: { type: "LineString", coordinates: p.geometry.map(([a, c]) => [c, a]) } }));
          m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: routes } });
          m.addLayer({ id: "routes", type: "line", source: "routes", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": 4, "line-dasharray": [1, 1.6] } });
          // houses: pastel walls + a darker roof cap
          m.addSource("walls", { type: "geojson", data: walls, promoteId: "id" });
          m.addSource("roofs", { type: "geojson", data: roofs, promoteId: "id" });
          m.addLayer({ id: "gone", type: "fill", source: "walls", filter: ["==", ["get", "s"], "removed"], paint: { "fill-color": "#E5484D", "fill-opacity": 0.45 } });
          m.addLayer({
            id: "walls",
            type: "fill-extrusion",
            source: "walls",
            filter: ["!=", ["get", "s"], "removed"],
            paint: {
              "fill-extrusion-color": ["case", ["boolean", ["feature-state", "sel"], false], "#FFB703", ["get", "wall"]],
              "fill-extrusion-height": ["get", "h"],
              "fill-extrusion-opacity": 1,
              "fill-extrusion-vertical-gradient": true,
            },
          });
          m.addLayer({
            id: "roofs",
            type: "fill-extrusion",
            source: "roofs",
            paint: { "fill-extrusion-color": ["get", "roof"], "fill-extrusion-base": ["get", "h"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 1 },
          });
          // lollipop trees in parks
          m.addSource("trees", { type: "geojson", data: nature.trees });
          m.addLayer({
            id: "trees",
            type: "fill-extrusion",
            source: "trees",
            paint: { "fill-extrusion-color": ["get", "c"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"] },
          });
          // admin: house numbers on the roofs (members' pins), to check the address book against the model
          if (edit) {
            const pts = b.buildings
              .filter((x) => hs.houses?.[x.id])
              .map((x) => {
                const c = centroid(x.g);
                return { type: "Feature", properties: { t: String(hs.houses[x.id]).replace(/^4\//, "") }, geometry: { type: "Point", coordinates: [c[1], c[0]] } };
              });
            m.addSource("nums", { type: "geojson", data: { type: "FeatureCollection", features: pts } });
            m.addLayer({
              id: "nums",
              type: "symbol",
              source: "nums",
              minzoom: 17.3,
              layout: { "text-field": ["get", "t"], "text-font": ["Open Sans Bold"], "text-size": 12, "text-allow-overlap": false },
              paint: { "text-color": "#15201A", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
            });
          }
          // soi names + place pins as little HTML badges (Thai text, no glyph server needed)
          for (const [k, s] of Object.entries(so.sois || {})) {
            const ln = (s.lines || []).reduce((a, x) => (x.length > a.length ? x : a), []);
            if (!ln.length) continue;
            const mid = ln[Math.floor(ln.length / 2)];
            const [, roof] = colours(k);
            const d = document.createElement("div");
            d.textContent = `ซ.${k}`;
            d.style.cssText = `font:800 11px sans-serif;color:#fff;background:${roof};border:2px solid #fff;border-radius:999px;padding:0 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);pointer-events:none`;
            new ml.Marker({ element: d }).setLngLat([mid[1], mid[0]]).addTo(m);
          }
          for (const p of pl || []) {
            const at = p.kind === "pin" ? p.geometry : p.kind === "area" ? centroid(p.geometry) : p.geometry?.[0];
            if (!at) continue;
            const d = document.createElement("div");
            d.innerHTML = `<div style="font:700 12px sans-serif;background:#fff;border-radius:999px;padding:2px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap">${p.emoji || "📍"} ${String(p.name).replace(/[<>&]/g, "")}</div>`;
            d.style.pointerEvents = "none";
            new ml.Marker({ element: d, anchor: "bottom" }).setLngLat([at[1], at[0]]).addTo(m);
          }
          if (mineRef.current != null) {
            const hb = b.buildings.find((x) => x.id === mineRef.current);
            if (hb) {
              const c = centroid(hb.g);
              const d = document.createElement("div");
              d.innerHTML =
                '<div class="m3d-bob" style="font:800 13px sans-serif;background:#15201A;color:#fff;border-radius:999px;padding:3px 10px;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap">🏠 บ้านฉัน</div>';
              d.style.pointerEvents = "none";
              new ml.Marker({ element: d, anchor: "bottom", offset: [0, -28] }).setLngLat([c[1], c[0]]).addTo(m);
              m.jumpTo({ center: [c[1], c[0]], zoom: 18 });
            }
          }
          setReady(true);
        });
        if (edit) {
          let selId = null;
          const pick = (id) => {
            if (selId != null) m.setFeatureState({ source: "walls", id: selId }, { sel: false });
            selId = id;
            if (id != null) m.setFeatureState({ source: "walls", id }, { sel: true });
            setSel(id == null ? null : data.current.find((x) => x.id === id) || null);
          };
          m.on("click", (e) => {
            const hit = m.queryRenderedFeatures(e.point, { layers: ["walls", "roofs", "gone"] })[0];
            if (toolRef.current === "add") {
              if (hit && hit.properties.s !== "removed") return setMsg("ตรงนี้มีอาคารอยู่แล้ว · แตะที่ว่าง");
              const at = [e.lngLat.lat, e.lngLat.lng];
              // copy the nearest house's outline (rows of townhouses are all the same shape)
              let best = null;
              for (const x of data.current) {
                if (x.s === "removed") continue;
                const d = distM(centroid(x.g), at);
                if (!best || d < best.d) best = { d, x };
              }
              const body = { lat: +at[0].toFixed(6), lng: +at[1].toFixed(6) };
              if (best && best.d < 60) {
                const c = centroid(best.x.g);
                body.g = best.x.g.map(([a, b2]) => [+(a - c[0] + at[0]).toFixed(6), +(b2 - c[1] + at[1]).toFixed(6)]);
                body.lv = best.x.lv;
              }
              call("/admin/buildings/add", body, best && best.d < 60 ? "✅ เพิ่มอาคารแล้ว (รูปร่างเดียวกับหลังข้างๆ)" : "✅ เพิ่มอาคารแล้ว (ขนาดมาตรฐาน 7×10 ม.)");
              return;
            }
            if (!hit) return pick(null);
            if (hit.properties.s === "removed") {
              pick(null);
              call("/admin/buildings/restore", { id: hit.properties.id }, "✅ คืนอาคารแล้ว");
              return;
            }
            pick(hit.properties.id);
          });
          m._pick = pick;
        }
      } catch (e) {
        if (!dead) setErr("โหลดแผนที่ 3D ไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้แผนที่ปกติไปก่อน");
      }
    })();
    return () => {
      dead = true;
      if (map.current) map.current.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map.current) map.current.getCanvas().style.cursor = tool === "add" ? "crosshair" : "";
    if (tool === "add" && map.current?._pick) map.current._pick(null);
  }, [tool, ready]);

  function tilt() {
    const m = map.current;
    if (!m) return;
    m.easeTo(flat ? { pitch: 60, bearing: -24 } : { pitch: 0, bearing: 0 });
    setFlat(!flat);
  }

  const setLv = (lv) => {
    if (!sel || lv < 1 || lv > 30) return;
    setSel({ ...sel, lv });
    call("/admin/buildings/shape", { id: sel.id, lv }, `✅ ตั้งเป็น ${lv} ชั้นแล้ว`);
  };

  const selSoi = sel ? soiRef.current[sel.id] : null;

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: "linear-gradient(#BFE4FF, #EAF6FF 45%, #DCEFD6 46%)" }}>
      <style>
        {
          "@keyframes m3dbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}.m3d-bob{animation:m3dbob 1.6s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.m3d-bob{animation:none}}"
        }
      </style>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!ready && !err && <p className="absolute inset-0 grid place-items-center text-neutral-600">กำลังสร้างหมู่บ้านจำลอง…</p>}
      {err && <p className="absolute inset-0 grid place-items-center p-6 text-center text-red-700">{err}</p>}
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1.5">
        {onClose && (
          <button onClick={onClose} className="min-h-[44px] rounded-full bg-[#15201A] px-4 text-[15px] font-bold text-white shadow">
            ✕ ปิด 3D
          </button>
        )}
        <button onClick={tilt} className="min-h-[40px] rounded-full border border-[#D5DBD6] bg-white/95 px-3 text-sm font-bold shadow">
          {flat ? "🏙️ มุมเฉียง" : "🗺️ มองจากบน"}
        </button>
        {!edit && mine == null && ready && <span className="max-w-[12rem] rounded-lg bg-white/90 px-2 py-1 text-right text-xs shadow">ลงเลขที่บ้านในหน้า บ้านฉัน แล้วบ้านคุณจะขึ้นป้าย 🏠 ตรงนี้</span>}
      </div>
      {!edit && ready && (
        <p className="absolute bottom-2 left-2 z-10 rounded-lg bg-white/85 px-2 py-1 text-xs text-neutral-700 shadow">สีบ้าน = ซอย (จากข้อมูลที่ลูกบ้านช่วยกันลง) · หมุน/เอียงด้วยสองนิ้ว</p>
      )}
      {edit && (
        <div className="absolute inset-x-2 bottom-2 z-10 space-y-1.5">
          {sel && tool === "select" && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/95 p-2 shadow-lg">
              <span className="text-sm font-bold">
                {sel.s === "added" ? "อาคารที่เพิ่มเอง" : "อาคารจาก OSM"}
                {selSoi ? ` · ซ.${selSoi}` : " · ยังไม่รู้ซอย"}
              </span>
              <span className="flex items-center gap-1">
                <button disabled={busy} onClick={() => setLv(sel.lv - 1)} className="h-9 w-9 rounded-lg border text-lg font-bold" aria-label="ลดชั้น">
                  −
                </button>
                <b className="w-14 text-center">{sel.lv} ชั้น</b>
                <button disabled={busy} onClick={() => setLv(sel.lv + 1)} className="h-9 w-9 rounded-lg border text-lg font-bold" aria-label="เพิ่มชั้น">
                  +
                </button>
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  const id = sel.id;
                  map.current?._pick(null);
                  call("/admin/buildings/remove", { id }, "✅ ลบอาคารแล้ว · แตะสีแดงเพื่อคืน");
                }}
                className="min-h-[36px] rounded-lg bg-red-700 px-3 text-sm font-bold text-white"
              >
                🗑️ ลบอาคารนี้
              </button>
              <button onClick={() => map.current?._pick(null)} className="ml-auto min-h-[36px] px-2 text-sm text-neutral-600">
                ยกเลิก
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/95 p-1 shadow">
            {[
              ["select", "👆 เลือกอาคาร · ตั้งชั้น / ลบ"],
              ["add", "➕ เพิ่มอาคาร · แตะที่ว่าง"],
            ].map(([k, t]) => (
              <button
                key={k}
                onClick={() => setTool(k)}
                className={`min-h-[44px] rounded-lg text-sm font-semibold ${tool === k ? (k === "add" ? "bg-green-700 text-white" : "bg-[#15201A] text-white") : "text-neutral-600"}`}
              >
                {t}
              </button>
            ))}
          </div>
          {msg && <p className={`rounded-lg bg-white/95 px-2 py-1 text-sm shadow ${msg.startsWith("✅") ? "text-green-800" : "text-red-700"}`}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
