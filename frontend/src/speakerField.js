// 📢 เสียงตามสาย on the map (9 Oct 2026): a soft red / green wash from the houses' answers — red where people
// can't hear the village loudspeaker, green where they can. Same idea as the water surface (waterField.js).
import { fieldBounds } from "./waterField";

const INFLUENCE_M = 130; // a house speaks for about one soi block around it
const MIN_DIST_M = 12;
const MAX_ALPHA = 0.62;
const M_PER_DEG_LAT = 110540;
const mPerDegLng = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
const RED = [180, 35, 24];
const GREEN = [30, 107, 71];

export function renderSpeaker(points, bounds = fieldBounds(), cols = 200) {
  if (!points?.length) return null;
  const [[south, west], [north, east]] = bounds;
  const midLat = (south + north) / 2;
  const kx = mPerDegLng(midLat);
  const widthM = (east - west) * kx;
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
      let wSum = 0;
      let vSum = 0;
      let nearest = Infinity;
      for (const p of points) {
        const d = Math.hypot((p.lat - lat) * M_PER_DEG_LAT, (p.lng - lng) * kx);
        if (d > INFLUENCE_M) continue;
        nearest = Math.min(nearest, d);
        const w = (p.exact ? 1 : 0.6) / Math.pow(Math.max(d, MIN_DIST_M), 2);
        wSum += w;
        vSum += w * (p.heard ? 0 : 1); // 1 = can't hear
      }
      if (!wSum) continue;
      const v = vSum / wSum;
      const i = (y * cols + x) * 4;
      img.data[i] = Math.round(GREEN[0] + (RED[0] - GREEN[0]) * v);
      img.data[i + 1] = Math.round(GREEN[1] + (RED[1] - GREEN[1]) * v);
      img.data[i + 2] = Math.round(GREEN[2] + (RED[2] - GREEN[2]) * v);
      img.data[i + 3] = Math.round(255 * MAX_ALPHA * Math.pow(1 - nearest / INFLUENCE_M, 0.5));
      painted++;
    }
  }
  if (!painted) return null;
  ctx.putImageData(img, 0, 0);
  return canvas;
}
