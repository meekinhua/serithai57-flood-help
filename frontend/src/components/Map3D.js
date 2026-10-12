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
    mesh() {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      m.userData.owner = owner;
      return m;
    },
  };
}

const FLOOR = 3;
function buildHouse(B, b, wall, roof, segs) {
  const o = obb(b.g.map(toL));
  if (!o) return;
  const { cx, cz, ux, uz, hu, hv } = o;
  // the door faces the street: pick the side pointing at the nearest road
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
  const P = (x, y, z) => [cx + s[0] * x + f[0] * z, y, cz + s[1] * x + f[1] * z];
  const H = b.lv * FLOOR;
  // walls
  B.quad(P(-hw, 0, hd), P(hw, 0, hd), P(hw, H, hd), P(-hw, H, hd), wall);
  B.quad(P(-hw, 0, -hd), P(hw, 0, -hd), P(hw, H, -hd), P(-hw, H, -hd), wall);
  B.quad(P(hw, 0, -hd), P(hw, 0, hd), P(hw, H, hd), P(hw, H, -hd), wall);
  B.quad(P(-hw, 0, -hd), P(-hw, 0, hd), P(-hw, H, hd), P(-hw, H, -hd), wall);
  // roof: a gable on houses, flat on big blocks
  const big = Math.max(hw, hd) > 14 || b.lv >= 5;
  if (big) {
    B.quad(P(-hw, H, -hd), P(hw, H, -hd), P(hw, H, hd), P(-hw, H, hd), roof);
    const r = 0.6;
    B.quad(P(-hw, H, hd), P(hw, H, hd), P(hw, H + r, hd), P(-hw, H + r, hd), roof);
    B.quad(P(-hw, H, -hd), P(hw, H, -hd), P(hw, H + r, -hd), P(-hw, H + r, -hd), roof);
    B.quad(P(hw, H, -hd), P(hw, H, hd), P(hw, H + r, hd), P(hw, H + r, -hd), roof);
    B.quad(P(-hw, H, -hd), P(-hw, H, hd), P(-hw, H + r, hd), P(-hw, H + r, -hd), roof);
  } else {
    const R = 0.55 * Math.min(hw, hd) + 0.7;
    const ov = 0.4;
    if (hw >= hd) {
      // ridge runs left–right, slopes face the street
      const X = hw + ov;
      const Z = hd + ov;
      B.quad(P(-X, H, Z), P(X, H, Z), P(X, H + R, 0), P(-X, H + R, 0), roof);
      B.quad(P(-X, H, -Z), P(X, H, -Z), P(X, H + R, 0), P(-X, H + R, 0), roof);
      B.tri(P(hw, H, -hd), P(hw, H, hd), P(hw, H + R, 0), wall);
      B.tri(P(-hw, H, -hd), P(-hw, H, hd), P(-hw, H + R, 0), wall);
    } else {
      // ridge runs front–back: the gable faces the street
      const X = hw + ov;
      const Z = hd + ov;
      B.quad(P(X, H, -Z), P(X, H, Z), P(0, H + R, Z), P(0, H + R, -Z), roof);
      B.quad(P(-X, H, -Z), P(-X, H, Z), P(0, H + R, Z), P(0, H + R, -Z), roof);
      B.tri(P(-hw, H, hd), P(hw, H, hd), P(0, H + R, hd), wall);
      B.tri(P(-hw, H, -hd), P(hw, H, -hd), P(0, H + R, -hd), wall);
    }
  }
  // door + windows on the street side, a window per floor on the ends
  const front = hd + 0.03;
  const rect = (x, y, w, h, z, hex) => B.quad(P(x - w, y - h, z), P(x + w, y - h, z), P(x + w, y + h, z), P(x - w, y + h, z), hex);
  const side = (sx, y, w, h, hex) => B.quad(P(sx, y - h, -w), P(sx, y - h, w), P(sx, y + h, w), P(sx, y + h, -w), hex);
  const win = (x, y) => {
    rect(x, y, 0.62, 0.62, front, "#FFFFFF");
    rect(x, y, 0.48, 0.48, front + 0.02, "#8FD3F4");
  };
  const dx = hw > 1.8 ? -hw * 0.38 : 0;
  rect(dx, 1.05, 0.5, 1.05, front, "#8B5A3C");
  rect(dx + 0.3, 1.0, 0.07, 0.07, front + 0.02, "#FFD43B");
  if (hw > 1.8) win(hw * 0.4, 1.6);
  for (let k = 1; k < Math.min(b.lv, 6); k++) {
    const y = k * FLOOR + 1.6;
    if (hw > 2.2) {
      win(-hw * 0.45, y);
      win(hw * 0.45, y);
    } else win(0, y);
  }
  if (hd > 2.5)
    for (let k = 0; k < Math.min(b.lv, 6); k++) {
      for (const sx of [hw + 0.03, -hw - 0.03]) {
        side(sx, k * FLOOR + 1.6, 0.6, 0.6, "#FFFFFF");
        side(sx + Math.sign(sx) * 0.02, k * FLOOR + 1.6, 0.46, 0.46, "#8FD3F4");
      }
    }
}

