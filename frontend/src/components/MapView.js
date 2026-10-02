import { useEffect, useRef, useState } from "react";
import L from "../leafletGlobal";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { KINDS, VILLAGE_BOUNDARY, VILLAGE_CENTER, VILLAGE_ZOOM, categoryOf, timeAgo, waterOf } from "../config";
import { mediaUrl } from "../media";
import { drawStaff } from "./staffMarkers";
import { WATER_LEVELS, WATER_TREND, WATER_WHERE } from "../config";
import { MAX_AGE_H, STALE_H, describeLevel, estimateAt, fieldBounds, renderField, toPoints } from "../waterField";
import { load, save } from "../api";
import { CANALS, CANAL_STATE, LEAK_SEV, LEAK_STATUS, PUMP_STATUS, canalSummary } from "./Canal";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function createBaseMap(el, { center = VILLAGE_CENTER, zoom = VILLAGE_ZOOM } = {}) {
  const map = L.map(el, { center, zoom, zoomControl: true, tap: true });
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);
  L.polygon(VILLAGE_BOUNDARY, { color: "#000000", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
  return map;
}

function postIcon(post, isNew = false) {
  const [emoji] = categoryOf(post);
  const kind = KINDS[post.kind];
  // Monochrome pins: fill = kind, dashed ring = someone is helping, grey = done
  const border = post.status === "helping" ? "3px dashed #000" : `3px solid ${kind.pin === "#000000" ? "#fff" : "#000"}`;
  const size = post.urgent && post.status === "open" ? 44 : 36;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="${isNew ? "pin-drop " : ""}${post.urgent && post.status === "open" ? "pin-urgent" : ""}" style="width:${size}px;height:${size}px;border-radius:9999px;background:${
      post.status === "done" ? "#e5e5e5" : kind.pin
    };border:${border};box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;position:relative;font-size:${
      size / 2
    }px">${emoji}${
      post.payment === "paid"
        ? '<span style="position:absolute;top:-8px;right:-8px;font-size:14px;line-height:1;background:#fff;border:1.5px solid #000;border-radius:9999px;padding:1px">💰</span>'
        : ""
    }</div>`,
  });
}

// What the map shows. Busy days put 100+ requests and dozens of water readings on the same streets,
// so by default: requests (urgent ones always as their own pin, the rest grouped when zoomed out),
// staff, and the water colour surface. Water report dots, offers and info are one tap away.
const LAYER_DEFAULTS = { need: true, offer: false, info: false };

function levelHtml(lat, lng, points) {
  const est = estimateAt(lat, lng, points);
  if (!est) return `ยังไม่มีรายงานระดับน้ำใน ${MAX_AGE_H} ชม. ในระยะ 300 ม. จากจุดนี้`;
  const age = est.newestH < 1 ? "ไม่ถึง 1 ชม.ที่แล้ว" : `${Math.round(est.newestH)} ชม.ที่แล้ว`;
  return `<b>ระดับน้ำโดยประมาณ: ${describeLevel(est.level).label}</b> (${describeLevel(est.level).cm})<br><span style="color:#555">จากรายงานใกล้เคียง ${est.used} จุด · ใกล้สุด ${Math.round(est.nearest)} ม. · ล่าสุด ${age}</span>${
    est.newestH > STALE_H ? `<br><b style="color:#b45309">⚠️ ข้อมูลแถวนี้เก่าแล้ว น้ำอาจเปลี่ยนไป ช่วยแจ้งระดับน้ำตอนนี้</b>` : ""
  }`;
}

// Group bubble: how many requests, and a red badge when there are ones nobody is helping yet.
function clusterIcon(cluster) {
  const kids = cluster.getAllChildMarkers();
  const n = kids.length;
  const open = kids.filter((m) => m.options.post?.kind === "need" && m.options.post?.status === "open").length;
  const size = n < 10 ? 40 : n < 50 ? 48 : 56;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    html: `<div class="map-cluster" style="width:${size}px;height:${size}px">${n}${open ? `<span class="map-cluster-open">${open}</span>` : ""}</div>`,
  });
}

// 1 Oct: the map opens on the water view; truck drop points are always on it; in the water view it also
// shows the canal reports (how far below the flood wall) and the pumps.
export default function MapView({ posts, water, trips = [], onSelect, focus, filter = "all", onReportWater, drops = [], canal = null, onReportCanal, onPump, onPumps, canAddPump = false, onLeak, onLeaks, hubs = [] }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const clusterRef = useRef(null);
  const fieldRef = useRef(null);
  const tripsRef = useRef(null);
  const pointsRef = useRef([]);
  const seenPins = useRef(new Set());
  const [showField, setShowField] = useState(() => load("showWaterField", true));
  const [layers, setLayers] = useState(() => ({ ...LAYER_DEFAULTS, ...load("mapLayers", {}) }));
  // Two clear views instead of everything at once: 🆘 requests, or 💧 water level (colours + report dots only)
  const [mode, setModeState] = useState("water"); // opens on the water level
  const setMode = (m) => {
    setModeState(m);
    mapRef.current?.closePopup();
  };
  const waterMode = mode === "water";
  const fieldOn = waterMode || showField;
  const [hint, setHint] = useState("");
  const toggle = (k) =>
    setLayers((l) => {
      const next = { ...l, [k]: !l[k] };
      save("mapLayers", next);
      return next;
    });

  useEffect(() => {
    const map = createBaseMap(elRef.current);
    // Surface sits above the tiles but below report dots and pins.
    map.createPane("waterField").style.zIndex = 350;
    map.getPane("waterField").style.pointerEvents = "none";
    layerRef.current = L.layerGroup().addTo(map);
    clusterRef.current = L.markerClusterGroup({
      maxClusterRadius: 42,
      disableClusteringAtZoom: 18, // street level: every house on its own
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      iconCreateFunction: clusterIcon,
    }).addTo(map);
    map.createPane("trips").style.zIndex = 650; // moving vehicles above every other pin
    tripsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", (e) => {
      if (!fieldRef.current) return;
      L.popup().setLatLng(e.latlng).setContent(levelHtml(e.latlng.lat, e.latlng.lng, pointsRef.current)).openOn(map);
    });
    // Map containers that start hidden (mobile tabs) need a size refresh when shown.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      map.remove();
    };
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    const cluster = clusterRef.current;
    if (!layer) return;
    layer.clearLayers();
    cluster.clearLayers();

    // Latest report per ~30 m cell, so old readings at the same spot don't pile up.
    const seen = new Set();
    for (const w of waterMode ? water : []) {
      const cell = `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`;
      if (seen.has(cell)) continue;
      seen.add(cell);
      const ageH = (Date.now() - new Date(w.created_at).getTime()) / 3.6e6;
      if (ageH > 24) continue; // a day old says nothing about now
      const stale = ageH > STALE_H;
      const lv = waterOf(w.level);
      L.circleMarker([w.lat, w.lng], {
        radius: stale ? 7 : 11,
        color: stale ? "#9ca3af" : "#fff",
        weight: 2,
        dashArray: stale ? "3 3" : null,
        fillColor: lv.color,
        fillOpacity: stale ? 0.3 : 0.85,
        bubblingMouseEvents: false, // its own popup, not the map's estimate
      })
        .bindPopup(
          `${stale ? `<b style="color:#b45309">⚠️ ข้อมูลเก่า ${Math.round(ageH)} ชม. — ตอนนี้อาจไม่ใช่แล้ว</b><br>` : ""}<b>💧 ระดับน้ำ: ${lv.label} (${w.cm != null ? `${w.cm} ซม.` : lv.cm})</b>${w.trend ? ` ${WATER_TREND[w.trend][0]} ${WATER_TREND[w.trend][1]}` : ""}${
            w.where ? `<br>${WATER_WHERE[w.where][0]} วัด${WATER_WHERE[w.where][1]}` : ""
          }<br>${timeAgo(w.created_at)}${w.name ? ` · ${escapeHtml(w.name)}` : ""}${
            w.note ? `<br>${escapeHtml(w.note)}` : ""
          }${
            w.media?.[0]
              ? `<br><a href="${mediaUrl(w.media[0].id)}" target="_blank" rel="noreferrer"><img src="${mediaUrl(w.media[0].id, "thumb")}" alt="" style="margin-top:6px;width:180px;max-width:100%;border-radius:6px"></a>`
              : ""
          }`
        )
        .addTo(layer);
    }

    // truck drop points (one pin per block, stacked when two teams share a shop)
    const stacked = {};
    for (const d of drops) {
      if (d.lat == null) continue;
      const at = `${(+d.lat).toFixed(5)},${(+d.lng).toFixed(5)}`;
      const lift = 30 * (stacked[at] = (stacked[at] ?? -1) + 1);
      L.marker([d.lat, d.lng], {
        zIndexOffset: 800,
        icon: L.divIcon({ className: "", iconSize: [74, 28], iconAnchor: [37, 14 + lift], html: `<div class="drop-pin small" style="--c:${d.color}">🚚 ${escapeHtml(d.tag)}</div>` }),
      })
        .bindPopup(`<b>🚚 จุดลงของ ${escapeHtml(d.tag)}</b><br>${escapeHtml(d.place || "")}${d.person ? `<br>👤 ${escapeHtml(d.person)}` : ""}<br><a href="/zones">ดูแผนที่โซน</a>`)
        .addTo(layer);
    }
    // volunteer centre / hand-out point (repair mode, set by admins): on both views
    for (const h of hubs) {
      if (h.lat == null || h.lng == null) continue;
      L.marker([h.lat, h.lng], {
        zIndexOffset: 1100,
        icon: L.divIcon({ className: "", iconSize: [96, 30], iconAnchor: [48, 15], html: `<div class="drop-pin" style="--c:#facc15;color:#000">🤝 ${escapeHtml(h.tag || "ศูนย์อาสา")}</div>` }),
      })
        .bindPopup(
          `<b>📍 ${escapeHtml(h.title || "")}</b>${h.sub ? `<br>${escapeHtml(h.sub)}` : ""}<br><a href="https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}" target="_blank" rel="noreferrer">นำทาง ›</a>`
        )
        .addTo(layer);
    }
    // leaks in the flood wall: on both views, they need hands now
    for (const lk of canal?.leaks || []) {
      if (lk.lat == null) continue;
      const st = LEAK_STATUS[lk.status] || LEAK_STATUS.open;
      L.marker([lk.lat, lk.lng], {
        zIndexOffset: 1200,
        icon: L.divIcon({ className: "", iconSize: [36, 36], iconAnchor: [18, 18], html: `<div class="leak-pin ${lk.status}" style="--c:${st.color}">🕳️</div>` }),
      })
        .on("click", () => onLeak?.(lk))
        .bindTooltip(`รูรั่ว${lk.soi ? ` ท้ายซอย ${escapeHtml(lk.soi)}` : ""} · ${LEAK_SEV[lk.severity]?.label || ""} · ${st.label}`, { direction: "top", offset: [0, -16] })
        .addTo(layer);
    }
    if (waterMode && canal) {
      // latest report per spot (canal + ~30 m), last 24 h
      const spot = new Set();
      for (const r of canal.reports || []) {
        if (r.lat == null) continue;
        const key = `${r.canal}|${(+r.lat).toFixed(4)},${(+r.lng).toFixed(4)}`;
        const ageH = (Date.now() - new Date(r.created_at).getTime()) / 3.6e6;
        if (spot.has(key) || ageH > 24) continue;
        spot.add(key);
        const st = CANAL_STATE[r.state];
        const text = r.state === "below" && r.below_cm != null ? `ต่ำกว่าขอบ ${r.below_cm} ซม.` : st.label;
        L.marker([r.lat, r.lng], {
          zIndexOffset: 900,
          icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="canal-pin${ageH > 3 ? " old" : ""}" style="--c:${st.color}">🌊</div>` }),
        })
          .bindPopup(
            `<b>🌊 ${CANALS[r.canal]}: ${text}</b>${r.soi ? `<br>ท้ายซอย ${escapeHtml(r.soi)}` : ""}<br>${timeAgo(r.created_at)}${r.name ? ` · ${escapeHtml(r.name)}` : ""}${
              r.note ? `<br>${escapeHtml(r.note)}` : ""
            }${ageH > 3 ? `<br><b style="color:#b45309">⚠️ รายงานเก่ากว่า 3 ชม.</b>` : ""}${
              r.media?.[0] ? `<br><a href="${mediaUrl(r.media[0].id)}" target="_blank" rel="noreferrer"><img src="${mediaUrl(r.media[0].id, "thumb")}" alt="" style="margin-top:6px;width:180px;max-width:100%;border-radius:6px"></a>` : ""
            }`
          )
          .addTo(layer);
      }
      for (const pm of canal.pumps || []) {
        if (pm.lat == null) continue;
        const st = PUMP_STATUS[pm.status] || PUMP_STATUS.stopped;
        L.marker([pm.lat, pm.lng], {
          zIndexOffset: 950,
          icon: L.divIcon({ className: "", iconSize: [34, 34], iconAnchor: [17, 17], html: `<div class="pump-pin ${pm.status}">⚙️</div>` }),
        })
          .on("click", () => onPump?.(pm))
          .bindTooltip(`${st.icon} ${escapeHtml(pm.label)} · ${st.label}`, { direction: "top", offset: [0, -14] })
          .addTo(layer);
      }
    }

    const pinned = []; // urgent open requests: never hidden inside a group
    const grouped = [];
    for (const p of waterMode ? [] : posts) {
      if (p.general) continue; // "ทั้งหมู่บ้าน" posts are listed, not pinned
      // a specific filter chosen above the map wins over the layer switches
      if (filter === "all" && !layers[p.kind]) continue;
      const isNew = !seenPins.current.has(p.id);
      seenPins.current.add(p.id);
      const m = L.marker([p.lat, p.lng], { icon: postIcon(p, isNew), post: p, zIndexOffset: p.urgent ? 1000 : p.kind === "need" ? 500 : 0 }).on("click", () => onSelect(p.id));
      (p.urgent && p.status === "open" ? pinned : grouped).push(m);
    }
    pinned.forEach((m) => m.addTo(layer));
    cluster.addLayers(grouped);
  }, [posts, water, onSelect, layers, filter, waterMode, drops, canal, onPump, onLeak, hubs]);

  // Staff boats / trucks / people on duty: big, pulsing, always above residents' pins
  useEffect(() => {
    if (tripsRef.current) drawStaff(tripsRef.current, trips, "trips");
  }, [trips]);

  // Interpolated water surface. Rebuilt only when the set of reports changes (not on every 20 s poll).
  const fieldKey = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${fieldOn}|${water.map((w) => w.id).join(",")}|${Math.floor(Date.now() / 600000)}`; // + 10-min bucket for time decay
    if (key === fieldKey.current) return;
    fieldKey.current = key;
    if (fieldRef.current) {
      map.removeLayer(fieldRef.current);
      fieldRef.current = null;
    }
    pointsRef.current = toPoints(water);
    if (!fieldOn) return;
    const canvas = renderField(pointsRef.current);
    if (!canvas) return;
    fieldRef.current = L.imageOverlay(canvas.toDataURL(), fieldBounds(), { pane: "waterField", interactive: false, className: "water-field" }).addTo(map);
  }, [water, fieldOn]);

  useEffect(() => {
    if (!focus || !mapRef.current) return;
    if (focus.water) setModeState("water");
    mapRef.current.setView([focus.lat, focus.lng], 18);
  }, [focus]);

  function hereLevel() {
    if (!navigator.geolocation) return setHint("เครื่องนี้หาตำแหน่งไม่ได้ — แตะบนแผนที่แทน");
    setHint("กำลังหาตำแหน่ง…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setHint("");
        mapRef.current.setView([lat, lng], 17);
        L.popup().setLatLng([lat, lng]).setContent(`<b>📍 ตรงที่คุณอยู่</b><br>${levelHtml(lat, lng, pointsRef.current)}`).openOn(mapRef.current);
      },
      () => setHint("ไม่ได้อนุญาตตำแหน่ง — แตะบนแผนที่ตรงบ้านคุณแทน"),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  }

  const count = (k) => posts.filter((p) => p.kind === k && !p.general).length;
  const canalLines = canalSummary(canal?.reports || []);
  const pumps = (canal?.pumps || []).filter((x) => x.status !== "removed");
  const openLeaks = (canal?.leaks || []).filter((x) => x.status !== "sealed").length;
  const chips = [
    ["offer", "🤝 ช่วยได้", count("offer")],
    ["info", "📍 ข้อมูล", count("info")],
  ].filter(([, , n]) => n > 0);
  const tabCls = (on) => `pointer-events-auto min-h-[44px] flex-1 rounded-full px-3 text-sm font-bold ${on ? "bg-black text-white" : "text-neutral-800"}`;

  return (
    <div className="relative h-full w-full">
      <div ref={elRef} className="h-full w-full" />
      {/* one big switch: what am I looking at */}
      <div className="pointer-events-none absolute inset-x-0 top-2 z-[600] flex justify-center px-12">
        <div className="pointer-events-auto flex w-full max-w-xs rounded-full border-2 border-black bg-white/95 p-0.5 shadow-lg" role="tablist" aria-label="ดูบนแผนที่">
          <button type="button" role="tab" aria-selected={!waterMode} onClick={() => setMode("need")} className={tabCls(!waterMode)}>
            🆘 คำขอช่วย
          </button>
          <button type="button" role="tab" aria-selected={waterMode} onClick={() => setMode("water")} className={tabCls(waterMode)}>
            💧 ระดับน้ำ
          </button>
        </div>
      </div>

      {waterMode ? (
        <div className="pointer-events-none absolute inset-x-2 bottom-6 z-[500] flex flex-col items-start gap-1">
          <div className="pointer-events-auto rounded-lg bg-white/95 px-2 py-1.5 text-xs leading-tight shadow">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {WATER_LEVELS.map((w) => (
                <span key={w.label} className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full border border-white" style={{ background: w.color }} />
                  {w.label}
                </span>
              ))}
            </div>
            {canalLines.map((c) => (
              <p key={c.key} className="mt-0.5 font-semibold">
                {CANAL_STATE[c.state].icon} {c.name}: {c.title} → {c.short}
                {c.stale && <span className="font-normal text-amber-700"> (เก่า)</span>}
              </p>
            ))}
            <p className="mt-0.5 text-neutral-600">👆 แตะแผนที่ดูระดับน้ำตรงนั้น · 🌊 / ⚙️ แตะดูรายละเอียด</p>
            {hint && <p className="text-neutral-600">{hint}</p>}
          </div>
          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={hereLevel} aria-label="ระดับน้ำตรงที่ฉันอยู่" className="pointer-events-auto min-h-[44px] rounded-full border-2 border-black bg-white px-3 text-sm font-bold shadow">
              📍 ตรงฉัน
            </button>
            {onReportWater && (
              <button type="button" onClick={onReportWater} className="pointer-events-auto min-h-[44px] rounded-full bg-sky-600 px-3 text-sm font-bold text-white shadow">
                💧 แจ้งน้ำ
              </button>
            )}
            {onLeaks && (
              <button type="button" onClick={onLeaks} className="pointer-events-auto min-h-[44px] rounded-full bg-red-700 px-3 text-sm font-bold text-white shadow">
                🕳️ รูรั่ว{openLeaks ? ` ${openLeaks}` : ""}
              </button>
            )}
            {onReportCanal && (
              <button type="button" onClick={onReportCanal} className="pointer-events-auto min-h-[44px] rounded-full bg-blue-900 px-3 text-sm font-bold text-white shadow">
                🌊 แจ้งคลอง
              </button>
            )}
            {onPumps && (pumps.length > 0 || canAddPump) && (
              <button type="button" onClick={onPumps} className="pointer-events-auto min-h-[44px] rounded-full border-2 border-black bg-white px-3 text-sm font-bold shadow">
                ⚙️ ปั๊ม {pumps.filter((x) => x.status === "running").length}/{pumps.length}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-6 left-2 z-[500] flex max-w-[85%] flex-wrap gap-1">
          {onLeaks && (
            <button type="button" onClick={onLeaks} className="pointer-events-auto min-h-[36px] rounded-full bg-red-700 px-2.5 text-xs font-bold text-white shadow">
              🕳️ รูรั่ว{openLeaks ? ` ${openLeaks}` : ""}
            </button>
          )}
          {water.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setShowField((v) => !v);
                save("showWaterField", !showField);
              }}
              aria-pressed={showField}
              className={`pointer-events-auto min-h-[36px] rounded-full border-2 px-2.5 text-xs font-semibold shadow ${showField ? "border-black bg-black text-white" : "border-neutral-300 bg-white/95 text-neutral-700"}`}
            >
              {showField ? "✓ " : ""}🌊 สีน้ำ
            </button>
          )}
          {chips.map(([k, label, n]) => {
            const on = filter === "all" ? layers[k] : filter === k;
            return (
              <button
                key={k}
                type="button"
                disabled={filter !== "all"}
                onClick={() => toggle(k)}
                aria-pressed={on}
                className={`pointer-events-auto min-h-[36px] rounded-full border-2 px-2.5 text-xs font-semibold shadow ${on ? "border-black bg-black text-white" : "border-neutral-300 bg-white/95 text-neutral-700"} ${filter !== "all" ? "opacity-60" : ""}`}
              >
                {on ? "✓ " : ""}
                {label} {n}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
