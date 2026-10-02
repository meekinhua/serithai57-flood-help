import { CANAL_STATE, LEAK_STATUS, canalSummary } from "./Canal";
import { WATER_WHERE, timeAgo, waterOf } from "../config";
import { mediaUrl } from "../media";
import MapView from "./MapView";
import { TripsStrip } from "./Trips";

// 2 Oct: heavy rain right after the village dried. Is the water coming back? Street levels reported in the
// last 3 h, the canals against the flood wall, holes not sealed yet — and one tap to report.
const RECENT_H = 3;

export default function WatchPanel({ water, canal, onWater, onCanal, onLeak, onLeaks, onMap, title = "" }) {
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
        <h2 className="text-lg font-black">{alarm ? "🚨 น้ำกลับมา? เฝ้าระวัง" : title || "🌧️ ฝนตกอีกรอบ · เฝ้าระวังน้ำ"}</h2>
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
        <button onClick={onMap} className="min-h-[48px] rounded-xl border-2 border-black bg-white px-2 font-bold">🗺️ แผนที่น้ำ</button>
      </div>
      <p className="mt-2 text-xs text-neutral-600">น้ำไม่ท่วมก็แจ้ง “ไม่ท่วม” ได้ ช่วยให้รู้ว่าซอยไหนปลอดภัย · ถ้าน้ำเข้าหมู่บ้าน ผู้ดูแลจะเปิดระบบน้ำท่วมกลับมาทันที · ฉุกเฉินโทร 1669 / 199</p>
    </section>
  );
}

// The whole picture in one glance, for the sticky header: the deepest street level reported in the last 3 h,
// or the canal / leak alarm if that is worse. Tap → the water tab.
export function waterStatus(water, canal) {
  const t = Date.now();
  const recent = water.filter((w) => t - new Date(w.created_at).getTime() <= RECENT_H * 3.6e6);
  const worst = recent.reduce((m, w) => (m == null || w.level > m.level ? w : m), null);
  const canals = canalSummary(canal?.reports || []).filter((c) => !c.stale);
  const over = canals.find((c) => c.state === "over");
  const badLeak = (canal?.leaks || []).find((l) => l.status === "worse" || (l.status !== "sealed" && l.severity === "gush"));
  const wet = recent.filter((w) => w.level >= 1).length;
  if (over) return { color: "#dc2626", text: `${over.name} ล้น`, sub: "คลองล้นเข้าหมู่บ้าน", alarm: true };
  if (worst && worst.level >= 1) {
    const lv = waterOf(worst.level);
    return { color: lv.color, text: `น้ำขัง ${lv.label}`, sub: `${wet}/${recent.length} จุดมีน้ำ · ${RECENT_H} ชม.`, alarm: worst.level >= 2 };
  }
  if (badLeak) return { color: "#7e22ce", text: "รูรั่วหนัก", sub: badLeak.soi ? `ท้ายซอย ${badLeak.soi}` : "ดูรูรั่ว", alarm: true };
  if (recent.length) return { color: "#16a34a", text: "ไม่ท่วม", sub: `${recent.length} จุด · ${RECENT_H} ชม.`, alarm: false };
  return { color: "#a3a3a3", text: "ยังไม่มีรายงาน", sub: "ช่วยแจ้งระดับน้ำ", alarm: false };
}

export function WaterPill({ water, canal, onOpen }) {
  const st = waterStatus(water, canal);
  return (
    <button
      onClick={onOpen}
      aria-label={`ระดับน้ำตอนนี้: ${st.text} · ${st.sub} · แตะเพื่อดูแผนที่น้ำ`}
      className={`flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-left leading-tight ${st.alarm ? "bg-red-600" : "bg-white/10"} active:bg-white/20`}
    >
      <span className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white ${st.alarm ? "animate-pulse" : ""}`} style={{ background: st.color }} aria-hidden="true" />
      <span className="text-xs font-bold sm:text-sm">
        💧 {st.text}
        <span className="hidden text-[11px] font-normal opacity-80 min-[420px]:block">{st.sub}</span>
      </span>
    </button>
  );
}

// 💧 tab: the map in water mode (street dots, canals, pumps, leaks) and the latest reports.
export function WaterView({ water, canal, onWater, onCanal, onLeaks, onLeak, onPump, onPumps, admin, trips = [], focus, onFocusTrip, hubs = [] }) {
  return (
    <div className="space-y-3">
      {trips.length > 0 && <TripsStrip trips={trips} onFocus={onFocusTrip} />}
      <div className="relative isolate h-[65vh] min-h-[320px] overflow-hidden rounded-xl border border-neutral-300 bg-white">
        <MapView
          posts={[]}
          water={water}
          trips={trips}
          focus={focus}
          hubs={hubs}
          onSelect={() => {}}
          onReportWater={onWater}
          canal={canal}
          onReportCanal={onCanal}
          onPump={onPump}
          onPumps={onPumps}
          canAddPump={!!admin}
          onLeak={onLeak}
          onLeaks={onLeaks}
        />
      </div>
      <section className="rounded-xl bg-white p-3">
        <h3 className="mb-2 font-bold">💧 รายงานล่าสุด</h3>
        <ul className="space-y-1 text-sm">
          {water.slice(0, 15).map((w) => {
            const lv = waterOf(w.level);
            return (
              <li key={w.id} className="flex min-h-[40px] items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: lv.color }} aria-hidden="true" />
                <b className="shrink-0">{lv.label}</b>
                <span className="min-w-0 flex-1 truncate text-neutral-600">
                  {w.cm != null && `${w.cm} ซม. · `}
                  {w.where && WATER_WHERE[w.where] && `${WATER_WHERE[w.where][1]} · `}
                  {timeAgo(w.created_at)}
                  {w.note && ` · ${w.note}`}
                </span>
                {w.media?.[0] && (
                  <a href={mediaUrl(w.media[0].id)} target="_blank" rel="noreferrer" aria-label="ดูรูป" className="shrink-0">
                    <img src={mediaUrl(w.media[0].id, "thumb")} alt="" loading="lazy" className="h-9 w-9 rounded object-cover" />
                  </a>
                )}
              </li>
            );
          })}
          {!water.length && <li className="text-neutral-500">ยังไม่มีรายงาน</li>}
        </ul>
        <button onClick={onWater} className="mt-2 min-h-[48px] w-full rounded-xl bg-sky-700 font-bold text-white">💧 แจ้งระดับน้ำหน้าบ้านฉัน</button>
      </section>
    </div>
  );
}
