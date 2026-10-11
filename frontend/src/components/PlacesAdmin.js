// 🗺️ /admin › สถานที่ (11 Oct 2026): pins (a shop, an activity spot), areas (tennis court, park) and routes
// (the monks' alms round) on the village map — each with an optional timetable: always shown, or only while on
// (plus a heads-up N minutes before).
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { createBaseMap } from "./MapView";
import { drawPlace } from "./placeDraw";

const KINDS = [
  ["pin", "📍 หมุด", "ร้าน จุดนัด จุดกิจกรรม · แตะ 1 จุด"],
  ["area", "⬛ พื้นที่", "สนามเทนนิส สวน ลานจอดรถ · แตะรอบขอบ"],
  ["route", "〰️ เส้นทาง", "พระบิณฑบาต เส้นทางเดิน · แตะไล่ตามทาง"],
];
const EMOJI = ["📍", "🍜", "☕", "🛒", "🎾", "🏸", "⚽", "🌳", "🙏", "🎉", "🏥", "🅿️", "🚛", "💧", "📢", "🏫"];
const COLORS = ["#1E6B47", "#2563EB", "#D97706", "#B42318", "#7C3AED", "#0E7490", "#15201A"];
const DAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const BLANK = { kind: "pin", name: "", emoji: "📍", detail: "", color: "#1E6B47", geometry: [], slots: [], show: "always", notice: 30, phone: "", link: "", on: true };
const STATE = { on: ["🟢 กำลังมีตอนนี้", "text-green-800"], soon: ["🟡 ใกล้เริ่ม", "text-amber-700"], off: ["⚪ ยังไม่ถึงเวลา", "text-neutral-500"] };

