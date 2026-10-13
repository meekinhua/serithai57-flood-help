// 🏙️ 3D village map (12–13 Oct 2026): the village as a kids'-game toy town. Every house is built from its
// OpenStreetMap outline as a little model (walls, gable roof, a door facing the street, windows on every floor) and
// painted per soi; the soi comes from the address book members filled in (house pins + soi) or the nearest soi line
// (incl. the ones drawn in /admin). Lawns, pitches and ponds come from OSM, with lollipop trees; places (shops,
// activity areas, routes) from /admin › สถานที่. MapLibre draws the ground, three.js the houses; both load from a
// CDN only when someone opens the map, so the app bundle stays small.
// `edit` (/admin › ที่อยู่ › อาคาร) adds a game-style toolbar: pick a tool, tap houses — 🏠 place a house shaped like
// its neighbour, ⬆️⬇️ floors, 🔨 knock one down, 👆 look, ↩️ undo. Removed houses show as red patches (tap to restore).
import { useEffect, useRef, useState } from "react";
import { api, load } from "../api";
import { VILLAGE_BOUNDARY, VILLAGE_CENTER } from "../config";

function loadScript(srcs, css, ready) {
  if (ready()) return Promise.resolve(ready());
  const one = (i) =>
    new Promise((resolve, reject) => {
      if (css?.[i]) {
        const l = document.createElement("link");
        l.rel = "stylesheet";
        l.href = css[i];
        document.head.appendChild(l);
      }
      const s = document.createElement("script");
      s.src = srcs[i];
      s.onload = () => (ready() ? resolve(ready()) : reject(new Error("not loaded")));
      s.onerror = () => reject(new Error("load failed"));
      document.head.appendChild(s);
    }).catch((e) => (i + 1 < srcs.length ? one(i + 1) : Promise.reject(e)));
  return one(0);
}
let libs = null;
function loadLibs() {
  if (!libs) {
    libs = Promise.all([
      loadScript(
        ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js", "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js"],
        ["https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css", "https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css"],
        () => window.maplibregl,
      ),
      loadScript(["https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js", "https://unpkg.com/three@0.128.0/build/three.min.js"], null, () => window.THREE),
    ]).catch((e) => {
      libs = null;
      throw e;
    });
  }
  return libs;
}

// ---------- colours ----------
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

// ---------- local metric frame around the village centre (x east, y up, z south) ----------
const [LAT0, LNG0] = VILLAGE_CENTER;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110574;
const toL = ([la, ln]) => [(ln - LNG0) * KX, -(la - LAT0) * KZ];
const centroid = (g) => [g.reduce((a, p) => a + p[0], 0) / g.length, g.reduce((a, p) => a + p[1], 0) / g.length];
const distM = (a, b) => Math.hypot((a[0] - b[0]) * KZ, (a[1] - b[1]) * KX);
const ring = (g) => [...g.map(([la, ln]) => [ln, la]), [g[0][1], g[0][0]]];

// smallest rectangle around an outline: centre, unit axis u, half sizes along u and v
function obb(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.3) continue;
    const ux = (x2 - x1) / len;
    const uz = (z2 - z1) / len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity; // prettier-ignore
    for (const [x, z] of pts) {
      const a = x * ux + z * uz;
      const b = -x * uz + z * ux;
      a0 = Math.min(a0, a);
      a1 = Math.max(a1, a);
      b0 = Math.min(b0, b);
      b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) {
      const ca = (a0 + a1) / 2;
      const cb = (b0 + b1) / 2;
      best = { area, cx: ca * ux - cb * uz, cz: ca * uz + cb * ux, ux, uz, hu: Math.max(1.5, (a1 - a0) / 2), hv: Math.max(1.5, (b1 - b0) / 2) };
    }
  }
  return best;
}

function nearestRoad(segs, x, z) {
  let best = null;
  for (const [ax, az, bx, bz] of segs) {
    if (Math.min(ax, bx) - 70 > x || Math.max(ax, bx) + 70 < x || Math.min(az, bz) - 70 > z || Math.max(az, bz) + 70 < z) continue;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const px = ax + t * dx;
    const pz = az + t * dz;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.d) best = { d, px, pz };
  }
  return best;
}

// ---------- geometry ----------
function makeBuilder(THREE) {
  const pos = [];
  const col = [];
  const owner = []; // building id per triangle (for tapping)
  const c = new THREE.Color();
  let cur = 0;
  const tri = (a, b, d, hex) => {
    c.set(hex);
    pos.push(...a, ...b, ...d);
    for (let i = 0; i < 3; i++) col.push(c.r, c.g, c.b);
    owner.push(cur);
  };
  const quad = (a, b, d, e, hex) => {
    tri(a, b, d, hex);
    tri(a, d, e, hex);
  };
  return {
    tri,
    quad,
    setOwner: (id) => (cur = id),
    mesh(glass = false) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial(glass ? { vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.3, depthWrite: false } : { vertexColors: true, side: THREE.DoubleSide }));
      if (glass) m.renderOrder = 1;
      m.userData.owner = owner;
      return m;
    },
  };
}

const toLLr = ([x, z]) => [+(LAT0 - z / KZ).toFixed(7), +(LNG0 + x / KX).toFixed(7)];

const FLOOR = 3;
// what a building can be (the admin picks one); size = default footprint [w, d] in metres when placed new
export const KINDS = {
  house: { icon: "🏠", label: "บ้าน", size: [7, 10] },
  townhouse: { icon: "🏘️", label: "ทาวน์เฮาส์/ตึกแถว", size: [5, 14] },
  shop: { icon: "🏪", label: "ร้านค้า", size: [6, 12] },
  office: { icon: "🏢", label: "ออฟฟิศหมู่บ้าน", size: [10, 14] },
  hall: { icon: "🏛️", label: "หอประชุม", size: [20, 30] },
  shrine: { icon: "🛕", label: "หอพระ", size: [8, 12] },
  school: { icon: "🏫", label: "โรงเรียน", size: [12, 40] },
  pool: { icon: "🏊", label: "สระว่ายน้ำ", size: [12, 25] },
  tennis: { icon: "🎾", label: "สนามเทนนิส", size: [18, 36] },
  basket: { icon: "🏀", label: "สนามบาส", size: [15, 28] },
  badminton: { icon: "🏸", label: "สนามแบด", size: [6.1, 13.4] },
  park: { icon: "🌳", label: "สวนสาธารณะ", size: [30, 30] },
  other: { icon: "📦", label: "อื่นๆ", size: [8, 8] },
};
export const FLATS = new Set(["pool", "tennis", "basket", "badminton", "park"]);

// the building's own frame: centre, front (towards the street), half width/depth
function frame(b, segs) {
  const o = obb(b.g.map(toL));
  if (!o) return null;
  const { cx, cz, ux, uz, hu, hv } = o;
  const road = nearestRoad(segs, cx, cz);
  const vx = -uz;
  const vz = ux;
  let f = [vx, vz];
  let hd = hv;
  let hw = hu;
  if (road) {
    const tx = road.px - cx;
    const tz = road.pz - cz;
    const cand = [
      [ux, uz, hu, hv],
      [-ux, -uz, hu, hv],
      [vx, vz, hv, hu],
      [-vx, -vz, hv, hu],
    ];
    const pick = cand.reduce((a, k) => (k[0] * tx + k[1] * tz > a[0] * tx + a[1] * tz ? k : a));
    f = [pick[0], pick[1]];
    hd = pick[2];
    hw = pick[3];
  }
  const s = [f[1], -f[0]];
  return { cx, cz, hw, hd, P: (x, y, z) => [cx + s[0] * x + f[0] * z, y, cz + s[1] * x + f[1] * z], long: hu >= hv ? [ux, uz] : [vx, vz] };
}

function toolkit(B, P) {
  const box = (x0, x1, y0, y1, z0, z1, hex, top = true) => {
    B.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), hex);
    B.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), hex);
    B.quad(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), hex);
    B.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), hex);
    if (top) B.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), hex);
  };
  const floor = (x0, x1, z0, z1, y, hex) => B.quad(P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1), hex);
  // a gable roof over [-hw, hw] × [-hd, hd] from height H, ridge along the longer side
  const gable = (hw, hd, H, R, ov, roof, wall) => {
    const X = hw + ov;
    const Z = hd + ov;
    if (hw >= hd) {
      B.quad(P(-X, H, Z), P(X, H, Z), P(X, H + R, 0), P(-X, H + R, 0), roof);
      B.quad(P(-X, H, -Z), P(X, H, -Z), P(X, H + R, 0), P(-X, H + R, 0), roof);
      B.tri(P(hw, H, -hd), P(hw, H, hd), P(hw, H + R, 0), wall);
      B.tri(P(-hw, H, -hd), P(-hw, H, hd), P(-hw, H + R, 0), wall);
    } else {
      B.quad(P(X, H, -Z), P(X, H, Z), P(0, H + R, Z), P(0, H + R, -Z), roof);
      B.quad(P(-X, H, -Z), P(-X, H, Z), P(0, H + R, Z), P(0, H + R, -Z), roof);
      B.tri(P(-hw, H, hd), P(hw, H, hd), P(0, H + R, hd), wall);
      B.tri(P(-hw, H, -hd), P(hw, H, -hd), P(0, H + R, -hd), wall);
    }
  };
  const lineX = (x0, x1, z, y, hex = "#FFFFFF", w = 0.08) => floor(x0, x1, z - w, z + w, y, hex);
  const lineZ = (z0, z1, x, y, hex = "#FFFFFF", w = 0.08) => floor(x - w, x + w, z0, z1, y, hex);
  return { box, floor, gable, lineX, lineZ };
}

