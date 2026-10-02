import { CANAL_STATE, LEAK_STATUS, canalSummary } from "./Canal";
import { timeAgo, waterOf } from "../config";

// 2 Oct: heavy rain right after the village dried. Is the water coming back? Street levels reported in the
// last 3 h, the canals against the flood wall, holes not sealed yet — and one tap to report.
const RECENT_H = 3;

export default function WatchPanel({ water, canal, onWater, onCanal, onLeak, onLeaks }) {
  const t = Date.now();
  const recent = water.filter((w) => t - new Date(w.created_at).getTime() <= RECENT_H * 3.6e6);
  const worst = recent.reduce((m, w) => (m == null || w.level > m.level ? w : m), null);
  const canals = canalSummary(canal?.reports || []).filter((c) => !c.stale);
  const openLeaks = (canal?.leaks || []).filter((l) => l.status !== "sealed");
  const alarm = (worst && worst.level >= 1) || canals.some((c) => c.state === "over" || c.state === "leak") || openLeaks.some((l) => l.status === "worse" || l.severity === "gush");
  const lv = worst ? waterOf(worst.level) : null;

  return (
    <section className={`rounded-2xl border-4 p-3 ${alarm ? "border-red-600 bg-red-50" : "border-sky-600 bg-sky-50"}`} aria-label="เฝ้าระวังน้ำ">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 className="text-lg font-black">{alarm ? "🚨 น้ำกลับมา? เฝ้าระวัง" : "🌧️ ฝนตกอีกรอบ · เฝ้าระวังน้ำ"}</h2>
        <span className="text-sm text-neutral-600">รายงานจากเพื่อนบ้าน {RECENT_H} ชม.ล่าสุด</span>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-2">
          <p className="text-xs font-semibold text-neutral-500">💧 ระดับน้ำบนถนน</p>
          {worst ? (
            <p className="flex items-center gap-1.5 font-bold">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: lv.color }} aria-hidden="true" />
              สูงสุด {lv.label}
              <span className="font-normal text-neutral-600">· {recent.length} จุด</span>
            </p>
          ) : (
            <p className="font-semibold text-neutral-600">ยังไม่มีคนแจ้ง · ช่วยแจ้งหน้าบ้านคุณ</p>
          )}
          {worst?.note && <p className="truncate text-xs text-neutral-600">{worst.note} · {timeAgo(worst.created_at)}</p>}
        </div>
        <div className="rounded-xl bg-white p-2">
          <p className="text-xs font-semibold text-neutral-500">🌊 คลองข้างหมู่บ้าน</p>
          {canals.length ? (
            canals.map((c) => (
              <p key={c.key} className="text-sm">
                {CANAL_STATE[c.state].icon} <b>{c.name}</b> {c.title}
              </p>
            ))
          ) : (
            <p className="font-semibold text-neutral-600">ยังไม่มีคนแจ้ง</p>
          )}
        </div>
        <button onClick={onLeaks} className="rounded-xl bg-white p-2 text-left">
          <p className="text-xs font-semibold text-neutral-500">🕳️ รูรั่วที่ยังไม่อุด</p>
          {openLeaks.length ? (
            <p className="font-bold text-red-700">
              {openLeaks.length} จุด{openLeaks[0].soi && ` · ท้ายซอย ${openLeaks.map((l) => l.soi).filter(Boolean).join(", ")}`}
              <span className="block text-xs font-normal">{LEAK_STATUS[openLeaks[0].status]?.label} · ดูทั้งหมด ›</span>
            </p>
          ) : (
            <p className="font-semibold text-emerald-700">✅ อุดหมดแล้ว</p>
          )}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button onClick={onWater} className="min-h-[48px] rounded-xl bg-sky-700 px-2 font-bold text-white">💧 แจ้งระดับน้ำ</button>
        <button onClick={onCanal} className="min-h-[48px] rounded-xl border-2 border-black bg-white px-2 font-bold">🌊 แจ้งคลอง</button>
        <button onClick={onLeak} className="min-h-[48px] rounded-xl bg-red-700 px-2 font-bold text-white">🕳️ เจอรูรั่ว</button>
        <a href="/flood" className="flex min-h-[48px] items-center justify-center rounded-xl border-2 border-black bg-white px-2 font-bold">🗺️ แผนที่น้ำ</a>
      </div>
      <p className="mt-2 text-xs text-neutral-600">น้ำไม่ท่วมก็แจ้ง “ไม่ท่วม” ได้ ช่วยให้รู้ว่าซอยไหนปลอดภัย · ถ้าน้ำเข้าหมู่บ้าน ผู้ดูแลจะเปิดระบบน้ำท่วมกลับมาทันที · ฉุกเฉินโทร 1669 / 199</p>
    </section>
  );
}
