import { useEffect, useMemo, useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { placeOf } from "./ZonesPage";

// /ops — the volunteer coordination board. Answers what the volunteer LINE group asked all day:
// "drop point B is which soi? who's there? number?", "which point is short of what?",
// "power leak in soi 24", "who has the boat / who can drive it". One tap copies a summary to post in LINE.

export const NEEDS = {
  food: "🍱 ข้าว/อาหาร",
  water: "💧 น้ำดื่ม",
  meds: "💊 ยา",
  dry: "🥫 ของแห้ง",
  bags: "🛍️ ถุง",
  people: "🙋 คนช่วย",
  boat: "🚤 เรือ",
  car: "🛻 รถขนของ",
};
export const HAZ = {
  power: ["⚡", "ไฟรั่ว / สายไฟ"],
  tree: ["🌳", "ต้นไม้ล้ม"],
  deep: ["🌊", "น้ำลึก / กระแสแรง"],
  closed: ["🚧", "ปิดทาง ห้ามเข้า"],
  other: ["⚠️", "อื่นๆ"],
};
const BOAT = { paddle: "🛶 เรือพาย", motor: "🚤 เรือเครื่อง", other: "🧰 อุปกรณ์" };
const STALE_H = 3; // a point nobody touched for this long: "ยืนยันอีกที"
const navUrl = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3.6e6 : Infinity);
const inputCls = "min-h-[44px] w-full rounded-lg border border-neutral-300 px-3";

function useName() {
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const remember = () => save("contact", { ...load("contact", {}), name: name.trim() });
  return [name, setName, remember];
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`min-h-[40px] rounded-full px-3 text-sm ${on ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}>
      {children}
    </button>
  );
}

const Tel = ({ phone }) =>
  phone ? (
    <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`} className="ml-1 inline-flex items-center rounded-full bg-green-600 px-2 py-0.5 text-sm font-bold text-white">
      📞 {phone}
    </a>
  ) : null;