function buildThing(B, b, wall, roof, segs, kit) {
  const tree = kit.tree;
  const F = frame(b, segs);
  if (!F) return;
  const { hw, hd, P } = F;
  const K = toolkit(B, P);
  const t = b.t || "house";
  const front = hd + 0.03;
  const rect = (x, y, w, h, z, hex) => B.quad(P(x - w, y - h, z), P(x + w, y - h, z), P(x + w, y + h, z), P(x - w, y + h, z), hex);
  const win = (x, y) => {
    rect(x, y, 0.62, 0.62, front, "#FFFFFF");
    rect(x, y, 0.48, 0.48, front + 0.02, "#8FD3F4");
  };
  // courts and pools lie along their long side
  const L = Math.max(hw, hd);
  const S = Math.min(hw, hd);
  const along = hw >= hd; // long side runs along x
  const C = (a, y, c) => (along ? P(a, y, c) : P(c, y, a)); // a = along the long side, c = across
  const cfloor = (a0, a1, c0, c1, y, hex) => B.quad(C(a0, y, c0), C(a1, y, c0), C(a1, y, c1), C(a0, y, c1), hex);
  const court = (base, inner, line, inset) => {
    cfloor(-L, L, -S, S, 0.05, base);
    const l = L * inset;
    const s2 = S * inset;
    cfloor(-l, l, -s2, s2, 0.07, inner);
    const w = 0.09;
    cfloor(-l, l, s2 - w, s2 + w, 0.09, line);
    cfloor(-l, l, -s2 - w, -s2 + w, 0.09, line);
    cfloor(l - w, l + w, -s2, s2, 0.09, line);
    cfloor(-l - w, -l + w, -s2, s2, 0.09, line);
    return { l, s2 };
  };
  const net = (s2, h, hex = "#F4F4F4") => {
    B.quad(C(-0.04, 0, -s2), C(-0.04, 0, s2), C(-0.04, h, s2), C(-0.04, h, -s2), hex);
    for (const c of [-s2, s2]) K.box(...(along ? [-0.1, 0.1, 0, h + 0.1, c - 0.1, c + 0.1] : [c - 0.1, c + 0.1, 0, h + 0.1, -0.1, 0.1]), "#7A7A7A");
  };

  if (t === "pool") {
    cfloor(-L, L, -S, S, 0.25, "#EDE6D6");
    K.box(-hw, hw, 0, 0.25, -hd, hd, "#EDE6D6", false);
    const l = L - 1.2;
    const s2 = S - 1.2;
    cfloor(-l, l, -s2, s2, 0.28, "#4FC3F7");
    for (let k = 1; k < 5; k++) {
      const c = -s2 + (2 * s2 * k) / 5;
      cfloor(-l + 1, l - 1, c - 0.06, c + 0.06, 0.3, "#E1F5FE");
    }
    return;
  }
  if (t === "tennis") {
    const { s2 } = court("#4E9F6A", "#3A86B5", "#FFFFFF", 0.82);
    cfloor(-0.05, 0.05, -s2, s2, 0.09, "#FFFFFF");
    net(s2 + 0.4, 1.07);
    return;
  }
  if (t === "badminton") {
    const { l, s2 } = court("#2E8B57", "#2F9E66", "#FFFFFF", 0.92);
    for (const a of [-l * 0.3, l * 0.3]) cfloor(a - 0.05, a + 0.05, -s2, s2, 0.09, "#FFFFFF");
    cfloor(-l, l, -0.05, 0.05, 0.09, "#FFFFFF");
    net(s2 + 0.2, 1.55);
    return;
  }
  if (t === "basket") {
    const { l, s2 } = court("#E9824A", "#D9733B", "#FFFFFF", 0.9);
    cfloor(-0.06, 0.06, -s2, s2, 0.09, "#FFFFFF");
    for (const end of [-1, 1]) {
      const a = end * (l - 0.2);
      const key = end * (l - 5.8);
      cfloor(Math.min(a, key), Math.max(a, key), -2.4, 2.4, 0.08, "#C4572A");
      const pole = end * (l + 0.6);
      K.box(...(along ? [pole - 0.12, pole + 0.12, 0, 3.4, -0.12, 0.12] : [-0.12, 0.12, 0, 3.4, pole - 0.12, pole + 0.12]), "#5C6670");
      const bd = end * (l - 0.1);
      B.quad(C(bd, 2.8, -0.9), C(bd, 2.8, 0.9), C(bd, 3.9, 0.9), C(bd, 3.9, -0.9), "#FFFFFF");
      const r = end * (l - 0.55);
      cfloor(r - 0.25, r + 0.25, -0.25, 0.25, 3.05, "#FF6B1A");
    }
    return;
  }
  if (t === "park") {
    cfloor(-L, L, -S, S, 0.04, "#A8DD86");
    let seed = Math.abs(b.id) % 2147483647 || 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const n = Math.min(14, Math.max(3, Math.round((L * S) / 40)));
    for (let k = 0; k < n; k++) {
      const p = C((rnd() * 2 - 1) * L * 0.85, 0, (rnd() * 2 - 1) * S * 0.85);
      tree(p[0], p[2], rnd);
    }
    cfloor(-L * 0.9, L * 0.9, -0.6, 0.6, 0.06, "#E9DFC6"); // a footpath
    return;
  }
  if (t === "shrine") {
    // หอพระ: a golden seated Buddha on a lotus base, inside a clear glass pavilion with a gold-trimmed spire roof
    const G = kit.G;
    const gold = "#E6B422";
    const gold2 = "#F5D061";
    const ico = (x, y, z, sx, sy, sz, hex) => {
      const v = kit.ico;
      for (let i = 0; i < v.count; i += 3) {
        const q = (k) => P(x + v.getX(i + k) * sx, y + v.getY(i + k) * sy, z + v.getZ(i + k) * sz);
        B.tri(q(0), q(1), q(2), hex);
      }
    };
    const prism = (r, y0, y1, hex, n = 8) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 2 * Math.PI;
        const a1 = ((i + 1) / n) * 2 * Math.PI;
        const p0 = [Math.cos(a0) * r, Math.sin(a0) * r];
        const p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
        B.quad(P(p0[0], y0, p0[1]), P(p1[0], y0, p1[1]), P(p1[0], y1, p1[1]), P(p0[0], y1, p0[1]), hex);
        B.tri(P(0, y1, 0), P(p0[0], y1, p0[1]), P(p1[0], y1, p1[1]), hex);
      }
    };
    const cone = (x, y, z, r, h, hex, n = 8) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 2 * Math.PI;
        const a1 = ((i + 1) / n) * 2 * Math.PI;
        B.tri(P(x + Math.cos(a0) * r, y, z + Math.sin(a0) * r), P(x + Math.cos(a1) * r, y, z + Math.sin(a1) * r), P(x, y + h, z), hex);
      }
    };
    const bar = (a, b2, w, hex) => {
      // a thin gold strip between two points of the frame
      const up = [0, w, 0];
      B.quad(P(a[0], a[1], a[2]), P(b2[0], b2[1], b2[2]), P(b2[0], b2[1] + up[1], b2[2]), P(a[0], a[1] + up[1], a[2]), hex);
    };
    const pl = 0.6;
    K.box(-hw - 0.6, hw + 0.6, 0, pl, -hd - 0.6, hd + 0.6, "#F3EEE2");
    // the statue, sized to the pavilion and facing the street
    const k = Math.max(0.8, Math.min(S * 0.55, 3));
    const y0 = pl;
    prism(1.35 * k, y0, y0 + 0.4 * k, "#A3222B");
    prism(1.45 * k, y0 + 0.4 * k, y0 + 0.5 * k, gold);
    prism(1.2 * k, y0 + 0.5 * k, y0 + 0.75 * k, gold2, 12);
    ico(0, y0 + 1.0 * k, 0.12 * k, 1.1 * k, 0.36 * k, 0.78 * k, gold); // crossed legs
    ico(0, y0 + 1.75 * k, -0.08 * k, 0.68 * k, 0.82 * k, 0.46 * k, gold); // body
    ico(0, y0 + 1.18 * k, 0.5 * k, 0.32 * k, 0.12 * k, 0.2 * k, gold2); // hands in the lap
    ico(0, y0 + 2.72 * k, 0, 0.34 * k, 0.4 * k, 0.34 * k, gold2); // head
    cone(0, y0 + 3.02 * k, 0, 0.16 * k, 0.5 * k, gold2, 6); // flame of the topknot
    // glass pavilion: white corner posts, clear walls and a clear spire roof with gold edges
    const H = y0 + 3.7 * k + 0.4;
    const X = hw;
    const Z = hd;
    for (const [px, pz] of [
      [-X, -Z],
      [X, -Z],
      [X, Z],
      [-X, Z],
    ])
      K.box(px - 0.15, px + 0.15, pl, H, pz - 0.15, pz + 0.15, "#FFFFFF");
    const glass = "#BFE9FF";
    G.quad(P(-X, pl, Z), P(X, pl, Z), P(X, H, Z), P(-X, H, Z), glass);
    G.quad(P(-X, pl, -Z), P(X, pl, -Z), P(X, H, -Z), P(-X, H, -Z), glass);
    G.quad(P(X, pl, -Z), P(X, pl, Z), P(X, H, Z), P(X, H, -Z), glass);
    G.quad(P(-X, pl, -Z), P(-X, pl, Z), P(-X, H, Z), P(-X, H, -Z), glass);
    const R = 0.9 * S + 1.4;
    const ap = [0, H + R, 0];
    const cs = [
      [-X - 0.3, H, -Z - 0.3],
      [X + 0.3, H, -Z - 0.3],
      [X + 0.3, H, Z + 0.3],
      [-X - 0.3, H, Z + 0.3],
    ];
    for (let i = 0; i < 4; i++) {
      const c1 = cs[i];
      const c2 = cs[(i + 1) % 4];
      G.tri(P(...c1), P(...c2), P(...ap), glass);
      bar(c1, c2, 0.18, gold);
      bar(c1, ap, 0.14, gold);
    }
    cone(0, H + R - 0.1, 0, 0.25, 1.6, gold, 6); // the gold finial
    return;
  }

  // buildings with walls
  const isHall = t === "hall" || t === "school";
  const H = t === "hall" ? Math.max(7, b.lv * FLOOR) : b.lv * FLOOR;
  K.box(-hw, hw, 0, H, -hd, hd, wall, false);
  const big = Math.max(hw, hd) > 14 || b.lv >= 5 || t === "school";
  const rs = b.r || (big && t !== "hall" ? "flat" : "gable");
  const R = (t === "hall" ? 0.4 : 0.55) * Math.min(hw, hd) + 0.7;
  if (rs === "flat") {
    K.floor(-hw, hw, -hd, hd, H, roof);
    K.box(-hw, hw, H, H + 0.6, -hd, hd, roof, false);
  } else if (rs === "hip") {
    // ปั้นหยา: four slopes, a short ridge along the long side
    const ov = 0.4;
    const X = hw + ov;
    const Z = hd + ov;
    const k = Math.min(hw, hd);
    if (hw >= hd) {
      const rx = Math.max(0, hw - k);
      B.quad(P(-X, H, Z), P(X, H, Z), P(rx, H + R, 0), P(-rx, H + R, 0), roof);
      B.quad(P(-X, H, -Z), P(X, H, -Z), P(rx, H + R, 0), P(-rx, H + R, 0), roof);
      B.tri(P(X, H, -Z), P(X, H, Z), P(rx, H + R, 0), roof);
      B.tri(P(-X, H, -Z), P(-X, H, Z), P(-rx, H + R, 0), roof);
    } else {
      const rz = Math.max(0, hd - k);
      B.quad(P(X, H, -Z), P(X, H, Z), P(0, H + R, rz), P(0, H + R, -rz), roof);
      B.quad(P(-X, H, -Z), P(-X, H, Z), P(0, H + R, rz), P(0, H + R, -rz), roof);
      B.tri(P(-X, H, Z), P(X, H, Z), P(0, H + R, rz), roof);
      B.tri(P(-X, H, -Z), P(X, H, -Z), P(0, H + R, -rz), roof);
    }
  } else if (rs === "shed") {
    // เพิงหมาแหงน: one slope, high at the back
    const ov = 0.3;
    const X = hw + ov;
    const Z = hd + ov;
    const r2 = R * 0.7;
    B.quad(P(-X, H, Z), P(X, H, Z), P(X, H + r2, -Z), P(-X, H + r2, -Z), roof);
    B.quad(P(-hw, H, -hd), P(hw, H, -hd), P(hw, H + r2, -hd), P(-hw, H + r2, -hd), wall);
    B.tri(P(hw, H, hd), P(hw, H, -hd), P(hw, H + r2, -hd), wall);
    B.tri(P(-hw, H, hd), P(-hw, H, -hd), P(-hw, H + r2, -hd), wall);
  } else K.gable(hw, hd, H, R, 0.4, roof, wall);
  const dx = hw > 1.8 && !isHall ? -hw * 0.38 : 0;
  rect(dx, isHall ? 1.6 : 1.05, isHall ? 1.4 : 0.5, isHall ? 1.6 : 1.05, front, "#8B5A3C");
  if (!isHall) rect(dx + 0.3, 1.0, 0.07, 0.07, front + 0.02, "#FFD43B");
  if (t === "hall") for (const x of [-hw * 0.8, -hw * 0.4, hw * 0.4, hw * 0.8]) K.box(x - 0.3, x + 0.3, 0, H, hd + 0.4, hd + 1.0, "#FFFFFF");
  if (t === "shop") {
    // a striped awning over the shopfront
    const n = Math.max(3, Math.round(hw * 2));
    for (let k = 0; k < n; k++) {
      const x0 = -hw + (2 * hw * k) / n;
      const x1 = -hw + (2 * hw * (k + 1)) / n;
      B.quad(P(x0, 2.9, hd), P(x1, 2.9, hd), P(x1, 2.4, hd + 1.3), P(x0, 2.4, hd + 1.3), k % 2 ? "#FFFFFF" : "#E8505B");
    }
  }
  if (t === "office") {
    // a flagpole with the Thai flag
    const px = hw + 1.5;
    K.box(px - 0.08, px + 0.08, 0, H + 3, hd - 0.08, hd + 0.08, "#C9CED6");
    const st = ["#ED1C24", "#FFFFFF", "#241D4F", "#241D4F", "#FFFFFF", "#ED1C24"];
    st.forEach((c, k) => B.quad(P(px + 0.1, H + 2.9 - k * 0.2, hd), P(px + 1.9, H + 2.9 - k * 0.2, hd), P(px + 1.9, H + 2.7 - k * 0.2, hd), P(px + 0.1, H + 2.7 - k * 0.2, hd), c));
  }
  if (!isHall && hw > 1.8 && t !== "shop") win(hw * 0.4, 1.6);
  for (let k = 1; k < Math.min(b.lv, 6); k++) {
    const y = k * FLOOR + 1.6;
    if (hw > 2.2) {
      win(-hw * 0.45, y);
      win(hw * 0.45, y);
    } else win(0, y);
  }
  if (hd > 2.5 && t !== "townhouse")
    for (let k = 0; k < Math.min(b.lv, 6); k++)
      for (const sx of [hw + 0.03, -hw - 0.03]) {
        B.quad(P(sx, k * FLOOR + 1.0, -0.6), P(sx, k * FLOOR + 1.0, 0.6), P(sx, k * FLOOR + 2.2, 0.6), P(sx, k * FLOOR + 2.2, -0.6), "#FFFFFF");
        const s2 = sx + Math.sign(sx) * 0.02;
        B.quad(P(s2, k * FLOOR + 1.14, -0.46), P(s2, k * FLOOR + 1.14, 0.46), P(s2, k * FLOOR + 2.06, 0.46), P(s2, k * FLOOR + 2.06, -0.46), "#8FD3F4");
      }
}

