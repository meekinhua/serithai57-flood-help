import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { createBaseMap } from "./MapView";
import { drawTeams } from "./teamMarkers";

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
// phones' number pad has no "/": "917", "4.917" and "4-917" all mean 4/917 (every house here is 4/…)
export const cleanHouse = (h) => {
  // the field starts as "4/" on tap: someone typing "4/917" again would give "4/4/917"
  const x = (h || "")
    .replace(/\s/g, "")
    .replace(/^(\d{1,3})[.-](\d)/, "$1/$2")
    .replace(/^4\/4[./-]/, "4/");
  return /^\d{1,5}$/.test(x) ? `4/${x}` : x;
};

// Active sign-up lists (e.g. "ลงชื่อขอช่างไฟตรวจบ้าน") at the top of the home page, open by default.
export default function SurveyBoxes({ look }) {
  const [list, setList] = useState([]);
  useEffect(() => {
    const go = () =>
      api("/surveys")
        .then(setList)
        .catch(() => {});
    go();
    const t = setInterval(go, 60000);
    return () => clearInterval(t);
  }, []);
  return list.map((s) => <SurveyBox key={s.key} s={s} look={look} onCount={(count) => setList((l) => l.map((x) => (x.key === s.key ? { ...x, count } : x)))} />);
}

// บ้านฉัน and this box share one record per house; either tells the other when it changes
export const MYHOME_CHANGED = "myhome:changed";
const WANT = { free: "ยังสนใจ รอช่างฟรีรอบหน้า", fine: "ไม่สนใจแล้ว", hired: "จ้างช่างเองแล้ว", group: "รวมกลุ่มจ้างช่าง" };

