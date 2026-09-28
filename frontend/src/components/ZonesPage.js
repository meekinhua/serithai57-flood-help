import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { createBaseMap } from "./MapView";

// /zones — the village split into zones A, B, C… (so relief teams don't overlap) and one truck
// drop point per zone on the main road (big trucks can't enter the small sois). Printable.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// /zones?poster=1 — the same page without buttons, for a printable image / LINE post
const POSTER = new URLSearchParams(window.location.search).has("poster");
const navUrl = (d) => `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;

export function drawZones(map, data, { houses = true, labels = true, pane } = {}) {
  const group = L.layerGroup().addTo(map);
  const P = pane ? { pane } : {}; // Leaflet breaks on pane: undefined
  // main road: the only road trucks can use
  L.polyline(data.main_road, { color: "#111", weight: 12, opacity: 0.35, interactive: false, ...P }).addTo(group);
  L.polyline(data.main_road, { color: "#facc15", weight: 5, opacity: 0.95, interactive: false, ...P }).addTo(group);
  if (houses) {
    for (const [lat, lng, zi] of data.houses) {
      L.circleMarker([lat, lng], { ...P, radius: 3, stroke: false, fillColor: data.zones[zi].color, fillOpacity: 0.85, interactive: false }).addTo(group);
    }
  }
  for (const z of data.zones) {
    for (const s of z.sois) {
      for (const line of data.soiLines?.[s] || []) L.polyline(line, { color: z.color, weight: 4, opacity: 0.9, interactive: false, ...P }).addTo(group);
    }
    if (labels) {
      L.marker(z.center, {
        ...P,
        interactive: false,
        icon: L.divIcon({ className: "", iconSize: [58, 58], iconAnchor: [29, 29], html: `<div class="zone-label" style="--c:${z.color}">${z.id}</div>` }),
      }).addTo(group);
    }
    L.marker([z.drop.lat, z.drop.lng], {
      ...P,
      zIndexOffset: 2000,
      icon: L.divIcon({ className: "", iconSize: [64, 40], iconAnchor: [32, 20], html: `<div class="drop-pin" style="--c:${z.color}">🚚 ${z.id}</div>` }),
    })
      .bindPopup(
        `<b>🚚 ${esc(z.drop.label)}</b><br>โซน ${z.id} · ${z.houses} หลัง · ซอย ${esc(z.sois.join(", "))}<br>รถใหญ่จอดริมถนนหลัก แล้วทีมโซน ${z.id} ขนเข้าซอย<br><a href="${navUrl(z.drop)}" target="_blank" rel="noreferrer">🧭 นำทางไปจุดนี้</a>`
      )
      .addTo(group);
  }
  return group;
}

export default function ZonesPage() {
  const el = useRef(null);
  const mapRef = useRef(null);
  const [data, setData] = useState(null);
  const [posts, setPosts] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api("/zones"), api("/sois")])
      .then(([z, s]) => setData({ ...z, soiLines: Object.fromEntries(Object.entries(s.sois).map(([k, v]) => [k, v.lines])) }))
      .catch((e) => setError(e.message));
    api("/posts?kind=need")
      .then((p) => setPosts(Array.isArray(p) ? p : p.items || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!data || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomSnap = 0.25; // the village is a long strip: whole-number zooms leave it tiny
    mapRef.current = map;
    drawZones(map, data);
    const bounds = L.latLngBounds(data.houses.map((h) => [h[0], h[1]])).pad(0.03);
    // keep the whole village in view while the page lays out (a background tab starts at 0×0),
    // until the person touches the map
    let touched = false;
    const stop = () => (touched = true);
    el.current.addEventListener("pointerdown", stop);
    el.current.addEventListener("wheel", stop);
    const fit = () => {
      map.invalidateSize();
      if (!touched && map.getSize().x > 50) map.fitBounds(bounds);
    };
    fit();
    const t = setTimeout(fit, 300);
    const ro = new ResizeObserver(fit);
    ro.observe(el.current);
    return () => {
      clearTimeout(t);
      ro.disconnect();
      map.remove(); // removes the zone layers too; removing them first leaves a canvas redraw queued on a dead context
    };
  }, [data]);

  // open requests per zone, so donors see where things are needed
  const need = useMemo(() => {
    const out = {};
    if (!data) return out;
    for (const p of posts) {
      if (p.status === "done") continue;
      const z = data.soi_zone[p.soi || ""];
      if (!z) continue;
      out[z] = out[z] || { open: 0, urgent: 0 };
      out[z].open += 1;
      if (p.urgent) out[z].urgent += 1;
    }
    return out;
  }, [data, posts]);

  const focus = (z) => {
    mapRef.current?.setView([z.drop.lat, z.drop.lng], 18);
    el.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className={`zones-page min-h-screen bg-neutral-100${POSTER ? " poster" : ""}`}>
      <header className="bg-black px-4 py-3 text-white print:bg-white print:text-black">
        <div className="mx-auto flex max-w-5xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">🗺️ แผนที่โซน · จุดลงของ</h1>
            <p className="text-sm text-neutral-300 print:text-neutral-700">หมู่บ้านสหกรณ์เคหะสถาน 4 · เสรีไทย 57</p>
          </div>
          <button onClick={() => window.print()} className="min-h-[44px] rounded-lg bg-white/10 px-3 text-sm font-semibold print:hidden">🖨️ พิมพ์</button>
          <a href="/" className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2.5 text-sm print:hidden">หน้าหลัก</a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-3 px-3 py-3">
        <section className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border-4 border-yellow-400 bg-yellow-50 p-3">
            <p className="text-lg font-bold">🚚 รถใหญ่ / คนนำของมาบริจาค</p>
            <p>รถใหญ่เข้าได้<b>เฉพาะถนนหลัก (เส้นเหลือง)</b> เข้าซอยเล็กไม่ได้ · เลือก<b>จุดลงของ 🚚</b> ที่สะดวก จอดลงของริมถนนหลัก แล้วทีมในโซนนั้นขนเข้าซอยต่อ</p>
          </div>
          <div className="rounded-xl border-4 border-emerald-500 bg-emerald-50 p-3">
            <p className="text-lg font-bold">👷 ทีมช่วยเหลือ / อาสา</p>
            <p>ตกลงกันว่า<b>ทีมไหนดูแลโซนไหน</b> (A, B, C…) แล้วรับงานเฉพาะในโซนตัวเอง ไม่ไปบ้านซ้ำกัน · ในหน้า /staff เลือกกรองงานตามโซนได้</p>
          </div>
        </section>

        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <div ref={el} className="zones-map h-[70vh] w-full overflow-hidden rounded-xl border border-neutral-300 bg-white print:h-[180mm]" />

        {data && (
          <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.zones.map((z) => {
              const n = need[z.id];
              return (
                <div key={z.id} className="zone-card rounded-xl border-l-8 bg-white p-3 shadow" style={{ borderColor: z.color }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-black text-white" style={{ background: z.color }}>
                      {z.id}
                    </span>
                    <div className="min-w-0">
                      <p className="font-bold">โซน {z.id} · ~{z.houses} หลัง</p>
                      <p className="text-sm text-neutral-600">ซอย {z.sois.join(", ")}</p>
                    </div>
                  </div>
                  <p className="mt-2 font-semibold">🚚 จุดลงของ: ปากซอย {z.drop.soi} (ริมถนนหลัก)</p>
                  {n && !POSTER && (
                    <p className="text-sm">
                      🆘 คำขอค้าง {n.open}
                      {n.urgent ? <span className="ml-1 rounded bg-red-600 px-1.5 font-bold text-white">ด่วน {n.urgent}</span> : null}
                    </p>
                  )}
                  <div className="mt-2 grid grid-cols-2 gap-2 print:hidden">
                    <button onClick={() => focus(z)} className="min-h-[44px] rounded-lg border-2 border-black text-sm font-semibold">📍 ดูบนแผนที่</button>
                    <a href={navUrl(z.drop)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center justify-center rounded-lg bg-black text-sm font-semibold text-white">
                      🧭 นำทาง
                    </a>
                  </div>
                </div>
              );
            })}
          </section>
        )}
        {POSTER && <p className="rounded-xl bg-black p-3 text-center text-lg font-bold text-white">ดูแผนที่ออนไลน์ + นำทาง: serithai57.com/zones</p>}
        <p className="text-xs text-neutral-500">
          แบ่งโซนจากจำนวนบ้านจริง ~{data?.target_per_zone || 170} หลังต่อโซน (ข้อมูลอาคาร/ซอยจาก © OpenStreetMap contributors) · จุดลงของเลือกปากซอยบนถนนหลักที่อยู่กลางโซน
        </p>
      </main>
    </div>
  );
}
