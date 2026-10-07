// Electrician teams on a map: a 👷 label per team that has "📍 ตำแหน่งฉัน" on (positions expire after 20 minutes).
// Used by the technicians' page and the public progress map on the home page.
import L from "leaflet";
import { timeAgo } from "../config";

export function drawTeams(layer, teams, me = "") {
  layer.clearLayers();
  for (const t of teams || []) {
    const mine = t.name === me;
    const icon = L.divIcon({
      className: "",
      iconSize: [120, 40],
      iconAnchor: [60, 40],
      html: `<div style="display:flex;flex-direction:column;align-items:center;pointer-events:none">
        <div style="background:${mine ? "#2563eb" : "#111827"};color:#fff;border-radius:9999px;padding:2px 8px;font:700 11px/1.3 sans-serif;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.4)">👷 ${escape(t.name)}</div>
        <div style="width:12px;height:12px;border-radius:9999px;background:${mine ? "#2563eb" : "#111827"};border:2px solid #fff;margin-top:2px"></div></div>`,
    });
    L.marker([t.lat, t.lng], { icon, zIndexOffset: 1000, interactive: true })
      .bindTooltip(`${escape(t.name)} · ${timeAgo(t.at)}`)
      .addTo(layer);
  }
}

function escape(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
