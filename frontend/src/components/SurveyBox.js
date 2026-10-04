import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { createBaseMap } from "./MapView";
import { drawTeams } from "./teamMarkers";

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
// phones' number pad has no "/": "917", "4.917" and "4-917" all mean 4/917 (every house here is 4/…)
const cleanHouse = (h) => {
  // the field starts as "4/" on tap: someone typing "4/917" again would give "4/4/917"
  const x = (h || "").replace(/\s/g, "").replace(/^(\d{1,3})[.-](\d)/, "$1/$2").replace(/^4\/4[./-]/, "4/");
  return /^\d{1,5}$/.test(x) ? `4/${x}` : x;
};

// Active sign-up lists (e.g. "ลงชื่อขอช่างไฟตรวจบ้าน") at the top of the home page, open by default.
export default function SurveyBoxes() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const go = () => api("/surveys").then(setList).catch(() => {});
    go();
    const t = setInterval(go, 60000);
    return () => clearInterval(t);
  }, []);
  return list.map((s) => <SurveyBox key={s.key} s={s} onCount={(count) => setList((l) => l.map((x) => (x.key === s.key ? { ...x, count } : x)))} />);
}

function SurveyBox({ s, onCount }) {
  const mine = load(`survey:${s.key}`, null);
  const c = load("contact", {});
  const [open, setOpen] = useState(!mine); // open unless this phone already signed
  const [mode, setMode] = useState("sign"); // sign | check
  const [f, setF] = useState(() => mine || { house: "", soi: "", name: c.name || "", phone: c.phone || "", picks: [], note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [prog, setProg] = useState(null); // technicians' follow-up, public: counts per soi only
  const [showSois, setShowSois] = useState(false);
  useEffect(() => {
    const go = () => api(`/surveys/${s.key}/progress`).then(setProg).catch(() => {});
    go();
    const t = setInterval(go, 60000);
    return () => clearInterval(t);
  }, [s.key]);
  const [dup, setDup] = useState(null); // the house already signed: ask before overwriting
  const [q, setQ] = useState(mine?.house || "");
  const [found, setFound] = useState(null);
  const set = (p) => {
    setF((x) => ({ ...x, ...p }));
    if (p.house !== undefined) setDup(null);
  };
  const toggle = (o) => set({ picks: f.picks.includes(o) ? f.picks.filter((x) => x !== o) : [...f.picks, o] });

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      const res = await api(`/surveys/${s.key}`, { method: "POST", body: JSON.stringify({ ...f, house: cleanHouse(f.house) }) });
      save(`survey:${s.key}`, { ...f, house: cleanHouse(f.house) });
      onCount(res.count);
      setOpen(false);
      setDup(null);
      setMsg(res.updated ? `แก้ไขข้อมูลบ้าน ${cleanHouse(f.house)} แล้ว ✅` : `ลงชื่อบ้าน ${cleanHouse(f.house)} แล้ว ✅ ทีมจะรวบรวมส่งให้ช่าง`);
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (dup) return send(); // they saw the warning and confirmed
    setBusy(true);
    setMsg("");
    try {
      const r = await api(`/surveys/${s.key}/check?house=${encodeURIComponent(cleanHouse(f.house))}`);
      setBusy(false);
      if (r.signed) return setDup(r);
    } catch (e2) {
      setBusy(false);
      return setMsg(e2.message);
    }
    send();
  }

  async function lookup(e) {
    e.preventDefault();
    setFound(null);
    setMsg("");
    try {
      setFound(await api(`/surveys/${s.key}/check?house=${encodeURIComponent(cleanHouse(q))}`));
    } catch (e2) {
      setMsg(e2.message);
    }
  }

  return (
    <section className="mb-3 rounded-xl border-4 border-blue-600 bg-blue-50 px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-[56px] w-full items-center gap-3 text-left">
        <span className="text-2xl" aria-hidden="true">⚡</span>
        <span className="min-w-0 flex-1">
          <b className="break-words">{s.title}</b>
          <span className="block text-sm text-neutral-700">
            ลงชื่อแล้ว {s.count} หลัง{mine ? ` · บ้าน ${mine.house} ลงแล้ว ✅` : ""}
          </span>
        </span>
        <span className="shrink-0 font-semibold underline">{open ? "ย่อ" : mine ? "ดู / แก้ไข ›" : "ลงชื่อ ›"}</span>
      </button>
      {prog && prog.total.all > 0 && <Progress prog={prog} showSois={showSois} onToggle={() => setShowSois((v) => !v)} />}
      {msg && !open && <p className="pb-1 text-sm font-semibold text-blue-800">{msg}</p>}
      {open && (
        <div className="space-y-2 pb-2 pt-1">
          {s.details && <p className="text-sm text-neutral-700">{s.details}</p>}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1" role="tablist">
            {[
              ["sign", "✍️ ลงชื่อ"],
              ["check", "🔎 เช็กว่าลงแล้วหรือยัง"],
            ].map(([k, t]) => (
              <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={`min-h-[44px] rounded-lg text-sm font-semibold ${mode === k ? "bg-blue-700 text-white" : "text-neutral-700"}`}>
                {t}
              </button>
            ))}
          </div>

          {mode === "check" && (
            <form onSubmit={lookup} className="space-y-2">
              <div className="flex gap-2">
                <input required value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => !q && setQ("4/")} className={input} placeholder="บ้านเลขที่ เช่น 4/917" aria-label="บ้านเลขที่ที่จะเช็ก" inputMode="text" autoComplete="off" />
                <button className="min-h-[44px] shrink-0 rounded-lg bg-blue-700 px-4 font-bold text-white">เช็ก</button>
              </div>
              {found && (
                <p className={`rounded-lg p-2 font-semibold ${found.signed ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                  {found.signed
                    ? `✅ บ้าน ${found.house} ลงชื่อแล้ว (${timeAgo(found.at)} ทาง${found.via})${found.picks?.length ? ` · ${found.picks.join(", ")}` : ""} · ${jobText(found.job)}`
                    : `ยังไม่มีชื่อบ้าน ${found.house} — กด "ลงชื่อ" ได้เลย`}
                </p>
              )}
              {found && !found.signed && (
                <button type="button" onClick={() => { set({ house: found.house }); setMode("sign"); }} className="min-h-[44px] w-full rounded-xl border-2 border-blue-700 font-semibold text-blue-800">
                  ✍️ ลงชื่อบ้าน {found.house}
                </button>
              )}
            </form>
          )}

          {mode === "sign" && (
            <form onSubmit={submit} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input required value={f.house} onChange={(e) => set({ house: e.target.value })} onFocus={() => !f.house && set({ house: "4/" })} className={input} placeholder="บ้านเลขที่ * เช่น 4/917" aria-label="บ้านเลขที่" inputMode="text" autoComplete="off" />
                <input required value={f.soi} onChange={(e) => set({ soi: e.target.value })} className={input} placeholder="ซอย/แยก *" aria-label="ซอย" />
                <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อ" aria-label="ชื่อ" maxLength={60} />
                <input required value={f.phone} onChange={(e) => set({ phone: e.target.value })} className={input} placeholder="เบอร์โทร *" aria-label="เบอร์โทร" inputMode="tel" />
              </div>
              {s.options?.length > 0 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">ปัญหาที่เจอ (เลือกได้หลายข้อ)</legend>
                  <div className="flex flex-wrap gap-2">
                    {s.options.map((o) => (
                      <label key={o} className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full border-2 px-3 text-sm ${f.picks.includes(o) ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-300 bg-white"}`}>
                        <input type="checkbox" className="sr-only" checked={f.picks.includes(o)} onChange={() => toggle(o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <textarea value={f.note} onChange={(e) => set({ note: e.target.value })} className={input} rows={2} maxLength={300} placeholder="รายละเอียดเพิ่ม / สะดวกให้เข้าช่วงไหน" aria-label="รายละเอียด" />
              <p className="text-xs text-neutral-600">เบอร์โทรเห็นเฉพาะทีมอาสา · 1 บ้านลงได้ครั้งเดียว ลงซ้ำ = แก้ไขข้อมูลเดิม</p>
              {dup && (
                <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-2 text-amber-900" role="alert">
                  <b>⚠️ บ้าน {dup.house} ลงชื่อไว้แล้ว</b> ({timeAgo(dup.at)} ทาง{dup.via}) · ไม่ต้องลงซ้ำ ถ้ากด "ยืนยันแก้ไข" ข้อมูลเดิมจะถูกแทนด้วยข้อมูลนี้
                </div>
              )}
              {msg && <p className="rounded-lg bg-red-50 p-2 text-red-700">{msg}</p>}
              <div className={dup ? "grid grid-cols-2 gap-2" : ""}>
                {dup && (
                  <button type="button" onClick={() => { setDup(null); setOpen(false); }} className="min-h-[48px] w-full rounded-xl border-2 border-black font-semibold">
                    ไม่ต้องแล้ว
                  </button>
                )}
                <button disabled={busy} className={`min-h-[48px] w-full rounded-xl font-bold text-white disabled:opacity-60 ${dup ? "bg-amber-600" : "bg-blue-700"}`}>
                  {busy ? "กำลังส่ง…" : dup ? "ยืนยันแก้ไข" : "ลงชื่อ"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

const JOB = { todo: "ยังไม่ได้ตรวจ", claimed: "ช่างรับงานแล้ว กำลังไป", done: "ช่างตรวจเสร็จแล้ว ✅", absent: "ช่างไปแล้วแต่ไม่มีคนอยู่บ้าน", again: "ช่างจะกลับมาอีกรอบ" };
export const jobText = (job) => JOB[job?.status || "todo"];

// Public follow-up of the electricians' rounds: how many houses are done, soi by soi. No names, no phone numbers.
function Progress({ prog, showSois, onToggle }) {
  const t = prog.total;
  const done = (t.done || 0) + (t.absent || 0);
  const pct = Math.round((done / t.all) * 100);
  return (
    <div className="pb-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <b>🔧 ช่างตรวจแล้ว {done} / {t.all} หลัง</b>
        <button onClick={onToggle} className="shrink-0 font-semibold underline">
          {showSois ? "ซ่อนรายซอย" : "ดูรายซอย ›"}
        </button>
      </div>
      <div className="my-1 h-2.5 overflow-hidden rounded-full bg-white">
        <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-neutral-600">
        {t.claimed ? `กำลังไป ${t.claimed} หลัง · ` : ""}
        {t.absent ? `ไม่มีคนอยู่ ${t.absent} หลัง · ` : ""}
        {t.again ? `ต้องกลับไปอีก ${t.again} หลัง · ` : ""}
        รอตรวจ {t.todo || 0} หลัง{prog.last ? ` · อัปเดต ${timeAgo(prog.last)}` : ""}
      </p>
      {showSois && <ProgressMap sois={prog.sois} />}
      {showSois && (
        <div className="mt-2 flex flex-wrap gap-1">
          {prog.sois.map((b) => (
            <span key={b.soi} className={`rounded-full px-2 py-1 text-xs font-semibold ${b.done >= b.all ? "bg-emerald-600 text-white" : b.done ? "bg-amber-200 text-amber-900" : "bg-white text-neutral-700"}`}>
              ซ.{b.soi} {b.done}/{b.all}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Map of the rounds: one circle per soi, "done/all" — green = all checked, orange = some, red = none yet.
function ProgressMap({ sois }) {
  const el = useRef(null);
  const layerRef = useRef(null);
  const teamsRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [teams, setTeams] = useState([]);
  useEffect(() => {
    Promise.all([api("/zones"), api("/sois")])
      .then(([z, s]) => setGeo({ road: z.main_road, houses: z.houses, centers: s.sois }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!geo || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomAnimation = false; // hiding the box removes the map; Leaflet crashes if a zoom is still animating
    L.polyline(geo.road, { color: "#facc15", weight: 5, opacity: 0.9, interactive: false }).addTo(map);
    map.fitBounds(L.latLngBounds(geo.houses.map(([a, b]) => [a, b])), { padding: [6, 6], animate: false });
    layerRef.current = L.layerGroup().addTo(map);
    teamsRef.current = L.layerGroup().addTo(map);
    drawTeams(teamsRef.current, teams);
    return () => {
      layerRef.current = null;
      teamsRef.current = null;
      map.stop();
      map.off();
      map.remove();
    };
  }, [geo]); // eslint-disable-line react-hooks/exhaustive-deps -- teams are redrawn by their own effect
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !geo) return;
    layer.clearLayers();
    for (const b of sois) {
      const c = geo.centers[b.soi];
      if (!c) continue;
      const color = b.done >= b.all ? "#16a34a" : b.done ? "#f59e0b" : "#dc2626";
      const icon = L.divIcon({
        className: "",
        iconSize: [34, 34],
        iconAnchor: [17, 17],
        html: `<div style="width:34px;height:34px;border-radius:9999px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 10px/1.1 sans-serif">${b.done}/${b.all}<span style="font-size:8px;font-weight:600">ซ.${b.soi}</span></div>`,
      });
      L.marker(c.center, { icon, interactive: false }).addTo(layer);
    }
  }, [sois, geo]);
  useEffect(() => {
    const go = () => api("/surveys/electric/techs").then(setTeams).catch(() => {});
    go();
    const t = setInterval(go, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (teamsRef.current) drawTeams(teamsRef.current, teams);
  }, [teams]);
  return (
    <div className="mt-2">
      {teams.length > 0 && <p className="mb-1 text-sm font-semibold">👷 ทีมช่างกำลังทำงาน {teams.length} ทีม: {teams.map((t) => t.name).join(" · ")}</p>}
      <div ref={el} className="h-[340px] w-full overflow-hidden rounded-xl" />
      <p className="mt-1 text-xs text-neutral-600">ตัวเลข = ตรวจแล้ว/ลงชื่อไว้ ในซอยนั้น · 🟢 ครบแล้ว · 🟠 ตรวจไปบางหลัง · 🔴 ยังไม่ได้เริ่ม · 👷 = ทีมช่าง (ตำแหน่งล่าสุด)</p>
    </div>
  );
}
