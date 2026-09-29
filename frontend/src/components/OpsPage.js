import { useEffect, useMemo, useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { placeOf } from "./ZonesPage";

// /ops — the volunteer coordination board. Answers what the volunteer LINE group asked all day:
// "drop point B is which soi? who's there? number?", "which point is short of what?",
// "power leak in soi 24", "who has the boat / who can drive it". One tap copies a summary to post in LINE.

const NEEDS = {
  food: "🍱 ข้าว/อาหาร",
  water: "💧 น้ำดื่ม",
  meds: "💊 ยา",
  dry: "🥫 ของแห้ง",
  bags: "🛍️ ถุง",
  people: "🙋 คนช่วย",
  boat: "🚤 เรือ",
  car: "🛻 รถขนของ",
};
const HAZ = {
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
      { enableHighAccuracy: true, timeout: 20000 }
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
        <Chip on={f.manned} onClick={() => setF({ ...f, manned: true })}>✅ มีคนอยู่ตอนนี้</Chip>
        <Chip on={!f.manned} onClick={() => setF({ ...f, manned: false })}>❌ ไม่มีคน / ต้องการคนประจำ</Chip>
      </div>
      <p className="text-sm font-semibold">จุดนี้ต้องการอะไร (แตะเลือก)</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(NEEDS).map(([k, t]) => (
          <Chip key={k} on={f.needs.includes(k)} onClick={() => toggle(k)}>
            {t}
          </Chip>
        ))}
      </div>
      <input value={f.surplus} onChange={set("surplus")} maxLength={120} className={inputCls} placeholder="✅ มีของเหลือ / พอแบ่ง เช่น น้ำ 20 แพ็ค" />
      <input value={f.note} onChange={set("note")} maxLength={200} className={inputCls} placeholder="📝 หมายเหตุ เช่น รวมจุดกับ G · มีโต๊ะวางของ" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={`${inputCls} ${msg.startsWith("✍️") ? "border-2 border-red-500" : ""}`} placeholder="ชื่อคุณ (จำเป็น)" />
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">ยกเลิก</button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">บันทึก</button>
      </div>
    </div>
  );
}

