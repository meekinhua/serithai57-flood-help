// Smooth water-level surface from residents' point reports (inverse distance weighting).
// Nearer and newer reports weigh more; far from any report the surface fades to clear,
// so we never paint a guess where nobody has reported.
import { VILLAGE_BOUNDARY, WATER_LEVELS } from "./config";

export const INFLUENCE_M = 300; // beyond this from every report: no colour
const HALF_LIFE_H = 6; // a report's weight halves every 6 hours
const MIN_DIST_M = 15; // avoids a spike exactly on top of a report
const MAX_ALPHA = 0.55;
const MARGIN_M = 400; // paint a little beyond the village boundary

const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

const RGB = WATER_LEVELS.map((w) => [1, 3, 5].map((i) => parseInt(w.color.slice(i, i + 2), 16)));

export function levelColor(value) {
  const v = Math.max(0, Math.min(RGB.length - 1, value));
  const lo = Math.floor(v);
  const hi = Math.min(lo + 1, RGB.length - 1);
  const t = v - lo;
  return RGB[lo].map((c, i) => Math.round(c + (RGB[hi][i] - c) * t));
}

// Keep only the newest report per ~20 m cell, so a spot re-reported many times counts once.
export function toPoints(reports, nowMs = Date.now()) {
  const seen = new Set();
  const points = [];
  for (const r of reports) {
    const cell = `${Math.round(r.lat / 0.0002)},${Math.round(r.lng / 0.0002)}`;
    if (seen.has(cell)) continue; // reports arrive newest first
    seen.add(cell);
    const ageH = Math.max(0, (nowMs - new Date(r.created_at).getTime()) / 3.6e6);
    points.push({ lat: r.lat, lng: r.lng, level: r.level, timeW: Math.pow(0.5, ageH / HALF_LIFE_H) });
  }
  return points;
}

export function estimateAt(lat, lng, points) {
  const kx = mPerDegLng(lat);
  let num = 0;
  let den = 0;
  let nearest = Infinity;
  let used = 0;
  for (const p of points) {
    const dx = (p.lng - lng) * kx;
    const dy = (p.lat - lat) * M_PER_DEG_LAT;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > INFLUENCE_M * 2) continue;
    nearest = Math.min(nearest, d);
    const w = p.timeW / Math.pow(Math.max(d, MIN_DIST_M), 2);
    num += w * p.level;
    den += w;
    used++;
  }
  if (!den || nearest > INFLUENCE_M) return null;
  return { level: num / den, nearest, used };
}

export function fieldBounds() {
  const lats = VILLAGE_BOUNDARY.map((p) => p[0]);
  const lngs = VILLAGE_BOUNDARY.map((p) => p[1]);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const dLat = MARGIN_M / M_PER_DEG_LAT;
  const dLng = MARGIN_M / mPerDegLng(midLat);
  return [
    [Math.min(...lats) - dLat, Math.min(...lngs) - dLng],
    [Math.max(...lats) + dLat, Math.max(...lngs) + dLng],
  ];
}

// Render the surface onto a small canvas; the map stretches it with smoothing, which gives the soft blend.
export function renderField(points, bounds = fieldBounds(), cols = 180) {
  if (!points.length) return null;
  const [[south, west], [north, east]] = bounds;
  const midLat = (south + north) / 2;
  const widthM = (east - west) * mPerDegLng(midLat);
  const heightM = (north - south) * M_PER_DEG_LAT;
  const rows = Math.max(1, Math.round((cols * heightM) / widthM));
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(cols, rows);
  let painted = 0;
  for (let y = 0; y < rows; y++) {
    const lat = north - ((y + 0.5) / rows) * (north - south);
    for (let x = 0; x < cols; x++) {
      const lng = west + ((x + 0.5) / cols) * (east - west);
      const est = estimateAt(lat, lng, points);
      if (!est) continue;
      const [r, g, b] = levelColor(est.level);
      const fade = Math.pow(1 - est.nearest / INFLUENCE_M, 0.6);
      const i = (y * cols + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(255 * MAX_ALPHA * fade);
      painted++;
    }
  }
  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function describeLevel(value) {
  const lv = WATER_LEVELS[Math.round(Math.max(0, Math.min(WATER_LEVELS.length - 1, value)))];
  return lv;
}
