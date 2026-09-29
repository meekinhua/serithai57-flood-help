import { useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../config";
import { HAZ } from "./OpsPage";
import { placeOf, zoneGroups } from "./ZonesPage";

// /teamwork — for everyone in the village (share it in the village LINE group): what the volunteer
// teams are doing, how much is left, what they are short of, and how to come and help.
// Read only, and nothing personal: the backend sends counts only (no house numbers, names or phones).

const ACT = {
  delivered: ["📦", "ส่งของถึงบ้านแล้ว"],
  on_the_way: ["🚶", "อาสากำลังเดินลุยน้ำไปส่ง"],
  boat: ["🚤", "เรือเข้าไปแจกของ"],
  truck_drop: ["🚛", "รถลงของที่จุด"],
  food: ["🍱", "แจกอาหาร"],
  water: ["💧", "แจกน้ำดื่ม"],
  evacuate: ["🚣", "รับคนออก / อพยพ"],
  medical: ["🩺", "ดูแลคนป่วย / ส่งยา"],
  need: ["⚠️", "แจ้งว่ายังขาดของ"],
  other: ["📝", "งานอาสา"],
};

function Stat({ n, label, tone = "bg-white" }) {
  return (
    <div className={`rounded-2xl p-3 text-center shadow ${tone}`}>
      <p className="text-4xl font-black leading-none">{n}</p>
      <p className="mt-1 text-sm font-semibold">{label}</p>
    </div>
  );
}

export default function TeamworkPage() {
  const [d, setD] = useState(null);
  const [zones, setZones] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "ทีมอาสาหมู่บ้านทำงานอยู่ · เสรีไทย 57";
    const load = () =>
      api("/public/teamwork")
        .then((x) => {
          setD(x);
          setError("");
        })
        .catch((e) => setError(e.message === "404" || e.message === "Not Found" ? "หน้านี้ยังไม่เปิดบนเว็บ (ต้อง deploy รุ่นใหม่)" : e.message));
    load();
    api("/zones")
      .then((z) => setZones(z.zones))
      .catch(() => {});
    const t = setInterval(() => document.visibilityState === "visible" && load(), 60000);
    return () => clearInterval(t);
  }, []);

  async function share() {
    const text = `ทีมอาสาหมู่บ้านลุยน้ำแจกของทุกวัน ส่งถึงบ้านแล้ว ${d?.totals.done_24h ?? ""} บ้านใน 24 ชม. ยังรออีก ${d ? d.totals.open + d.totals.helping : ""} บ้าน — ดูว่าทีมขาดอะไร / มาช่วยได้อย่างไร: ${window.location.origin}/teamwork`;
    if (navigator.share) return navigator.share({ text }).catch(() => {});
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("คัดลอกข้อความนี้", text);
    }
  }

  const groups = zoneGroups(zones);
  const T = d?.totals;
  const waiting = T ? T.open + T.helping : 0;
  const pointOf = (id) => (d?.points || []).find((p) => p.zone === id);
  const unmanned = groups.filter((g) => !pointOf(g.id)?.manned);
  // same thing in the same block within 15 minutes = one line "× N"
  const feed = [];
  for (const a of d?.activity || []) {
    const g = groups.find((x) => x.ids.includes(a.zone));
    const key = `${a.kind}|${g?.id || a.zone}`;
    const last = feed[feed.length - 1];
    if (last && last.key === key && new Date(last.first) - new Date(a.at) < 15 * 60000) last.n += 1;
    else feed.push({ ...a, key, label: g?.label || a.zone, first: a.at, n: 1 });
  }

  return (
    <div className="min-h-screen bg-sky-50 pb-12">
      <header className="bg-gradient-to-br from-sky-700 to-sky-900 px-4 pb-6 pt-5 text-white">
        <div className="mx-auto max-w-3xl">
          <p className="text-sm opacity-80">หมู่บ้านสหกรณ์เคหะสถาน 4 · เสรีไทย 57</p>
          <h1 className="mt-1 text-2xl font-black leading-snug">💪 ทีมอาสาของหมู่บ้านเรา กำลังลุยน้ำช่วยกันอยู่</h1>
          <p className="mt-2 text-[15px] leading-relaxed opacity-95">
            อาสาเป็นเพื่อนบ้านเราเอง เดินลุยน้ำแจกข้าว น้ำ ยา ถึงหน้าบ้านทุกวัน 11:00–17:00 หลายคนเริ่มเท้าเปื่อย บางคนป่วยจากการแช่น้ำ แต่ยังมีบ้านที่รอความช่วยเหลืออยู่
          </p>
          {d && <p className="mt-2 text-xs opacity-75">อัปเดต {timeAgo(d.updated_at)} · ข้อมูลส่วนตัว (บ้านเลขที่ ชื่อ เบอร์) ไม่แสดงในหน้านี้</p>}
        </div>
      </header>

      <main className="mx-auto -mt-3 max-w-3xl space-y-4 px-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        {!d && !error && <p className="rounded-xl bg-white p-4 text-center text-neutral-600 shadow">กำลังโหลด…</p>}

        {d && (
          <>
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat n={T.done_24h} label="📦 บ้านที่ส่งของถึงแล้ว (24 ชม.)" tone="bg-green-600 text-white" />
              <Stat n={waiting} label="🏠 บ้านที่ยังรอ" tone={waiting ? "bg-amber-400" : "bg-white"} />
              <Stat n={d.volunteers || "—"} label="🙋 อาสาในทีม" />
              <Stat n={d.boats.total} label={`🚤 เรือที่ใช้อยู่${d.boats.need_driver ? ` (${d.boats.need_driver} ลำขาดคนขับ)` : ""}`} />
            </section>

            {d.hazards.length > 0 && (
              <section className="rounded-2xl bg-red-600 p-4 text-white shadow">
                <p className="text-lg font-black">⚠️ ระวัง! จุดอันตราย</p>
                {d.hazards.map((h, i) => (
                  <p key={i} className="font-semibold">
                    {(HAZ[h.kind] || HAZ.other)[0]} {(HAZ[h.kind] || HAZ.other)[1]}
                    {h.soi && ` ซ.${h.soi}`}
                    {h.note && ` — ${h.note}`}
                  </p>
                ))}
              </section>
            )}

            <section className="rounded-2xl border-4 border-amber-400 bg-white p-4 shadow">
              <p className="text-xl font-black">🙏 อยากช่วย? ทำได้ทันที</p>
              <ol className="mt-2 space-y-2 text-[15px]">
                <li>
                  <b>1. มาเป็นแรงช่วย</b> — มาที่ <b>เต็นท์ป้ายรถเมล์หน้าหมู่บ้าน</b> 11:00–17:00 บอกว่า “มาช่วยอาสา”
                  {unmanned.length > 0 && (
                    <span className="block text-sm text-neutral-700">
                      ตอนนี้จุดลงของที่ยังไม่มีคนประจำ: <b>{unmanned.map((g) => `${g.label} (${pointOf(g.id)?.place || placeOf(g)})`).join(" · ")}</b>
                    </span>
                  )}
                </li>
                {d.boats.need_driver > 0 && (
                  <li>
                    <b>2. ขับ / พายเรือเป็น?</b> — มีเรือ {d.boats.need_driver} ลำที่ยังไม่มีคนขับ แจ้งที่เต็นท์หน้าหมู่บ้าน
                  </li>
                )}
                <li>
                  <b>{d.boats.need_driver > 0 ? 3 : 2}. บ้านใกล้กัน ช่วยถือของไปฝากเพื่อนบ้าน</b> — ถ้าคุณเดินมารับของได้ ถือไปให้บ้านข้างๆ ที่ออกมาไม่ได้ (คนแก่ / คนป่วย)
                </li>
                <li>
                  <b>{d.boats.need_driver > 0 ? 4 : 3}. บริจาคของที่ทีมขาด</b> — ดูรายการด้านล่าง นำมาส่งที่เต็นท์หน้าหมู่บ้าน
                </li>
              </ol>
            </section>

            {d.supplies.length > 0 && (
              <section className="rounded-2xl bg-white p-4 shadow">
                <p className="text-lg font-black">🛒 สิ่งที่ทีมอาสายังขาด</p>
                <ul className="mt-2 space-y-1">
                  {d.supplies.map((s) => (
                    <li key={s} className="rounded-lg bg-amber-50 px-3 py-2 font-semibold">
                      • {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-2xl bg-white p-4 shadow">
              <p className="text-lg font-black">📍 แต่ละโซนไปถึงไหนแล้ว</p>
              <p className="text-sm text-neutral-600">สีเขียว = ส่งของถึงแล้ว (24 ชม.) · สีส้ม = กำลังไป · สีเทา = ยังรอ</p>
              <div className="mt-3 space-y-3">
                {groups.map((g) => {
                  const n = g.ids.reduce(
                    (a, id) => {
                      const o = d.zones[id] || {};
                      return { open: a.open + (o.open || 0), helping: a.helping + (o.helping || 0), done: a.done + (o.done_24h || 0) };
                    },
                    { open: 0, helping: 0, done: 0 }
                  );
                  const all = n.open + n.helping + n.done || 1;
                  const pt = pointOf(g.id);
                  return (
                    <div key={g.id}>
                      <div className="flex items-baseline gap-2">
                        <span className="rounded px-2 font-black text-white" style={{ background: g.color }}>
                          {g.label}
                        </span>
                        <span className="text-sm text-neutral-700">ซอย {g.sois[0]}–{g.sois[g.sois.length - 1]}</span>
                        <span className="ml-auto text-sm">
                          ✅ {n.done} · 🚶 {n.helping} · ⏳ {n.open}
                        </span>
                      </div>
                      <div className="mt-1 flex h-4 overflow-hidden rounded-full bg-neutral-200">
                        <div className="bg-green-500" style={{ width: `${(n.done / all) * 100}%` }} />
                        <div className="bg-orange-400" style={{ width: `${(n.helping / all) * 100}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs text-neutral-600">
                        🚚 จุดลงของ: {pt?.place || placeOf(g)} {pt?.manned ? "· ✅ มีอาสาประจำ" : "· 🙋 ยังไม่มีคนประจำ"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {d.activity.length > 0 && (
              <section className="rounded-2xl bg-white p-4 shadow">
                <p className="text-lg font-black">⏱️ ความเคลื่อนไหวล่าสุดของทีม</p>
                <ul className="mt-2 divide-y">
                  {feed.slice(0, 12).map((a, i) => {
                    const [e, t] = ACT[a.kind] || ACT.other;
                    return (
                      <li key={i} className="flex items-center gap-2 py-1.5 text-[15px]">
                        <span className="w-6 text-center">{e}</span>
                        <span className="flex-1">
                          {t}
                          {a.n > 1 && <b> × {a.n}{a.kind === "delivered" || a.kind === "on_the_way" ? " บ้าน" : " ครั้ง"}</b>}
                          {a.zone !== "?" && <span className="text-neutral-600"> · โซน {a.label}</span>}
                        </span>
                        <span className="text-xs text-neutral-500">{timeAgo(a.at)}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            <button onClick={share} className="min-h-[52px] w-full rounded-2xl bg-green-600 text-lg font-bold text-white shadow">
              {copied ? "✅ คัดลอกแล้ว ไปวางใน LINE" : "📤 แชร์หน้านี้ให้เพื่อนบ้าน"}
            </button>
            <p className="text-center text-sm text-neutral-600">
              ต้องการความช่วยเหลือ? แจ้งที่ <a href="/" className="font-semibold underline">หน้าหลัก serithai57.com</a> · แผนที่โซน <a href="/zones" className="font-semibold underline">/zones</a>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
