// ✏️ /admin › ที่อยู่ › เส้นซอย (9 Oct 2026): draw the sub-sois the map doesn't have (48/1, 34/2 …).
// A drawn line joins the soi map for the whole site: the map, "which soi is this pin on", the house checks.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { createBaseMap } from "./MapView";

const SOI_RE = /^\d{1,3}(\/\d{1,2})?$/;

export default function SoiDraw() {
  const el = useRef(null);
  const map = useRef(null);
  const base = useRef(null);
  const live = useRef(null);
  const [sois, setSois] = useState(null); // the whole soi map (drawn ones included)
  const [drawn, setDrawn] = useState({});
  const [missing, setMissing] = useState([]); // sois houses are saved under but the map has no line for
  const [name, setName] = useState("");
  const [lines, setLines] = useState([[]]); // the one being drawn: several lines allowed (a branch)
  const [drawing, setDrawing] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [s, d, r] = await Promise.all([api("/sois"), api("/admin/sois/drawn"), api("/admin/addresses/review").catch(() => ({ items: [] }))]);
    setSois(s.sois);
    setDrawn(d.sois);
    const by = {};
    for (const x of r.items) {
      if (x.soi && !s.sois[x.soi] && SOI_RE.test(x.soi)) (by[x.soi] = by[x.soi] || []).push(x);
    }
    setMissing(Object.entries(by).sort((a, b) => b[1].length - a[1].length));
  };
  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
  }, []);

  // map + every soi line (drawn ones in blue)
  useEffect(() => {
    if (!sois || !el.current) return;
    if (!map.current) {
      map.current = createBaseMap(el.current, { zoom: 16 });
      base.current = L.layerGroup().addTo(map.current);
      live.current = L.layerGroup().addTo(map.current);
    }
    base.current.clearLayers();
    for (const [k, s] of Object.entries(sois)) {
      for (const ln of s.lines || []) {
        L.polyline(ln, { color: s.drawn ? "#2563EB" : "#7d8b84", weight: s.drawn ? 6 : 4, opacity: 0.7 })
          .bindTooltip(`ซ.${k}`, { sticky: true })
          .addTo(base.current);
      }
    }
    for (const [k, hs] of missing) {
      for (const h of hs) {
        if (h.lat == null) continue;
        L.circleMarker([h.lat, h.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#D97706", fillOpacity: 1 }).bindTooltip(`${h.house} · ซ.${k} (ยังไม่มีเส้น)`).addTo(base.current);
      }
    }
  }, [sois, missing]);

  // tap = a point on the line being drawn
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const add = (e) =>
      setLines((ls) => {
        const next = ls.map((l) => [...l]);
        next[next.length - 1].push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
        return next;
      });
    if (drawing) m.on("click", add);
    m.getContainer().style.cursor = drawing ? "crosshair" : "";
    return () => m.off("click", add);
  }, [drawing, sois]);

  useEffect(() => {
    if (!live.current) return;
    live.current.clearLayers();
    for (const ln of lines) {
      if (ln.length > 1) L.polyline(ln, { color: "#DC2626", weight: 6 }).addTo(live.current);
      ln.forEach((p, i) => L.circleMarker(p, { radius: i === ln.length - 1 ? 7 : 5, color: "#DC2626", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(live.current));
    }
  }, [lines]);

  function start(n, existing) {
    setName(n || "");
    setLines(existing?.length ? existing.map((l) => [...l]) : [[]]);
    setDrawing(true);
    setMsg("");
    const hs = (missing.find(([k]) => k === n) || [])[1] || [];
    const pts = [...hs.filter((h) => h.lat != null).map((h) => [h.lat, h.lng]), ...(existing || []).flat()];
    if (pts.length) map.current?.fitBounds(pts, { padding: [40, 40], maxZoom: 19 });
  }
  async function saveLine() {
    const n = name.trim().replace(/^(ซอย|ซ\.?|แยก)\s*/, "");
    const ls = lines.filter((l) => l.length >= 2);
    if (!SOI_RE.test(n)) return setMsg("☝️ ใส่ชื่อซอย เช่น 48/1");
    if (!ls.length) return setMsg("☝️ แตะบนแผนที่ตามแนวถนนซอย อย่างน้อย 2 จุด");
    setBusy(true);
    try {
      await api(`/admin/sois/drawn/${n}`, { method: "PUT", body: JSON.stringify({ lines: ls }) });
      setDrawing(false);
      setLines([[]]);
      await reload();
      setMsg(`✅ บันทึกเส้น ซ.${n} แล้ว · ทั้งเว็บใช้เส้นนี้ทันที`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }
  async function remove(n) {
    if (!window.confirm(`ลบเส้น ซ.${n} ที่วาดไว้?`)) return;
    setBusy(true);
    try {
      await api(`/admin/sois/drawn/${n}`, { method: "DELETE" });
      await reload();
      setMsg(`ลบเส้น ซ.${n} แล้ว`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  if (!sois) return <p className={msg ? "text-red-700" : "text-neutral-500"}>{msg || "กำลังโหลด…"}</p>;
  const pts = lines.reduce((t, l) => t + l.length, 0);
  return (
    <section className="rounded-2xl border bg-white p-3">
      <h2 className="text-lg font-bold">✏️ เส้นซอย · วาดซอยย่อยที่แผนที่ยังไม่มี</h2>
      <p className="text-sm text-neutral-600">
        เส้นเทา = ซอยจากแผนที่ · เส้นน้ำเงิน = ที่วาดเพิ่ม · จุดส้ม = บ้านที่บันทึกซอยที่ยังไม่มีเส้น · วาดแล้วทั้งเว็บใช้ทันที (หาซอยจากหมุด, แผนที่, ตรวจที่อยู่)
      </p>
      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_320px]">
        <div ref={el} className="h-[440px] rounded-xl border md:h-[560px]" />
        <div className="space-y-2">
          {drawing ? (
            <div className="rounded-xl border-2 border-red-600 p-3">
              <label className="block text-sm font-semibold">ชื่อซอย</label>
              <input value={name} onChange={(e) => setName(e.target.value.replace(/\s/g, ""))} placeholder="เช่น 48/1" className="min-h-[44px] w-full rounded-lg border px-2 text-base" />
              <p className="mt-2 text-sm">แตะบนแผนที่ไล่ตามแนวถนนซอย จากปากซอยเข้าไป · {pts} จุด</p>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  onClick={() =>
                    setLines((ls) => {
                      const next = ls.map((l) => [...l]);
                      if (next[next.length - 1].length) next[next.length - 1].pop();
                      else if (next.length > 1) next.pop();
                      return next;
                    })
                  }
                  className="min-h-[44px] rounded-lg border-2 border-black text-sm font-semibold"
                >
                  ↩︎ ลบจุดล่าสุด
                </button>
                <button onClick={() => setLines((ls) => (ls[ls.length - 1].length ? [...ls, []] : ls))} className="min-h-[44px] rounded-lg border-2 border-black text-sm font-semibold">
                  ➕ เส้นแยกอีกเส้น
                </button>
                <button disabled={busy} onClick={saveLine} className="min-h-[48px] rounded-lg bg-black font-semibold text-white disabled:opacity-50">
                  💾 บันทึก
                </button>
                <button
                  onClick={() => {
                    setDrawing(false);
                    setLines([[]]);
                  }}
                  className="min-h-[48px] rounded-lg border font-semibold"
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => start("")} className="min-h-[52px] w-full rounded-xl bg-black font-bold text-white">
              ✏️ วาดเส้นซอยใหม่
            </button>
          )}
          {msg && <p className={msg.startsWith("✅") ? "text-green-800" : "text-red-700"}>{msg}</p>}
          {missing.length > 0 && (
            <div className="rounded-xl bg-amber-50 p-2">
              <p className="text-sm font-semibold">ซอยที่ยังไม่มีเส้น (มีบ้านบันทึกไว้)</p>
              {missing.map(([k, hs]) => (
                <button
                  key={k}
                  disabled={drawing}
                  onClick={() => start(k)}
                  className="mt-1 flex min-h-[40px] w-full items-center justify-between rounded-lg bg-white px-2 text-left text-sm disabled:opacity-50"
                >
                  <span>
                    <b>ซ.{k}</b> · {hs.length} หลัง{hs.some((h) => h.lat != null) ? " · มีหมุด" : ""}
                  </span>
                  <span className="font-semibold text-blue-800">วาด ›</span>
                </button>
              ))}
            </div>
          )}
          {Object.keys(drawn).length > 0 && (
            <div className="rounded-xl border p-2">
              <p className="text-sm font-semibold">เส้นที่วาดไว้</p>
              {Object.entries(drawn).map(([k, d]) => (
                <div key={k} className="mt-1 flex items-center gap-2 text-sm">
                  <b className="flex-1">
                    ซ.{k} <span className="font-normal text-neutral-500">· {(d.lines || []).reduce((t, l) => t + l.length, 0)} จุด</span>
                  </b>
                  <button disabled={drawing} onClick={() => start(k, d.lines)} className="underline disabled:opacity-40">
                    แก้
                  </button>
                  <button disabled={drawing || busy} onClick={() => remove(k)} className="text-red-700 underline disabled:opacity-40">
                    ลบ
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
