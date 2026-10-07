// The canals around the village and the pumps (1 Oct 2026). The flood now depends on the canals next to
// the flood wall: people near a canal report how far below the top of the wall the water is (or that it
// is over the wall / leaking through it), so everyone can see whether pumping into that canal still makes
// sense; and each pump shows where it is, where it pumps to and whether it is running now.
import { useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { mediaUrl } from "../media";
import LocationPicker from "./LocationPicker";
import MediaPicker, { mediaState } from "./MediaPicker";

export const CANALS = {
  rahat: "คลองระหัส",
  bueng: "สวนน้ำบึงกุ่ม / บึง",
  lamrang: "คลองลำราง",
  other: "คลองอื่น",
};
export const CANAL_STATE = {
  below: { icon: "🟢", label: "ต่ำกว่าขอบเขื่อน", color: "#16a34a" },
  brim: { icon: "🟠", label: "ปริ่มขอบเขื่อน", color: "#f59e0b" },
  over: { icon: "🔴", label: "ล้นเข้าหมู่บ้าน", color: "#dc2626" },
  leak: { icon: "🟣", label: "เขื่อนรั่ว / ซึม", color: "#7e22ce" },
};
export const PUMP_STATUS = {
  running: { icon: "✅", label: "กำลังสูบ", cls: "bg-green-600 text-white" },
  stopped: { icon: "⏸️", label: "หยุด", cls: "bg-neutral-300 text-black" },
  broken: { icon: "🛠️", label: "เสีย / สูบไม่ได้", cls: "bg-red-600 text-white" },
  planned: { icon: "🕓", label: "กำลังจะตั้ง", cls: "bg-yellow-300 text-black" },
  removed: { icon: "🚫", label: "ถอดออกแล้ว", cls: "bg-neutral-200 text-neutral-600" },
};
const NOW_H = 3; // "now" = the last 3 h
const ageH = (r) => (Date.now() - new Date(r.created_at).getTime()) / 3.6e6;
const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-neutral-600 focus:outline-none";
const seg = (on) => `min-h-[48px] rounded-lg border-2 px-2 text-sm font-semibold ${on ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`;

// Per canal: the worst thing reported in the last 3 h (a leak or overflow anywhere matters more than a
// calm spot), the typical distance below the wall, and what that means for pumping into it.
export function canalSummary(reports) {
  const out = [];
  for (const [key, name] of Object.entries(CANALS)) {
    const mine = reports.filter((r) => r.canal === key);
    if (!mine.length) continue;
    const recent = mine.filter((r) => ageH(r) <= NOW_H);
    const use = recent.length ? recent : mine.slice(0, 1);
    const has = (s) => use.some((r) => r.state === s);
    const cms = use
      .filter((r) => r.state === "below" && r.below_cm != null)
      .map((r) => r.below_cm)
      .sort((a, b) => a - b);
    const cm = cms.length ? cms[Math.floor((cms.length - 1) / 2)] : null;
    let state, title, advice, short;
    if (has("over")) [state, title, short, advice] = ["over", "ล้นเข้าหมู่บ้าน", "อย่าสูบลงคลองนี้", "สูบลงคลองนี้จะวนกลับเข้าหมู่บ้าน · เร่งกั้นกระสอบทราย / แจ้งเขต"];
    else if (has("leak")) [state, title, short, advice] = ["leak", "เขื่อนรั่ว / ซึม", "อุดรอยรั่วก่อน", "อุดจุดรั่วก่อน · สูบได้แต่ต้องเฝ้าจุดรั่ว"];
    else if (has("brim")) [state, title, short, advice] = ["brim", "ปริ่มขอบ", "สูบได้ ต้องเฝ้า", "สูบลงคลองนี้ต้องเฝ้า เสี่ยงล้นกลับ"];
    else if (cm != null && cm >= 20) [state, title, short, advice] = ["below", `ต่ำกว่าขอบ ~${cm} ซม.`, "สูบได้", "ยังสูบลงคลองนี้ได้"];
    else if (cm != null) [state, title, short, advice] = ["brim", `ต่ำกว่าขอบ ~${cm} ซม.`, "สูบได้ ต้องเฝ้า", "สูบได้ แต่ต้องเฝ้าใกล้ชิด ใกล้ล้นแล้ว"];
    else [state, title, short, advice] = ["below", "ต่ำกว่าขอบ", "สูบได้", "ยังสูบได้"];
    out.push({ key, name, state, title, short, advice, cm, n: recent.length, stale: !recent.length, last: mine[0] });
  }
  return out;
}

// Every pump, its status, and a way to update it; admins can also add one (opened from the map).
export function PumpList({ pumps, onPump, admin = false }) {
  return (
    <div className="space-y-2">
      {pumps.length === 0 && <p className="text-neutral-600">ยังไม่มีข้อมูลเครื่องสูบ</p>}
      {pumps.map((p) => {
        const st = PUMP_STATUS[p.status] || PUMP_STATUS.stopped;
        return (
          <button key={p.id} onClick={() => onPump(p)} className="flex min-h-[56px] w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 text-left">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${st.cls}`}>
              {st.icon} {st.label}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block">{p.label}</b>
              <span className="block text-xs text-neutral-600">
                {[p.place || (p.soi && `ซอย ${p.soi}`), p.into && `→ ${p.into}`, p.owner].filter(Boolean).join(" · ")} · อัปเดต {timeAgo(p.updated_at)}
                {p.note && ` · ${p.note}`}
              </span>
            </span>
            <span className="shrink-0 text-sm underline">อัปเดต</span>
          </button>
        );
      })}
      {admin ? (
        <button onClick={() => onPump(null)} className="min-h-[48px] w-full rounded-lg border-2 border-dashed border-neutral-400 font-semibold">
          + เพิ่มเครื่องสูบ (ผู้ดูแล)
        </button>
      ) : (
        <p className="text-sm text-neutral-600">เห็นเครื่องสูบที่ยังไม่มีในรายการ หรือเครื่องย้ายที่ — แจ้งผู้ดูแล / ทีมอาสา ให้เพิ่มหรือย้ายให้</p>
      )}
    </div>
  );
}

function useName() {
  const [contact, setContact] = useState(() => load("contact", { name: "", phone: "" }));
  return [
    contact.name,
    (name) => {
      const next = { ...contact, name };
      setContact(next);
      save("contact", next);
    },
  ];
}

export function CanalForm({ onDone }) {
  const [name, setName] = useName();
  const [canal, setCanal] = useState(null);
  const [state, setState] = useState(null);
  const [cm, setCm] = useState("");
  const [soi, setSoi] = useState("");
  const [note, setNote] = useState("");
  const [media, setMedia] = useState([]);
  const [loc, setLoc] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!canal) return setError("เลือกคลอง");
    if (!state) return setError("เลือกว่าน้ำในคลองเป็นอย่างไร");
    if (state === "below" && cm === "") return setError("ใส่ว่าต่ำกว่าขอบเขื่อนกี่ ซม. (กะเอาก็ได้ เช่น 1 คืบ ≈ 20 ซม.)");
    if (!pinned && !soi.trim()) return setError("บอกตำแหน่ง: ใส่ท้ายซอย หรือเลื่อนหมุดบนแผนที่ไปตรงจุดที่ดู");
    if (attached.busy) return setError("รอรูปอัปโหลดให้เสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const r = await api("/canal/reports", {
        method: "POST",
        body: JSON.stringify({
          canal,
          state,
          below_cm: state === "below" ? Number(cm) : null,
          soi: soi.trim(),
          note: note.trim(),
          name: name.trim(),
          media_ids: attached.ids,
          ...(pinned && loc ? loc : {}), // no pin moved: the server puts it at the canal end of that soi
        }),
      });
      onDone(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-1 block font-medium">คลองไหน *</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CANALS).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setCanal(k)} aria-pressed={canal === k} className={seg(canal === k)}>
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 block font-medium">น้ำในคลองตอนนี้ *</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CANAL_STATE).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setState(k)} aria-pressed={state === k} className={seg(state === k)}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </fieldset>
      {state === "below" && (
        <label className="block">
          <span className="mb-1 block font-medium">ต่ำกว่าขอบเขื่อนกี่ ซม. *</span>
          <input type="number" inputMode="numeric" min={0} max={300} value={cm} onChange={(e) => setCm(e.target.value)} className={`${input} w-32`} placeholder="ซม." />
          <span className="mt-1 block text-xs text-neutral-500">กะเอาได้: 1 ฝ่ามือ ≈ 10 ซม. · 1 คืบ ≈ 20 ซม. · 1 ศอก ≈ 45 ซม.</span>
        </label>
      )}
      <label className="block">
        <span className="mb-1 block font-medium">ตรงไหน (ท้ายซอย / แยก)</span>
        <input value={soi} onChange={(e) => setSoi(e.target.value)} maxLength={10} className={`${input} w-32`} placeholder="เช่น 17" />
      </label>
      <div>
        <span className="mb-1 block font-medium">ตรงจุดไหนบนแผนที่ (ถ้าไม่เลื่อน ใช้ท้ายซอยที่ใส่)</span>
        <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinned(true)} />
      </div>
      <div>
        <span className="mb-1 block font-medium">รูปขอบเขื่อน / คลอง (ช่วยให้คนอื่นเห็นจริง)</span>
        <MediaPicker items={media} setItems={setMedia} max={1} allowVideo={false} />
      </div>
      <label className="block">
        <span className="mb-1 block font-medium">หมายเหตุ</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="เช่น น้ำซึมตรงรอยต่อกำแพง บ้าน 4/xxx" />
      </label>
      <label className="block">
        <span className="mb-1 block font-medium">ชื่อผู้แจ้ง</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} />
      </label>
      {error && <p className="rounded-lg bg-red-50 p-2 font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-[52px] w-full rounded-xl bg-black text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : "ส่งรายงานคลอง"}
      </button>
    </form>
  );
}

// Update a pump's status, or (no pump) add one that someone has seen.
// Status: anyone. Adding, moving, fixing details and deleting: admins (the server checks too).
export function PumpForm({ pump, onDone, admin = false }) {
  const [name, setName] = useName();
  const [status, setStatus] = useState(pump?.status || "running");
  const [f, setF] = useState({ label: pump?.label || "", place: pump?.place || "", soi: pump?.soi || "", owner: pump?.owner || "", into: pump?.into || "" });
  const [editing, setEditing] = useState(false); // existing pump: move it / fix its details
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState(pump?.lat != null ? { lat: pump.lat, lng: pump.lng } : null);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if ((!pump || editing) && f.label.trim().length < 2) return setError("ตั้งชื่อเครื่อง เช่น “ปั๊ม 8 นิ้ว หน้าป้อม รปภ.”");
    if (!pump && !pinned && !f.soi.trim()) return setError("บอกตำแหน่ง: ใส่ซอย หรือเลื่อนหมุดบนแผนที่ไปตรงเครื่องสูบ");
    setBusy(true);
    setError("");
    try {
      const body = { status, note: note.trim(), name: name.trim() };
      const fields = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]));
      if (pump && editing) {
        await api(`/pumps/${pump.id}`, { method: "PUT", body: JSON.stringify({ ...fields, ...(pinned && loc ? loc : {}), name: name.trim() }) });
      }
      const r = pump
        ? status !== pump.status || note.trim() || !editing
          ? await api(`/pumps/${pump.id}/status`, { method: "POST", body: JSON.stringify(body) })
          : pump
        : await api("/pumps", {
            method: "POST",
            body: JSON.stringify({ ...body, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])), ...(pinned && loc ? loc : {}) }),
          });
      onDone(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {pump && !editing ? (
        <div className="rounded-lg bg-neutral-100 p-2 text-sm">
          <p className="font-bold">{pump.label}</p>
          <p>{[pump.place || (pump.soi && `ซอย ${pump.soi}`), pump.into && `สูบลง ${pump.into}`, pump.owner].filter(Boolean).join(" · ")}</p>
          {(pump.history || [])
            .slice(-3)
            .reverse()
            .map((h, i) => (
              <p key={i} className="text-xs text-neutral-600">
                {PUMP_STATUS[h.status]?.icon} {PUMP_STATUS[h.status]?.label} · {h.name} · {timeAgo(h.at)}
                {h.note && ` · ${h.note}`}
              </p>
            ))}
          {admin && (
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-2">
              <button type="button" onClick={() => setEditing(true)} className="min-h-[44px] rounded-lg border-2 border-black bg-white font-semibold">
                📍 ย้ายตำแหน่ง / แก้ข้อมูล
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(`ลบ “${pump.label}” ออกจากรายการ? (ถ้าเครื่องถูกถอดไป เลือกสถานะ “ถอดออกแล้ว” แทนได้ ประวัติยังอยู่)`)) return;
                  try {
                    await api(`/admin/pumps/${pump.id}`, { method: "DELETE" });
                    onDone(null);
                  } catch (err) {
                    setError(err.message);
                  }
                }}
                className="min-h-[44px] rounded-lg border-2 border-red-600 px-3 font-semibold text-red-700"
              >
                ลบ
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={80} className={input} placeholder="ชื่อเครื่อง เช่น ปั๊ม 8 นิ้ว หน้าป้อม รปภ. *" />
          <input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} maxLength={120} className={input} placeholder="อยู่ตรงไหน เช่น หน้าป้อม รปภ. / ท้ายซอย 15" />
          <input value={f.soi} onChange={(e) => setF({ ...f, soi: e.target.value })} maxLength={10} className={`${input} w-40`} placeholder="ซอย (ถ้ามี)" />
          <p className="text-sm font-medium">{pump ? "ลากแผนที่ให้หมุดอยู่ตรงตำแหน่งใหม่ของเครื่อง" : "ตำแหน่งเครื่อง (ลากแผนที่ หรือใส่ซอย)"}</p>
          <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinned(true)} />
          <div className="grid grid-cols-2 gap-2">
            <input value={f.into} onChange={(e) => setF({ ...f, into: e.target.value })} maxLength={60} className={input} placeholder="สูบลง เช่น คลองระหัส" />
            <input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} maxLength={60} className={input} placeholder="ของใคร เช่น กทม. / ปภ." />
          </div>
        </div>
      )}
      <fieldset>
        <legend className="mb-1 block font-medium">ตอนนี้</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(PUMP_STATUS).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setStatus(k)} aria-pressed={status === k} className={seg(status === k)}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </fieldset>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="หมายเหตุ เช่น ไฟช็อต รอช่าง / ขยะอุดตะแกรง" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} placeholder="ชื่อผู้แจ้ง" />
      {error && <p className="rounded-lg bg-red-50 p-2 font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-[52px] w-full rounded-xl bg-black text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : pump ? (editing ? "บันทึกตำแหน่ง / ข้อมูล" : "บันทึกสถานะเครื่องสูบ") : "เพิ่มเครื่องสูบ"}
      </button>
    </form>
  );
}

// ---------- leaks through the flood wall / under the canal bank (1 Oct: holes found at the soi ends) ----------
export const LEAK_SEV = {
  seep: { icon: "💧", label: "ซึม" },
  flow: { icon: "🌊", label: "ไหลเข้า" },
  gush: { icon: "🚨", label: "พุ่งแรง" },
};
export const LEAK_STATUS = {
  open: { label: "เจอรูรั่ว ยังไม่มีคนอุด", cls: "bg-red-600 text-white", color: "#dc2626" },
  sealing: { label: "กำลังอุด", cls: "bg-amber-400 text-black", color: "#f59e0b" },
  worse: { label: "หนักขึ้น!", cls: "bg-purple-700 text-white", color: "#7e22ce" },
  sealed: { label: "อุดแล้ว", cls: "bg-green-600 text-white", color: "#16a34a" },
};

export function LeakForm({ onDone }) {
  const [name, setName] = useName();
  const [canal, setCanal] = useState("rahat");
  const [severity, setSeverity] = useState("flow");
  const [soi, setSoi] = useState("");
  const [bags, setBags] = useState("");
  const [note, setNote] = useState("");
  const [media, setMedia] = useState([]);
  const [loc, setLoc] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!pinned && !soi.trim()) return setError("บอกตำแหน่ง: ใส่ท้ายซอย หรือเลื่อนหมุด / กด “ใช้ตำแหน่งปัจจุบัน” ตรงรูรั่ว");
    if (attached.busy) return setError("รอรูปอัปโหลดให้เสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const r = await api("/leaks", {
        method: "POST",
        body: JSON.stringify({
          canal,
          severity,
          soi: soi.trim(),
          note: note.trim(),
          name: name.trim(),
          sandbags: bags === "" ? null : Number(bags),
          media_ids: attached.ids,
          ...(pinned && loc ? loc : {}),
        }),
      });
      onDone(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className="mb-1 block font-medium">น้ำเข้ามาแค่ไหน *</legend>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(LEAK_SEV).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setSeverity(k)} aria-pressed={severity === k} className={seg(severity === k)}>
              {v.icon} {v.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <span className="mb-1 block font-medium">ตรงไหน * (ยืนอยู่ตรงรูรั่ว กด “ใช้ตำแหน่งปัจจุบัน” ได้เลย)</span>
        <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinned(true)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">ท้ายซอย</span>
          <input value={soi} onChange={(e) => setSoi(e.target.value)} maxLength={10} className={input} placeholder="เช่น 15" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">ต้องใช้ทรายกี่ถุง (ถ้ากะได้)</span>
          <input type="number" inputMode="numeric" min={0} max={2000} value={bags} onChange={(e) => setBags(e.target.value)} className={input} placeholder="ถุง" />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1 block text-sm font-medium">ริมคลองไหน</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(CANALS).map(([k, v]) => (
            <button type="button" key={k} onClick={() => setCanal(k)} aria-pressed={canal === k} className={seg(canal === k)}>
              {v}
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <span className="mb-1 block font-medium">รูป / คลิปรูรั่ว (ช่วยให้ทีมรู้ว่าต้องเอาอะไรไป)</span>
        <MediaPicker items={media} setItems={setMedia} max={2} allowVideo />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="หมายเหตุ เช่น รูใต้คันปูน ข้างบ้าน 4/xxx กว้างราว 1 ฝ่ามือ" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} placeholder="ชื่อผู้แจ้ง" />
      {error && <p className="rounded-lg bg-red-50 p-2 font-semibold text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="min-h-[52px] w-full rounded-xl bg-red-700 text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : "🕳️ แจ้งรูรั่ว"}
      </button>
    </form>
  );
}

// One leak: what was reported, and anyone can move it along (กำลังอุด → อุดแล้ว / หนักขึ้น).
export function LeakSheet({ leak, onDone, onDelete }) {
  const [name, setName] = useName();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function set(status) {
    setBusy(true);
    setError("");
    try {
      onDone(await api(`/leaks/${leak.id}/status`, { method: "POST", body: JSON.stringify({ status, note: note.trim(), name: name.trim() }) }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  const st = LEAK_STATUS[leak.status] || LEAK_STATUS.open;
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-neutral-100 p-2">
        <p className="font-bold">
          <span className={`mr-1 rounded px-1.5 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
          {LEAK_SEV[leak.severity]?.icon} {LEAK_SEV[leak.severity]?.label} · {CANALS[leak.canal]}
          {leak.soi && ` · ท้ายซอย ${leak.soi}`}
        </p>
        {leak.sandbags != null && <p className="text-sm">ต้องใช้ทรายประมาณ {leak.sandbags} ถุง</p>}
        {(leak.history || [])
          .slice()
          .reverse()
          .slice(0, 4)
          .map((h, i) => (
            <p key={i} className="text-xs text-neutral-600">
              {LEAK_STATUS[h.status]?.label} · {h.name} · {timeAgo(h.at)}
              {h.note && ` · ${h.note}`}
            </p>
          ))}
        <div className="mt-1 flex gap-2">
          {(leak.media || []).map((m) => (
            <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noreferrer">
              <img src={mediaUrl(m.id, "thumb")} alt="รูรั่ว" className="h-20 w-20 rounded object-cover" />
            </a>
          ))}
        </div>
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${leak.lat},${leak.lng}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sm underline">
          🧭 นำทางไปจุดนี้
        </a>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="หมายเหตุ เช่น ใช้ทราย 15 ถุง / ต้องการคนเพิ่ม 3 คน" />
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={input} placeholder="ชื่อ" />
      <div className="grid grid-cols-2 gap-2">
        <button disabled={busy} onClick={() => set("sealing")} className="min-h-[52px] rounded-xl bg-amber-400 font-bold">
          🧱 กำลังอุด
        </button>
        <button disabled={busy} onClick={() => set("sealed")} className="min-h-[52px] rounded-xl bg-green-600 font-bold text-white">
          ✅ อุดแล้ว
        </button>
        <button disabled={busy} onClick={() => set("worse")} className="min-h-[48px] rounded-xl bg-purple-700 font-bold text-white">
          🚨 หนักขึ้น
        </button>
        <button disabled={busy} onClick={() => set("open")} className="min-h-[48px] rounded-xl border-2 border-black font-semibold">
          ↩️ ยังรั่วอยู่
        </button>
      </div>
      {onDelete && (
        <button onClick={() => window.confirm("ลบรายงานรูรั่วนี้?") && onDelete(leak)} className="min-h-[40px] w-full rounded-lg border border-red-600 text-sm text-red-700">
          ลบ (ผู้ดูแล)
        </button>
      )}
      {error && <p className="rounded-lg bg-red-50 p-2 font-semibold text-red-700">{error}</p>}
    </div>
  );
}

export function LeakList({ leaks, onLeak, onAdd }) {
  const order = { worse: 0, open: 1, sealing: 2, sealed: 3 };
  const list = [...leaks].sort((a, b) => order[a.status] - order[b.status] || new Date(b.updated_at) - new Date(a.updated_at));
  return (
    <div className="space-y-2">
      <button onClick={onAdd} className="min-h-[52px] w-full rounded-xl bg-red-700 text-lg font-bold text-white">
        🕳️ แจ้งรูรั่วใหม่
      </button>
      {list.length === 0 && <p className="text-neutral-600">ยังไม่มีรายงานรูรั่ว</p>}
      {list.map((l) => {
        const st = LEAK_STATUS[l.status] || LEAK_STATUS.open;
        return (
          <button key={l.id} onClick={() => onLeak(l)} className="flex min-h-[56px] w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 text-left">
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${st.cls}`}>{st.label}</span>
            <span className="min-w-0 flex-1">
              <b className="block">
                {LEAK_SEV[l.severity]?.icon} {l.soi ? `ท้ายซอย ${l.soi}` : CANALS[l.canal]} · {LEAK_SEV[l.severity]?.label}
              </b>
              <span className="block truncate text-xs text-neutral-600">
                {l.sandbags != null && `ทราย ~${l.sandbags} ถุง · `}อัปเดต {timeAgo(l.updated_at)}
                {l.note && ` · ${l.note}`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
