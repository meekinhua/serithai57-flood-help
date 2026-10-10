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

function HouseReview({ goHouse }) {
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

  useEffect(() => {
    if (goHouse && data) {
      setQ(goHouse.replace(/^4\//, ""));
      pick(goHouse);
    }
  }, [goHouse, !!data]); // eslint-disable-line react-hooks/exhaustive-deps
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

// a confirmed range swallows the same soi's ranges it touches and trims the others'
function merged(list, lo, hi, soi) {
  const rest = [];
  for (const r of list) {
    if (r.hi < lo - 1 || r.lo > hi + 1 || (r.soi !== soi && (r.hi < lo || r.lo > hi))) rest.push(r);
    else if (r.soi === soi) {
      lo = Math.min(lo, r.lo);
      hi = Math.max(hi, r.hi);
    } else {
      if (r.lo < lo) rest.push({ ...r, hi: lo - 1 });
      if (r.hi > hi) rest.push({ ...r, lo: hi + 1 });
    }
  }
  return [...rest, { lo, hi, soi }].sort((a, b) => a.lo - b.lo);
}

// 🎯 one question at a time: the biggest unknown stretches first, then the one-house ranges that may be typos
const WIDE = 30; // a stretch wider than this has more than one soi in it: ask for a house seen on Google instead of guessing

function Quiz({ d, covered, busy, add, addMany, onHouse, reload }) {
  const [hn, setHn] = useState("");
  const [hs, setHs] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  async function saveHouse(soi) {
    setSaving(true);
    setNote("");
    try {
      await api("/admin/addresses/review", { method: "POST", body: JSON.stringify({ house: `4/${hn}`, soi }) });
      setNote(`✅ 4/${hn} = ซ.${soi} · ช่วงคำนวณใหม่แล้ว`);
      setHn("");
      setHs("");
      await reload();
    } catch (e) {
      setNote(e.message);
    }
    setSaving(false);
  }
  const [skip, setSkip] = useState([]);
  const [at, setAt] = useState("");
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const [sois, setSois] = useState(null);
  useEffect(() => {
    api("/sois")
      .then((r) => setSois(r.sois))
      .catch(() => {});
  }, []);
  const qs = [
    ...d.gaps.filter((g) => !covered(g.lo, g.hi)).map((g) => ({ ...g, kind: "gap", key: `g${g.lo}` })),
    ...d.runs.filter((r) => r.n === 1 && !covered(r.lo, r.hi)).map((r) => ({ ...r, kind: "one", key: `o${r.lo}` })),
  ]
    .filter((q) => !skip.includes(q.key))
    .sort((a, b) => {
      // quick ones first: narrow gaps (one boundary to find), then one-house ranges, then the wide stretches
      const rank = (x) => (x.kind === "gap" ? (x.hi - x.lo < WIDE ? 0 : 2) : 1);
      return rank(a) - rank(b) || a.hi - a.lo - (b.hi - b.lo) || a.lo - b.lo;
    });
  const q = qs[0];
  // the run just below / above a question: its soi + pins, for the map
  const near = q
    ? d.runs
        .filter((r) => r.hi < q.lo)
        .slice(-1)
        .concat(d.runs.filter((r) => r.lo > q.hi).slice(0, 1))
    : [];
  useEffect(() => {
    if (!el.current || !q) return;
    if (!map.current) {
      map.current = createBaseMap(el.current, { zoom: 17 });
      layer.current = L.layerGroup().addTo(map.current);
    }
    const m = map.current;
    layer.current.clearLayers();
    const pts = [];
    const colors = ["#2563EB", "#DC2626"];
    const soiList = q.kind === "gap" ? [q.below, q.above] : [q.soi];
    soiList.forEach((k, i) => {
      for (const ln of (sois && sois[k]?.lines) || []) {
        L.polyline(ln, { color: colors[i], weight: 7, opacity: 0.7 }).bindTooltip(`ซ.${k}`, { permanent: true, direction: "center", className: "font-bold" }).addTo(layer.current);
        pts.push(...ln);
      }
    });
    for (const r of near.concat(q.kind === "one" ? [q] : [])) {
      for (const [n, lat, lng] of r.pins || []) {
        L.circleMarker([lat, lng], { radius: 7, color: "#000", weight: 2, fillColor: "#fff", fillOpacity: 1 })
          .bindTooltip(`4/${n} ซ.${r.soi}`, { permanent: true, direction: "top" })
          .addTo(layer.current);
        pts.push([lat, lng]);
      }
    }
    if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 18 });
  }, [q?.key, sois]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!q) return <p className="mt-3 rounded-xl bg-green-50 p-3 font-semibold text-green-800">🎉 ไม่มีข้อที่ต้องตอบแล้ว · ดูทั้งหมดได้ที่ “📋 ดูทั้งหมด”</p>;
  const pin = near.flatMap((r) => r.pins || [])[0] || (q.pins || [])[0];
  const k = +at;
  return (
    <div className="mt-2 rounded-xl border-2 border-black p-3">
      <p className="text-sm text-neutral-600">เหลือ {qs.length} ข้อ</p>
      {q.kind === "gap" ? (
        <p className="text-lg font-bold">
          บ้าน 4/{q.lo}
          {q.hi !== q.lo && `–${q.hi}`} ({q.hi - q.lo + 1} เลข) อยู่ <span className="text-blue-700">ซ.{q.below}</span> หรือ <span className="text-red-700">ซ.{q.above}</span>?
        </p>
      ) : (
        <p className="text-lg font-bold">
          4/{q.lo} บันทึกไว้ว่า ซ.{q.soi} · แต่เลขรอบ ๆ อยู่ {near.map((r) => `ซ.${r.soi}`).join(" / ")} · ถูกไหม?
        </p>
      )}
      <p className="text-sm text-neutral-600">
        {q.kind === "gap" ? `เลขก่อนหน้า 4/${q.lo - 1} อยู่ ซ.${q.below} · เลขถัดไป 4/${q.hi + 1} อยู่ ซ.${q.above}` : "บ้านเดียวที่ไม่เข้าพวก มักพิมพ์ซอยผิด"}
      </p>
      <div ref={el} className="mt-2 h-[300px] rounded-xl border" />
      {pin && (
        <a
          href={`https://www.google.com/maps/@${pin[1]},${pin[2]},19z`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex min-h-[48px] items-center justify-center rounded-xl border-2 border-blue-800 font-semibold text-blue-800"
        >
          🔎 เปิด Google Maps แถวนี้ · แตะอาคารดูเลขที่
        </a>
      )}
      {q.kind === "gap" && q.hi - q.lo >= WIDE ? (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm">ช่วงนี้กว้าง มีหลายซอยปนกัน เดาไม่ได้ · เปิด Google แตะอาคารในแถบนี้สัก 1–2 หลัง แล้วใส่เลขด้านล่าง ระบบจะแบ่งช่วงให้เอง</p>
      ) : q.kind === "gap" ? (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => add(q.lo, q.hi, q.below)} className="min-h-[56px] rounded-xl bg-blue-700 text-lg font-bold text-white disabled:opacity-50">
              ทั้งหมด ซ.{q.below}
            </button>
            <button disabled={busy} onClick={() => add(q.lo, q.hi, q.above)} className="min-h-[56px] rounded-xl bg-red-700 text-lg font-bold text-white disabled:opacity-50">
              ทั้งหมด ซ.{q.above}
            </button>
          </div>
          {q.below !== q.above && q.hi > q.lo && (
            <div className="mt-2 flex items-center gap-1 text-sm">
              <span>หรือ ซ.{q.above} เริ่มที่ 4/</span>
              <input value={at} onChange={(e) => setAt(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="min-h-[44px] w-20 rounded-lg border px-2 text-base" />
              <button
                disabled={busy || !(k > q.lo && k <= q.hi)}
                onClick={() => {
                  addMany(
                    [
                      [q.lo, k - 1, q.below],
                      [k, q.hi, q.above],
                    ],
                    `แบ่งที่ 4/${k}`,
                  );
                  setAt("");
                }}
                className="min-h-[44px] rounded-lg bg-black px-3 font-semibold text-white disabled:opacity-40"
              >
                แบ่ง
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={() => add(q.lo, q.hi, q.soi)} className="min-h-[56px] rounded-xl bg-green-700 font-bold text-white disabled:opacity-50">
            ถูก ซ.{q.soi}
          </button>
          <button onClick={() => onHouse(`4/${q.lo}`)} className="min-h-[56px] rounded-xl border-2 border-black font-bold">
            ผิด · ไปแก้บ้านนี้
          </button>
        </div>
      )}
      <div className="mt-3 rounded-xl bg-neutral-100 p-2">
        <p className="text-sm font-semibold">เห็นเลขบ้านใน Google? ใส่ได้เลย (ทีละหลัง)</p>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span>4/</span>
          <input value={hn} onChange={(e) => setHn(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="เลข" className="min-h-[44px] w-20 rounded-lg border px-2 text-base" />
          <span>อยู่</span>
          {[...new Set(q.kind === "gap" ? [q.below, q.above] : [q.soi, ...near.map((r) => r.soi)])].map((x) => (
            <button key={x} disabled={!hn || saving} onClick={() => saveHouse(x)} className="min-h-[44px] rounded-lg bg-black px-3 font-semibold text-white disabled:opacity-40">
              ซ.{x}
            </button>
          ))}
          <input value={hs} onChange={(e) => setHs(e.target.value.replace(/[^\d/]/g, ""))} placeholder="ซอยอื่น" className="min-h-[44px] w-20 rounded-lg border px-2 text-base" />
          <button disabled={!hn || !hs || saving} onClick={() => saveHouse(hs)} className="min-h-[44px] rounded-lg border-2 border-black px-2 font-semibold disabled:opacity-40">
            บันทึก
          </button>
        </div>
        {note && <p className={`mt-1 text-sm ${note.startsWith("✅") ? "text-green-800" : "text-red-700"}`}>{note}</p>}
      </div>
      <button onClick={() => setSkip([...skip, q.key])} className="mt-2 min-h-[44px] w-full text-sm text-neutral-600 underline">
        ไม่แน่ใจ · ข้ามไปข้อถัดไป
      </button>
    </div>
  );
}

// ---------- 📏 house numbers run in chunks along the sois: confirm a range once instead of every house ----------
export default function AddressAdmin() {
  const [mode, setMode] = useState("ranges");
  const [goHouse, setGoHouse] = useState("");
  return (
    <div>
      <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["ranges", "📏 ช่วงเลขบ้าน (ทีละช่วง)"],
          ["houses", "🏠 รายหลัง"],
          ["draw", "✏️ เส้นซอย"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-lg font-semibold ${mode === k ? "bg-white shadow" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {mode === "draw" ? (
        <SoiDraw />
      ) : mode === "ranges" ? (
        <RangeView
          onHouse={(h) => {
            setGoHouse(h);
            setMode("houses");
          }}
        />
      ) : (
        <HouseReview goHouse={goHouse} />
      )}
    </div>
  );
}

function RangeView({ onHouse }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [split, setSplit] = useState({}); // gap lo → the number where the upper soi starts
  const [view, setView] = useState("quiz"); // quiz: one question at a time · list: everything
  useEffect(() => {
    api("/admin/addresses/ranges")
      .then(setD)
      .catch((e) => setMsg(e.message));
  }, []);
  if (!d) return <p className={msg ? "text-red-700" : "text-neutral-500"}>{msg || "กำลังโหลด…"}</p>;
  const conf = d.confirmed || [];
  const covered = (lo, hi) => conf.some((r) => r.lo <= lo && hi <= r.hi);
  async function put(next, note) {
    setBusy(true);
    setMsg("");
    try {
      setD(await api("/admin/addresses/ranges", { method: "PUT", body: JSON.stringify({ ranges: next }) }));
      setMsg(`✅ ${note}`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }
  const add = (lo, hi, soi) => put(merged(conf, lo, hi, soi), `4/${lo}–${hi} = ซ.${soi}`);
  const addMany = (xs, note) =>
    put(
      xs.reduce((l, [lo, hi, soi]) => merged(l, lo, hi, soi), conf),
      note,
    );
  const clear = d.runs.filter((r) => r.n >= 3 && !covered(r.lo, r.hi));
  const [mode, setMode] = [view, setView];
  const rows = [...d.runs.map((r) => ({ ...r, kind: "run" })), ...d.gaps.map((g) => ({ ...g, kind: "gap" }))].sort((a, b) => a.lo - b.lo);
  const gapNums = d.gaps.reduce((t, g) => t + (covered(g.lo, g.hi) ? 0 : g.hi - g.lo + 1), 0);
  const gm = (p) => `https://www.google.com/maps/@${p[1]},${p[2]},20z`;
  return (
    <section className="rounded-2xl border bg-white p-3">
      <h2 className="text-lg font-bold">📏 ช่วงเลขบ้าน → ซอย</h2>
      <p className="text-sm text-neutral-600">
        เลขบ้านเรียงเป็นช่วงตามซอย (ฝั่งหนึ่งของบล็อก แล้วไปอีกซอย) · ยืนยันทีละช่วง บ้านที่ยังไม่มีข้อมูลในช่วงนั้นจะได้ซอยตามช่วงเลย · ช่วงที่รู้ {d.runs.length} · เลขที่ยังไม่รู้ระหว่างช่วง{" "}
        {gapNums} เลข · ยืนยันแล้ว {conf.length} ช่วง
      </p>
      {msg && <p className={`mt-1 ${msg.startsWith("✅") ? "text-green-800" : "text-red-700"}`}>{msg}</p>}
      {clear.length > 0 && (
        <button
          disabled={busy}
          onClick={() =>
            put(
              clear.reduce((l, r) => merged(l, r.lo, r.hi, r.soi), conf),
              `ยืนยันช่วงที่ชัด ${clear.length} ช่วง`,
            )
          }
          className="mt-2 min-h-[52px] w-full rounded-xl bg-green-700 px-3 text-base font-bold text-white disabled:opacity-50"
        >
          ⚡ ยืนยันช่วงที่ชัดเจนทั้งหมด ({clear.length} ช่วง · รู้ตั้งแต่ 3 หลังขึ้นไป เลขเรียงซอยเดียวกัน)
        </button>
      )}
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-neutral-100 p-1">
        {[
          ["quiz", "🎯 ไล่ตอบทีละข้อ"],
          ["list", "📋 ดูทั้งหมด"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setMode(k)} className={`min-h-[40px] rounded-lg text-sm font-semibold ${mode === k ? "bg-white shadow" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {mode === "quiz" && <Quiz d={d} covered={covered} busy={busy} add={add} addMany={addMany} onHouse={onHouse} reload={() => api("/admin/addresses/ranges").then(setD)} />}
      <ul className={`mt-2 divide-y rounded-xl border ${mode === "quiz" ? "hidden" : ""}`}>
        {rows.map((r) =>
          r.kind === "run" ? (
            <li key={`r${r.lo}`} className={`flex flex-wrap items-center gap-2 p-2 ${covered(r.lo, r.hi) ? "bg-green-50" : ""}`}>
              <b className="w-14">ซ.{r.soi}</b>
              <span className="flex-1">
                4/{r.lo}
                {r.hi !== r.lo && `–${r.hi}`} · รู้ {r.n} หลัง
                {r.n === 1 && <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-900">หลังเดียว อาจผิด</span>}
                <span className="block text-xs text-neutral-500">
                  {r.nums.slice(0, 12).map((n) => (
                    <button key={n} onClick={() => onHouse(`4/${n}`)} className="mr-1 underline">
                      {n}
                    </button>
                  ))}
                </span>
              </span>
              {covered(r.lo, r.hi) ? (
                <span className="text-sm font-semibold text-green-800">✓ ยืนยันแล้ว</span>
              ) : (
                <button disabled={busy} onClick={() => add(r.lo, r.hi, r.soi)} className="min-h-[40px] rounded-lg border-2 border-green-700 px-3 text-sm font-semibold text-green-800">
                  ✓ ช่วงนี้ถูก
                </button>
              )}
            </li>
          ) : covered(r.lo, r.hi) ? null : (
            <li key={`g${r.lo}`} className="bg-amber-50 p-2 text-sm">
              <span>
                ❓{" "}
                <b>
                  4/{r.lo}
                  {r.hi !== r.lo && `–${r.hi}`}
                </b>{" "}
                ({r.hi - r.lo + 1} เลข) อยู่ระหว่าง ซ.{r.below} กับ ซ.{r.above}
                {r.pins.map((p) => (
                  <a key={p[0]} href={gm(p)} target="_blank" rel="noreferrer" className="ml-2 text-blue-800 underline">
                    🔎 ใกล้ 4/{p[0]}
                  </a>
                ))}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <button disabled={busy} onClick={() => add(r.lo, r.hi, r.below)} className="min-h-[36px] rounded-lg border px-2">
                  ทั้งหมด ซ.{r.below}
                </button>
                <button disabled={busy} onClick={() => add(r.lo, r.hi, r.above)} className="min-h-[36px] rounded-lg border px-2">
                  ทั้งหมด ซ.{r.above}
                </button>
                {r.below !== r.above && (
                  <>
                    <span>หรือ ซ.{r.above} เริ่มที่เลข</span>
                    <input
                      value={split[r.lo] || ""}
                      onChange={(e) => setSplit({ ...split, [r.lo]: e.target.value.replace(/\D/g, "") })}
                      inputMode="numeric"
                      className="min-h-[36px] w-20 rounded-lg border px-2"
                    />
                    <button
                      disabled={busy || !(+split[r.lo] >= r.lo && +split[r.lo] <= r.hi + 1)}
                      onClick={() => {
                        const k = +split[r.lo];
                        const next = conf.filter((x) => x.hi < r.lo || x.lo > r.hi);
                        if (k > r.lo) next.push({ lo: r.lo, hi: k - 1, soi: r.below });
                        if (k <= r.hi) next.push({ lo: k, hi: r.hi, soi: r.above });
                        put(next, `แบ่งที่ 4/${k}`);
                      }}
                      className="min-h-[36px] rounded-lg bg-black px-2 text-white disabled:opacity-40"
                    >
                      แบ่ง
                    </button>
                  </>
                )}
              </div>
            </li>
          ),
        )}
      </ul>
      {d.odd.length > 0 && (
        <p className="mt-2 text-sm">
          ⚠️ เลขที่ไม่เข้ากับเลขข้างเคียง (อาจพิมพ์ผิด):{" "}
          {d.odd.map((o) => (
            <button key={o.n} onClick={() => onHouse(`4/${o.n}`)} className="mr-2 underline">
              4/{o.n} (ซ.{o.soi})
            </button>
          ))}
        </p>
      )}
      {conf.length > 0 && (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer font-semibold">ช่วงที่ยืนยันแล้ว {conf.length} ช่วง</summary>
          {conf.map((r) => (
            <div key={r.lo} className="flex items-center gap-2 py-1">
              <span className="flex-1">
                4/{r.lo}–{r.hi} = ซ.{r.soi}
              </span>
              <button
                disabled={busy}
                onClick={() =>
                  put(
                    conf.filter((x) => x !== r),
                    `ลบ 4/${r.lo}–${r.hi}`,
                  )
                }
                className="underline"
              >
                ลบ
              </button>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