export default function PlacesAdmin() {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [list, setList] = useState(null);
  const [f, setF] = useState(null); // the place being made / edited
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));

  const reload = () =>
    api("/admin/places")
      .then(setList)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!list || !el.current) return;
    if (!map.current) {
      map.current = createBaseMap(el.current, { zoom: 16 });
      layer.current = L.layerGroup().addTo(map.current);
    }
  }, [list]);

  // tap = a point (pin: the point; area / route: one more corner)
  useEffect(() => {
    const m = map.current;
    if (!m || !f) return;
    const add = (e) => {
      const p = [+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)];
      setF((x) => ({ ...x, geometry: x.kind === "pin" ? p : [...(Array.isArray(x.geometry[0]) ? x.geometry : []), p] }));
    };
    m.on("click", add);
    m.getContainer().style.cursor = "crosshair";
    return () => {
      m.off("click", add);
      m.getContainer().style.cursor = "";
    };
  }, [f?.kind, !!f, list]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const g = layer.current;
    if (!g || !list) return;
    g.clearLayers();
    for (const p of list) if (!f || p.id !== f.id) drawPlace(p, g, { onClick: (x) => !f && edit(x), faded: !p.on });
    if (f) {
      const pts = f.kind === "pin" ? (f.geometry.length === 2 && !Array.isArray(f.geometry[0]) ? [f.geometry] : []) : f.geometry;
      if (pts.length && (f.kind === "pin" || pts.length >= 2)) drawPlace({ ...f, name: f.name || "…", geometry: f.kind === "pin" ? pts[0] : pts }, g);
      pts.forEach((p) => L.circleMarker(p, { radius: 5, color: "#DC2626", weight: 2, fillColor: "#fff", fillOpacity: 1 }).addTo(g));
    }
  }, [list, f]); // eslint-disable-line react-hooks/exhaustive-deps

  function edit(p) {
    setF(JSON.parse(JSON.stringify(p)));
    setMsg("");
  }
  async function saveIt() {
    const ready = f.kind === "pin" ? f.geometry.length === 2 && !Array.isArray(f.geometry[0]) : f.geometry.length >= (f.kind === "area" ? 3 : 2);
    if (!f.name.trim()) return setMsg("☝️ ใส่ชื่อ");
    if (!ready) return setMsg(f.kind === "pin" ? "☝️ แตะบนแผนที่ตรงที่จะปักหมุด" : `☝️ แตะบนแผนที่อย่างน้อย ${f.kind === "area" ? 3 : 2} จุด`);
    setBusy(true);
    try {
      const body = JSON.stringify({ ...f, slots: f.slots.filter((s) => s.days.length && s.start && s.end) });
      if (f.id) await api(`/admin/places/${f.id}`, { method: "PUT", body });
      else await api("/admin/places", { method: "POST", body });
      setMsg(`✅ บันทึก “${f.name}” แล้ว · ขึ้นบนแผนที่หมู่บ้าน`);
      setF(null);
      await reload();
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }
  async function del() {
    if (!window.confirm(`ลบ “${f.name}”?`)) return;
    await api(`/admin/places/${f.id}`, { method: "DELETE" });
    setF(null);
    await reload();
  }

  if (!list) return <p className={msg ? "text-red-700" : "text-neutral-500"}>{msg || "กำลังโหลด…"}</p>;
  const slot = (i, patch) => set({ slots: f.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <section className="rounded-2xl border bg-white p-3">
      <h2 className="text-lg font-bold">🗺️ สถานที่ · กิจกรรม · เส้นทาง บนแผนที่หมู่บ้าน</h2>
      <p className="text-sm text-neutral-600">ปักหมุดร้าน/จุดกิจกรรม วาดพื้นที่ (สนาม สวน) หรือเส้นทาง (พระบิณฑบาต) · ใส่ตารางเวลาได้ จะโชว์ตลอด หรือโชว์เฉพาะตอนมี + เตือนล่วงหน้า</p>
      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_360px]">
        <div ref={el} className="h-[440px] rounded-xl border md:h-[600px]" />
        <div className="space-y-2">
          {!f ? (
            <>
              <div className="grid grid-cols-3 gap-1">
                {KINDS.map(([k, t]) => (
                  <button
                    key={k}
                    onClick={() => setF({ ...BLANK, kind: k, emoji: k === "route" ? "🙏" : k === "area" ? "🌳" : "📍" })}
                    className="min-h-[52px] rounded-xl bg-black px-1 text-sm font-bold text-white"
                  >
                    + {t}
                  </button>
                ))}
              </div>
              {msg && <p className={msg.startsWith("✅") ? "text-green-800" : "text-red-700"}>{msg}</p>}
              <ul className="divide-y rounded-xl border">
                {list.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => edit(p)} className="w-full p-2 text-left">
                      <b>
                        {p.emoji} {p.name}
                      </b>{" "}
                      <span className="text-xs text-neutral-500">{KINDS.find((k) => k[0] === p.kind)?.[1]}</span>
                      {!p.on && <span className="ml-1 text-xs text-red-700">ซ่อนอยู่</span>}
                      <span className="block text-xs text-neutral-600">
                        {p.times || "ไม่มีตารางเวลา · โชว์ตลอด"}
                        {p.times && <span className={`ml-1 ${STATE[p.state]?.[1]}`}>{STATE[p.state]?.[0]}</span>}
                      </span>
                    </button>
                  </li>
                ))}
                {!list.length && <li className="p-2 text-sm text-neutral-500">ยังไม่มี · กดปุ่มด้านบนเพื่อเริ่ม</li>}
              </ul>
            </>
          ) : (
            <div className="space-y-2 rounded-xl border-2 border-black p-3">
              <p className="text-sm font-semibold">
                {KINDS.find((k) => k[0] === f.kind)?.[1]} · {KINDS.find((k) => k[0] === f.kind)?.[2]}
              </p>
              {f.kind !== "pin" && (
                <div className="flex gap-1 text-sm">
                  <button onClick={() => set({ geometry: f.geometry.slice(0, -1) })} className="min-h-[40px] flex-1 rounded-lg border-2 border-black font-semibold">
                    ↩︎ ลบจุดล่าสุด
                  </button>
                  <button onClick={() => set({ geometry: [] })} className="min-h-[40px] flex-1 rounded-lg border font-semibold">
                    เริ่มวาดใหม่
                  </button>
                </div>
              )}
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="ชื่อ เช่น สนามเทนนิส / พระบิณฑบาต" className="min-h-[44px] w-full rounded-lg border px-2 text-base" />
              <div className="flex flex-wrap gap-1">
                {EMOJI.map((x) => (
                  <button key={x} onClick={() => set({ emoji: x })} className={`h-9 w-9 rounded-lg text-xl ${f.emoji === x ? "bg-black" : "bg-neutral-100"}`}>
                    {x}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => set({ color: c })}
                    aria-label={c}
                    className={`h-8 w-8 rounded-full ${f.color === c ? "ring-2 ring-black ring-offset-2" : ""}`}
                    style={{ background: c }}
                  />
                ))}
              </div>
              <textarea
                value={f.detail}
                onChange={(e) => set({ detail: e.target.value })}
                rows={3}
                placeholder="รายละเอียด (โชว์ใน popup) เช่น เปิดให้ลูกบ้านใช้ฟรี / พระเดินจากวัด… ผ่านซอย…"
                className="w-full rounded-lg border p-2 text-base"
              />
              <div className="grid grid-cols-2 gap-1">
                <input value={f.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="เบอร์ (ถ้ามี)" className="min-h-[40px] rounded-lg border px-2" />
                <input value={f.link} onChange={(e) => set({ link: e.target.value })} placeholder="ลิงก์ (ถ้ามี)" className="min-h-[40px] rounded-lg border px-2" />
              </div>

              <div className="rounded-lg bg-neutral-100 p-2">
                <p className="text-sm font-semibold">⏰ ตารางเวลา (ไม่ใส่ = ไม่มีเวลา)</p>
                {f.slots.map((s, i) => (
                  <div key={i} className="mt-1 rounded-lg bg-white p-1.5">
                    <div className="flex flex-wrap gap-1">
                      {DAYS.map((d, k) => (
                        <button
                          key={d}
                          onClick={() => slot(i, { days: s.days.includes(k) ? s.days.filter((x) => x !== k) : [...s.days, k].sort() })}
                          className={`h-8 min-w-[34px] rounded-md px-1 text-sm font-semibold ${s.days.includes(k) ? "bg-black text-white" : "bg-neutral-100"}`}
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-sm">
                      <input type="time" value={s.start} onChange={(e) => slot(i, { start: e.target.value })} className="min-h-[36px] rounded border px-1" />
                      –
                      <input type="time" value={s.end} onChange={(e) => slot(i, { end: e.target.value })} className="min-h-[36px] rounded border px-1" />
                      <button onClick={() => set({ slots: f.slots.filter((_, j) => j !== i) })} className="ml-auto text-red-700 underline">
                        ลบ
                      </button>
                    </div>
                  </div>
                ))}
                <button onClick={() => set({ slots: [...f.slots, { days: [0, 1, 2, 3, 4, 5, 6], start: "06:00", end: "07:00" }] })} className="mt-1 min-h-[36px] text-sm font-semibold underline">
                  + เพิ่มช่วงเวลา
                </button>
                {f.slots.length > 0 && (
                  <div className="mt-2 space-y-1 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={f.show === "always"} onChange={() => set({ show: "always" })} /> โชว์บนแผนที่ตลอด (บอกเวลาใน popup)
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={f.show === "schedule"} onChange={() => set({ show: "schedule" })} /> โชว์เฉพาะตอนมี
                    </label>
                    <label className="flex items-center gap-2">
                      เตือน “เร็วๆ นี้” ล่วงหน้า
                      <select value={f.notice} onChange={(e) => set({ notice: +e.target.value })} className="rounded border p-1">
                        {[0, 15, 30, 60, 120].map((m) => (
                          <option key={m} value={m}>
                            {m ? `${m} นาที` : "ไม่เตือน"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={f.on} onChange={(e) => set({ on: e.target.checked })} /> แสดงบนแผนที่หมู่บ้าน
              </label>
              {msg && <p className={msg.startsWith("✅") ? "text-green-800" : "text-red-700"}>{msg}</p>}
              <div className="grid grid-cols-2 gap-1">
                <button disabled={busy} onClick={saveIt} className="min-h-[48px] rounded-xl bg-black font-semibold text-white disabled:opacity-50">
                  💾 บันทึก
                </button>
                <button onClick={() => setF(null)} className="min-h-[48px] rounded-xl border font-semibold">
                  ยกเลิก
                </button>
              </div>
              {f.id && (
                <button onClick={del} className="min-h-[40px] w-full text-sm text-red-700 underline">
                  ลบอันนี้
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
