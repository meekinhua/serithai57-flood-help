// 🛡️ Admin: move a post's pin (a report or a หาย·เจอ that landed in the wrong place). 9 Oct 2026.
import { useEffect, useState } from "react";
import { api } from "../api";
import LocationPicker from "./LocationPicker";

export default function PinFix({ kind, item, onSaved, onClose }) {
  const [loc, setLoc] = useState(item.lat != null && !item.approx ? { lat: item.lat, lng: item.lng } : item.lat != null ? { lat: item.lat, lng: item.lng } : null);
  const [touched, setTouched] = useState(false);
  const [soi, setSoi] = useState(item.soi || "");
  const [typed, setTyped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const key = touched && loc ? `${loc.lat},${loc.lng}` : "";
  useEffect(() => {
    if (!key || typed) return;
    const t = setTimeout(() => {
      api(`/myhome/soi-at?lat=${loc.lat}&lng=${loc.lng}`)
        .then((r) => r.soi && setSoi(r.soi))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [key, typed]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(clear = false) {
    setBusy(true);
    setErr("");
    try {
      const x = await api(`/admin/${kind}/${item.id}/where`, { method: "POST", body: JSON.stringify(clear ? { soi, clear: true } : { ...loc, soi }) });
      onSaved(x);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="anim-in mt-2 space-y-2 rounded-xl border-2 border-[#15201A] p-2">
      <b className="block text-sm">🛡️ ย้ายหมุด (ผู้ดูแล){item.approx ? " · ตอนนี้เป็นตำแหน่งโดยประมาณ" : ""}</b>
      <LocationPicker value={loc} onChange={setLoc} onTouched={() => setTouched(true)} />
      <label className="flex items-center gap-2 text-sm">
        ซอย / แยก
        <input
          value={soi}
          onChange={(e) => {
            setSoi(e.target.value);
            setTyped(true);
          }}
          maxLength={12}
          className="min-h-[40px] w-24 rounded-lg border border-neutral-300 px-2"
        />
      </label>
      {err && <p className="text-sm font-bold text-red-700">{err}</p>}
      <div className="grid grid-cols-3 gap-2 text-sm">
        <button onClick={onClose} className="min-h-[44px] rounded-lg border border-neutral-400">
          ยกเลิก
        </button>
        <button onClick={() => save(true)} disabled={busy} title="ไม่ใช้หมุด ใช้กลางซอยแทน" className="min-h-[44px] rounded-lg border border-neutral-400 disabled:opacity-50">
          ใช้กลางซอย
        </button>
        <button onClick={() => save(false)} disabled={busy || !touched} className="min-h-[44px] rounded-lg bg-[#1E6B47] font-bold text-white disabled:opacity-40">
          บันทึกหมุด
        </button>
      </div>
      {!touched && <p className="text-xs text-neutral-500">ลากแผนที่ให้หมุดชี้ตรงจุด แล้วกดบันทึก</p>}
    </div>
  );
}
