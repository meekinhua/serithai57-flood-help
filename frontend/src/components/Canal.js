// The canals around the village and the pumps (1 Oct 2026). The flood now depends on the canals next to
// the flood wall: people near a canal report how far below the top of the wall the water is (or that it
// is over the wall / leaking through it), so everyone can see whether pumping into that canal still makes
// sense; and each pump shows where it is, where it pumps to and whether it is running now.
import { useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { mediaUrl } from "../media";
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
    const cms = use.filter((r) => r.state === "below" && r.below_cm != null).map((r) => r.below_cm).sort((a, b) => a - b);
    const cm = cms.length ? cms[Math.floor((cms.length - 1) / 2)] : null;
    let state, title, advice;
    if (has("over")) [state, title, advice] = ["over", "ล้นเข้าหมู่บ้าน", "สูบลงคลองนี้จะวนกลับเข้าหมู่บ้าน · เร่งกั้นกระสอบทราย / แจ้งเขต"];
    else if (has("leak")) [state, title, advice] = ["leak", "เขื่อนรั่ว / ซึม", "อุดจุดรั่วก่อน · สูบได้แต่ต้องเฝ้าจุดรั่ว"];
    else if (has("brim")) [state, title, advice] = ["brim", "ปริ่มขอบเขื่อน", "สูบลงคลองนี้ต้องเฝ้า เสี่ยงล้นกลับ"];
    else if (cm != null && cm >= 20) [state, title, advice] = ["below", `ต่ำกว่าขอบ ~${cm} ซม.`, "ยังสูบลงคลองนี้ได้"];
    else if (cm != null) [state, title, advice] = ["brim", `ต่ำกว่าขอบแค่ ~${cm} ซม.`, "สูบได้ แต่ต้องเฝ้าใกล้ชิด ใกล้ล้นแล้ว"];
    else [state, title, advice] = ["below", "ต่ำกว่าขอบ", "ยังสูบได้"];
    out.push({ key, name, state, title, advice, cm, n: recent.length, stale: !recent.length, last: mine[0] });
  }
  return out;
}