function buildTrees(B, THREE, green, places) {
  let seed = 57;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ico = new THREE.IcosahedronGeometry(1, 0).toNonIndexed().getAttribute("position");
  const tree = (x, z) => {
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
      tree(p[0], p[1]);
    }
  };
  B.setOwner(0);
  for (const a of green || []) if (a.k === "green") plant(a.g, 230);
  for (const p of places || []) if (p.kind === "area" && p.geometry?.length > 2 && /สวน|park|ต้นไม้/i.test(p.name)) plant(p.geometry, 160);
}

const TOOLS = [
  ["look", "👆", "ดู"],
  ["add", "🏠", "วางบ้าน"],
  ["up", "⬆️", "เพิ่มชั้น"],
  ["down", "⬇️", "ลดชั้น"],
  ["remove", "🔨", "ทุบ"],
];

export default function Map3D({ edit = false, onClose, className = "" }) {
  const el = useRef(null);
  const map = useRef(null);
  const world = useRef({}); // THREE, scene, mesh, segs, green, places
  const data = useRef([]);
  const soiRef = useRef({});
  const housesRef = useRef({});
  const mineRef = useRef(null);
  const selRef = useRef(null);
  const toolRef = useRef("look");
  const undoRef = useRef([]);
  const busyRef = useRef(false);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState("look");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [flat, setFlat] = useState(false);
  const [mine, setMine] = useState(null);
  const [undoN, setUndoN] = useState(0);
  const [done, setDone] = useState(0);
  const [pops, setPops] = useState([]);
  toolRef.current = tool;

  const path = edit ? "/admin/buildings3d" : "/buildings3d";

  function rebuild() {
    const W = world.current;
    if (!W.scene) return;
    if (W.mesh) {
      W.scene.remove(W.mesh);
      W.mesh.geometry.dispose();
    }
    const B = makeBuilder(W.THREE);
    for (const b of data.current) {
      if (b.s === "removed") continue;
      B.setOwner(b.id);
      let [wall, roof] = b.id === mineRef.current ? ["#FFFFFF", "#FF3B5C"] : colours(soiRef.current[b.id]);
      if (b.s === "added") wall = "#C9F2D5";
      if (b.id === selRef.current) wall = "#FFD43B";
      buildHouse(B, b, wall, roof, W.segs);
    }
    buildTrees(B, W.THREE, W.green, W.places);
    W.mesh = B.mesh();
    W.scene.add(W.mesh);
    const m = map.current;
    if (m?.getSource("hit")) m.getSource("hit").setData(hitGeo(data.current));
    m?.triggerRepaint();
  }

  const hitGeo = (list) => ({ type: "FeatureCollection", features: list.map((b) => ({ type: "Feature", properties: { id: b.id, s: b.s || "osm" }, geometry: { type: "Polygon", coordinates: [ring(b.g)] } })) });

  function pop(point, text) {
    const id = Math.random();
    setPops((p) => [...p, { id, x: point.x, y: point.y, text }]);
    setTimeout(() => setPops((p) => p.filter((q) => q.id !== id)), 1100);
  }

  async function reload() {
    const r = await api(path);
    data.current = r.buildings;
    rebuild();
    return r.buildings;
  }

  async function call(p, body) {
    setBusy(true);
    busyRef.current = true;
    setMsg("");
    try {
      await api(p, { method: "POST", body: JSON.stringify(body) });
      return await reload();
    } catch (e) {
      setMsg(e.message);
      return null;
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  const select = (id) => {
    selRef.current = id;
    setSel(id == null ? null : data.current.find((x) => x.id === id) || null);
    rebuild();
  };

  async function act(kind, b, point) {
    if (kind === "remove") {
      if (await call("/admin/buildings/remove", { id: b.id })) {
        undoRef.current.push({ kind: "remove", id: b.id });
        pop(point, "💥 ทุบแล้ว");
      }
    } else if (kind === "up" || kind === "down") {
      const lv = b.lv + (kind === "up" ? 1 : -1);
      if (lv < 1 || lv > 30) return pop(point, kind === "up" ? "สูงสุดแล้ว" : "ต่ำสุดแล้ว");
      if (await call("/admin/buildings/shape", { id: b.id, lv })) {
        undoRef.current.push({ kind: "lv", id: b.id, prev: b.lv });
        pop(point, kind === "up" ? `⬆️ ${lv} ชั้น` : `⬇️ ${lv} ชั้น`);
      }
    }
    setUndoN(undoRef.current.length);
    setDone((n) => n + 1);
  }

  async function undo() {
    const u = undoRef.current.pop();
    setUndoN(undoRef.current.length);
    if (!u) return;
    if (u.kind === "remove") await call("/admin/buildings/restore", { id: u.id });
    else if (u.kind === "add") await call("/admin/buildings/remove", { id: u.id });
    else if (u.kind === "lv") await call("/admin/buildings/shape", { id: u.id, lv: u.prev });
    setMsg("↩️ ย้อนกลับแล้ว");
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
          // footprints: red patches for removed houses, and a near-invisible layer to tap from straight above
          m.addSource("hit", { type: "geojson", data: hitGeo(b.buildings) });
          m.addLayer({ id: "gone", type: "fill", source: "hit", filter: ["==", ["get", "s"], "removed"], paint: { "fill-color": "#E5484D", "fill-opacity": 0.5 } });
          m.addLayer({ id: "hit", type: "fill", source: "hit", filter: ["!=", ["get", "s"], "removed"], paint: { "fill-color": "#000", "fill-opacity": 0.01 } });

          // the toy houses (three.js on the map's own WebGL context)
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
          world.current.base = base;

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
              layout: { "text-field": ["get", "t"], "text-font": ["Open Sans Bold"], "text-size": 12, "text-offset": [0, -1.6] },
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

        // tap: ray-cast into the toy houses first (what you see), the footprints second
        const tapHouse = (e) => {
          const W = world.current;
          if (W.mesh && W.camera) {
            const cv = m.getCanvas();
            const r = cv.getBoundingClientRect();
            const nx = (e.point.x / r.width) * 2 - 1;
            const ny = -(e.point.y / r.height) * 2 + 1;
            const inv = W.camera.projectionMatrix.clone().invert();
            const a = new THREE.Vector3(nx, ny, -1).applyMatrix4(inv);
            const z = new THREE.Vector3(nx, ny, 1).applyMatrix4(inv);
            const ray = new THREE.Raycaster(a, z.sub(a).normalize());
            const hit = ray.intersectObject(W.mesh)[0];
            const id = hit ? W.mesh.userData.owner[hit.faceIndex] : 0;
            if (id) return data.current.find((x) => x.id === id) || null;
          }
          const f = m.queryRenderedFeatures(e.point, { layers: ["hit"] })[0];
          return f ? data.current.find((x) => x.id === f.properties.id) || null : null;
        };
        if (edit) {
          m.on("click", async (e) => {
            if (busyRef.current) return;
            const gone = m.queryRenderedFeatures(e.point, { layers: ["gone"] })[0];
            const t = toolRef.current;
            if (gone && t !== "add") {
              if (await call("/admin/buildings/restore", { id: gone.properties.id })) pop(e.point, "✨ คืนบ้านแล้ว");
              return;
            }
            const b2 = tapHouse(e);
            if (t === "add") {
              if (b2) return pop(e.point, "มีบ้านอยู่แล้ว");
              const at = [e.lngLat.lat, e.lngLat.lng];
              let best = null;
              for (const x of data.current) {
                if (x.s === "removed") continue;
                const d = distM(centroid(x.g), at);
                if (!best || d < best.d) best = { d, x };
              }
              const body = { lat: +at[0].toFixed(6), lng: +at[1].toFixed(6) };
              if (best && best.d < 60) {
                const c = centroid(best.x.g);
                body.g = best.x.g.map(([p, q]) => [+(p - c[0] + at[0]).toFixed(6), +(q - c[1] + at[1]).toFixed(6)]);
                body.lv = best.x.lv;
              }
              const before = new Set(data.current.map((x) => x.id));
              const after = await call("/admin/buildings/add", body);
              if (after) {
                const nb = after.find((x) => !before.has(x.id));
                if (nb) undoRef.current.push({ kind: "add", id: nb.id });
                setUndoN(undoRef.current.length);
                setDone((n) => n + 1);
                pop(e.point, "🏠 +1 หลัง");
              }
              return;
            }
            if (!b2) return select(null);
            if (t === "look") return select(b2.id);
            act(t, b2, e.point);
          });
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
    if (map.current) map.current.getCanvas().style.cursor = tool === "look" ? "" : "crosshair";
    if (tool !== "look" && selRef.current != null) select(null);
  }, [tool, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  function tilt() {
    const m = map.current;
    if (!m) return;
    m.easeTo(flat ? { pitch: 60, bearing: -24 } : { pitch: 0, bearing: 0 });
    setFlat(!flat);
  }

  const hint = { look: "แตะบ้านเพื่อดูข้อมูล", add: "แตะที่ว่าง วางบ้านหน้าตาเหมือนหลังข้างๆ", up: "แตะบ้าน +1 ชั้น", down: "แตะบ้าน −1 ชั้น", remove: "แตะบ้านที่ไม่มีจริง เพื่อทุบทิ้ง" }[tool];

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
        <span key={p.id} className="m3d-pop pointer-events-none absolute z-20 rounded-full bg-white px-3 py-1 text-base font-black text-[#15201A] shadow-lg" style={{ left: p.x, top: p.y }}>
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
          <div className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full bg-[#15201A]/85 px-3 py-1 text-sm font-bold text-white shadow">
            {busy ? "⏳ กำลังบันทึก…" : `${hint}${done ? ` · แก้แล้ว ${done} ครั้ง` : ""}`}
          </div>
          {sel && tool === "look" && (
            <div className="absolute inset-x-2 bottom-[92px] z-10 flex items-center gap-2 rounded-2xl border-2 border-[#FFD43B] bg-white/95 p-2 shadow-lg">
              <span className="text-3xl">🏠</span>
              <span className="min-w-0 flex-1 text-sm leading-tight">
                <b className="block text-base">{housesRef.current[sel.id] || (sel.s === "added" ? "บ้านที่เพิ่มเอง" : "ยังไม่มีเลขที่บ้าน")}</b>
                {soiRef.current[sel.id] ? `ซ.${soiRef.current[sel.id]}` : "ยังไม่รู้ซอย"} · {sel.lv} ชั้น
              </span>
              <button onClick={() => select(null)} className="h-9 w-9 rounded-full bg-neutral-200 font-bold" aria-label="ปิด">
                ✕
              </button>
            </div>
          )}
          {msg && <p className={`absolute inset-x-2 bottom-[92px] z-10 rounded-lg bg-white/95 px-2 py-1 text-sm shadow ${msg.startsWith("↩️") ? "text-green-800" : "text-red-700"}`}>{msg}</p>}
          <div className="absolute inset-x-2 bottom-2 z-10 flex items-end justify-center gap-1.5 rounded-[28px] bg-white/90 p-1.5 shadow-xl backdrop-blur sm:gap-3">
            {TOOLS.map(([k, icon, label]) => (
              <button
                key={k}
                onClick={() => setTool(k)}
                aria-pressed={tool === k}
                className={`flex h-[66px] w-[60px] flex-col items-center justify-center rounded-[20px] text-[11px] font-bold transition-transform active:scale-90 ${
                  tool === k ? "-translate-y-1 bg-[#FFD43B] text-[#15201A] shadow-[0_4px_0_#C99A00]" : "bg-[#F1F4F2] text-neutral-700 shadow-[0_3px_0_#C9D2CC]"
                }`}
              >
                <span className="text-2xl leading-none">{icon}</span>
                {label}
              </button>
            ))}
            <button
              onClick={undo}
              disabled={!undoN || busy}
              className="flex h-[66px] w-[60px] flex-col items-center justify-center rounded-[20px] bg-[#E8F1FF] text-[11px] font-bold text-[#1F5FA8] shadow-[0_3px_0_#B8CDEB] active:scale-90 disabled:opacity-40"
            >
              <span className="text-2xl leading-none">↩️</span>ย้อน{undoN ? ` (${undoN})` : ""}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