// ---------- drop points ----------
function PointEditor({ zone, p, onDone }) {
  const [f, setF] = useState({
    place: p.place || "",
    person: p.person || "",
    phone: p.phone || "",
    hours: p.hours || "",
    manned: p.manned ?? true, // "❌" only when someone says so; no name already reads as "no one here"
    needs: p.needs || [],
    surplus: p.surplus || "",
    boats_needed: p.boats_needed || 0,
    note: p.note || "",
  });
  const [pin, setPin] = useState(null); // {lat,lng} from GPS
  const [name, setName, remember] = useName();
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggle = (k) => setF({ ...f, needs: f.needs.includes(k) ? f.needs.filter((x) => x !== k) : [...f.needs, k] });

  function gps() {
    if (!navigator.geolocation) return setMsg("เครื่องนี้หาตำแหน่งไม่ได้");
    setMsg("กำลังหาตำแหน่ง… (ถ้ามือถือถาม ให้กด “อนุญาต”)");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setMsg("");
      },
      (err) => setMsg(err.code === 1 ? "ไม่ได้อนุญาตตำแหน่ง" : "หาตำแหน่งไม่ได้"),
      { enableHighAccuracy: true, timeout: 20000 },
    );
  }

  async function submit() {
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อของคุณก่อน (ช่องล่างสุด)");
    try {
      await api(`/ops/points/${zone.id}`, { method: "PUT", body: JSON.stringify({ ...f, ...(pin || {}), name: name.trim() }) });
      remember();
      onDone(true);
    } catch (e) {
      setMsg(e.message === "404" || e.message === "Not Found" ? "ระบบนี้ยังไม่เปิดบนเว็บ (ต้อง deploy รุ่นใหม่)" : e.message);
    }
  }

  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <label className="block text-sm font-semibold">
        📍 จุดลงของอยู่ตรงไหนจริงๆ
        <input value={f.place} onChange={set("place")} maxLength={120} className={inputCls} placeholder={placeOf(zone)} />
      </label>
      <button type="button" onClick={gps} className="min-h-[40px] w-full rounded-lg border-2 border-blue-600 text-sm font-semibold text-blue-700">
        {pin ? "✅ ได้ตำแหน่งแล้ว (จะใช้นำทาง)" : "📍 ฉันยืนอยู่ที่จุดนี้ — ปักหมุดตรงนี้"}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <input value={f.person} onChange={set("person")} maxLength={80} className={inputCls} placeholder="👤 คนประจำจุด" />
        <input value={f.phone} onChange={set("phone")} maxLength={20} inputMode="tel" className={inputCls} placeholder="📞 เบอร์" />
      </div>
      <input value={f.hours} onChange={set("hours")} maxLength={40} className={inputCls} placeholder="🕐 อยู่ช่วงไหน เช่น 11:00–17:00" />
      <p className="text-xs text-neutral-500">เบอร์นี้ทุกคนเห็น (ให้คนเอาของมาโทรหาได้) ใส่เฉพาะเบอร์ที่ยินดีรับสาย</p>
      <div className="flex gap-2">
        <Chip on={f.manned} onClick={() => setF({ ...f, manned: true })}>
          ✅ มีคนอยู่ตอนนี้
        </Chip>
        <Chip on={!f.manned} onClick={() => setF({ ...f, manned: false })}>
          ❌ ไม่มีคน / ต้องการคนประจำ
        </Chip>
      </div>
      <p className="text-sm font-semibold">จุดนี้ต้องการอะไร (แตะเลือก)</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(NEEDS).map(([k, t]) => (
          <Chip key={k} on={f.needs.includes(k)} onClick={() => toggle(k)}>
            {t}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-sm font-semibold">🚤 จุดนี้ต้องการเรือกี่ลำ</span>
        <button type="button" onClick={() => setF({ ...f, boats_needed: Math.max(0, f.boats_needed - 1) })} className="h-11 w-11 rounded-full border border-neutral-300 text-xl">
          −
        </button>
        <span className="w-8 text-center text-xl font-black">{f.boats_needed}</span>
        <button type="button" onClick={() => setF({ ...f, boats_needed: Math.min(10, f.boats_needed + 1) })} className="h-11 w-11 rounded-full border border-neutral-300 text-xl">
          +
        </button>
      </div>
      <input value={f.surplus} onChange={set("surplus")} maxLength={120} className={inputCls} placeholder="✅ มีของเหลือ / พอแบ่ง เช่น น้ำ 20 แพ็ค" />
      <input value={f.note} onChange={set("note")} maxLength={200} className={inputCls} placeholder="📝 หมายเหตุ เช่น รวมจุดกับ G · มีโต๊ะวางของ" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${inputCls} ${msg.startsWith("✍️") ? "border-2 border-red-500" : ""}`} placeholder="ชื่อคุณ (จำเป็น)" />
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">
          ยกเลิก
        </button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">
          บันทึก
        </button>
      </div>
    </div>
  );
}

export function PointCard({ zone, p = {}, onSaved, insider = true, boatsHere }) {
  const [edit, setEdit] = useState(false);
  const lat = p.lat ?? zone.drop.lat;
  const lng = p.lng ?? zone.drop.lng;
  const touched = !!p.updated_at;
  const stale = touched && hoursSince(p.updated_at) > STALE_H;
  const here = !!p.person && p.manned !== false;
  return (
    <div id={`pt-${zone.id}`} className="scroll-mt-20 rounded-xl border-l-8 bg-white p-3 shadow" style={{ borderColor: zone.color }}>
      <div className="flex items-start gap-2">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl font-black text-white" style={{ background: zone.color }}>
          {zone.id}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold leading-tight">{p.place || placeOf(zone)}</p>
          <p className="text-xs text-neutral-500">
            โซน {zone.id} · ซอย {zone.sois.join(", ")}
          </p>
        </div>
        {touched && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${here ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{here ? "✅ มีคนอยู่" : "❌ ไม่มีคน"}</span>
        )}
      </div>
      {p.person ? (
        <p className="mt-2">
          👤 <b>{p.person}</b>
          <Tel phone={p.phone} />
          {p.hours && <span className="ml-1 text-sm text-neutral-600">🕐 {p.hours}</span>}
        </p>
      ) : (
        <p className="mt-2 rounded bg-yellow-100 px-2 py-1 text-sm font-semibold">🙋 ยังไม่มีคนประจำจุดนี้ — ใครรับได้ กด “อัปเดต” ใส่ชื่อ</p>
      )}
      {p.needs?.length > 0 && (
        <p className="mt-1 flex flex-wrap gap-1">
          <span className="text-sm font-semibold text-red-700">ต้องการ:</span>
          {p.needs.map((n) => (
            <span key={n} className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
              {NEEDS[n]}
            </span>
          ))}
        </p>
      )}
      {(p.boats_needed > 0 || boatsHere > 0) && (
        <p className={`mt-1 text-sm font-semibold ${(boatsHere || 0) < (p.boats_needed || 0) ? "text-red-700" : "text-green-800"}`}>
          🚤 เรือที่จุดนี้ {boatsHere || 0}
          {p.boats_needed > 0 && ` / ต้องการ ${p.boats_needed} ลำ`}
        </p>
      )}
      {p.surplus && <p className="mt-1 text-sm text-green-800">✅ มีเหลือ: {p.surplus}</p>}
      {p.note && <p className="mt-1 text-sm text-neutral-700">📝 {p.note}</p>}
      {touched && (
        <p className={`mt-1 text-xs ${stale ? "font-bold text-amber-700" : "text-neutral-500"}`}>
          {stale ? "⏰ " : ""}อัปเดต {timeAgo(p.updated_at)} โดย {p.updated_by}
          {stale ? " — ยังจริงอยู่ไหม? ช่วยยืนยัน" : ""}
        </p>
      )}
      {edit ? (
        <PointEditor
          zone={zone}
          p={p}
          onDone={(saved) => {
            setEdit(false);
            if (saved) onSaved();
          }}
        />
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <a href={navUrl(lat, lng)} target="_blank" rel="noreferrer" className="flex min-h-[44px] items-center justify-center rounded-lg border-2 border-black text-sm font-semibold">
            🧭 นำทาง{p.lat != null ? " (หมุดจริง)" : ""}
          </a>
          {insider ? (
            <button onClick={() => setEdit(true)} className="min-h-[44px] rounded-lg bg-blue-600 text-sm font-bold text-white">
              ✏️ อัปเดตจุดนี้
            </button>
          ) : (
            p.phone && (
              <a href={`tel:${p.phone.replace(/[^0-9+]/g, "")}`} className="flex min-h-[44px] items-center justify-center rounded-lg bg-green-600 text-sm font-bold text-white">
                📞 โทรหาคนประจำจุด
              </a>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ---------- hazards ----------
export function Hazards({ hazards, onChange, insider = true }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState(null);
  const [soi, setSoi] = useState("");
  const [note, setNote] = useState("");
  const [name, setName, remember] = useName();
  const [msg, setMsg] = useState("");

  async function add() {
    if (!kind) return setMsg("👆 เลือกว่าอันตรายแบบไหน");
    if (!soi.trim() && !note.trim()) return setMsg("บอกซอย หรือรายละเอียด");
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อของคุณ");
    try {
      await api("/ops/hazards", { method: "POST", body: JSON.stringify({ kind, soi: soi.trim(), note: note.trim(), name: name.trim() }) });
      remember();
      setAdding(false);
      setKind(null);
      setSoi("");
      setNote("");
      setMsg("");
      onChange();
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function clear(h) {
    const who = name.trim() || window.prompt("ชื่อคุณ (คนยืนยันว่าแก้แล้ว)") || "";
    if (!who.trim()) return;
    if (!window.confirm(`ยืนยันว่า “${HAZ[h.kind][1]} ${h.soi ? `ซ.${h.soi}` : ""}” แก้แล้ว ปลอดภัยแล้ว?`)) return;
    try {
      await api(`/ops/hazards/${h.id}/clear`, { method: "POST", body: JSON.stringify({ name: who.trim() }) });
      onChange();
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <div className="space-y-2">
      {hazards.length === 0 && <p className="rounded-xl bg-white p-3 text-neutral-600">ยังไม่มีการแจ้งจุดอันตราย</p>}
      {hazards.map((h) => {
        const [e, t] = HAZ[h.kind] || HAZ.other;
        const done = !!h.cleared_at;
        return (
          <div key={h.id} className={`rounded-xl p-3 shadow ${done ? "bg-white opacity-60" : "border-2 border-red-600 bg-red-50"}`}>
            <p className={`text-lg font-bold ${done ? "line-through" : "text-red-800"}`}>
              {e} {t}
              {h.soi && ` · ซ.${h.soi}`}
            </p>
            {h.note && <p>{h.note}</p>}
            <p className="text-xs text-neutral-600">
              แจ้ง {timeAgo(h.created_at)} โดย {h.by}
              {done && ` · ✅ แก้แล้ว ${timeAgo(h.cleared_at)} (${h.cleared_by})`}
            </p>
            {!done && insider && (
              <button onClick={() => clear(h)} className="mt-2 min-h-[40px] rounded-lg border border-green-700 bg-white px-3 text-sm font-semibold text-green-800">
                ✅ แก้แล้ว / ปลอดภัยแล้ว
              </button>
            )}
          </div>
        );
      })}
      {adding ? (
        <div className="space-y-2 rounded-xl bg-white p-3 shadow">
          <p className="font-semibold">แจ้งจุดอันตราย</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(HAZ).map(([k, [e, t]]) => (
              <Chip key={k} on={kind === k} onClick={() => setKind(k)}>
                {e} {t}
              </Chip>
            ))}
          </div>
          <input value={soi} onChange={(e) => setSoi(e.target.value)} maxLength={20} className={inputCls} placeholder="ซอย เช่น 24" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={inputCls} placeholder="รายละเอียด เช่น เสาไฟต้นแรกซ้ายมือ ห้ามเดินเข้า" />
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="ชื่อคุณ (จำเป็น)" />
          {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => setAdding(false)} className="min-h-[48px] rounded-lg border border-neutral-300">
              ยกเลิก
            </button>
            <button onClick={add} className="col-span-2 min-h-[48px] rounded-lg bg-red-600 font-bold text-white">
              แจ้งอันตราย
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="min-h-[48px] w-full rounded-xl bg-red-600 font-bold text-white">
          ⚠️ แจ้งจุดอันตรายใหม่
        </button>
      )}
    </div>
  );
}

// ---------- boats ----------
const EMPTY_BOAT = { label: "", kind: "paddle", owner: "", owner_phone: "", holder: "", holder_phone: "", where: "", due: "", need_driver: false, zone: "", note: "" };
const ZONE_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

function BoatForm({ boat, onDone }) {
  const [f, setF] = useState({ ...EMPTY_BOAT, ...(boat || {}) });
  const [name, setName, remember] = useName();
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    if (!f.label.trim()) return setMsg("ตั้งชื่อ เช่น เรือพาย พี่โอ ซ.11");
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อของคุณ");
    const body = Object.fromEntries(Object.keys(EMPTY_BOAT).map((k) => [k, f[k]]));
    try {
      await api(boat ? `/ops/boats/${boat.id}` : "/ops/boats", { method: boat ? "PUT" : "POST", body: JSON.stringify({ ...body, name: name.trim() }) });
      remember();
      onDone(true);
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <div className="space-y-2 rounded-xl bg-white p-3 shadow">
      <input value={f.label} onChange={set("label")} maxLength={60} className={inputCls} placeholder="ชื่อ เช่น เรือพาย พี่โอ ซ.11" />
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(BOAT).map(([k, t]) => (
          <Chip key={k} on={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
            {t}
          </Chip>
        ))}
      </div>
      <input value={f.where} onChange={set("where")} maxLength={80} className={inputCls} placeholder="📍 ตอนนี้อยู่ที่ไหน เช่น จุด F ร้านไอซ์มาร์ท" />
      <div className="grid grid-cols-2 gap-2">
        <input value={f.holder} onChange={set("holder")} maxLength={60} className={inputCls} placeholder="🙋 ใครดูแลอยู่" />
        <input value={f.holder_phone} onChange={set("holder_phone")} maxLength={20} inputMode="tel" className={inputCls} placeholder="📞 เบอร์" />
        <input value={f.owner} onChange={set("owner")} maxLength={60} className={inputCls} placeholder="เจ้าของ" />
        <input value={f.owner_phone} onChange={set("owner_phone")} maxLength={20} inputMode="tel" className={inputCls} placeholder="📞 เบอร์เจ้าของ" />
      </div>
      <input value={f.due} onChange={set("due")} maxLength={60} className={inputCls} placeholder="คืนเมื่อไหร่ เช่น ยืม 3 วัน ถึง 2 ต.ค." />
      <label className="flex items-center gap-2 text-sm font-semibold">
        ประจำจุด / โซน
        <select value={f.zone || ""} onChange={set("zone")} className="min-h-[44px] flex-1 rounded-lg border border-neutral-300 px-2">
          <option value="">ไม่ประจำจุดไหน (ใช้รับส่ง / ส่วนกลาง)</option>
          {ZONE_IDS.map((z) => (
            <option key={z} value={z}>
              จุด {z}
            </option>
          ))}
        </select>
      </label>
      <Chip on={f.need_driver} onClick={() => setF({ ...f, need_driver: !f.need_driver })}>
        🙋 ต้องการคนขับ/พายเป็น
      </Chip>
      <input value={f.note} onChange={set("note")} maxLength={200} className={inputCls} placeholder="📝 หมายเหตุ เช่น ต้องเติมน้ำมันเอง · ล็อกโซ่ไว้" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="ชื่อคุณ (จำเป็น)" />
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">
          ยกเลิก
        </button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">
          บันทึก
        </button>
      </div>
    </div>
  );
}

export function Boats({ boats, onChange }) {
  const [editing, setEditing] = useState(null); // boat id | "new" | null (an id survives the 30 s refresh)
  const [name] = useName();
  async function giveBack(b) {
    const who = name.trim() || window.prompt("ชื่อคุณ") || "";
    if (!who.trim() || !window.confirm(`“${b.label}” คืนเจ้าของแล้ว? (จะเอาออกจากรายการ)`)) return;
    try {
      await api(`/ops/boats/${b.id}/return`, { method: "POST", body: JSON.stringify({ name: who.trim() }) });
      onChange();
    } catch (e) {
      window.alert(e.message);
    }
  }
  const done = (saved) => {
    setEditing(null);
    if (saved) onChange();
  };
  return (
    <div className="space-y-2">
      {boats.length === 0 && editing !== "new" && <p className="rounded-xl bg-white p-3 text-neutral-600">ยังไม่มีเรือ/อุปกรณ์ในรายการ</p>}
      {boats.map((b) =>
        editing === b.id ? (
          <BoatForm key={b.id} boat={b} onDone={done} />
        ) : (
          <div key={b.id} className="rounded-xl bg-white p-3 shadow">
            <p className="text-lg font-bold">
              {(BOAT[b.kind] || BOAT.other).split(" ")[0]} {b.label}
            </p>
            {b.need_driver && <p className="mt-1 inline-block rounded-full bg-red-600 px-2 py-0.5 text-sm font-bold text-white">🙋 ต้องการคนขับ/พายเป็น</p>}
            {b.zone && <p className="font-semibold">🚚 ประจำจุด {b.zone}</p>}
            {b.where && <p>📍 {b.where}</p>}
            {b.holder && (
              <p>
                ดูแลอยู่: <b>{b.holder}</b>
                <Tel phone={b.holder_phone} />
              </p>
            )}
            {b.owner && (
              <p className="text-sm">
                เจ้าของ: {b.owner}
                <Tel phone={b.owner_phone} />
              </p>
            )}
            {b.due && <p className="text-sm">⏳ คืน: {b.due}</p>}
            {b.note && <p className="text-sm text-neutral-700">📝 {b.note}</p>}
            <p className="text-xs text-neutral-500">
              อัปเดต {timeAgo(b.updated_at)} โดย {b.updated_by}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => setEditing(b.id)} className="min-h-[44px] rounded-lg bg-blue-600 text-sm font-bold text-white">
                ✏️ ย้าย / เปลี่ยนคนดูแล
              </button>
              <button onClick={() => giveBack(b)} className="min-h-[44px] rounded-lg border border-neutral-300 text-sm">
                ↩️ คืนแล้ว
              </button>
            </div>
          </div>
        ),
      )}
      {editing === "new" ? (
        <BoatForm onDone={done} />
      ) : (
        <button onClick={() => setEditing("new")} className="min-h-[48px] w-full rounded-xl bg-black font-bold text-white">
          ➕ เพิ่มเรือ / อุปกรณ์ที่ยืมมา
        </button>
      )}
    </div>
  );
}

// ---------- pin board: ❓ waiting for a decision → ✅ decided; 🛒 what the team is short of ----------
const NOTE = {
  question: { icon: "❓", title: "รอสรุป", add: "ปักเรื่องที่ยังไม่จบ", ph: "เช่น พรุ่งนี้ใครประจำจุด E (ซ.28 หรือ ซ.32)?", who: "ใครควรเป็นคนตัดสิน (ไม่ใส่ก็ได้)" },
  decision: { icon: "✅", title: "ข้อสรุป", add: "บันทึกข้อสรุป", ph: "เช่น พรุ่งนี้เริ่ม 11:00 เหมือนเดิม", who: "ใครสรุป (ไม่ใส่ก็ได้)" },
  supply: { icon: "🛒", title: "ทีมขาดอะไร", add: "ขอของใช้ทีม", ph: "เช่น รองเท้าบูท", who: "สำหรับใคร / จุดไหน เช่น ทีมจุด F" },
};

function NoteForm({ kind, onDone }) {
  const [text, setText] = useState("");
  const [detail, setDetail] = useState("");
  const [forWho, setForWho] = useState("");
  const [name, setName, remember] = useName();
  const [msg, setMsg] = useState("");
  const k = NOTE[kind];
  async function submit() {
    if (!text.trim()) return setMsg("พิมพ์เรื่องก่อน");
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อของคุณ");
    try {
      await api("/ops/notes", { method: "POST", body: JSON.stringify({ kind, text: text.trim(), detail: detail.trim(), for_who: forWho.trim(), name: name.trim() }) });
      remember();
      onDone(true);
    } catch (e) {
      setMsg(e.message === "404" || e.message === "Not Found" ? "ระบบนี้ยังไม่เปิดบนเว็บ (ต้อง deploy รุ่นใหม่)" : e.message);
    }
  }
  return (
    <div className="mb-2 space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="font-semibold">
        {k.icon} {k.add}
      </p>
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} className={inputCls} placeholder={k.ph} />
      <input
        value={detail}
        onChange={(e) => setDetail(e.target.value)}
        maxLength={200}
        className={inputCls}
        placeholder={kind === "supply" ? "จำนวน / ไซซ์ เช่น 40–41 ×4 คู่, 42–43 ×6 คู่" : "รายละเอียด (ไม่ใส่ก็ได้)"}
      />
      <input value={forWho} onChange={(e) => setForWho(e.target.value)} maxLength={60} className={inputCls} placeholder={k.who} />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="ชื่อคุณ (จำเป็น)" />
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">
          ยกเลิก
        </button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">
          บันทึก
        </button>
      </div>
    </div>
  );
}

export function Board({ notes, onChange }) {
  const [adding, setAdding] = useState(null); // kind of the open form
  const [name] = useName();
  const who = () => (name.trim() || window.prompt("ชื่อคุณ") || "").trim();
  async function post(path, body) {
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      onChange();
    } catch (e) {
      window.alert(e.message);
    }
  }
  function resolve(n) {
    const res = n.kind === "question" ? window.prompt(`สรุปว่าอย่างไร?\n❓ ${n.text}`) : window.prompt(`ได้ “${n.text}” แล้ว — ตอนนี้อยู่กับใคร / ที่ไหน? (ไม่ใส่ก็ได้)`, "");
    if (res == null || (n.kind === "question" && !res.trim())) return;
    const w = who();
    if (w) post(`/ops/notes/${n.id}/resolve`, { resolution: res.trim(), name: w });
  }
  function archive(n) {
    const w = who();
    if (w && window.confirm(`เอา “${n.text}” ออกจากบอร์ด?`)) post(`/ops/notes/${n.id}/archive`, { name: w });
  }
  const done = (saved) => {
    setAdding(null);
    if (saved) onChange();
  };
  const open = notes.filter((n) => n.kind === "question" && !n.done && !isFood(n)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const decided = notes.filter((n) => n.kind !== "supply" && n.done).sort((a, b) => new Date(b.done_at) - new Date(a.done_at));
  const supply = notes.filter((n) => n.kind === "supply").sort((a, b) => a.done - b.done || new Date(a.created_at) - new Date(b.created_at));

  const item = (n) => (
    <li key={n.id} className={`rounded-lg p-2 ${n.done && n.kind === "supply" ? "bg-green-50 opacity-70" : "bg-neutral-50"}`}>
      <p className="font-semibold">
        {n.kind === "supply" && n.done ? "✅ " : ""}
        {n.text}
      </p>
      {n.detail && <p className="text-sm text-neutral-700">{n.detail}</p>}
      {n.resolution && (
        <p className="text-sm font-semibold text-green-800">
          {n.kind === "question" ? "➡️ " : "📦 "}
          {n.resolution}
        </p>
      )}
      <p className="text-xs text-neutral-500">
        {n.for_who && `${n.kind === "supply" ? "สำหรับ" : n.kind === "question" ? "ให้" : "โดย"} ${n.for_who} · `}
        {n.done && n.kind !== "decision" ? `เสร็จ ${timeAgo(n.done_at)} (${n.done_by})` : `${timeAgo(n.created_at)} · ${n.by}`}
      </p>
      <div className="mt-1 flex gap-2">
        {!n.done && (
          <button onClick={() => resolve(n)} className="min-h-[36px] rounded-lg bg-green-600 px-3 text-sm font-bold text-white">
            {n.kind === "question" ? "✅ สรุปแล้ว" : "✅ ได้แล้ว"}
          </button>
        )}
        <button onClick={() => archive(n)} className="min-h-[36px] rounded-lg border border-neutral-300 px-3 text-sm">
          🗑️ เอาออก
        </button>
      </div>
    </li>
  );
  const section = (kind, list, empty) => (
    <section className="rounded-xl bg-white p-3 shadow">
      <div className="mb-2 flex items-center gap-2">
        <p className="flex-1 text-lg font-bold">
          {NOTE[kind].icon} {NOTE[kind].title} {list.length > 0 && <span className="text-sm font-normal text-neutral-500">({list.length})</span>}
        </p>
        <button onClick={() => setAdding(kind)} className="min-h-[40px] rounded-lg bg-black px-3 text-sm font-bold text-white">
          ➕ เพิ่ม
        </button>
      </div>
      {adding === kind && <NoteForm kind={kind} onDone={done} />}
      {list.length ? <ul className="space-y-2">{list.map(item)}</ul> : adding !== kind && <p className="text-sm text-neutral-500">{empty}</p>}
    </section>
  );
  return (
    <div className="space-y-3">
      {section("question", open, "ไม่มีเรื่องค้าง — เรื่องไหนคุยใน LINE แล้วยังไม่จบ กด ➕ ปักไว้ตรงนี้")}
      {section("supply", supply, "ทีมยังไม่ได้แจ้งว่าขาดอะไร")}
      {section("decision", decided, "ยังไม่มีข้อสรุป")}
    </div>
  );
}

// ---------- volunteer roster: replaces the copy-paste name+phone chain in LINE ----------
export function Roster({ people, insider, onChange }) {
  const [name, setName, remember] = useName();
  const [phone, setPhone] = useState(() => load("contact", {}).phone || "");
  const [role, setRole] = useState("");
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState(false);
  async function join() {
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อ");
    if (phone.replace(/\D/g, "").length < 9) return setMsg("📞 ใส่เบอร์ให้ครบ");
    try {
      const res = await api("/ops/people", { method: "POST", body: JSON.stringify({ name: name.trim(), phone: phone.trim(), role: role.trim() }) });
      remember();
      save("contact", { ...load("contact", {}), name: name.trim(), phone: phone.trim() });
      setMsg(res.updated ? "✅ อัปเดตชื่อของคุณแล้ว" : "✅ ลงชื่อแล้ว ขอบคุณครับ");
      setRole("");
      onChange();
    } catch (e) {
      setMsg(e.message === "404" || e.message === "Not Found" ? "ระบบนี้ยังไม่เปิดบนเว็บ (ต้อง deploy รุ่นใหม่)" : e.message);
    }
  }
  async function remove(pp) {
    const w = name.trim() || window.prompt("ชื่อคุณ") || "";
    if (!w.trim() || !window.confirm(`ลบ “${pp.name}” ออกจากรายชื่อ?`)) return;
    try {
      await api(`/ops/people/${pp.id}/remove`, { method: "POST", body: JSON.stringify({ name: w.trim() }) });
      onChange();
    } catch (e) {
      window.alert(e.message);
    }
  }
  async function copyList() {
    const text = [`📋 รายชื่ออาสา (${people.length} คน)`, ...people.map((pp, i) => `${i + 1}. ${pp.name} ${pp.phone}${pp.role ? ` · ${pp.role}` : ""}`)].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("คัดลอกข้อความนี้", text);
    }
  }
  return (
    <div className="space-y-3">
      <section className="rounded-xl bg-white p-3 shadow">
        <div className="mb-2 flex items-center gap-2">
          <p className="flex-1 text-lg font-bold">📋 รายชื่ออาสา ({people.length})</p>
          {insider && people.length > 0 && (
            <button onClick={copyList} className="min-h-[40px] rounded-lg bg-black px-3 text-sm font-bold text-white">
              {copied ? "✅ คัดลอกแล้ว" : "📋 คัดลอก"}
            </button>
          )}
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-neutral-500">ยังไม่มีใครลงชื่อ</p>
        ) : (
          [
            ["🙋 ทีมอาสา", people.filter((pp) => !pp.role?.startsWith("ติดต่อ"))],
            ["📇 ติดต่อภายนอก (เขต / ทหาร / เรือ / รถ)", people.filter((pp) => pp.role?.startsWith("ติดต่อ"))],
          ]
            .filter(([, list]) => list.length)
            .map(([title, list]) => (
              <div key={title} className="mb-3">
                <p className="mb-1 text-sm font-bold text-neutral-700">
                  {title} ({list.length})
                </p>
                <ol className="space-y-1">
                  {list.map((pp, i) => (
                    <li key={pp.id} className="flex items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1.5">
                      <span className="w-6 text-right text-sm text-neutral-500">{i + 1}.</span>
                      <span className="min-w-0 flex-1">
                        <b>{pp.name}</b> {insider ? <Tel phone={pp.phone} /> : <span className="text-sm text-neutral-600">{pp.phone}</span>}
                        {pp.role && <span className="block text-xs text-neutral-600">{pp.role.replace(/^ติดต่อ · /, "")}</span>}
                      </span>
                      <button onClick={() => remove(pp)} aria-label={`ลบ ${pp.name}`} className="min-h-[36px] rounded px-2 text-sm text-neutral-400">
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ))
        )}
      </section>
      <section className="space-y-2 rounded-xl border-2 border-green-600 bg-white p-3 shadow">
        <p className="text-lg font-bold">➕ เพิ่มชื่อ / ลงชื่ออาสา (ไม่ต้องก๊อปต่อกันในไลน์แล้ว)</p>
        <div className="grid grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="ชื่อเล่น" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" className={inputCls} placeholder="📞 เบอร์" />
        </div>
        <input value={role} onChange={(e) => setRole(e.target.value)} maxLength={80} className={inputCls} placeholder="ช่วยตรงไหน เช่น หน้าหมู่บ้าน ทีมมีจัง / จุด F / ขับเรือเป็น" />
        {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
        <button onClick={join} className="min-h-[48px] w-full rounded-lg bg-green-600 font-bold text-white">
          ลงชื่อ
        </button>
        <p className="text-xs text-neutral-500">🔒 รายชื่อนี้เห็นเฉพาะคนที่เปิดจากลิงก์ทีม · ลงซ้ำด้วยเบอร์เดิม = แก้ชื่อ/หน้าที่ · ขึ้นต้นหน้าที่ด้วย “ติดต่อ” = ไปอยู่กลุ่มติดต่อภายนอก</p>
      </section>
    </div>
  );
}

// ---------- 🍱 food coming in: board items that start with 🍱 (from the village LINE sweep) ----------
// Food that needs a drop spot or people to hand it out. After 4 h the meal has probably passed: greyed.
export const isFood = (n) => n.kind === "question" && (n.text || "").startsWith("🍱");
const FOOD_STALE_H = 4;

export function FoodIn({ notes, onChange, compact = false }) {
  const list = notes.filter((n) => isFood(n) && !n.done).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!list.length) return null;
  const who = () => (load("contact", {}).name || window.prompt("ชื่อคุณ") || "").trim();
  async function done(n) {
    const res = window.prompt(`“${n.text.replace(/^🍱\s*/, "")}”\nจัดการแล้วอย่างไร? เช่น ลงจุด G แจกแล้ว / เขาแจกเอง / ยกเลิก`, "");
    if (res == null) return;
    const w = who();
    if (!w) return;
    try {
      await api(`/ops/notes/${n.id}/resolve`, { method: "POST", body: JSON.stringify({ resolution: res.trim() || "จัดการแล้ว", name: w }) });
      onChange?.();
    } catch (e) {
      window.alert(e.message);
    }
  }
  return (
    <section className="rounded-xl border-4 border-orange-400 bg-orange-50 p-3 shadow">
      <p className="text-lg font-black">🍱 อาหาร / ของเข้ามา — ต้องการคนแจก หรือที่ลง</p>
      <ul className="mt-2 space-y-2">
        {list.map((n) => {
          const stale = hoursSince(n.created_at) > FOOD_STALE_H;
          return (
            <li key={n.id} className={`rounded-lg p-2 ${stale ? "bg-neutral-100 opacity-60" : "bg-white"}`}>
              <p className="font-bold">
                {n.text.replace(/^🍱\s*/, "")}
                {stale && <span className="ml-1 rounded bg-neutral-400 px-1.5 text-xs text-white">อาจเลยมื้อแล้ว</span>}
              </p>
              {!compact && n.detail && <p className="text-sm text-neutral-700">{n.detail}</p>}
              <p className="text-xs text-neutral-500">
                {n.for_who && `${n.for_who} · `}ลงบอร์ด {timeAgo(n.created_at)}
              </p>
              {onChange && (
                <button onClick={() => done(n)} className="mt-1 min-h-[36px] rounded-lg bg-green-600 px-3 text-sm font-bold text-white">
                  ✅ จัดการแล้ว
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- the LINE summary ----------
export function summaryText(zones, board) {
  const t = new Date().toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const out = [`🤝 สรุปงานอาสา · ${t}`];
  const live = board.hazards.filter((h) => !h.cleared_at);
  if (live.length) {
    out.push("", "⚠️ อันตราย ระวัง!");
    for (const h of live) out.push(`${(HAZ[h.kind] || HAZ.other)[0]} ${(HAZ[h.kind] || HAZ.other)[1]}${h.soi ? ` ซ.${h.soi}` : ""}${h.note ? ` — ${h.note}` : ""}`);
  }
  const notes = board.notes || [];
  const food = notes.filter((n) => isFood(n) && !n.done && hoursSince(n.created_at) <= 4);
  if (food.length) {
    out.push("", "🍱 อาหารเข้ามา ต้องการคนแจก / ที่ลง");
    for (const n of food) out.push(`• ${n.text.replace(/^🍱\s*/, "")}`);
  }
  const open = notes.filter((n) => n.kind === "question" && !n.done && !isFood(n)).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (open.length) {
    out.push("", "❓ รอสรุป");
    for (const n of open) out.push(`• ${n.text}${n.for_who ? ` (${n.for_who})` : ""}`);
  }
  const decided = notes.filter((n) => n.kind !== "supply" && n.done && hoursSince(n.done_at) < 24);
  if (decided.length) {
    out.push("", "✅ ข้อสรุป");
    for (const n of decided.slice(0, 8)) out.push(`• ${n.kind === "question" ? `${n.text} → ${n.resolution}` : n.text}`);
  }
  const need = notes.filter((n) => n.kind === "supply" && !n.done).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (need.length) {
    out.push("", "🛒 ทีมขาด");
    for (const n of need) out.push(`• ${n.text}${n.detail ? ` — ${n.detail}` : ""}${n.for_who ? ` (${n.for_who})` : ""}`);
  }
  out.push("", "📍 จุดลงของ");
  for (const z of zones) {
    const p = board.points[z.id] || {};
    const shared = z.drop.shared || [z.id];
    if (shared[0] !== z.id && !p.updated_at) continue; // G, H: reported on F's line
    const bits = [`${shared[0] === z.id ? shared.join("·") : z.id} · ${p.place || placeOf(z)}`];
    bits.push(p.person ? `${p.person}${p.phone ? ` ${p.phone}` : ""}${p.hours ? ` (${p.hours})` : ""}${p.manned === false ? " ❌ไม่อยู่" : ""}` : "❌ ยังไม่มีคนประจำ");
    if (p.needs?.length) bits.push(`ต้องการ: ${p.needs.map((n) => NEEDS[n].split(" ")[1]).join(", ")}`);
    if (p.surplus) bits.push(`เหลือ: ${p.surplus}`);
    out.push(bits.join(" · "));
  }
  if (board.boats.length) {
    out.push("", "🚤 เรือ / อุปกรณ์");
    for (const b of board.boats)
      out.push(`${b.label}${b.where ? ` @ ${b.where}` : ""}${b.holder ? ` · ${b.holder}${b.holder_phone ? ` ${b.holder_phone}` : ""}` : ""}${b.need_driver ? " · 🙋 หาคนขับ" : ""}`);
  }
  out.push("", `ดู/อัปเดต: ${window.location.origin}/ops`);
  return out.join("\n");
}

export default function OpsPage() {
  const [zones, setZones] = useState(null);
  const [board, setBoard] = useState({ points: {}, hazards: [], boats: [], notes: [], people: [], insider: false });
  const [error, setError] = useState("");
  const [tab, setTab] = useState(() => ({ "#hazards": "hazards", "#boats": "boats", "#board": "board", "#people": "people" })[window.location.hash] || "points");
  const [copied, setCopied] = useState(false);
  const reload = () =>
    api("/ops")
      .then((b) => {
        setBoard({ notes: [], people: [], ...b });
        setError("");
      })
      .catch((e) => setError(e.message === "404" || e.message === "Not Found" ? "ระบบประสานงานยังไม่เปิดบนเว็บนี้ (ต้อง deploy รุ่นใหม่)" : e.message));

  useEffect(() => {
    api("/zones")
      .then((d) => setZones(d.zones))
      .catch((e) => setError(e.message));
    reload();
    const t = setInterval(() => document.visibilityState === "visible" && reload(), 30000);
    return () => clearInterval(t);
  }, []);
  // /ops#F — jump to a point (link sent to the person on it)
  useEffect(() => {
    const id = window.location.hash.slice(1).toUpperCase();
    if (zones && /^[A-Z]$/.test(id)) setTimeout(() => document.getElementById(`pt-${id}`)?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [zones]);

  const jump = (id) => {
    setTab("points");
    setTimeout(() => document.getElementById(`pt-${id}`)?.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const live = board.hazards.filter((h) => !h.cleared_at);
  // "where should donations go?": points that asked for something, unmanned ones flagged
  const wanted = useMemo(
    () =>
      (zones || [])
        .map((z) => ({ z, p: board.points[z.id] || {} }))
        .filter(({ p }) => p.needs?.length)
        .sort((a, b) => b.p.needs.length - a.p.needs.length),
    [zones, board],
  );
  const unmanned = (zones || []).filter((z) => !board.points[z.id]?.person || board.points[z.id]?.manned === false);

  async function copy() {
    const text = summaryText(zones || [], board);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("คัดลอกข้อความนี้", text);
    }
  }
  async function share() {
    const text = summaryText(zones || [], board);
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, "_blank");
  }

  const openQ = (board.notes || []).filter((n) => n.kind === "question" && !n.done && !isFood(n)).length;
  const TABS = [
    ["points", `📍 จุด`],
    ["board", `📌 บอร์ด${openQ ? ` (${openQ})` : ""}`],
    ["hazards", `⚠️ อันตราย${live.length ? ` (${live.length})` : ""}`],
    ["boats", `🚤 เรือ`],
    ["people", `🙋 อาสา`],
  ].filter(([k]) => board.insider || k === "points" || k === "hazards");

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-black px-3 py-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight">🤝 ประสานงานอาสา</h1>
            <p className="text-sm text-neutral-300">ใครอยู่จุดไหน · ขาดอะไร · อันตราย · เรือ</p>
          </div>
          <a href="/zones" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-2.5 text-sm">
            🗺️ โซน
          </a>
          <a href="/" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-2.5 text-sm">
            🏠
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 py-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}

        {live.length > 0 && (
          <button onClick={() => setTab("hazards")} className="block w-full rounded-xl border-4 border-red-600 bg-red-600 p-3 text-left text-white shadow">
            <p className="text-lg font-black">⚠️ ระวัง! จุดอันตราย {live.length} จุด</p>
            {live.slice(0, 3).map((h) => (
              <p key={h.id} className="font-semibold">
                {(HAZ[h.kind] || HAZ.other)[0]} {(HAZ[h.kind] || HAZ.other)[1]}
                {h.soi && ` ซ.${h.soi}`}
                {h.note && ` — ${h.note}`}
              </p>
            ))}
          </button>
        )}

        <section className="grid grid-cols-2 gap-2">
          <button onClick={copy} disabled={!zones} className="min-h-[52px] rounded-xl bg-green-600 font-bold text-white shadow disabled:opacity-50">
            {copied ? "✅ คัดลอกแล้ว ไปวางใน LINE" : "📋 คัดลอกสรุปส่ง LINE"}
          </button>
          <button onClick={share} disabled={!zones} className="min-h-[52px] rounded-xl border-2 border-green-600 bg-white font-bold text-green-700 shadow disabled:opacity-50">
            📤 แชร์สรุป
          </button>
        </section>

        <section className="rounded-xl bg-white p-3 shadow">
          <p className="font-bold">🍱 มีของจะบริจาค ส่งไปจุดไหนดี?</p>
          {wanted.length ? (
            <ul className="mt-1 space-y-1">
              {wanted.map(({ z, p }) => (
                <li key={z.id}>
                  <button type="button" onClick={() => jump(z.id)} className="flex flex-wrap items-center gap-1 text-left">
                    <span className="rounded px-1.5 font-black text-white" style={{ background: z.color }}>
                      {z.id}
                    </span>
                    <span className="text-sm">{p.place || placeOf(z)}:</span>
                    {p.needs.map((n) => (
                      <span key={n} className="rounded-full bg-red-100 px-2 text-xs font-semibold text-red-800">
                        {NEEDS[n]}
                      </span>
                    ))}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-neutral-600">ยังไม่มีจุดไหนแจ้งว่าขาด — คนประจำจุด กด “อัปเดตจุดนี้” แล้วเลือกของที่ต้องการ</p>
          )}
          {zones && unmanned.length > 0 && (
            <p className="mt-2 rounded bg-yellow-100 px-2 py-1 text-sm">
              🙋 <b>ยังไม่มีคนประจำ:</b> จุด{" "}
              {unmanned.map((z) => (
                <button key={z.id} type="button" onClick={() => jump(z.id)} className="mx-0.5 font-bold underline">
                  {z.id}
                </button>
              ))}
            </p>
          )}
        </section>

        <nav className={`sticky top-0 z-10 grid ${board.insider ? "grid-cols-5" : "grid-cols-2"} gap-1 rounded-xl bg-white p-1 shadow`}>
          {TABS.map(([k, t]) => (
            <button key={k} onClick={() => setTab(k)} className={`min-h-[48px] rounded-lg px-0.5 text-xs font-semibold leading-tight ${tab === k ? "bg-black text-white" : ""}`}>
              {t}
            </button>
          ))}
        </nav>

        {tab === "points" && (
          <section className="space-y-2">
            {!zones && !error && <p className="p-3 text-neutral-600">กำลังโหลด…</p>}
            {zones?.map((z) => (
              <PointCard
                key={z.id}
                zone={z}
                p={board.points[z.id]}
                onSaved={reload}
                insider={!!board.insider}
                boatsHere={(board.boats || []).filter((b) => (z.drop.shared || [z.id]).includes(b.zone)).length}
              />
            ))}
          </section>
        )}
        {tab === "hazards" && <Hazards hazards={board.hazards} onChange={reload} insider={!!board.insider} />}
        {tab === "boats" && <Boats boats={board.boats} onChange={reload} />}
        {tab === "board" && <Board notes={board.notes || []} onChange={reload} />}
        {tab === "people" && <Roster people={board.people || []} insider={!!board.insider} onChange={reload} />}

        <p className="pb-6 text-xs text-neutral-500">
          {board.insider
            ? `ทีมงานแก้ได้ (ใส่ชื่อทุกครั้ง ระบบเก็บประวัติว่าใครแก้อะไร) · ภาพรวมทั้งหมด: ${window.location.host}/hq · ทีมแจกตามโซน: ${window.location.host}/team`
            : "ทีมงาน: เปิดจากลิงก์ทีมเพื่ออัปเดตจุด / บอร์ด / เรือ / รายชื่อ"}
        </p>
      </main>
    </div>
  );
}