export function CanalBox({ data, onReport, onPump, onAddPump, onDelete }) {
  const reports = data?.reports || [];
  const pumps = data?.pumps || [];
  const summary = canalSummary(reports);
  const worst = summary.find((s) => s.state === "over") || summary.find((s) => s.state === "leak") || summary.find((s) => s.state === "brim");
  const running = pumps.filter((p) => p.status === "running").length;
  return (
    <section className="rounded-2xl border-4 bg-white p-3 shadow" style={{ borderColor: worst ? CANAL_STATE[worst.state].color : "#0284c7" }}>
      <p className="text-lg font-black">🌊 ระดับคลองรอบหมู่บ้าน · ยังควรสูบไหม?</p>
      {summary.length === 0 && <p className="mt-1 text-sm text-neutral-700">ยังไม่มีรายงาน — บ้านไหนอยู่ติดคลอง ช่วยแจ้งว่าน้ำในคลองต่ำกว่าขอบเขื่อนแค่ไหน</p>}
      <ul className="mt-2 space-y-2">
        {summary.map((s) => (
          <li key={s.key} className="rounded-xl p-2" style={{ background: `${CANAL_STATE[s.state].color}18` }}>
            <p className="font-bold">
              {CANAL_STATE[s.state].icon} {s.name}: {s.title}
            </p>
            <p className="text-sm">{s.advice}</p>
            <p className="text-xs text-neutral-600">{s.stale ? `⚠️ ยังไม่มีรายงานใหม่ใน ${NOW_H} ชม. · ล่าสุด ${timeAgo(s.last.created_at)}` : `จาก ${s.n} รายงานใน ${NOW_H} ชม.`}</p>
          </li>
        ))}
      </ul>
      {reports.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-neutral-200 pt-2 text-sm">
          {reports.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              <span className="shrink-0">{CANAL_STATE[r.state].icon}</span>
              <span className="min-w-0 flex-1 truncate">
                <b>{CANALS[r.canal]}</b>
                {r.soi && ` · ท้ายซอย ${r.soi}`} · {r.state === "below" && r.below_cm != null ? `ต่ำกว่าขอบ ${r.below_cm} ซม.` : CANAL_STATE[r.state].label}
                <span className="text-neutral-600">
                  {" "}
                  · {timeAgo(r.created_at)}
                  {r.note && ` · ${r.note}`}
                </span>
              </span>
              {r.media?.[0] && (
                <a href={mediaUrl(r.media[0].id)} target="_blank" rel="noreferrer" aria-label="ดูรูปคลอง" className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center">
                  <img src={mediaUrl(r.media[0].id, "thumb")} alt="" loading="lazy" className="h-9 w-9 rounded object-cover" />
                </a>
              )}
              {onDelete && (
                <button onClick={() => onDelete(r)} className="min-h-[40px] shrink-0 px-1 text-red-700 underline">
                  ลบ
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <button onClick={onReport} className="mt-2 min-h-[52px] w-full rounded-xl bg-sky-700 text-lg font-bold text-white active:bg-sky-800">
        🌊 แจ้งระดับน้ำในคลอง / เขื่อนรั่ว
      </button>

      <div className="mt-3 border-t-2 border-neutral-200 pt-2">
        <p className="font-bold">
          ⚙️ เครื่องสูบน้ำ {pumps.length > 0 && <span className="font-normal text-neutral-700">· กำลังสูบ {running} / {pumps.length} เครื่อง</span>}
        </p>
        {pumps.length === 0 && <p className="text-sm text-neutral-600">ยังไม่มีข้อมูลเครื่องสูบ</p>}
        <ul className="mt-1 space-y-1">
          {pumps.map((p) => {
            const st = PUMP_STATUS[p.status] || PUMP_STATUS.stopped;
            return (
              <li key={p.id}>
                <button onClick={() => onPump(p)} className="flex min-h-[52px] w-full items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2 text-left">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ${st.cls}`}>
                    {st.icon} {st.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{p.label}</b>
                    <span className="block truncate text-xs text-neutral-600">
                      {[p.place || (p.soi && `ซอย ${p.soi}`), p.into && `→ ${p.into}`, p.owner].filter(Boolean).join(" · ")} · อัปเดต {timeAgo(p.updated_at)}
                      {p.note && ` · ${p.note}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm underline">อัปเดต</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button onClick={onAddPump} className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-dashed border-neutral-400 text-sm font-semibold">
          + เพิ่มเครื่องสูบที่เห็น
        </button>
      </div>
    </section>
  );
}

function useName() {
  const [contact, setContact] = useState(() => load("contact", { name: "", phone: "" }));
  return [contact.name, (name) => {
    const next = { ...contact, name };
    setContact(next);
    save("contact", next);
  }];
}

export function CanalForm({ onDone }) {
  const [name, setName] = useName();
  const [canal, setCanal] = useState(null);
  const [state, setState] = useState(null);
  const [cm, setCm] = useState("");
  const [soi, setSoi] = useState("");
  const [note, setNote] = useState("");
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!canal) return setError("เลือกคลอง");
    if (!state) return setError("เลือกว่าน้ำในคลองเป็นอย่างไร");
    if (state === "below" && cm === "") return setError("ใส่ว่าต่ำกว่าขอบเขื่อนกี่ ซม. (กะเอาก็ได้ เช่น 1 คืบ ≈ 20 ซม.)");
    if (attached.busy) return setError("รอรูปอัปโหลดให้เสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const r = await api("/canal/reports", {
        method: "POST",
        body: JSON.stringify({ canal, state, below_cm: state === "below" ? Number(cm) : null, soi: soi.trim(), note: note.trim(), name: name.trim(), media_ids: attached.ids }),
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
export function PumpForm({ pump, onDone }) {
  const [name, setName] = useName();
  const [status, setStatus] = useState(pump?.status || "running");
  const [f, setF] = useState({ label: "", place: "", soi: "", owner: "", into: "" });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    if (!pump && f.label.trim().length < 2) return setError("ตั้งชื่อเครื่อง เช่น “ปั๊ม 8 นิ้ว หน้าป้อม รปภ.”");
    setBusy(true);
    setError("");
    try {
      const body = { status, note: note.trim(), name: name.trim() };
      const r = pump
        ? await api(`/pumps/${pump.id}/status`, { method: "POST", body: JSON.stringify(body) })
        : await api("/pumps", { method: "POST", body: JSON.stringify({ ...body, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])) }) });
      onDone(r);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {pump ? (
        <div className="rounded-lg bg-neutral-100 p-2 text-sm">
          <p className="font-bold">{pump.label}</p>
          <p>{[pump.place || (pump.soi && `ซอย ${pump.soi}`), pump.into && `สูบลง ${pump.into}`, pump.owner].filter(Boolean).join(" · ")}</p>
          {(pump.history || []).slice(-3).reverse().map((h, i) => (
            <p key={i} className="text-xs text-neutral-600">
              {PUMP_STATUS[h.status]?.icon} {PUMP_STATUS[h.status]?.label} · {h.name} · {timeAgo(h.at)}
              {h.note && ` · ${h.note}`}
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={80} className={input} placeholder="ชื่อเครื่อง เช่น ปั๊ม 8 นิ้ว หน้าป้อม รปภ. *" />
          <input value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} maxLength={120} className={input} placeholder="อยู่ตรงไหน เช่น หน้าป้อม รปภ. / ท้ายซอย 15" />
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
        {busy ? "กำลังส่ง…" : pump ? "บันทึกสถานะเครื่องสูบ" : "เพิ่มเครื่องสูบ"}
      </button>
    </form>
  );
}
