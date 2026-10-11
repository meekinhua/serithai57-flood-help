// 🏠 /admin › ที่อยู่ (9 Oct 2026): check and correct the address book (house → soi / pin) that residents filled in.
// Flags come from the backend (pin on another soi, outside the village, neighbours' numbers, sign-up soi …);
// every save here counts as the team's (strongest source: บ้านฉัน / the LINE import can't overwrite it).
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api } from "../api";
import { timeAgo } from "../config";
import { createBaseMap } from "./MapView";
import SoiDraw from "./SoiDraw";

const SRC = { staff: "ทีมยืนยัน", resident: "เจ้าของบ้านใส่เอง", neighbor: "เพื่อนบ้านใส่ให้", text: "เดาจากแชท LINE" };
const COLOR = { red: "#B42318", amber: "#D9A21B", ok: "#1E6B47", done: "#5B6CFF" };
const sevOf = (r) => (r.flags.some((f) => f[0] === "red") ? "red" : r.flags.length ? "amber" : r.reviewed ? "done" : "ok");
const HINT = { pin: "ตามหมุด", signup: "ตามที่ลงทะเบียนตรวจไฟ", numbers: "ตามเลขบ้านข้างเคียง", guess: "ระบบเดาจากเลขข้างเคียง" };
// Google Maps shows a building's number when you tap it (sometimes wrong): the admin looks there by hand
const gmaps = (p) => `https://www.google.com/maps/@${p.lat},${p.lng},20z`;

