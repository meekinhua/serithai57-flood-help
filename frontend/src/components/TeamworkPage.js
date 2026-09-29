import { useEffect, useState } from "react";
import { api } from "../api";
import { timeAgo } from "../config";
import { HAZ } from "./OpsPage";
import { placeOf, zoneGroups } from "./ZonesPage";

// /teamwork — the /hq picture for everyone in the village (share it in the village LINE group), read only:
// the same tiles and zone cards, so residents see how hard the teams work and may come and help.
// Nothing personal: the backend sends counts and roles only (no house numbers, names, phones,
// boat locations, or the internal board).

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

function Tile({ n, label, tone = "bg-white" }) {
  return (
    <div className={`rounded-xl p-2 text-center shadow ${tone}`}>
      <p className="text-3xl font-black leading-none">{n}</p>
      <p className="mt-1 text-xs font-semibold">{label}</p>
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

  const T = d?.totals;
  async function share() {
    const text = `ทีมอาสาหมู่บ้านลุยน้ำแจกของทุกวัน ส่งถึงบ้านแล้ว ${T?.done_24h ?? ""} บ้านใน 24 ชม. ยังรออีก ${T ? T.open + T.helping : ""} บ้าน — ดูว่าทีมขาดอะไร / มาช่วยได้อย่างไร: ${window.location.origin}/teamwork`;
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
  const pointOf = (id) => (d?.points || []).find((p) => p.zone === id);
  const unmanned = groups.filter((g) => !pointOf(g.id)?.manned);
  // the feed: same thing in the same block within 15 minutes = one line "× N"
  const feed = [];
  for (const a of d?.activity || []) {
    const g = groups.find((x) => x.ids.includes(a.zone));
    const key = `${a.kind}|${g?.id || a.zone}`;
    const last = feed[feed.length - 1];
    if (last && last.key === key && new Date(last.first) - new Date(a.at) < 15 * 60000) last.n += 1;
    else feed.push({ ...a, key, gid: g?.id, label: g?.label || a.zone, first: a.at, n: 1 });
  }
  const roleCount = {};
  for (const r of d?.roles || []) roleCount[r] = (roleCount[r] || 0) + 1;

  return (
    <div className="min-h-screen bg-neutral-100 pb-10">
      <header className="bg-black px-3 py-3 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <div className="min-w-[12rem] flex-1">
            <h1 className="text-xl font-black">💪 ทีมอาสาหมู่บ้าน กำลังลุยอยู่</h1>
            <p className="text-sm text-neutral-300">{d ? `อัปเดต ${timeAgo(d.updated_at)} · รีเฟรชเองทุก 1 นาที` : "กำลังโหลด…"}</p>
          </div>
          <button onClick={share} className="min-h-[44px] rounded-lg bg-green-600 px-3 text-sm font-bold">
            {copied ? "✅ คัดลอกแล้ว" : "📤 แชร์ให้เพื่อนบ้าน"}
          </button>
          <a href="/zones" className="min-h-[44px] rounded-lg bg-white/15 px-3 py-2.5 text-sm">🗺️ โซน</a>
          <a href="/" className="min-h-[44px] rounded-lg bg-white/15 px-3 py-2.5 text-sm">🏠</a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-3 px-3 py-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        <p className="rounded-xl bg-sky-50 p-3 text-[15px] leading-relaxed">
          อาสาคือเพื่อนบ้านเราเอง เดินลุยน้ำแจกข้าว น้ำ ยา ถึงหน้าบ้านทุกวัน 11:00–17:00 หลายคนเริ่ม<b>เท้าเปื่อย</b> บางคน<b>ป่วยจากการแช่น้ำ</b> แต่ยังมีบ้านที่รออยู่ — ถ้าพอมีแรง มาช่วยกันนะครับ
          <span className="block text-xs text-neutral-500">ข้อมูลส่วนตัว (บ้านเลขที่ ชื่อ เบอร์โทร) ไม่แสดงในหน้านี้</span>
        </p>

        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Tile n={T ? T.open : "…"} label="🆘 บ้านที่ยังรอ" tone={T?.open ? "bg-neutral-800 text-white" : "bg-white"} />
          <Tile n={T ? T.urgent : "…"} label="🔴 ด่วน (คนแก่/ป่วย)" tone={T?.urgent ? "bg-red-600 text-white" : "bg-white"} />
          <Tile n={T ? T.helping : "…"} label="🚶 อาสากำลังไป" />
          <Tile n={T ? T.done_24h : "…"} label="📦 ส่งถึงแล้ว 24 ชม." tone="bg-green-600 text-white" />
          <Tile n={d ? d.volunteers || "—" : "…"} label="🙋 อาสาในทีม" />
          <Tile n={d ? d.boats.total : "…"} label={`🚤 เรือ${d?.boats.need_driver ? ` · ขาดคนขับ ${d.boats.need_driver}` : ""}`} tone={d?.boats.need_driver ? "bg-yellow-100" : "bg-white"} />
        </section>

        {d?.hazards.length > 0 && (
          <div className="rounded-xl bg-red-600 p-3 font-semibold text-white shadow">
            <p className="font-black">⚠️ ระวัง! จุดอันตราย</p>
            {d.hazards.map((h, i) => (
              <span key={i} className="block">
                {(HAZ[h.kind] || HAZ.other)[0]} {(HAZ[h.kind] || HAZ.other)[1]}
                {h.soi && ` ซ.${h.soi}`}
                {h.note && ` — ${h.note}`}
              </span>
            ))}
          </div>
        )}

        {d && (
          <section className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3">
              <p className="font-bold">🙏 อยากช่วย? ทำได้ทันที</p>
              <p className="text-sm">
                • มาที่ <b>เต็นท์ป้ายรถเมล์หน้าหมู่บ้าน</b> 11:00–17:00 บอกว่า “มาช่วยอาสา”
              </p>
              {unmanned.length > 0 && (
                <p className="text-sm">
                  • จุดลงของที่ยังไม่มีคนประจำ: <b>{unmanned.map((g) => g.label).join(", ")}</b>
                </p>
              )}
              {d.boats.need_driver > 0 && <p className="text-sm">• ขับ / พายเรือเป็น? มีเรือ {d.boats.need_driver} ลำรอคนขับ</p>}
              <p className="text-sm">• เดินมารับของได้ ช่วยถือไปฝากบ้านข้างๆ ที่ออกมาไม่ได้</p>
              <p className="text-sm">• บริจาคของที่ทีมขาด ส่งที่เต็นท์หน้าหมู่บ้าน</p>
            </div>
            <div className="rounded-xl border-2 border-orange-400 bg-orange-50 p-3">
              <p className="font-bold">🛒 ทีมขาด</p>
              {d.supplies.length ? (
                d.supplies.map((s) => (
                  <p key={s} className="text-sm">
                    • {s}
                  </p>
                ))
              ) : (
                <p className="text-sm text-neutral-600">ตอนนี้ยังไม่มีรายการ</p>
              )}
            </div>
          </section>
        )}

        {/* zones: the same cards as /hq, without names or phones */}
        <section>
          <h2 className="mb-2 text-lg font-black">📍 แต่ละโซน</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(d ? groups : []).map((g) => {
              const n = g.ids.reduce(
                (a, id) => {
                  const o = d.zones[id] || {};
                  return { open: a.open + (o.open || 0), helping: a.helping + (o.helping || 0), done: a.done + (o.done_24h || 0), urgent: a.urgent + (o.urgent || 0) };
                },
                { open: 0, helping: 0, done: 0, urgent: 0 }
              );
              const all = n.open + n.helping + n.done || 1;
              const pt = pointOf(g.id);
              const last = feed.find((a) => a.gid === g.id);
              return (
                <div key={g.id} className="rounded-xl border-l-8 bg-white p-3 shadow" style={{ borderColor: g.color }}>
                  <div className="flex items-center gap-2">
                    <span className={`flex h-10 shrink-0 items-center justify-center rounded-full font-black text-white ${g.ids.length > 1 ? "px-2 text-sm" : "w-10 text-xl"}`} style={{ background: g.color }}>
                      {g.label}
                    </span>
                    <div className="grid flex-1 grid-cols-4 gap-1 text-center text-xs">
                      <span className={`rounded py-1 ${n.open ? "bg-neutral-800 text-white" : "bg-neutral-100"}`}>
                        <b className="block text-lg leading-none">{n.open}</b>รอ
                      </span>
                      <span className={`rounded py-1 ${n.urgent ? "bg-red-600 text-white" : "bg-neutral-100"}`}>
                        <b className="block text-lg leading-none">{n.urgent}</b>ด่วน
                      </span>
                      <span className="rounded bg-blue-50 py-1">
                        <b className="block text-lg leading-none">{n.helping}</b>กำลังไป
                      </span>
                      <span className="rounded bg-green-50 py-1">
                        <b className="block text-lg leading-none">{n.done}</b>ส่งแล้ว
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-neutral-200">
                    <div className="bg-green-500" style={{ width: `${(n.done / all) * 100}%` }} />
                    <div className="bg-blue-400" style={{ width: `${(n.helping / all) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-sm font-semibold">🚚 {pt?.place || placeOf(g)}</p>
                  <p className="text-sm">{pt?.manned ? "✅ มีอาสาประจำจุด" : <span className="font-semibold text-amber-700">🙋 ยังไม่มีคนประจำจุด — มาช่วยได้</span>}</p>
                  <p className="text-xs text-neutral-500">
                    ซอย {g.sois[0]}–{g.sois[g.sois.length - 1]} · {last ? `${(ACT[last.kind] || ACT.other)[0]} ${(ACT[last.kind] || ACT.other)[1]} · ${timeAgo(last.at)}` : "ยังไม่มีความเคลื่อนไหว 24 ชม."}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {feed.length > 0 && (
          <details open className="rounded-xl bg-white shadow">
            <summary className="cursor-pointer select-none p-3 text-lg font-bold">⏱️ ความเคลื่อนไหวล่าสุดของทีม</summary>
            <ul className="divide-y border-t px-3">
              {feed.slice(0, 12).map((a, i) => {
                const [e, t] = ACT[a.kind] || ACT.other;
                return (
                  <li key={i} className="flex items-center gap-2 py-1.5 text-[15px]">
                    <span className="w-6 text-center">{e}</span>
                    <span className="flex-1">
                      {t}
                      {a.n > 1 && (
                        <b>
                          {" "}
                          × {a.n}
                          {a.kind === "delivered" || a.kind === "on_the_way" ? " บ้าน" : " ครั้ง"}
                        </b>
                      )}
                      {a.zone !== "?" && <span className="text-neutral-600"> · โซน {a.label}</span>}
                    </span>
                    <span className="text-xs text-neutral-500">{timeAgo(a.at)}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        )}

        {d?.volunteers > 0 && (
          <details className="rounded-xl bg-white shadow">
            <summary className="cursor-pointer select-none p-3 text-lg font-bold">🙋 ทีมอาสา {d.volunteers} คน ทำอะไรกันบ้าง</summary>
            <ul className="space-y-1 border-t p-3 text-sm">
              {Object.entries(roleCount).map(([r, c]) => (
                <li key={r}>
                  • {r}
                  {c > 1 && <b> × {c}</b>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <p className="text-center text-sm text-neutral-600">
          ต้องการความช่วยเหลือ? แจ้งที่{" "}
          <a href="/" className="font-semibold underline">
            หน้าหลัก serithai57.com
          </a>
        </p>
      </main>
    </div>
  );
}