// geometry helpers for the editor
const rotL = ([x, z], c, a) => {
  const cs = Math.cos(a);
  const sn = Math.sin(a);
  return [c[0] + (x - c[0]) * cs - (z - c[1]) * sn, c[1] + (x - c[0]) * sn + (z - c[1]) * cs];
};
const lCentre = (pts) => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
export function rotate(g, deg) {
  const pts = g.map(toL);
  const c = lCentre(pts);
  return pts.map((p) => toLLr(rotL(p, c, (deg * Math.PI) / 180)));
}
export function scale(g, k) {
  const pts = g.map(toL);
  const c = lCentre(pts);
  return pts.map(([x, z]) => toLLr([c[0] + (x - c[0]) * k, c[1] + (z - c[1]) * k]));
}
export function move(g, dx, dz) {
  return g.map(toL).map(([x, z]) => toLLr([x + dx, z + dz]));
}
// cut a long block into n equal units along its long side (townhouses / shophouses)
export function split(g, n) {
  const o = obb(g.map(toL));
  const along = o.hu >= o.hv;
  const [ax, az] = along ? [o.ux, o.uz] : [-o.uz, o.ux];
  const [bx, bz] = along ? [-o.uz, o.ux] : [o.ux, o.uz];
  const L = along ? o.hu : o.hv;
  const S = along ? o.hv : o.hu;
  const pt = (a, c) => toLLr([o.cx + ax * a + bx * c, o.cz + az * a + bz * c]);
  return Array.from({ length: n }, (_, k) => {
    const a0 = -L + (2 * L * k) / n;
    const a1 = -L + (2 * L * (k + 1)) / n;
    return [pt(a0, -S), pt(a1, -S), pt(a1, S), pt(a0, S)];
  });
}
// a new footprint of w × d metres at a point, lined up with a reference outline if there is one
export function rectAt(at, w, d, ref) {
  const [cx, cz] = toL(at);
  let ux = 1;
  let uz = 0;
  if (ref) {
    const o = obb(ref.map(toL));
    if (o) [ux, uz] = o.hu >= o.hv ? [o.ux, o.uz] : [-o.uz, o.ux];
  }
  const vx = -uz;
  const vz = ux;
  const [a, c] = [d / 2, w / 2];
  return [
    [-a, -c],
    [a, -c],
    [a, c],
    [-a, c],
  ].map(([p, q]) => toLLr([cx + ux * p + vx * q, cz + uz * p + vz * q]));
}