function HouseReview() {
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("bad");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(null); // house
  const [soi, setSoi] = useState("");
  const [moving, setMoving] = useState(null); // {lat,lng} while dragging the pin
  const [busy, setBusy] = useState(false);
  const mapEl = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const drag = useRef(null);

  const load = () =>
    api("/admin/addresses/review")
      .then(setData)
      .catch((e) => setMsg(e.message));
  useEffect(() => {
    load();
  }, []);

  // the map + soi lines (once)
  useEffect(() => {
    if (!data || map.current || !mapEl.current) return;
    const m = createBaseMap(mapEl.current, { zoom: 16 });
    map.current = m;
    api("/sois").then((r) => {
      for (const [k, s] of Object.entries(r.sois)) {
        for (const ln of s.lines || []) L.polyline(ln, { color: "#7d8b84", weight: 3, opacity: 0.55 }).bindTooltip(`ซ.${k}`, { sticky: true }).addTo(m);
      }
    });
    layer.current = L.layerGroup().addTo(m);
    m.on("click", (e) => setMoving((v) => (v ? { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) } : v)));
  }, [data]);

  const items = useMemo(() => {
    if (!data) return [];
    const k = q.trim().replace(/^4\//, "");
    return data.items.filter((r) => (k ? r.house.replace(/^4\//, "").startsWith(k) : filter === "all" || (filter === "bad" ? r.flags.length : filter === "nopin" ? r.lat == null : r.reviewed)));
  }, [data, filter, q]);
  const [guess, setGuess] = useState(null); // a house not in the book yet: the system's guess {soi, lat, lng}
  const cur =
    data?.items.find((r) => r.house === sel) || (sel ? { house: sel, soi: "", lat: null, lng: null, flags: [], hints: guess?.soi ? { guess: guess.soi } : {}, source: "", by: "", isNew: true } : null);
  const qNum = q.trim().replace(/^4\//, "");
  const canAdd = /^\d{1,4}$/.test(qNum) && data && !data.items.some((r) => r.house === `4/${qNum}`);

  // markers
  useEffect(() => {
    if (!layer.current || !data) return;
    layer.current.clearLayers();
    for (const r of data.items) {
      if (r.lat == null) continue;
      const sev = sevOf(r);
      const on = r.house === sel;
      L.circleMarker([r.lat, r.lng], { radius: on ? 11 : sev === "ok" || sev === "done" ? 5 : 8, color: on ? "#000" : "#fff", weight: on ? 3 : 1.5, fillColor: COLOR[sev], fillOpacity: 0.95 })
        .bindTooltip(`${r.house} · ซ.${r.soi || "?"}`)
        .on("click", () => pick(r.house))
        .addTo(layer.current);
    }
  }, [data, sel]); // eslint-disable-line react-hooks/exhaustive-deps

  // the draggable pin while moving
  useEffect(() => {
    if (drag.current) {
      drag.current.remove();
      drag.current = null;
    }
    if (!moving || !map.current) return;
    drag.current = L.marker([moving.lat, moving.lng], { draggable: true, zIndexOffset: 1000 })
      .on("dragend", (e) => {
        const p = e.target.getLatLng();
        setMoving({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) });
      })
      .addTo(map.current);
  }, [moving]);

  function pick(h) {
    const r = data.items.find((x) => x.house === h);
    setGuess(null);
    if (!r)
      api(`/myhome?house=${encodeURIComponent(h)}`)
        .then((x) => {
          setGuess({ soi: x.soi, lat: x.lat, lng: x.lng });
          if (x.lat) map.current?.setView([x.lat, x.lng], 18);
        })
        .catch(() => {});
    setSel(h);
    setSoi(r?.soi || "");
    setMoving(null);
    setMsg("");
    if (r?.lat != null) map.current?.setView([r.lat, r.lng], 19);
  }

  async function save(extra = {}) {
    setBusy(true);
    setMsg("");
    try {
      await api("/admin/addresses/review", { method: "POST", body: JSON.stringify({ house: sel, soi: soi.trim() || null, ...extra }) });
      await load();
      setMoving(null);
      setMsg(`✅ บันทึก ${sel} แล้ว`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  if (!data) return <p className={msg ? "text-red-700" : "text-neutral-500"}>{msg || "กำลังโหลด…"}</p>;
  const bad = data.items.filter((r) => r.flags.length).length;
  const red = data.items.filter((r) => sevOf(r) === "red").length;
  return (
    <section className="rounded-2xl border bg-white p-3">
      <h2 className="text-lg font-bold">🏠 ตรวจที่อยู่บ้าน (บ้านเลขที่ → ซอย / หมุด)</h2>
      <p className="text-sm text-neutral-600">
        {data.items.length} หลัง · มีหมุด {data.items.filter((r) => r.lat != null).length} · น่าสงสัย {bad} (🔴 {red}) · ข้อมูลภายในทีม มีเลขบ้าน
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {[
          ["bad", "⚠️ น่าสงสัย"],
          ["nopin", "ไม่มีหมุด"],
          ["done", "แก้/ยืนยันแล้ว"],
          ["all", "ทั้งหมด"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setFilter(k)} className={`min-h-[40px] rounded-lg px-3 text-sm font-semibold ${filter === k ? "bg-black text-white" : "border-2 border-black"}`}>
            {t}
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นเลขบ้าน เช่น 766" inputMode="numeric" className="min-h-[40px] w-40 rounded-lg border px-2" />
      </div>

      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_340px]">
        <div ref={mapEl} className="h-[420px] rounded-xl border md:h-[560px]" />
        <div className="flex max-h-[560px] flex-col gap-2">
          {cur && (
            <div className="rounded-xl border-2 border-black p-3">
              <div className="flex items-center gap-2">
                <b className="flex-1 text-lg">{cur.house}</b>
                <button onClick={() => setSel(null)} className="text-sm underline">
                  ปิด
                </button>
              </div>
              <p className="text-sm text-neutral-600">
                {cur.isNew ? "ยังไม่มีในสมุด · " : ""}
                {SRC[cur.source] || cur.source} {cur.by && `(${cur.by})`} {cur.at && `· ${timeAgo(cur.at)}`} · {cur.lat != null ? "มีหมุด" : "ยังไม่มีหมุด"}
              </p>
              {cur.flags.map(([s, t]) => (
                <p key={t} className={`text-sm ${s === "red" ? "font-semibold text-red-700" : "text-amber-700"}`}>
                  ⚠️ {t}
                </p>
              ))}

              <label className="mt-2 block text-sm font-semibold">ซอย</label>
              <div className="flex gap-1">
                <input value={soi} onChange={(e) => setSoi(e.target.value.replace(/\s/g, ""))} list="addr-sois" className="min-h-[44px] w-24 rounded-lg border px-2 text-base" />
                <datalist id="addr-sois">
                  {data.sois.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                {Object.entries(cur.hints).map(([k, v]) => (
                  <button key={k} onClick={() => setSoi(v)} className="min-h-[44px] rounded-lg border px-2 text-xs" title={HINT[k]}>
                    ซ.{v}
                    <br />
                    <span className="text-neutral-500">{HINT[k]}</span>
                  </button>
                ))}
              </div>

              <div className="mt-2 rounded-lg bg-neutral-100 p-2 text-sm">
                {moving ? (
                  <>
                    📍 ลากหมุดสีน้ำเงิน หรือแตะบนแผนที่ตรงหลังคาบ้าน · {moving.lat}, {moving.lng}
                    <button onClick={() => setMoving(null)} className="ml-2 underline">
                      ยกเลิก
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setMoving(cur.lat != null ? { lat: cur.lat, lng: cur.lng } : { lat: map.current.getCenter().lat, lng: map.current.getCenter().lng })}
                    className="font-semibold underline"
                  >
                    📍 {cur.lat != null ? "ย้ายหมุด" : "ปักหมุดบ้านนี้"}
                  </button>
                )}
                <a
                  href={gmaps(moving || (cur.lat != null ? cur : guess?.lat ? guess : { lat: map.current?.getCenter().lat.toFixed(6), lng: map.current?.getCenter().lng.toFixed(6) }))}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block font-semibold text-blue-800 underline"
                >
                  🔎 ดูใน Google Maps ตรงนี้
                </a>
                <span className="block text-xs text-neutral-600">แตะอาคารใน Google จะขึ้นเลขที่บ้าน · Google ผิดได้ เทียบกับเลขข้างเคียงด้วย</span>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  disabled={busy}
                  onClick={() => save(moving ? { lat: moving.lat, lng: moving.lng } : {})}
                  className="min-h-[48px] rounded-xl bg-black font-semibold text-white disabled:opacity-50"
                >
                  💾 บันทึกที่แก้
                </button>
                <button disabled={busy} onClick={() => save({ ok: true })} className="min-h-[48px] rounded-xl border-2 border-green-700 font-semibold text-green-800 disabled:opacity-50">
                  ✓ ถูกแล้ว
                </button>
              </div>
              {!cur.isNew && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`ลบ ${cur.house} ออกจากสมุดที่อยู่? (เช่น พิมพ์เลขผิด / ไม่มีบ้านเลขนี้จริง)`)) return;
                    setBusy(true);
                    try {
                      await api("/admin/addresses/delete", { method: "POST", body: JSON.stringify({ house: cur.house }) });
                      setSel(null);
                      await load();
                      setMsg(`✅ ลบ ${cur.house} แล้ว`);
                    } catch (e) {
                      setMsg(e.message);
                    }
                    setBusy(false);
                  }}
                  className="mt-1 min-h-[44px] w-full rounded-xl border border-red-300 text-sm font-semibold text-red-700 disabled:opacity-50"
                >
                  🗑️ ลบบ้านนี้ออก (ข้อมูลผิด)
                </button>
              )}
            </div>
          )}
          {msg && <p className={msg.startsWith("✅") ? "text-green-800" : "text-red-700"}>{msg}</p>}
          {canAdd && (
            <button onClick={() => pick(`4/${qNum}`)} className="min-h-[44px] rounded-xl border-2 border-dashed border-black font-semibold">
              ➕ 4/{qNum} ยังไม่มีในสมุด · เพิ่ม/ปักหมุด
            </button>
          )}
          <p className="text-sm text-neutral-600">{items.length} หลัง · แตะเพื่อดู/แก้</p>
          <ul className="flex-1 overflow-auto rounded-xl border">
            {items.map((r) => (
              <li key={r.house}>
                <button onClick={() => pick(r.house)} className={`w-full border-b p-2 text-left ${r.house === sel ? "bg-neutral-100" : ""}`}>
                  <span style={{ color: COLOR[sevOf(r)] }}>●</span> <b>{r.house}</b> ซ.{r.soi || "?"} {r.lat == null && <span className="text-xs text-neutral-500">· ไม่มีหมุด</span>}
                  {r.flags.length > 0 && <span className="block text-xs text-neutral-600">{r.flags.map((f) => f[1]).join(" · ")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---------- 11 Oct: the number-range tool left (members fill in the houses themselves now) ----------
export default function AddressAdmin() {
  const [mode, setMode] = useState("houses");
  return (
    <div>
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["houses", "🏠 รายหลัง"],
          ["draw", "✏️ เส้นซอย"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-lg font-semibold ${mode === k ? "bg-white shadow" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {mode === "draw" ? <SoiDraw /> : <HouseReview />}
    </div>
  );
}
