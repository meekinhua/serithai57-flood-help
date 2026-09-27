import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { KINDS, VILLAGE_BOUNDARY, VILLAGE_CENTER, VILLAGE_ZOOM, categoryOf, timeAgo, waterOf } from "../config";
import { mediaUrl } from "../media";
import { WATER_LEVELS } from "../config";
import { describeLevel, estimateAt, fieldBounds, renderField, toPoints } from "../waterField";
import { load, save } from "../api";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export function createBaseMap(el, { center = VILLAGE_CENTER, zoom = VILLAGE_ZOOM } = {}) {
  const map = L.map(el, { center, zoom, zoomControl: true, tap: true });
  L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTR }).addTo(map);
  L.polygon(VILLAGE_BOUNDARY, { color: "#000000", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(map);
  return map;
}

function postIcon(post) {
  const [emoji] = categoryOf(post);
  const kind = KINDS[post.kind];
  // Monochrome pins: fill = kind, dashed ring = someone is helping, grey = done
  const border = post.status === "helping" ? "3px dashed #000" : `3px solid ${kind.pin === "#000000" ? "#fff" : "#000"}`;
  const size = post.urgent && post.status === "open" ? 44 : 36;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div class="${post.urgent && post.status === "open" ? "pin-urgent" : ""}" style="width:${size}px;height:${size}px;border-radius:9999px;background:${
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

export default function MapView({ posts, water, onSelect, focus }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const fieldRef = useRef(null);
  const pointsRef = useRef([]);
  const [showField, setShowField] = useState(() => load("showWaterField", true));

  useEffect(() => {
    const map = createBaseMap(elRef.current);
    // Surface sits above the tiles but below report dots and pins.
    map.createPane("waterField").style.zIndex = 350;
    map.getPane("waterField").style.pointerEvents = "none";
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", (e) => {
      if (!fieldRef.current) return;
      const est = estimateAt(e.latlng.lat, e.latlng.lng, pointsRef.current);
      const html = est
        ? `<b>ระดับน้ำโดยประมาณ: ${describeLevel(est.level).label}</b> (${describeLevel(est.level).cm})<br><span style="color:#555">คำนวณจากรายงานใกล้เคียง ${est.used} จุด · ใกล้สุด ${Math.round(est.nearest)} ม.</span>`
        : `ยังไม่มีรายงานระดับน้ำในระยะ 300 ม. จากจุดนี้`;
      L.popup().setLatLng(e.latlng).setContent(html).openOn(map);
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
    if (!layer) return;
    layer.clearLayers();

    // Latest report per ~30 m cell, so old readings at the same spot don't pile up.
    const seen = new Set();
    for (const w of water) {
      const cell = `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`;
      if (seen.has(cell)) continue;
      seen.add(cell);
      const lv = waterOf(w.level);
      L.circleMarker([w.lat, w.lng], { radius: 11, color: "#fff", weight: 2, fillColor: lv.color, fillOpacity: 0.85 })
        .bindPopup(
          `<b>💧 ระดับน้ำ: ${lv.label} (${lv.cm})</b><br>${timeAgo(w.created_at)}${w.name ? ` · ${escapeHtml(w.name)}` : ""}${
            w.note ? `<br>${escapeHtml(w.note)}` : ""
          }${
            w.media?.[0]
              ? `<br><a href="${mediaUrl(w.media[0].id)}" target="_blank" rel="noreferrer"><img src="${mediaUrl(w.media[0].id, "thumb")}" alt="" style="margin-top:6px;width:180px;max-width:100%;border-radius:6px"></a>`
              : ""
          }`
        )
        .addTo(layer);
    }

    for (const p of posts) {
      L.marker([p.lat, p.lng], { icon: postIcon(p), zIndexOffset: p.urgent ? 1000 : p.kind === "need" ? 500 : 0 })
        .on("click", () => onSelect(p.id))
        .addTo(layer);
    }
  }, [posts, water, onSelect]);

  // Interpolated water surface. Rebuilt only when the set of reports changes (not on every 20 s poll).
  const fieldKey = useRef("");
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${showField}|${water.map((w) => w.id).join(",")}|${Math.floor(Date.now() / 600000)}`; // + 10-min bucket for time decay
    if (key === fieldKey.current) return;
    fieldKey.current = key;
    if (fieldRef.current) {
      map.removeLayer(fieldRef.current);
      fieldRef.current = null;
    }
    pointsRef.current = toPoints(water);
    if (!showField) return;
    const canvas = renderField(pointsRef.current);
    if (!canvas) return;
    fieldRef.current = L.imageOverlay(canvas.toDataURL(), fieldBounds(), { pane: "waterField", interactive: false, className: "water-field" }).addTo(map);
  }, [water, showField]);

  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.setView([focus.lat, focus.lng], 18);
  }, [focus]);

  const hasReports = water.length > 0;

  return (
    <div className="relative h-full w-full">
      <div ref={elRef} className="h-full w-full" />
      {hasReports && (
        <div className="pointer-events-none absolute right-2 top-2 z-[500] flex max-w-[70%] flex-col items-end gap-1">
          <button
            onClick={() => {
              setShowField((v) => !v);
              save("showWaterField", !showField);
            }}
            aria-pressed={showField}
            className={`pointer-events-auto min-h-[44px] rounded-lg border-2 border-black px-3 text-sm font-semibold shadow ${showField ? "bg-black text-white" : "bg-white text-black"}`}
          >
            🌊 ระบายสีระดับน้ำ {showField ? "เปิด" : "ปิด"}
          </button>
          {showField && (
            <div className="rounded-lg bg-white/95 px-2 py-1 text-[11px] leading-tight shadow">
              <div className="h-2 w-40 max-w-full rounded" style={{ background: `linear-gradient(to right, ${WATER_LEVELS.map((w) => w.color).join(",")})` }} />
              <div className="mt-0.5 flex justify-between gap-2 text-neutral-700">
                <span>{WATER_LEVELS[0].label}</span>
                <span>{WATER_LEVELS[3].label}</span>
                <span>{WATER_LEVELS[WATER_LEVELS.length - 1].label}</span>
              </div>
              <div className="text-neutral-500">ค่าประมาณจากรายงาน · แตะแผนที่เพื่อดูระดับ</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