function SurveyBox({ s, onCount, look }) {
  const myHouse = load("myHouse", "");
  const mine = load(`survey:${s.key}`, null) || (myHouse ? { house: myHouse, soi: load("mySoi", ""), name: "", phone: "", picks: [], note: "" } : null);
  const saved = myHouse ? load(`myContact:${myHouse}`, null) : null;
  const c = { name: saved?.name || load("myName", ""), phone: saved?.phone || "" };
  const [status, setStatus] = useState(null); // this phone's house, as บ้านฉัน sees it
  useEffect(() => {
    const house = mine?.house;
    if (!house) return;
    const go = () =>
      api(`/surveys/${s.key}/check?house=${encodeURIComponent(house)}`)
        .then(setStatus)
        .catch(() => {});
    go();
    window.addEventListener(MYHOME_CHANGED, go);
    window.addEventListener("myhome:electric", go);
    return () => {
      window.removeEventListener(MYHOME_CHANGED, go);
      window.removeEventListener("myhome:electric", go);
    };
  }, [s.key, mine?.house]);
  // 6 Oct: starts folded (title + progress only) so the community below is on the first screen
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("sign"); // sign | check
  const [f, setF] = useState(() => ({
    house: "",
    soi: "",
    picks: [],
    note: "",
    ...(mine || {}),
    teams: mine?.teams || [],
    confirm: false,
    name: mine?.name || c.name || "",
    phone: mine?.phone || c.phone || "",
  }));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [prog, setProg] = useState(null); // technicians' follow-up, public: counts per soi only
  const [showSois, setShowSois] = useState(false);
  useEffect(() => {
    const go = () =>
      api(`/surveys/${s.key}/progress`)
        .then(setProg)
        .catch(() => {});
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
  // the house number is the key: it fills the soi (from the village map) and the contact this phone already has
  const houseKey = cleanHouse(f.house || "");
  useEffect(() => {
    if (!/^\d{1,3}\/\d{1,5}/.test(houseKey)) return;
    const t = setTimeout(() => {
      const known = load(`myContact:${houseKey}`, null);
      if (known?.phone && !f.phone) set({ phone: known.phone, name: f.name || known.name || "" });
      api(`/myhome?house=${encodeURIComponent(houseKey)}`)
        .then((r) => r.soi && !f.soi && set({ soi: String(r.soi) }))
        .catch(() => {});
    }, 500);
    return () => clearTimeout(t);
  }, [houseKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleTeam = (k) => set({ teams: f.teams.includes(k) ? f.teams.filter((x) => x !== k) : [...f.teams, k] });
  const teamLabel = (k) => (s.teams || []).find((t) => t.key === k)?.label || k;

  async function send() {
    setBusy(true);
    setMsg("");
    try {
      const res = await api(`/surveys/${s.key}`, { method: "POST", body: JSON.stringify({ ...f, house: cleanHouse(f.house) }) });
      save(`survey:${s.key}`, { ...f, house: cleanHouse(f.house) });
      save("myHouse", cleanHouse(f.house));
      if (f.name) save("myName", f.name);
      window.dispatchEvent(new Event(MYHOME_CHANGED));
      onCount(res.count);
      setOpen(false);
      setDup(null);
      setMsg(
        s.round
          ? `ยืนยันคิว ${s.round_label || ""} บ้าน ${cleanHouse(f.house)} แล้ว ✅ · ${f.teams.map(teamLabel).join(" + ")} · อยู่บ้านรอเปิดประตูนะครับ`
          : res.updated
            ? `แก้ไขข้อมูลบ้าน ${cleanHouse(f.house)} แล้ว ✅`
            : `ลงชื่อบ้าน ${cleanHouse(f.house)} แล้ว ✅ ถ้าทีมช่างกลับมา ทีมอาสาจะโทรนัดก่อน · ดูสถานะได้ในบ้านฉัน`,
      );
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (s.teams?.length && !f.teams.length) return setMsg("☝️ เลือกทีมช่างก่อน");
    if (s.round && !f.confirm) return setMsg("☝️ ติ๊ก “อยู่บ้านรอเปิดประตู” ก่อน");
    if (dup) return send(); // they saw the warning and confirmed
    setBusy(true);
    setMsg("");
    try {
      const r = await api(`/surveys/${s.key}/check?house=${encodeURIComponent(cleanHouse(f.house))}`);
      setBusy(false);
      if (r.signed && (!s.round || r.round === s.round)) return setDup(r);
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
    <section className="mb-3 rounded-xl border-4 border-blue-600 bg-blue-50 px-3 py-2" style={look?.frame}>
      <button
        onClick={() => {
          if (!s.round || open) return setOpen((o) => !o);
          // the house number is the key: บ้านฉัน already knows the soi and the phone, so confirming is one tap there
          const target = document.getElementById(myHouse ? "myhome-electric-round" : "myhome-house-input");
          if (!target) return setOpen(true);
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          if (myHouse) {
            target.classList.remove("anim-fresh");
            void target.offsetWidth;
            target.classList.add("anim-fresh");
          } else setTimeout(() => target.focus(), 400);
        }}
        className="flex min-h-[56px] w-full items-center gap-3 text-left"
      >
        <span className="text-2xl" aria-hidden="true">
          ⚡
        </span>
        <span className="min-w-0 flex-1">
          <b className="break-words">{s.title}</b>
          <span className="block text-sm text-neutral-700">
            {s.round && prog?.round
              ? status?.signed && status.round === s.round
                ? `บ้าน ${status.house}: ยืนยันคิว ${s.round_label} แล้ว ✅ · ${(status.teams || []).map(teamLabel).join(" + ")}`
                : `ยืนยันคิวแล้ว ${prog.round.confirmed} หลัง · ${(s.teams || []).map((t) => `${t.label.replace(/\s*\(.*\)/, "")} ${prog.round.teams[t.key]?.all || 0}`).join(" · ")}${mine?.house ? ` · บ้าน ${mine.house} ยังไม่ยืนยัน` : ""}`
              : status?.signed
                ? `บ้าน ${status.house}: ${status.job?.status === "done" ? "ช่างตรวจแล้ว ✅" : WANT[status.want] || "ลงชื่อแล้ว ✅"}`
                : `ลงชื่อแล้ว ${s.count} หลัง${mine?.house ? ` · บ้าน ${mine.house} ยังไม่ได้ลง` : ""}`}
          </span>
        </span>
        <span className={`shrink-0 font-semibold ${s.round && !open && !(status?.signed && status.round === s.round) ? "rounded-xl bg-blue-700 px-3 py-2 text-white" : "underline"}`}>
          {open ? "ย่อ" : s.round && !(status?.signed && status.round === s.round) ? (myHouse ? "ยืนยันคิว ›" : "ใส่บ้านเลขที่ ›") : status?.signed ? "ดู ›" : "ลงชื่อ ›"}
        </span>
      </button>
      {prog && prog.total.all > 0 && !s.round && <Progress prog={prog} showSois={showSois} onToggle={() => setShowSois((v) => !v)} />}
      {msg && !open && <p className="pb-1 text-sm font-semibold text-blue-800">{msg}</p>}
      {s.round && !open && (
        <button onClick={() => setOpen(true)} className="pb-1 text-sm text-neutral-600 underline">
          หรือกรอกแบบฟอร์ม (ลงให้บ้านอื่น / ไม่ใช้บ้านฉัน)
        </button>
      )}
      {open && (
        <div className="space-y-2 pb-2 pt-1">
          {s.details && <p className="text-sm text-neutral-700">{s.details}</p>}
          {status?.signed && (
            <button
              type="button"
              onClick={() => document.getElementById("myhome-electric")?.scrollIntoView({ behavior: "smooth", block: "center" }) || window.scrollTo({ top: 0, behavior: "smooth" })}
              className="min-h-[48px] w-full rounded-xl bg-white text-[15px] font-bold text-blue-800 underline"
            >
              บ้าน {status.house} ตอบไว้แล้ว · ดูหรือเปลี่ยนคำตอบในบ้านฉัน ›
            </button>
          )}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-white p-1" role="tablist">
            {[
              ["sign", "✍️ ลงชื่อ"],
              ["check", "🔎 เช็กว่าลงแล้วหรือยัง"],
            ].map(([k, t]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={mode === k}
                onClick={() => setMode(k)}
                className={`min-h-[44px] rounded-lg text-sm font-semibold ${mode === k ? "bg-blue-700 text-white" : "text-neutral-700"}`}
              >
                {t}
              </button>
            ))}
          </div>

          {mode === "check" && (
            <form onSubmit={lookup} className="space-y-2">
              <div className="flex gap-2">
                <input
                  required
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => !q && setQ("4/")}
                  className={input}
                  placeholder="บ้านเลขที่ เช่น 4/917"
                  aria-label="บ้านเลขที่ที่จะเช็ก"
                  inputMode="text"
                  autoComplete="off"
                />
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
                <button
                  type="button"
                  onClick={() => {
                    set({ house: found.house });
                    setMode("sign");
                  }}
                  className="min-h-[44px] w-full rounded-xl border-2 border-blue-700 font-semibold text-blue-800"
                >
                  ✍️ ลงชื่อบ้าน {found.house}
                </button>
              )}
            </form>
          )}

          {mode === "sign" && (
            <form onSubmit={submit} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  required
                  value={f.house}
                  onChange={(e) => set({ house: e.target.value })}
                  onFocus={() => !f.house && set({ house: "4/" })}
                  className={input}
                  placeholder="บ้านเลขที่ * เช่น 4/917"
                  aria-label="บ้านเลขที่"
                  inputMode="text"
                  autoComplete="off"
                />
                <input required value={f.soi} onChange={(e) => set({ soi: e.target.value })} className={input} placeholder="ซอย/แยก *" aria-label="ซอย" />
                <input value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อ" aria-label="ชื่อ" maxLength={60} />
                <input required value={f.phone} onChange={(e) => set({ phone: e.target.value })} className={input} placeholder="เบอร์โทร *" aria-label="เบอร์โทร" inputMode="tel" />
              </div>
              {s.teams?.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-base font-bold">เลือกทีมช่าง * (เลือกได้ทั้งสองทีม)</legend>
                  {s.teams.map((t) => (
                    <label
                      key={t.key}
                      className={`flex min-h-[56px] cursor-pointer items-start gap-3 rounded-xl border-2 p-3 ${f.teams.includes(t.key) ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-300 bg-white"}`}
                    >
                      <input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-white" checked={f.teams.includes(t.key)} onChange={() => toggleTeam(t.key)} />
                      <span className="min-w-0">
                        <b className="block text-base leading-tight">{t.label}</b>
                        {t.desc && <span className={`block text-sm leading-snug ${f.teams.includes(t.key) ? "text-blue-100" : "text-neutral-600"}`}>{t.desc}</span>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {s.round && (
                <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${f.confirm ? "border-emerald-700 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-emerald-700" checked={f.confirm} onChange={(e) => set({ confirm: e.target.checked })} />
                  <b className="text-base leading-snug">ยืนยัน อยู่บ้านรอเปิดประตู {s.round_label} *</b>
                </label>
              )}
              {s.options?.length > 0 && (
                <fieldset>
                  <legend className="mb-1 text-sm font-medium">{s.teams?.length ? "อาการ / ปัญหาที่เจอ (ถ้ามี)" : "ปัญหาที่เจอ (เลือกได้หลายข้อ)"}</legend>
                  <div className="flex flex-wrap gap-2">
                    {s.options.map((o) => (
                      <label
                        key={o}
                        className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-full border-2 px-3 text-sm ${f.picks.includes(o) ? "border-blue-700 bg-blue-700 text-white" : "border-neutral-300 bg-white"}`}
                      >
                        <input type="checkbox" className="sr-only" checked={f.picks.includes(o)} onChange={() => toggle(o)} />
                        {o}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <textarea
                value={f.note}
                onChange={(e) => set({ note: e.target.value })}
                className={input}
                rows={2}
                maxLength={300}
                placeholder="รายละเอียดเพิ่ม / สะดวกให้เข้าช่วงไหน"
                aria-label="รายละเอียด"
              />
              <p className="text-xs text-neutral-600">เบอร์โทรเห็นเฉพาะทีมอาสา · 1 บ้านลงได้ครั้งเดียว ลงซ้ำ = แก้ไขข้อมูลเดิม</p>
              {dup && (
                <div className="rounded-lg border-2 border-amber-500 bg-amber-50 p-2 text-amber-900" role="alert">
                  <b>⚠️ บ้าน {dup.house} ลงชื่อไว้แล้ว</b> ({timeAgo(dup.at)} ทาง{dup.via}) · ไม่ต้องลงซ้ำ ถ้ากด "ยืนยันแก้ไข" ข้อมูลเดิมจะถูกแทนด้วยข้อมูลนี้
                </div>
              )}
              {msg && <p className="rounded-lg bg-red-50 p-2 text-red-700">{msg}</p>}
              <div className={dup ? "grid grid-cols-2 gap-2" : ""}>
                {dup && (
                  <button
                    type="button"
                    onClick={() => {
                      setDup(null);
                      setOpen(false);
                    }}
                    className="min-h-[48px] w-full rounded-xl border-2 border-black font-semibold"
                  >
                    ไม่ต้องแล้ว
                  </button>
                )}
                <button disabled={busy} className={`min-h-[48px] w-full rounded-xl font-bold text-white disabled:opacity-40 ${dup ? "bg-amber-600" : "bg-blue-700"}`}>
                  {busy ? "กำลังส่ง…" : dup ? "ยืนยันแก้ไข" : s.round ? `ยืนยันคิว ${s.round_label || ""}` : "ลงชื่อ"}
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
        <b>
          🔧 ช่างตรวจแล้ว {done} / {t.all} หลัง
        </b>
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
        ยังรอช่าง {t.waiting ?? t.todo ?? 0} หลัง{t.free ? ` (ยืนยันว่ายังสนใจ ${t.free})` : ""}
        {t.no ? ` · ไม่สนใจแล้ว ${t.no}` : ""}
        {prog.last ? ` · อัปเดต ${timeAgo(prog.last)}` : ""}
      </p>
      {showSois && <ProgressMap sois={prog.sois} />}
      {showSois && (
        <div className="mt-2 flex flex-wrap gap-1">
          {prog.sois.map((b) => (
            <span
              key={b.soi}
              className={`rounded-full px-2 py-1 text-xs font-semibold ${b.done >= b.all ? "bg-emerald-600 text-white" : b.done ? "bg-amber-200 text-amber-900" : "bg-white text-neutral-700"}`}
            >
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
    const go = () =>
      api("/surveys/electric/techs")
        .then(setTeams)
        .catch(() => {});
    go();
    const t = setInterval(go, 30000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (teamsRef.current) drawTeams(teamsRef.current, teams);
  }, [teams]);
  return (
    <div className="mt-2">
      {teams.length > 0 && (
        <p className="mb-1 text-sm font-semibold">
          👷 ทีมช่างกำลังทำงาน {teams.length} ทีม: {teams.map((t) => t.name).join(" · ")}
        </p>
      )}
      <div ref={el} className="h-[340px] w-full overflow-hidden rounded-xl" />
      <p className="mt-1 text-xs text-neutral-600">ตัวเลข = ตรวจแล้ว/ลงชื่อไว้ ในซอยนั้น · 🟢 ครบแล้ว · 🟠 ตรวจไปบางหลัง · 🔴 ยังไม่ได้เริ่ม · 👷 = ทีมช่าง (ตำแหน่งล่าสุด)</p>
    </div>
  );
}
