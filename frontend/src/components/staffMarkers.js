import L from "leaflet";
import { MISSIONS, PHASES, VEHICLES, timeAgo } from "../config";
import { isQuiet, tripClaims, tripWhere } from "./Trips";

// Staff on the map must stand out from residents' pins: a big filled disc in the team colour,
// white rim, pulsing ring, the vehicle as the icon, and a name tag. Used by the public map and
// the staff console map. Styles: .staff-pin* in index.css.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TRIP_COLOR = "#2563eb"; // on a trip (moving boat/truck)
const ONLINE_COLOR = "#059669"; // on duty, not on a trip
const SIZE = 54;

function pinHtml(t) {
  const onTrip = !t.presence;
  const [ve] = VEHICLES[t.vehicle] || ["🚗"];
  const icon = !onTrip && t.vehicle === "walk" ? "👷" : ve;
  const badge = onTrip ? (MISSIONS[t.mission] || ["🤝"])[0] : "";
  const quiet = isQuiet(t);
  const color = quiet ? "#737373" : onTrip ? TRIP_COLOR : ONLINE_COLOR;
  return `<div class="staff-pin${quiet ? " quiet" : ""}" style="--c:${color}">
    ${quiet ? "" : '<span class="staff-pin-ring"></span>'}
    <span class="staff-pin-body">${icon}</span>
    ${badge ? `<span class="staff-pin-badge">${badge}</span>` : ""}
    <span class="staff-pin-tag">${onTrip ? "ออกงาน" : "จนท."}</span>
  </div>`;
}

function popupHtml(t) {
  const claims = tripClaims(t);
  const [ve, vt] = VEHICLES[t.vehicle] || ["🚗", ""];
  const when = `<span style="color:#666">${isQuiet(t) ? "ตำแหน่งล่าสุด" : "อัปเดต"} ${timeAgo(t.updated_at)}</span>`;
  if (t.presence) {
    return `<b>${t.vehicle === "walk" ? "👷" : ve} ${esc(t.label)}</b>${t.vehicle !== "walk" ? ` · ${esc(vt)}` : ""}<br>${
      t.note ? `📝 ${esc(t.note)}` : '<span style="color:#666">ออนไลน์ พร้อมช่วย (ยังไม่ได้เขียนว่ากำลังจะทำอะไร)</span>'
    }${claims ? `<br>📋 ${esc(claims)}` : ""}<br>${esc(tripWhere(t))}<br>${when}`;
  }
  const [me, mt] = MISSIONS[t.mission] || ["🤝", ""];
  const [pe, pt] = PHASES[t.phase] || PHASES.enroute;
  return `<b>${ve} ${esc(t.label)}</b><br>${me} ${mt}<br>${pe} ${pt} · ${esc(tripWhere(t))}${t.note ? `<br>📝 ${esc(t.note)}` : ""}${
    claims ? `<br>📋 ${esc(claims)}` : ""
  }<br>${when}`;
}

export function drawStaff(layer, trips, pane) {
  layer.clearLayers();
  // quiet ones first so live ones are drawn on top
  const sorted = [...trips].sort((a, b) => isQuiet(b) - isQuiet(a));
  for (const t of sorted) {
    if (t.lat == null) continue; // no GPS fix yet / outside the area: listed in the strip only
    if (!t.presence && t.path?.length > 1) {
      L.polyline(t.path, { pane, color: TRIP_COLOR, weight: 4, opacity: 0.6, dashArray: "6 6", interactive: false }).addTo(layer);
    }
    L.marker([t.lat, t.lng], {
      pane,
      zIndexOffset: isQuiet(t) ? 0 : 1000,
      icon: L.divIcon({ className: "", iconSize: [SIZE, SIZE], iconAnchor: [SIZE / 2, SIZE / 2], popupAnchor: [0, -SIZE / 2], html: pinHtml(t) }),
    })
      .bindTooltip(esc(t.label), { permanent: true, direction: "bottom", offset: [0, SIZE / 2 + 2], className: `trip-label${t.presence ? " staff-label" : ""}` })
      .bindPopup(popupHtml(t))
      .addTo(layer);
  }
}