// a lollipop tree (trunk + faceted ball)
function makeTree(B, THREE) {
  const ico = new THREE.IcosahedronGeometry(1, 0).toNonIndexed().getAttribute("position");
  return (x, z, rnd) => {
    const r = 1.8 + rnd() * 1.3;
    const t = 2 + rnd();
    const w = 0.28;
    const bark = "#9C6B43";
    B.quad([x - w, 0, z - w], [x + w, 0, z - w], [x + w, t, z - w], [x - w, t, z - w], bark);
    B.quad([x - w, 0, z + w], [x + w, 0, z + w], [x + w, t, z + w], [x - w, t, z + w], bark);
    B.quad([x - w, 0, z - w], [x - w, 0, z + w], [x - w, t, z + w], [x - w, t, z - w], bark);
    B.quad([x + w, 0, z - w], [x + w, 0, z + w], [x + w, t, z + w], [x + w, t, z - w], bark);
    const leaf = ["#6CC07B", "#4FA866", "#7BCB6A"][Math.floor(rnd() * 3)];
    for (let i = 0; i < ico.count; i += 3) {
      const v = (k) => [x + ico.getX(i + k) * r, t + r * 0.8 + ico.getY(i + k) * r, z + ico.getZ(i + k) * r];
      B.tri(v(0), v(1), v(2), leaf);
    }
  };
}

