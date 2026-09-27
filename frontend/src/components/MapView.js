import { useEffect, useRef } from "react";
import L from "leaflet";
import { KINDS, VILLAGE_BOUNDARY, VILLAGE_CENTER, VILLAGE_ZOOM, categoryOf, timeAgo, waterOf } from "../config";
import { mediaUrl } from "../media";

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

  useEffect(() => {
    const map = createBaseMap(elRef.current);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
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

  useEffect(() => {
    if (focus && mapRef.current) mapRef.current.setView([focus.lat, focus.lng], 18);
  }, [focus]);

  return <div ref={elRef} className="h-full w-full" />;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
