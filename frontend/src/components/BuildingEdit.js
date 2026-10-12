// 🏘️ /admin › ที่อยู่ › อาคาร (11 Oct 2026): the roof points come from OpenStreetMap and miss / merge some houses
// (5 real houses, 4 roofs). Add a roof where a house is missing, remove one that's wrong, put a removed one back.
// The roofs are what บ้านฉัน's "ช่วยเติมแผนที่" shows and what a pin snaps to.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { createBaseMap } from "./MapView";
import Map3D from "./Map3D";

export default function BuildingEdit() {
  const [view, setView] = useState("3d");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["3d", "🏙️ 3D · รูปอาคาร + จำนวนชั้น"],
          ["2d", "📍 2D · จุดหลังคา (แบบเดิม)"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setView(k)} className={`min-h-[44px] rounded-lg text-sm font-semibold ${view === k ? "bg-[#15201A] text-white" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {view === "3d" ? (
        <section className="rounded-2xl border bg-white p-3">
          <h2 className="text-lg font-bold">🏙️ อาคาร 3D · แก้ให้ตรงของจริง</h2>
          <p className="text-sm text-neutral-600">
            เลือกเครื่องมือด้านล่าง แล้วแตะบ้านได้เลย: 🏠 วางบ้าน (หน้าตาเหมือนหลังข้างๆ) · ⬆️⬇️ จำนวนชั้น · 🔨 ทุบบ้านที่ไม่มีจริง · ↩️ ย้อน · ผนังมิ้นต์ = เพิ่มเอง · แดงแบน = ทุบไปแล้ว (แตะเพื่อคืน) · เลขบนหลังคา = บ้านที่ลูกบ้านปักหมุด · หมุน/เอียงด้วยสองนิ้ว หรือคลิกขวาลาก
          </p>
          <Map3D edit className="mt-2 h-[560px] rounded-xl border md:h-[680px]" />
        </section>
      ) : (
        <RoofPoints />
      )}
    </div>
  );
}

function RoofPoints() {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [d, setD] = useState(null);
  const [houses, setHouses] = useState([]);
  const [sois, setSois] = useState(null);
  const [mode, setMode] = useState("add"); // add | remove
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  useEffect(() => {
    api("/admin/buildings")
      .then(setD)
      .catch((e) => setMsg(e.message));
    api("/sois")
      .then((r) => setSois(r.sois))
      .catch(() => {});
    api("/admin/addresses/review")
      .then((r) => setHouses(r.items.filter((x) => x.lat != null)))
      .catch(() => {});
  }, []);

  async function call(path, body, note) {
    setBusy(true);
    setMsg("");
    try {
      setD(await api(path, { method: "POST", body: JSON.stringify(body) }));
      setMsg(note);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  useEffect(() => {
    if (!d || !el.current) return;
    if (!map.current) {
      map.current = createBaseMap(el.current, { zoom: 18 });
      map.current.setMaxZoom(20);
      layer.current = L.layerGroup().addTo(map.current);
      map.current.on("click", (e) => {
        if (modeRef.current !== "add") return;
        call("/admin/buildings/add", { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }, "✅ เพิ่มอาคารแล้ว");
      });
    }
    const g = layer.current;
    g.clearLayers();
    // the sois (blue lines + their names) so a block can be told apart
    for (const [k, so] of Object.entries(sois || {})) {
      const lines = so.lines || [];
      for (const ln of lines) L.polyline(ln, { color: so.drawn ? "#7C3AED" : "#2563EB", weight: 4, opacity: 0.55, interactive: false }).addTo(g);
      const ln = lines.reduce((a, b) => (b.length > a.length ? b : a), []);
      if (ln.length) {
        const mid = ln[Math.floor(ln.length / 2)];
        L.marker(mid, {
          interactive: false,
          icon: L.divIcon({
            className: "",
            iconSize: null,
            iconAnchor: [18, 10],
            html: `<div style="font:800 12px sans-serif;color:#fff;background:${so.drawn ? "#7C3AED" : "#2563EB"};border-radius:6px;padding:1px 6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">ซ.${k}</div>`,
          }),
        }).addTo(g);
      }
    }
    for (const h of houses) {
      L.marker([h.lat, h.lng], {
        interactive: false,
        icon: L.divIcon({
          className: "",
          iconSize: null,
          iconAnchor: [14, 22],
          html: `<div style="font:700 11px sans-serif;color:#15201A;background:rgba(255,255,255,.85);border-radius:4px;padding:0 3px">${h.house.replace(/^4\//, "")}</div>`,
        }),
      }).addTo(g);
    }
    for (const [lat, lng, id, added] of d.roofs) {
      L.circleMarker([lat, lng], { radius: 8, color: "#fff", weight: 2, fillColor: added ? "#1E6B47" : "#6B7280", fillOpacity: 0.95 })
        .bindTooltip(added ? "อาคารที่เพิ่มเอง · แตะในโหมดลบเพื่อเอาออก" : "อาคารจาก OpenStreetMap")
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          if (modeRef.current === "remove") call("/admin/buildings/remove", { id }, "✅ ลบอาคารแล้ว");
        })
        .addTo(g);
    }
    for (const [lat, lng, id] of d.removed) {
      L.marker([lat, lng], { icon: L.divIcon({ className: "", iconSize: [20, 20], iconAnchor: [10, 10], html: '<div style="color:#B42318;font:900 20px sans-serif;line-height:20px">✕</div>' }) })
        .bindTooltip("ลบไปแล้ว · แตะเพื่อคืน")
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          call("/admin/buildings/restore", { id }, "✅ คืนอาคารแล้ว");
        })
        .addTo(g);
    }
  }, [d, houses, sois]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (map.current) map.current.getContainer().style.cursor = mode === "add" ? "crosshair" : "";
  }, [mode, d]);

  if (!d) return <p className={msg ? "text-red-700" : "text-neutral-500"}>{msg || "กำลังโหลด…"}</p>;
  return (
    <section className="rounded-2xl border bg-white p-3">
      <h2 className="text-lg font-bold">🏘️ อาคาร · เพิ่ม / ลบ จุดหลังคา</h2>
      <p className="text-sm text-neutral-600">
        เส้น/ป้ายน้ำเงิน = ซอย (ม่วง = ซอยที่วาดเพิ่ม) · จุดเทา = อาคารจาก OpenStreetMap · จุดเขียว = ที่เพิ่มเอง · ✕ แดง = ลบไปแล้ว (แตะเพื่อคืน) · ตัวเลข = บ้านที่ปักหมุดแล้ว · ซูมเข้าไปดูทีละบล็อก
        เทียบกับ Google ได้ · มี {d.roofs.length} อาคาร (เพิ่มเอง {d.added} · ลบ {d.removed.length})
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["add", "➕ เพิ่มอาคาร · แตะบนแผนที่"],
          ["remove", "➖ ลบอาคาร · แตะจุด"],
        ].map(([k, t]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${mode === k ? (k === "add" ? "bg-green-700 text-white" : "bg-red-700 text-white") : "text-neutral-600"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {msg && <p className={`mt-1 ${msg.startsWith("✅") ? "text-green-800" : "text-red-700"}`}>{msg}</p>}
      <div ref={el} className={`mt-2 h-[520px] rounded-xl border md:h-[640px] ${busy ? "opacity-70" : ""}`} />
      <p className="mt-1 text-xs text-neutral-500">
        เพิ่มแล้วจุดใหม่จะขึ้นในเครื่องมือ “ช่วยเติมแผนที่” ของลูกบ้าน และใช้จับหมุดให้ตรงหลังคา · ภาพพื้นหลัง (รูปอาคารสีเทาในแผนที่) มาจาก OpenStreetMap แก้จากตรงนี้ไม่ได้
      </p>
    </section>
  );
}
