import { useEffect, useState } from "react";
import { api, load, save } from "../api";

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";

// Active sign-up lists (e.g. "ลงชื่อขอช่างไฟตรวจบ้าน") as boxes on the home page. Switched on/off by admins.
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
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(() => mine || { house: "", soi: "", name: c.name || "", phone: c.phone || "", picks: [], note: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (p) => setF((x) => ({ ...x, ...p }));
  const toggle = (o) => set({ picks: f.picks.includes(o) ? f.picks.filter((x) => x !== o) : [...f.picks, o] });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const res = await api(`/surveys/${s.key}`, { method: "POST", body: JSON.stringify(f) });
      save(`survey:${s.key}`, f);
      onCount(res.count);
      setOpen(false);
      setMsg(res.updated ? "แก้ไขข้อมูลแล้ว ✅" : "ลงชื่อแล้ว ✅ ทีมจะรวบรวมส่งให้ช่าง");
    } catch (e2) {
      setMsg(e2.message);
    }
    setBusy(false);
  }

  return (
    <section className="mb-3 rounded-xl border-4 border-blue-600 bg-blue-50 px-3 py-2">
      <button onClick={() => setOpen((o) => !o)} className="flex min-h-[56px] w-full items-center gap-3 text-left">
        <span className="text-2xl" aria-hidden="true">⚡</span>
        <span className="min-w-0 flex-1">
          <b className="break-words">{s.title}</b>
          <span className="block text-sm text-neutral-700">
            ลงชื่อแล้ว {s.count} หลัง{mine ? " · บ้านคุณลงแล้ว ✅" : ""}
          </span>
        </span>
        <span className="shrink-0 font-semibold underline">{open ? "ปิด" : mine ? "แก้ไข ›" : "ลงชื่อ ›"}</span>
      </button>
      {msg && !open && <p className="pb-1 text-sm font-semibold text-blue-800">{msg}</p>}
      {open && (
        <form onSubmit={submit} className="space-y-2 pb-2 pt-1">
          {s.details && <p className="text-sm text-neutral-700">{s.details}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input required value={f.house} onChange={(e) => set({ house: e.target.value })} className={input} placeholder="บ้านเลขที่ * (4/917)" aria-label="บ้านเลขที่" inputMode="numeric" />
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
          <p className="text-xs text-neutral-600">เบอร์โทรเห็นเฉพาะทีมอาสา · ลงซ้ำจากบ้านเดิม = แก้ไขข้อมูลเดิม</p>
          {msg && <p className="rounded-lg bg-red-50 p-2 text-red-700">{msg}</p>}
          <button disabled={busy} className="min-h-[48px] w-full rounded-xl bg-blue-700 font-bold text-white disabled:opacity-60">
            {busy ? "กำลังส่ง…" : mine ? "บันทึกการแก้ไข" : "ลงชื่อ"}
          </button>
        </form>
      )}
    </section>
  );
}