function PointCard({ zone, p = {}, onSaved }) {
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
          <p className="text-xs text-neutral-500">โซน {zone.id} · ซอย {zone.sois.join(", ")}</p>
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
          <button onClick={() => setEdit(true)} className="min-h-[44px] rounded-lg bg-blue-600 text-sm font-bold text-white">
            ✏️ อัปเดตจุดนี้
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- hazards ----------
function Hazards({ hazards, onChange }) {
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
            {!done && (
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
            <button onClick={() => setAdding(false)} className="min-h-[48px] rounded-lg border border-neutral-300">ยกเลิก</button>
            <button onClick={add} className="col-span-2 min-h-[48px] rounded-lg bg-red-600 font-bold text-white">แจ้งอันตราย</button>
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
const EMPTY_BOAT = { label: "", kind: "paddle", owner: "", owner_phone: "", holder: "", holder_phone: "", where: "", due: "", need_driver: false, note: "" };

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
      <Chip on={f.need_driver} onClick={() => setF({ ...f, need_driver: !f.need_driver })}>
        🙋 ต้องการคนขับ/พายเป็น
      </Chip>
      <input value={f.note} onChange={set("note")} maxLength={200} className={inputCls} placeholder="📝 หมายเหตุ เช่น ต้องเติมน้ำมันเอง · ล็อกโซ่ไว้" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={inputCls} placeholder="ชื่อคุณ (จำเป็น)" />
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">ยกเลิก</button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">บันทึก</button>
      </div>
    </div>
  );
}

function Boats({ boats, onChange }) {
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
              <button onClick={() => setEditing(b.id)} className="min-h-[44px] rounded-lg bg-blue-600 text-sm font-bold text-white">✏️ ย้าย / เปลี่ยนคนดูแล</button>
              <button onClick={() => giveBack(b)} className="min-h-[44px] rounded-lg border border-neutral-300 text-sm">↩️ คืนแล้ว</button>
            </div>
          </div>
        )
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

// ---------- the LINE summary ----------
function summaryText(zones, board) {
  const t = new Date().toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const out = [`🤝 สรุปงานอาสา · ${t}`];
  const live = board.hazards.filter((h) => !h.cleared_at);
  if (live.length) {
    out.push("", "⚠️ อันตราย ระวัง!");
    for (const h of live) out.push(`${(HAZ[h.kind] || HAZ.other)[0]} ${(HAZ[h.kind] || HAZ.other)[1]}${h.soi ? ` ซ.${h.soi}` : ""}${h.note ? ` — ${h.note}` : ""}`);
  }
  out.push("", "📍 จุดลงของ");
  for (const z of zones) {
    const p = board.points[z.id] || {};
    const bits = [`${z.id} · ${p.place || placeOf(z)}`];
    bits.push(p.person ? `${p.person}${p.phone ? ` ${p.phone}` : ""}${p.hours ? ` (${p.hours})` : ""}${p.manned === false ? " ❌ไม่อยู่" : ""}` : "❌ ยังไม่มีคนประจำ");
    if (p.needs?.length) bits.push(`ต้องการ: ${p.needs.map((n) => NEEDS[n].split(" ")[1]).join(", ")}`);
    if (p.surplus) bits.push(`เหลือ: ${p.surplus}`);
    out.push(bits.join(" · "));
  }
  if (board.boats.length) {
    out.push("", "🚤 เรือ / อุปกรณ์");
    for (const b of board.boats) out.push(`${b.label}${b.where ? ` @ ${b.where}` : ""}${b.holder ? ` · ${b.holder}${b.holder_phone ? ` ${b.holder_phone}` : ""}` : ""}${b.need_driver ? " · 🙋 หาคนขับ" : ""}`);
  }
  out.push("", `ดู/อัปเดต: ${window.location.origin}/ops`);
  return out.join("\n");
}

export default function OpsPage() {
  const [zones, setZones] = useState(null);
  const [board, setBoard] = useState({ points: {}, hazards: [], boats: [] });
  const [error, setError] = useState("");
  const [tab, setTab] = useState(() => (window.location.hash === "#hazards" ? "hazards" : window.location.hash === "#boats" ? "boats" : "points"));
  const [copied, setCopied] = useState(false);
  const reload = () =>
    api("/ops")
      .then((b) => {
        setBoard(b);
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
    [zones, board]
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

  const TABS = [
    ["points", `📍 จุดลงของ`],
    ["hazards", `⚠️ อันตราย${live.length ? ` (${live.length})` : ""}`],
    ["boats", `🚤 เรือ (${board.boats.length})`],
  ];

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="bg-black px-3 py-3 text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-tight">🤝 ประสานงานอาสา</h1>
            <p className="text-sm text-neutral-300">ใครอยู่จุดไหน · ขาดอะไร · อันตราย · เรือ</p>
          </div>
          <a href="/zones" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-2.5 text-sm">🗺️ โซน</a>
          <a href="/" className="shrink-0 rounded-lg bg-white/10 px-2.5 py-2.5 text-sm">🏠</a>
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

        <nav className="sticky top-0 z-10 grid grid-cols-3 gap-1 rounded-xl bg-white p-1 shadow">
          {TABS.map(([k, t]) => (
            <button key={k} onClick={() => setTab(k)} className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === k ? "bg-black text-white" : ""}`}>
              {t}
            </button>
          ))}
        </nav>

        {tab === "points" && (
          <section className="space-y-2">
            {!zones && !error && <p className="p-3 text-neutral-600">กำลังโหลด…</p>}
            {zones?.map((z) => (
              <PointCard key={z.id} zone={z} p={board.points[z.id]} onSaved={reload} />
            ))}
          </section>
        )}
        {tab === "hazards" && <Hazards hazards={board.hazards} onChange={reload} />}
        {tab === "boats" && <Boats boats={board.boats} onChange={reload} />}

        <p className="pb-6 text-xs text-neutral-500">
          ทุกคนแก้ได้ (ใส่ชื่อทุกครั้ง ระบบเก็บประวัติว่าใครแก้อะไร) · ส่งลิงก์ให้คนประจำจุดโดยตรงได้ เช่น {window.location.host}/ops#F
        </p>
      </main>
    </div>
  );
}