function buildTrees(B, tree, green, places) {
  let seed = 57;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const inPoly = ([x, z], g) => {
    let c = false;
    for (let i = 0, j = g.length - 1; i < g.length; j = i++) {
      const [xi, zi] = g[i];
      const [xj, zj] = g[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const plant = (gLL, every) => {
    const g = gLL.map(toL);
    const xs = g.map((p) => p[0]);
    const zs = g.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const n = Math.min(50, Math.max(2, Math.round(((x1 - x0) * (z1 - z0)) / every)));
    for (let i = 0, tries = 0; i < n && tries < n * 8; tries++) {
      const p = [x0 + rnd() * (x1 - x0), z0 + rnd() * (z1 - z0)];
      if (!inPoly(p, g)) continue;
      i++;
      tree(p[0], p[1], rnd);
    }
  };
  B.setOwner(0);
  for (const a of green || []) if (a.k === "green") plant(a.g, 230);
  for (const p of places || []) if (p.kind === "area" && p.geometry?.length > 2 && /สวน|park|ต้นไม้/i.test(p.name)) plant(p.geometry, 160);
}

const TOOLS = [
  ["look", "👆", "เลือก"],
  ["build", "🏗️", "สร้าง"],
  ["up", "⬆️", "เพิ่มชั้น"],
  ["down", "⬇️", "ลดชั้น"],
  ["remove", "🔨", "ทุบ"],
  ["hint", "💡", "ข้อเสนอ"],
];

export default function Map3D({ edit = false, onClose, className = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const world = useRef({});
  const data = useRef([]);
  const soiRef = useRef({});
  const housesRef = useRef({});
  const mineRef = useRef(null);
  const selRef = useRef(null);
  const linkRef = useRef([]);
  const toolRef = useRef("look");
  const kindRef = useRef("house");
  const undoRef = useRef([]);
  const busyRef = useRef(false);
  const saveT = useRef(null);
  const pending = useRef(null); // {id, prev} while the admin rotates / resizes / moves
  const labelsRef = useRef([]);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState("look");
  const [kind, setKind] = useState("house");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [flat, setFlat] = useState(false);
  const [mine, setMine] = useState(null);
  const [undoN, setUndoN] = useState(0);
  const [done, setDone] = useState(0);
  const [pops, setPops] = useState([]);
  const [linking, setLinking] = useState(null); // ids picked for a group
  const [parts, setParts] = useState(3);
  const [name, setName] = useState("");
  const [sugg, setSugg] = useState([]); // open suggestions from OSM / Google / Microsoft
  const [pick, setPick] = useState(null); // the suggestion tapped
  const [sure, setSure] = useState(false);
  const suggRef = useRef([]);
  toolRef.current = tool;
  kindRef.current = kind;

  const path = edit ? "/admin/buildings3d" : "/buildings3d";
  const leader = (b) => (b ? b.grp || b.id : null);
  const byId = (id) => data.current.find((x) => x.id === id) || null;

  function labels() {
    const ml = window.maplibregl;
    const m = map.current;
    if (!ml || !m) return;
    labelsRef.current.forEach((k) => k.remove());
    labelsRef.current = [];
    for (const b of data.current) {
      if (b.s === "removed" || b.grp) continue;
      const k = KINDS[b.t];
      if (!b.n && (!k || b.t === "house" || b.t === "townhouse")) continue;
      const c = centroid(b.g);
      const d = document.createElement("div");
      d.innerHTML = `<div style="font:700 12px sans-serif;background:#fff;border-radius:999px;padding:2px 8px;box-shadow:0 2px 6px rgba(0,0,0,.25);white-space:nowrap">${k ? k.icon : "📍"} ${String(b.n || k.label).replace(/[<>&]/g, "")}</div>`;
      d.style.pointerEvents = "none";
      labelsRef.current.push(new ml.Marker({ element: d, anchor: "bottom", offset: [0, -18] }).setLngLat([c[1], c[0]]).addTo(m));
    }
  }

  function rebuild() {
    const W = world.current;
    if (!W.scene) return;
    if (W.mesh) {
      W.scene.remove(W.mesh);
      if (W.glass) {
        W.scene.remove(W.glass);
        W.glass.geometry.dispose();
      }
      W.mesh.geometry.dispose();
    }
    const B = makeBuilder(W.THREE);
    const G = makeBuilder(W.THREE);
    const kit = { tree: makeTree(B, W.THREE), G, ico: W.ico || (W.ico = new W.THREE.IcosahedronGeometry(1, 1).toNonIndexed().getAttribute("position")) };
    const tree = kit.tree;
    const selLead = selRef.current;
    const linked = new Set(linkRef.current);
    const hint = toolRef.current === "hint";
    const fl = new Set(suggRef.current.filter((x) => x.kind === "floors").map((x) => x.ref));
    const sp = new Set(suggRef.current.filter((x) => x.kind === "split").map((x) => x.ref));
    const ex = new Set(suggRef.current.filter((x) => x.kind === "extra").map((x) => x.ref));
    for (const b of data.current) {
      if (b.s === "removed") continue;
      B.setOwner(b.id);
      const lead = leader(b);
      let [wall, roof] = lead === mineRef.current || b.id === mineRef.current ? ["#FFFFFF", "#FF3B5C"] : colours(soiRef.current[lead] || soiRef.current[b.id]);
      if (b.s === "added" && !b.t) wall = "#C9F2D5";
      if (b.t === "hall" || b.t === "office") [wall, roof] = ["#FFFFFF", "#C0392B"];
      if (b.t === "school") [wall, roof] = ["#FFF3C4", "#8A97A6"];
      if (selLead != null && lead === selLead) wall = "#FFD43B";
      if (linked.has(b.id)) wall = "#7DE3F4";
      if (hint) {
        [wall, roof] = ["#F2F2EE", "#C9CDD2"];
        if (fl.has(b.id)) [wall, roof] = ["#FFC46B", "#F08C00"];
        if (ex.has(b.id)) [wall, roof] = ["#FF9A9A", "#E5484D"];
        if (sp.has(b.id)) [wall, roof] = ["#D9C8FF", "#8B5CF6"];
      }
      buildThing(B, b, wall, roof, W.segs, kit);
    }
    buildTrees(B, tree, W.green, W.places);
    W.mesh = B.mesh();
    W.scene.add(W.mesh);
    W.glass = G.mesh(true);
    W.scene.add(W.glass);
    const m = map.current;
    if (m?.getSource("hit")) m.getSource("hit").setData(hitGeo(data.current));
    labels();
    m?.triggerRepaint();
  }

  const SRC = { google: "Google", microsoft: "Microsoft", osm: "OpenStreetMap", esri: "Esri", landsmaps: "แปลงที่ดิน (กรมที่ดิน)", neighbors: "หมุดบ้านที่ลูกบ้าน/เพื่อนบ้านปักไว้" };
  const suggGeo = (list) => ({
    type: "FeatureCollection",
    features: list.filter((x) => x.g).map((x) => ({ type: "Feature", properties: { sid: x.id, kind: x.kind, h: x.annex ? 3 : (x.lv || 2) * 3, annex: !!x.annex }, geometry: { type: "Polygon", coordinates: [ring(x.g)] } })),
  });
  const extraGeo = (list) => ({
    type: "FeatureCollection",
    features: list
      .filter((x) => x.kind === "extra" || x.kind === "floors")
      .map((x) => [x, byId(x.ref)])
      .filter(([, b]) => b)
      .map(([x, b]) => ({ type: "Feature", properties: { c: x.kind === "floors" ? "#F08C00" : "#E5484D" }, geometry: { type: "Polygon", coordinates: [ring(b.g)] } })),
  });
  function showSugg(list) {
    suggRef.current = list;
    setSugg(list);
    const m = map.current;
    if (m?.getSource("sugg")) {
      m.getSource("sugg").setData(suggGeo(list.filter((x) => x.kind === "missing")));
      m.getSource("extra").setData(extraGeo(list));
    }
  }
  async function decide(x, verb) {
    if (await call(`/admin/buildings/suggestions/${encodeURIComponent(x.id)}/${verb}`, {})) {
      showSugg(suggRef.current.filter((y) => y.id !== x.id));
      setPick(null);
      map.current?.getSource("preview")?.setData({ type: "FeatureCollection", features: [] });
      rebuild();
      popMid(verb === "accept" ? (x.kind === "missing" ? "🏠 เพิ่มแล้ว" : x.kind === "floors" ? `📏 ${x.lv} ชั้น` : x.kind === "split" ? `✂️ ${x.parts?.length} หลัง` : "💥 เอาออกแล้ว") : "👋 ข้ามแล้ว");
      setDone((n) => n + 1);
    }
  }
  async function acceptAllMissing() {
    if (!sure) return setSure(true);
    setSure(false);
    const todo = suggRef.current.filter((x) => x.kind === "missing" && !x.annex);
    setBusy(true);
    for (const x of todo) {
      try {
        await api(`/admin/buildings/suggestions/${encodeURIComponent(x.id)}/accept`, { method: "POST", body: "{}" });
      } catch (e) {
        // already decided by someone else
      }
    }
    setBusy(false);
    showSugg(suggRef.current.filter((x) => !todo.includes(x)));
    await reload();
    popMid(`🏠 เพิ่ม ${todo.length} หลัง`);
  }

  const hitGeo = (list) => ({ type: "FeatureCollection", features: list.map((b) => ({ type: "Feature", properties: { id: b.id, s: b.s || "osm" }, geometry: { type: "Polygon", coordinates: [ring(b.g)] } })) });

  function pop(point, text) {
    const id = Math.random();
    setPops((p) => [...p, { id, x: point.x, y: point.y, text }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 1100);
  }
  const popMid = (text) => {
    const c = map.current?.getCanvas();
    if (c) pop({ x: c.clientWidth / 2, y: c.clientHeight / 2 }, text);
  };

  async function reload() {
    const r = await api(path);
    data.current = r.buildings;
    if (selRef.current != null) setSel(byId(selRef.current));
    rebuild();
    return r.buildings;
  }

  async function call(p, body) {
    setBusy(true);
    busyRef.current = true;
    setMsg("");
    try {
      const r = await api(p, { method: "POST", body: JSON.stringify(body) });
      await reload();
      return r || true;
    } catch (e) {
      setMsg(e.message);
      return null;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }
  const pushUndo = (u) => {
    undoRef.current.push(u);
    setUndoN(undoRef.current.length);
    setDone((n) => n + 1);
  };

  const select = (id) => {
    flushShape();
    selRef.current = id;
    const b = id == null ? null : byId(id);
    setSel(b);
    setName(b?.n || "");
    rebuild();
  };

  // rotate / resize / move: shown at once, saved when the admin pauses
  function reshape(fn) {
    const b = byId(selRef.current);
    if (!b) return;
    if (!pending.current || pending.current.id !== b.id) {
      flushShape();
      pending.current = { id: b.id, prev: b.g };
    }
    b.g = fn(b.g);
    setSel({ ...b });
    rebuild();
    clearTimeout(saveT.current);
    saveT.current = setTimeout(flushShape, 700);
  }
  function flushShape() {
    clearTimeout(saveT.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const b = byId(p.id);
    if (!b) return;
    pushUndo({ kind: "shape", id: p.id, prev: p.prev });
    call("/admin/buildings/shape", { id: p.id, g: b.g });
  }
  const nudge = (up, right) => {
    const br = ((map.current?.getBearing() || 0) * Math.PI) / 180;
    const dx = Math.sin(br) * up + Math.cos(br) * right;
    const dz = -Math.cos(br) * up + Math.sin(br) * right;
    reshape((g) => move(g, dx, dz));
  };

  async function setType(t) {
    const b = byId(selRef.current);
    if (!b) return;
    const prev = b.t || "house";
    if (await call("/admin/buildings/shape", { id: b.id, t })) {
      pushUndo({ kind: "type", id: b.id, prev });
      popMid(`${KINDS[t].icon} ${KINDS[t].label}`);
    }
  }
  async function setRoof(r) {
    const b = byId(selRef.current);
    if (!b) return;
    const prev = b.r || "gable";
    if (await call("/admin/buildings/shape", { id: b.id, r })) {
      pushUndo({ kind: "roof", id: b.id, prev });
      popMid("🏠 เปลี่ยนหลังคาแล้ว");
    }
  }
  async function saveName() {
    const b = byId(selRef.current);
    if (!b || (b.n || "") === name.trim()) return;
    if (await call("/admin/buildings/shape", { id: b.id, n: name.trim() })) popMid("✏️ ตั้งชื่อแล้ว");
  }
  async function doSplit() {
    const b = byId(selRef.current);
    if (!b) return;
    flushShape();
    const r = await call("/admin/buildings/split", { id: b.id, parts: split(b.g, parts) });
    if (r?.ids) {
      pushUndo({ kind: "split", id: b.id, ids: r.ids });
      select(null);
      popMid(`✂️ แบ่งเป็น ${parts} ห้อง`);
    }
  }
  async function doGroup() {
    const ids = linking || [];
    if (ids.length < 2) return setMsg("แตะอาคารอื่นที่เป็นบ้านเดียวกันอย่างน้อย 1 หลัง");
    if (await call("/admin/buildings/group", { ids })) {
      pushUndo({ kind: "group", ids });
      popMid(`🔗 รวม ${ids.length} อาคารเป็นบ้านเดียวกัน`);
    }
    linkRef.current = [];
    setLinking(null);
    rebuild();
  }
  async function unGroup() {
    const b = byId(selRef.current);
    if (b && (await call("/admin/buildings/group", { ids: [b.id] }))) popMid("แยกกลุ่มแล้ว");
  }

  async function act(t, b, point) {
    if (t === "remove") {
      if (await call("/admin/buildings/remove", { id: b.id })) {
        pushUndo({ kind: "remove", id: b.id });
        pop(point, "💥 ทุบแล้ว");
      }
    } else if (t === "up" || t === "down") {
      const lv = b.lv + (t === "up" ? 1 : -1);
      if (lv < 1 || lv > 30) return pop(point, t === "up" ? "สูงสุดแล้ว" : "ต่ำสุดแล้ว");
      if (await call("/admin/buildings/shape", { id: b.id, lv })) {
        pushUndo({ kind: "lv", id: b.id, prev: b.lv });
        pop(point, t === "up" ? `⬆️ ${lv} ชั้น` : `⬇️ ${lv} ชั้น`);
      }
    }
  }

  async function undo() {
    flushShape();
    const u = undoRef.current.pop();
    setUndoN(undoRef.current.length);
    if (!u) return;
    if (u.kind === "remove") await call("/admin/buildings/restore", { id: u.id });
    else if (u.kind === "add") await call("/admin/buildings/remove", { id: u.id });
    else if (u.kind === "lv") await call("/admin/buildings/shape", { id: u.id, lv: u.prev });
    else if (u.kind === "shape") await call("/admin/buildings/shape", { id: u.id, g: u.prev });
    else if (u.kind === "type") await call("/admin/buildings/shape", { id: u.id, t: u.prev });
    else if (u.kind === "roof") await call("/admin/buildings/shape", { id: u.id, r: u.prev });
    else if (u.kind === "group") await call("/admin/buildings/group", { ids: [u.ids[0]] });
    else if (u.kind === "split") {
      for (const i of u.ids) await call("/admin/buildings/remove", { id: i });
      await call("/admin/buildings/restore", { id: u.id });
    }
    popMid("↩️ ย้อนแล้ว");
  }

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const myHouse = load("myHouse", "");
        const [[ml, THREE], b, so, sm, pl, me, hs] = await Promise.all([
          loadLibs(),
          api(path),
          api("/sois").catch(() => ({ sois: {} })),
          api("/map3d/sois").catch(() => ({ sois: {} })),
          api("/places").catch(() => []),
          myHouse && !edit ? api(`/map3d/me?house=${encodeURIComponent(myHouse)}`).catch(() => ({})) : Promise.resolve({}),
          edit ? api("/admin/map3d/houses").catch(() => ({ houses: {} })) : Promise.resolve({ houses: {} }),
        ]);
        const sg = edit ? await api("/admin/buildings/suggestions").catch(() => ({ items: [] })) : { items: [] };
        suggRef.current = sg.items || [];
        setSugg(suggRef.current);
        if (dead || !el.current) return;
        data.current = b.buildings;
        soiRef.current = sm.sois || {};
        housesRef.current = hs.houses || {};
        mineRef.current = me.id ?? null;
        setMine(me.id ?? null);
        const segs = [];
        for (const s of Object.values(so.sois || {}))
          for (const ln of s.lines || [])
            for (let i = 1; i < ln.length; i++) {
              const [ax, az] = toL(ln[i - 1]);
              const [bx, bz] = toL(ln[i]);
              segs.push([ax, az, bx, bz]);
            }
        world.current = { THREE, segs, green: b.green, places: pl };

        const m = new ml.Map({
          container: el.current,
          center: [LNG0, LAT0],
          zoom: 17,
          pitch: 60,
          bearing: -24,
          maxPitch: 78,
          antialias: true,
          attributionControl: { compact: true },
          style: {
            version: 8,
            glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
            sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
            layers: [
              { id: "ground", type: "background", paint: { "background-color": "#DCEFD6" } },
              { id: "osm", type: "raster", source: "osm", paint: { "raster-opacity": 0.22, "raster-saturation": -1, "raster-contrast": -0.3 } },
            ],
          },
        });
        map.current = m;
        window.__map3d = m; // for checking from the console
        m.addControl(new ml.NavigationControl({ visualizePitch: true }), "top-left");
        m.on("load", () => {
          const flatF = [];
          for (const a of b.green || []) flatF.push({ type: "Feature", properties: { c: a.k === "water" ? "#9FD8F5" : a.k === "pitch" ? "#B6E3A8" : "#C6EBB4", o: 0.95 }, geometry: { type: "Polygon", coordinates: [ring(a.g)] } });
          for (const p of pl || []) if (p.kind === "area" && p.geometry?.length > 2) flatF.push({ type: "Feature", properties: { c: p.color || "#1E6B47", o: 0.35 }, geometry: { type: "Polygon", coordinates: [ring(p.geometry)] } });
          m.addSource("flat", { type: "geojson", data: { type: "FeatureCollection", features: flatF } });
          m.addLayer({ id: "flat", type: "fill", source: "flat", paint: { "fill-color": ["get", "c"], "fill-opacity": ["get", "o"] } });
          const soiLines = [];
          for (const [k, s] of Object.entries(so.sois || {})) for (const ln of s.lines || []) soiLines.push({ type: "Feature", properties: { k }, geometry: { type: "LineString", coordinates: ln.map(([a, c]) => [c, a]) } });
          m.addSource("soi", { type: "geojson", data: { type: "FeatureCollection", features: soiLines } });
          const w = (n) => ["interpolate", ["exponential", 2], ["zoom"], 15, n / 4, 19, n * 4];
          m.addLayer({ id: "road-edge", type: "line", source: "soi", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#C8D3CB", "line-width": w(9) } });
          m.addLayer({ id: "road", type: "line", source: "soi", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": w(7.5) } });
          m.addSource("edge", { type: "geojson", data: { type: "Feature", geometry: { type: "LineString", coordinates: [...VILLAGE_BOUNDARY, VILLAGE_BOUNDARY[0]].map(([a, c]) => [c, a]) } } });
          m.addLayer({ id: "edge", type: "line", source: "edge", paint: { "line-color": "#5B7A66", "line-width": 2, "line-dasharray": [2, 2] } });
          const routes = (pl || []).filter((p) => p.kind === "route" && p.geometry?.length > 1).map((p) => ({ type: "Feature", properties: { c: p.color || "#7B68C8" }, geometry: { type: "LineString", coordinates: p.geometry.map(([a, c]) => [c, a]) } }));
          m.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: routes } });
          m.addLayer({ id: "routes", type: "line", source: "routes", layout: { "line-cap": "round" }, paint: { "line-color": ["get", "c"], "line-width": 4, "line-dasharray": [1, 1.6] } });
          m.addSource("hit", { type: "geojson", data: hitGeo(b.buildings) });
          m.addLayer({ id: "gone", type: "fill", source: "hit", filter: ["==", ["get", "s"], "removed"], paint: { "fill-color": "#E5484D", "fill-opacity": 0.5 } });
          m.addLayer({ id: "hit", type: "fill", source: "hit", filter: ["!=", ["get", "s"], "removed"], paint: { "fill-color": "#000", "fill-opacity": 0.01 } });
          if (edit) {
            // 💡 suggested houses (blue ghosts) and maybe-extra ones (red dashed outline)
            m.addSource("sugg", { type: "geojson", data: suggGeo(suggRef.current.filter((x) => x.kind === "missing")) });
            m.addLayer({ id: "sugg", type: "fill-extrusion", source: "sugg", paint: { "fill-extrusion-color": ["case", ["get", "annex"], "#7CD4FF", "#0096FF"], "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.6 } });
            m.addSource("extra", { type: "geojson", data: extraGeo(suggRef.current) });
            m.addLayer({ id: "extra", type: "line", source: "extra", paint: { "line-color": ["get", "c"], "line-width": 3, "line-dasharray": [1.5, 1] } });
            for (const id of ["sugg", "extra"]) m.setLayoutProperty(id, "visibility", "none");
            m.addSource("preview", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
            m.addLayer({ id: "preview", type: "line", source: "preview", paint: { "line-color": "#6D28D9", "line-width": 3 } });
          }

          const origin = ml.MercatorCoordinate.fromLngLat([LNG0, LAT0], 0);
          const sc = origin.meterInMercatorCoordinateUnits();
          const base = new THREE.Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new THREE.Vector3(sc, -sc, sc)).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2));
          m.addLayer({
            id: "toys",
            type: "custom",
            renderingMode: "3d",
            onAdd(mp, gl) {
              const W = world.current;
              W.camera = new THREE.Camera();
              W.scene = new THREE.Scene();
              W.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
              const sun = new THREE.DirectionalLight(0xfff4e0, 0.5);
              sun.position.set(-80, 140, 60);
              W.scene.add(sun);
              W.renderer = new THREE.WebGLRenderer({ canvas: mp.getCanvas(), context: gl, antialias: true });
              W.renderer.autoClear = false;
              rebuild();
            },
            render(gl, matrix) {
              const W = world.current;
              W.camera.projectionMatrix = new THREE.Matrix4().fromArray(matrix).multiply(base);
              W.renderer.resetState();
              W.renderer.render(W.scene, W.camera);
            },
          });

          for (const [k, s] of Object.entries(so.sois || {})) {
            const ln = (s.lines || []).reduce((a, x) => (x.length > a.length ? x : a), []);
            if (!ln.length) continue;
            const mid = ln[Math.floor(ln.length / 2)];
            const d = document.createElement("div");
            d.textContent = `ซ.${k}`;
            d.style.cssText = `font:800 11px sans-serif;color:#fff;background:${colours(k)[1]};border:2px solid #fff;border-radius:999px;padding:0 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);pointer-events:none`;
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
          if (edit) {
            const pts = b.buildings
              .filter((x) => housesRef.current[x.id])
              .map((x) => {
                const c = centroid(x.g);
                return { type: "Feature", properties: { t: String(housesRef.current[x.id]).replace(/^4\//, "") }, geometry: { type: "Point", coordinates: [c[1], c[0]] } };
              });
            m.addSource("nums", { type: "geojson", data: { type: "FeatureCollection", features: pts } });
            m.addLayer({
              id: "nums",
              type: "symbol",
              source: "nums",
              minzoom: 17.5,
              layout: { "text-field": ["get", "t"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-offset": [0, -1.6] },
              paint: { "text-color": "#15201A", "text-halo-color": "#FFFFFF", "text-halo-width": 1.6 },
            });
          }
          if (mineRef.current != null) {
            const hb = b.buildings.find((x) => x.id === mineRef.current);
            if (hb) {
              const c = centroid(hb.g);
              const d = document.createElement("div");
              d.innerHTML = '<div class="m3d-bob" style="font:800 13px sans-serif;background:#15201A;color:#fff;border-radius:999px;padding:3px 10px;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:nowrap">🏠 บ้านฉัน</div>';
              d.style.pointerEvents = "none";
              new ml.Marker({ element: d, anchor: "bottom", offset: [0, -34] }).setLngLat([c[1], c[0]]).addTo(m);
              m.once("idle", () => m.flyTo({ center: [c[1], c[0]], zoom: 18.2, duration: 1800 }));
            }
          }
          setReady(true);
        });

        // tap: ray-cast into the models first (what you see), the footprints second
        const tapHouse = (e) => {
          const W = world.current;
          if (W.mesh && W.camera) {
            const r = m.getCanvas().getBoundingClientRect();
            const nx = (e.point.x / r.width) * 2 - 1;
            const ny = -(e.point.y / r.height) * 2 + 1;
            const inv = W.camera.projectionMatrix.clone().invert();
            const a = new THREE.Vector3(nx, ny, -1).applyMatrix4(inv);
            const z = new THREE.Vector3(nx, ny, 1).applyMatrix4(inv);
            const hit = new THREE.Raycaster(a, z.sub(a).normalize()).intersectObject(W.mesh)[0];
            const id = hit ? W.mesh.userData.owner[hit.faceIndex] : 0;
            if (id) return byId(id);
          }
          const f = m.queryRenderedFeatures(e.point, { layers: ["hit"] })[0];
          return f ? byId(f.properties.id) : null;
        };
        if (edit) {
          m.on("click", async (e) => {
            if (busyRef.current) return;
            const t = toolRef.current;
            const gone = m.queryRenderedFeatures(e.point, { layers: ["gone"] })[0];
            if (gone && t !== "build") {
              if (await call("/admin/buildings/restore", { id: gone.properties.id })) pop(e.point, "✨ คืนแล้ว");
              return;
            }
            if (t === "hint") {
              const f = m.queryRenderedFeatures(e.point, { layers: ["sugg"] })[0];
              let x = f ? suggRef.current.find((y) => y.id === f.properties.sid) : null;
              if (!x) {
                const hb = tapHouse(e);
                x = hb ? suggRef.current.find((y) => (y.kind === "extra" || y.kind === "floors" || y.kind === "split") && y.ref === hb.id) : null;
              }
              setPick(x || null);
              if (m.getSource("preview")) m.getSource("preview").setData({ type: "FeatureCollection", features: (x?.parts || []).map((g) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring(g)] } })) });
              if (!x) pop(e.point, "แตะก้อนสีฟ้า หรืออาคารเส้นประแดง");
              return;
            }
            const b2 = tapHouse(e);
            if (linkRef.current.length) {
              // picking the other buildings of one house
              if (!b2) return;
              linkRef.current = linkRef.current.includes(b2.id) ? linkRef.current.filter((i) => i !== b2.id) : [...linkRef.current, b2.id];
              setLinking([...linkRef.current]);
              rebuild();
              return;
            }
            if (t === "build") {
              if (b2) return pop(e.point, "ตรงนี้มีอาคารแล้ว");
              const at = [e.lngLat.lat, e.lngLat.lng];
              const kd = kindRef.current;
              let near = null;
              for (const x of data.current) {
                if (x.s === "removed") continue;
                const d = distM(centroid(x.g), at);
                if (!near || d < near.d) near = { d, x };
              }
              let body;
              if (kd === "house" && near && near.d < 60) {
                const c = centroid(near.x.g);
                body = { g: near.x.g.map(([p, q]) => [+(p - c[0] + at[0]).toFixed(6), +(q - c[1] + at[1]).toFixed(6)]), lv: near.x.lv };
              } else {
                const [w, d] = KINDS[kd].size;
                body = { g: rectAt(at, w, d, near && near.d < 80 ? near.x.g : null), lv: kd === "house" || kd === "townhouse" ? 2 : 1, t: kd };
              }
              const before = new Set(data.current.map((x) => x.id));
              if (await call("/admin/buildings/add", body)) {
                const nb = data.current.find((x) => !before.has(x.id));
                if (nb) {
                  pushUndo({ kind: "add", id: nb.id });
                  if (kd !== "house") {
                    setTool("look");
                    select(nb.id);
                  }
                }
                pop(e.point, `${KINDS[kd].icon} +1`);
              }
              return;
            }
            if (!b2) return select(null);
            if (t === "look") return select(leader(b2) === leader(byId(selRef.current)) && b2.grp ? selRef.current : b2.id);
            act(t, b2, e.point);
          });
        }
      } catch (e) {
        if (!dead) setErr("โหลดแผนที่ 3D ไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้แผนที่ปกติไปก่อน");
      }
    })();
    return () => {
      dead = true;
      clearTimeout(saveT.current);
      if (map.current) map.current.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current;
    if (m?.getLayer("sugg")) for (const id of ["sugg", "extra"]) m.setLayoutProperty(id, "visibility", tool === "hint" ? "visible" : "none");
    if (ready) rebuild();
    setPick(null);
    m?.getSource("preview")?.setData({ type: "FeatureCollection", features: [] });
    if (map.current) map.current.getCanvas().style.cursor = tool === "look" ? "" : "crosshair";
    if (tool !== "look" && selRef.current != null) select(null);
  }, [tool, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  function tilt() {
    const m = map.current;
    if (!m) return;
    m.easeTo(flat ? { pitch: 60, bearing: -24 } : { pitch: 0, bearing: 0 });
    setFlat(!flat);
  }

  const hint = linking
    ? `แตะอาคารที่เป็นบ้านเดียวกัน (${linking.length} อาคาร)`
    : { look: "แตะอาคารเพื่อแก้ไข", build: `แตะที่ว่าง วาง ${KINDS[kind].icon} ${KINDS[kind].label}`, up: "แตะบ้าน +1 ชั้น", down: "แตะบ้าน −1 ชั้น", remove: "แตะอาคารที่ไม่มีจริง เพื่อทุบทิ้ง", hint: `💡 ข้อเสนอ ${sugg.length} · แตะอันที่มีสีเพื่อตัดสินใจ` }[tool];
  const pad = "flex h-11 min-w-[44px] items-center justify-center rounded-xl bg-[#F1F4F2] px-2 text-lg font-bold shadow-[0_2px_0_#C9D2CC] active:scale-90 disabled:opacity-40";
  const kindOf = sel ? KINDS[sel.t] || KINDS.house : null;
  const flatKind = sel && FLATS.has(sel.t);

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: "linear-gradient(#BFE4FF, #EAF6FF 45%, #DCEFD6 46%)" }}>
      <style>
        {"@keyframes m3dbob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}.m3d-bob{animation:m3dbob 1.6s ease-in-out infinite}" +
          "@keyframes m3dpop{0%{transform:translate(-50%,-50%) scale(.6);opacity:0}20%{transform:translate(-50%,-90%) scale(1.15);opacity:1}100%{transform:translate(-50%,-220%) scale(1);opacity:0}}.m3d-pop{animation:m3dpop 1.1s ease-out forwards}" +
          "@media (prefers-reduced-motion: reduce){.m3d-bob,.m3d-pop{animation:none}}"}
      </style>
      <div ref={el} style={{ position: "absolute", inset: 0 }} />
      {!ready && !err && <p className="absolute inset-0 grid place-items-center text-neutral-600">กำลังสร้างหมู่บ้านจำลอง… 🏡</p>}
      {err && <p className="absolute inset-0 grid place-items-center p-6 text-center text-red-700">{err}</p>}
      {pops.map((p) => (
        <span key={p.id} className="m3d-pop pointer-events-none absolute z-30 rounded-full bg-white px-3 py-1 text-base font-black text-[#15201A] shadow-lg" style={{ left: p.x, top: p.y }}>
          {p.text}
        </span>
      ))}
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
      {!edit && ready && <p className="absolute bottom-2 left-2 z-10 rounded-lg bg-white/85 px-2 py-1 text-xs text-neutral-700 shadow">สีบ้าน = ซอย (จากข้อมูลที่ลูกบ้านช่วยกันลง) · หมุน/เอียงด้วยสองนิ้ว</p>}
      {edit && (
        <>
          <div className="absolute left-1/2 top-2 z-10 max-w-[70%] -translate-x-1/2 truncate rounded-full bg-[#15201A]/85 px-3 py-1 text-sm font-bold text-white shadow">
            {busy ? "⏳ กำลังบันทึก…" : `${hint}${done ? ` · แก้แล้ว ${done}` : ""}`}
          </div>

          <div className="absolute inset-x-2 bottom-[86px] z-20 space-y-1.5">
            {tool === "hint" && (
              <div className="space-y-1.5 rounded-2xl border-2 border-[#00B4FF] bg-white/95 p-2 shadow-lg">
                {pick ? (
                  <>
                    <p className="text-sm leading-snug">
                      {pick.kind === "split" ? (
                        <>
                          <b>✂️ ตึกนี้คร่อมแปลงที่ดิน {pick.parts?.length} แปลง</b>
                          <br />
                          ปกติ 1 แปลง = 1 หลัง · ถ้ารับ จะแบ่งเป็น {pick.parts?.length} หลังตามแนวแปลง
                        </>
                      ) : pick.kind === "floors" ? (
                        <>
                          <b>📏 วัดความสูงได้ราว {pick.h} ม. ≈ {pick.lv} ชั้น</b>
                          <br />
                          จาก{pick.src === "drone" ? "ภาพโดรน" : pick.src === "google25d" ? "ภาพดาวเทียม (Google Open Buildings 2.5D)" : ` ${pick.src}`} · ตอนนี้ตั้งไว้ {byId(pick.ref)?.lv ?? "?"} ชั้น
                        </>
                      ) : pick.kind === "missing" && pick.annex ? (
                        <>
                          <b>🧱 ส่วนต่อเติมของบ้านข้างๆ (เช่น ครัวหลังบ้าน หลังคาโรงรถ)</b>
                          <br />
                          เห็นใน {SRC[pick.src] || pick.src} · ถ้าเพิ่ม จะรวมเป็นบ้านเดียวกับหลังที่ติดกัน
                        </>
                      ) : pick.kind === "missing" ? (
                        <>
                          <b>🏠 อาจมีบ้านหลังนี้ที่แผนที่เรายังไม่มี</b>
                          <br />
                          เห็นใน {SRC[pick.src] || pick.src}
                          {pick.conf ? ` · มั่นใจ ${Math.round(pick.conf * 100)}%` : ""}
                        </>
                      ) : (
                        <>
                          <b>❓ อาคารนี้อาจไม่มีอยู่จริงแล้ว</b>
                          <br />
                          {pick.src === "osm" ? "OpenStreetMap ล่าสุดไม่มีแล้ว" : `ภาพดาวเทียม (${SRC[pick.src] || pick.src}) ไม่เห็นอาคารตรงนี้`}
                        </>
                      )}
                    </p>
                    {pick.label && <p className="text-xs text-neutral-600">📍 {pick.label}</p>}
                    <div className="flex gap-2">
                      <button onClick={() => decide(pick, "accept")} disabled={busy} className="flex-1 rounded-xl bg-[#1E6B47] py-2 font-bold text-white shadow-[0_3px_0_#154D33] active:scale-95">
                        {pick.kind === "split" ? `✂️ แบ่งเป็น ${pick.parts?.length} หลัง` : pick.kind === "floors" ? `✓ ตั้งเป็น ${pick.lv} ชั้น` : pick.kind === "missing" ? (pick.annex ? "✓ เพิ่มเป็นส่วนของบ้านนี้" : "✓ เพิ่มบ้านนี้") : "🔨 เอาออก"}
                      </button>
                      <button onClick={() => decide(pick, "dismiss")} disabled={busy} className="flex-1 rounded-xl bg-neutral-200 py-2 font-bold active:scale-95">
                        ✕ ไม่ใช่ / ข้าม
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="flex w-full flex-wrap gap-x-3 gap-y-1 text-xs font-bold">
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: "#0096FF" }} />อาจขาด</span>
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: "#7CD4FF" }} />ส่วนต่อเติม</span>
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: "#F08C00" }} />เสนอเปลี่ยนชั้น</span>
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: "#E5484D" }} />อาจเกิน</span>
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px]" style={{ background: "#8B5CF6" }} />แบ่งตามแปลง</span>
                      <span><i className="mr-1 inline-block h-3 w-3 rounded-sm align-[-1px] border" style={{ background: "#F2F2EE" }} />บ้านเดิม</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      {sugg.length
                        ? `อาคารที่อาจขาด ${sugg.filter((x) => x.kind === "missing" && !x.annex).length}  · ส่วนต่อเติม ${sugg.filter((x) => x.annex).length} · เปลี่ยนชั้น ${sugg.filter((x) => x.kind === "floors").length} · แบ่งตามแปลง ${sugg.filter((x) => x.kind === "split").length} · อาจเกิน ${sugg.filter((x) => x.kind === "extra").length} · แตะเพื่อดูทีละหลัง`
                        : "ยังไม่มีข้อเสนอ · รอแอดมินรันการเทียบข้อมูล"}
                    </span>
                    {sugg.some((x) => x.kind === "missing" && !x.annex) && (
                      <button onClick={acceptAllMissing} disabled={busy} className={`rounded-xl px-3 py-2 font-bold text-white ${sure ? "bg-red-700" : "bg-[#0090D0]"}`}>
                        {sure ? "แตะอีกครั้งเพื่อยืนยัน" : `✓ เพิ่มอาคารหลักทั้งหมด ${sugg.filter((x) => x.kind === "missing" && !x.annex).length} หลัง`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {tool === "build" && (
              <div className="flex gap-1.5 overflow-x-auto rounded-2xl bg-white/95 p-1.5 shadow-lg">
                {Object.entries(KINDS).map(([k, v]) => (
                  <button key={k} onClick={() => setKind(k)} className={`flex w-[68px] shrink-0 flex-col items-center rounded-xl py-1 text-[10px] font-bold leading-tight ${kind === k ? "bg-[#FFD43B] shadow-[0_3px_0_#C99A00]" : "bg-[#F1F4F2]"}`}>
                    <span className="text-2xl">{v.icon}</span>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
            {linking && (
              <div className="flex items-center gap-2 rounded-2xl border-2 border-[#7DE3F4] bg-white/95 p-2 shadow-lg">
                <span className="min-w-0 flex-1 text-sm font-bold">🔗 แตะอาคารอื่นของบ้านหลังนี้ (เช่น เรือนหลัง โรงรถ) · เลือกแล้ว {linking.length}</span>
                <button onClick={doGroup} disabled={linking.length < 2 || busy} className="rounded-xl bg-[#0E7490] px-3 py-2 text-sm font-bold text-white disabled:opacity-40">
                  ✓ รวมเป็นบ้านเดียวกัน
                </button>
                <button
                  onClick={() => {
                    linkRef.current = [];
                    setLinking(null);
                    rebuild();
                  }}
                  className="px-2 text-sm text-neutral-600"
                >
                  ยกเลิก
                </button>
              </div>
            )}
            {sel && tool === "look" && !linking && (
              <div className="max-h-[52vh] space-y-2 overflow-y-auto rounded-2xl border-2 border-[#FFD43B] bg-white/95 p-2 shadow-lg">
                <div className="flex items-center gap-2">
                  <span className="text-3xl">{kindOf.icon}</span>
                  <span className="min-w-0 flex-1 text-sm leading-tight">
                    <b className="block text-base">{sel.n || housesRef.current[leader(sel)] || housesRef.current[sel.id] || kindOf.label}</b>
                    {soiRef.current[leader(sel)] || soiRef.current[sel.id] ? `ซ.${soiRef.current[leader(sel)] || soiRef.current[sel.id]}` : "ยังไม่รู้ซอย"}
                    {flatKind ? "" : ` · ${sel.lv} ชั้น`}
                    {sel.grp ? ` · 🔗 ${data.current.filter((x) => leader(x) === leader(sel) && x.s !== "removed").length} อาคารในบ้านนี้` : ""}
                  </span>
                  <button onClick={() => select(null)} className="h-9 w-9 shrink-0 rounded-full bg-neutral-200 font-bold" aria-label="ปิด">
                    ✕
                  </button>
                </div>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  {Object.entries(KINDS).map(([k, v]) => (
                    <button key={k} onClick={() => setType(k)} disabled={busy} className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${(sel.t || "house") === k ? "border-[#C99A00] bg-[#FFD43B]" : "bg-white"}`}>
                      {v.icon} {v.label}
                    </button>
                  ))}
                </div>
                {!flatKind && sel.t !== "shrine" && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-xs font-bold text-neutral-500">หลังคา</span>
                    {[
                      ["gable", "🔺 จั่ว"],
                      ["hip", "⛰️ ปั้นหยา"],
                      ["flat", "▭ แบน"],
                      ["shed", "◺ เพิงหมาแหงน"],
                    ].map(([k, label]) => (
                      <button key={k} onClick={() => setRoof(k)} disabled={busy} className={`rounded-full border px-2 py-1 text-xs font-bold ${sel.r === k ? "border-[#C99A00] bg-[#FFD43B]" : "bg-white"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex gap-1">
                  <input
                    id="m3d-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    maxLength={40}
                    placeholder="ตั้งชื่อ (ถ้ามี) เช่น หอประชุมหมู่บ้าน"
                    className="min-h-[40px] min-w-0 flex-1 rounded-xl border px-2 text-sm"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-neutral-500">หมุน</span>
                  <button className={pad} onClick={() => reshape((g) => rotate(g, -10))} aria-label="หมุนซ้าย 10 องศา">
                    ⟲
                  </button>
                  <button className={pad} onClick={() => reshape((g) => rotate(g, -2))} aria-label="หมุนซ้ายนิดเดียว">
                    ↶
                  </button>
                  <button className={pad} onClick={() => reshape((g) => rotate(g, 2))} aria-label="หมุนขวานิดเดียว">
                    ↷
                  </button>
                  <button className={pad} onClick={() => reshape((g) => rotate(g, 10))} aria-label="หมุนขวา 10 องศา">
                    ⟳
                  </button>
                  <span className="ml-2 text-xs font-bold text-neutral-500">ขนาด</span>
                  <button className={pad} onClick={() => reshape((g) => scale(g, 0.92))} aria-label="ย่อ">
                    ➖
                  </button>
                  <button className={pad} onClick={() => reshape((g) => scale(g, 1.08))} aria-label="ขยาย">
                    ➕
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-bold text-neutral-500">เลื่อน</span>
                  <button className={pad} onClick={() => nudge(0, -1)} aria-label="เลื่อนซ้าย">
                    ◀
                  </button>
                  <button className={pad} onClick={() => nudge(1, 0)} aria-label="เลื่อนขึ้น">
                    ▲
                  </button>
                  <button className={pad} onClick={() => nudge(-1, 0)} aria-label="เลื่อนลง">
                    ▼
                  </button>
                  <button className={pad} onClick={() => nudge(0, 1)} aria-label="เลื่อนขวา">
                    ▶
                  </button>
                  {!flatKind && (
                    <>
                      <span className="ml-2 text-xs font-bold text-neutral-500">ชั้น</span>
                      <button className={pad} disabled={busy || sel.lv <= 1} onClick={() => act("down", sel, { x: 0, y: 0 })} aria-label="ลดชั้น">
                        ⬇️
                      </button>
                      <b className="w-6 text-center">{sel.lv}</b>
                      <button className={pad} disabled={busy || sel.lv >= 30} onClick={() => act("up", sel, { x: 0, y: 0 })} aria-label="เพิ่มชั้น">
                        ⬆️
                      </button>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                  <span className="text-xs font-bold text-neutral-500">✂️ แบ่งเป็นห้องๆ</span>
                  <button className={pad} onClick={() => setParts(Math.max(2, parts - 1))}>
                    −
                  </button>
                  <b className="w-12 text-center">{parts} ห้อง</b>
                  <button className={pad} onClick={() => setParts(Math.min(20, parts + 1))}>
                    +
                  </button>
                  <button onClick={doSplit} disabled={busy} className="rounded-xl bg-[#7B68C8] px-3 py-2 text-sm font-bold text-white shadow-[0_3px_0_#5A4AA0] active:scale-95">
                    ✂️ แบ่ง
                  </button>
                  {sel.grp ? (
                    <button onClick={unGroup} disabled={busy} className="ml-auto rounded-xl bg-neutral-200 px-3 py-2 text-sm font-bold">
                      ⛓️‍💥 แยกกลุ่ม
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        linkRef.current = [sel.id];
                        setLinking([sel.id]);
                        rebuild();
                      }}
                      className="ml-auto rounded-xl bg-[#0E7490] px-3 py-2 text-sm font-bold text-white shadow-[0_3px_0_#0B5566] active:scale-95"
                    >
                      🔗 รวมกับอาคารอื่น
                    </button>
                  )}
                </div>
              </div>
            )}
            {msg && <p className="rounded-lg bg-white/95 px-2 py-1 text-sm text-red-700 shadow">{msg}</p>}
          </div>

          <div className="absolute inset-x-2 bottom-2 z-20 flex items-end justify-center gap-1.5 rounded-[28px] bg-white/90 p-1.5 shadow-xl backdrop-blur sm:gap-3">
            {TOOLS.map(([k, icon, label]) => (
              <button
                key={k}
                onClick={() => {
                  if (linking) {
                    linkRef.current = [];
                    setLinking(null);
                  }
                  setTool(k);
                }}
                aria-pressed={tool === k}
                className={`flex h-[66px] w-[58px] flex-col items-center justify-center rounded-[20px] text-[11px] font-bold transition-transform active:scale-90 ${
                  tool === k ? "-translate-y-1 bg-[#FFD43B] text-[#15201A] shadow-[0_4px_0_#C99A00]" : "bg-[#F1F4F2] text-neutral-700 shadow-[0_3px_0_#C9D2CC]"
                }`}
              >
                <span className="text-2xl leading-none">{icon}</span>
                {label}
                {k === "hint" && sugg.length ? ` ${sugg.length}` : ""}
              </button>
            ))}
            <button
              onClick={undo}
              disabled={!undoN || busy}
              className="flex h-[66px] w-[58px] flex-col items-center justify-center rounded-[20px] bg-[#E8F1FF] text-[11px] font-bold text-[#1F5FA8] shadow-[0_3px_0_#B8CDEB] active:scale-90 disabled:opacity-40"
            >
              <span className="text-2xl leading-none">↩️</span>ย้อน{undoN ? ` (${undoN})` : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
