// 🏙️ 3D village map (12 Oct 2026): every house from OpenStreetMap raised by its number of floors, on the same
// OSM tiles as the 2D map. MapLibre is loaded from a CDN only when someone opens it, so the app bundle stays small.
// With `edit` (/admin › ที่อยู่ › อาคาร) the admin fixes the map: tap a house to set floors or remove it, tap a red
// (removed) one to bring it back, or switch to ➕ and tap an empty spot to add a house shaped like its neighbour.
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
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

const FLOOR_M = 3.2;
const centroid = (g) => [g.reduce((a, p) => a + p[0], 0) / g.length, g.reduce((a, p) => a + p[1], 0) / g.length];
const distM = (a, b) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * 0.9715);

function toGeo(list) {
  return {
    type: "FeatureCollection",
    features: list.map((b) => ({
      type: "Feature",
      id: b.id,
      properties: { id: b.id, lv: b.lv, h: b.lv * FLOOR_M, s: b.s || "osm" },
      geometry: { type: "Polygon", coordinates: [[...b.g.map(([la, ln]) => [ln, la]), [b.g[0][1], b.g[0][0]]]] },
    })),
  };
}

export default function Map3D({ edit = false, onClose, className = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const data = useRef([]);
  const toolRef = useRef("select");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState(null); // selected building
  const [tool, setTool] = useState("select");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [flat, setFlat] = useState(false);
  toolRef.current = tool;

  const path = edit ? "/admin/buildings3d" : "/buildings3d";

  function paint(list) {
    data.current = list;
    const src = map.current && map.current.getSource("b");
    if (src) src.setData(toGeo(list));
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
        const [ml, b, so] = await Promise.all([loadMapLibre(), api(path), api("/sois").catch(() => ({ sois: {} }))]);
        if (dead || !el.current) return;
        data.current = b.buildings;
        const m = new ml.Map({
          container: el.current,
          center: [VILLAGE_CENTER[1], VILLAGE_CENTER[0]],
          zoom: 16.6,
          pitch: 58,
          bearing: -18,
          maxPitch: 75,
          attributionControl: { compact: true },
          style: {
            version: 8,
            sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
            layers: [{ id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.35, "raster-brightness-max": 0.95 } }],
          },
        });
        map.current = m;
        m.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");
        m.on("load", () => {
          m.addSource("edge", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [...VILLAGE_BOUNDARY, VILLAGE_BOUNDARY[0]].map(([a, c]) => [c, a]) } } });
          m.addLayer({ id: "edge", type: "line", source: "edge", paint: { "line-color": "#15201A", "line-width": 2, "line-dasharray": [3, 3] } });
          const soiLines = [];
          for (const [k, s] of Object.entries(so.sois || {}))
            for (const ln of s.lines || []) soiLines.push({ type: "Feature", properties: { k }, geometry: { type: "LineString", coordinates: ln.map(([a, c]) => [c, a]) } });
          m.addSource("soi", { type: "geojson", data: { type: "FeatureCollection", features: soiLines } });
          m.addLayer({ id: "soi", type: "line", source: "soi", paint: { "line-color": "#2563EB", "line-width": 3, "line-opacity": 0.45 } });
          m.addSource("b", { type: "geojson", data: toGeo(b.buildings), promoteId: "id" });
          m.addLayer({ id: "gone", type: "fill", source: "b", filter: ["==", ["get", "s"], "removed"], paint: { "fill-color": "#E5484D", "fill-opacity": 0.45, "fill-outline-color": "#B42318" } });
          m.addLayer({
            id: "b3d",
            type: "fill-extrusion",
            source: "b",
            filter: ["!=", ["get", "s"], "removed"],
            paint: {
              "fill-extrusion-color": [
                "case",
                ["boolean", ["feature-state", "sel"], false],
                "#F59E0B",
                ["==", ["get", "s"], "added"],
                "#5FA77A",
                ["interpolate", ["linear"], ["get", "lv"], 1, "#EFE6D6", 3, "#D9CBB4", 6, "#B9A88E"],
              ],
              "fill-extrusion-height": ["get", "h"],
              "fill-extrusion-opacity": 0.93,
            },
          });
          // soi names as plain HTML labels (no glyph server needed)
          for (const [k, s] of Object.entries(so.sois || {})) {
            const ln = (s.lines || []).reduce((a, x) => (x.length > a.length ? x : a), []);
            if (!ln.length) continue;
            const mid = ln[Math.floor(ln.length / 2)];
            const d = document.createElement("div");
            d.textContent = `ซ.${k}`;
            d.style.cssText = "font:800 11px sans-serif;color:#fff;background:#2563EB;border-radius:6px;padding:1px 5px;white-space:nowrap;opacity:.9;pointer-events:none";
            new ml.Marker({ element: d }).setLngLat([mid[1], mid[0]]).addTo(m);
          }
          setReady(true);
        });
        if (edit) {
          let selId = null;
          const pick = (id) => {
            if (selId != null) m.setFeatureState({ source: "b", id: selId }, { sel: false });
            selId = id;
            if (id != null) m.setFeatureState({ source: "b", id }, { sel: true });
            setSel(id == null ? null : data.current.find((x) => x.id === id) || null);
          };
          m.on("click", (e) => {
            const hit = m.queryRenderedFeatures(e.point, { layers: ["b3d", "gone"] })[0];
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
    m.easeTo(flat ? { pitch: 58, bearing: -18 } : { pitch: 0, bearing: 0 });
    setFlat(!flat);
  }

  const setLv = (lv) => {
    if (!sel || lv < 1 || lv > 30) return;
    setSel({ ...sel, lv });
    call("/admin/buildings/shape", { id: sel.id, lv }, `✅ ตั้งเป็น ${lv} ชั้นแล้ว`);
  };

  return (
    <div className={`relative overflow-hidden bg-[#E9EDEA] ${className}`}>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!ready && !err && <p className="absolute inset-0 grid place-items-center text-neutral-600">กำลังโหลดแผนที่ 3D…</p>}
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
      </div>
      {edit && (
        <div className="absolute inset-x-2 bottom-2 z-10 space-y-1.5">
          {sel && tool === "select" && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white/95 p-2 shadow-lg">
              <span className="text-sm font-bold">{sel.s === "added" ? "อาคารที่เพิ่มเอง" : "อาคารจาก OSM"}</span>
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
