// one place (pin / area / route) on a Leaflet layer — used by the village map and /admin › สถานที่
import L from "leaflet";

export function drawPlace(p, layer, { onClick, faded } = {}) {
  const g = p.geometry;
  const op = faded ? 0.45 : 1;
  let shape;
  if (p.kind === "pin") {
    shape = L.marker(g, {
      icon: L.divIcon({
        className: "",
        iconSize: null,
        iconAnchor: [16, 16],
        html: `<div style="opacity:${op};display:flex;align-items:center;gap:3px;background:#fff;border:2px solid ${p.color};border-radius:999px;padding:2px 7px 2px 3px;box-shadow:0 1px 4px rgba(0,0,0,.35);font:700 12px sans-serif;white-space:nowrap"><span style="font-size:18px">${p.emoji}</span>${p.name.replace(/</g, "&lt;")}</div>`,
      }),
    });
  } else if (p.kind === "area") {
    shape = L.polygon(g, { color: p.color, weight: 2, fillColor: p.color, fillOpacity: 0.18 * op, opacity: op });
  } else {
    shape = L.polyline(g, { color: p.color, weight: 6, opacity: 0.85 * op, dashArray: "10 6" });
  }
  if (p.kind !== "pin") shape.bindTooltip(`${p.emoji} ${p.name}`, { sticky: true });
  if (onClick)
    shape.on("click", (e) => {
      L.DomEvent.stopPropagation(e);
      onClick(p);
    });
  shape.addTo(layer);
  return shape;
}
