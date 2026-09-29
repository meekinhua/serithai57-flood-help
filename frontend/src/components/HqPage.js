import { useEffect, useMemo, useState } from "react";
import { api, useTeamKey } from "../api";
import { timeAgo } from "../config";
import { Board, Boats, HAZ, Hazards, NEEDS, PointCard, Roster, summaryText } from "./OpsPage";
import { NoKey } from "./TeamPage";
import { placeOf } from "./ZonesPage";

// /hq#k=… — the team's one-screen picture: cases per zone, drop points, hazards, open questions,
// what the team is short of, boats, volunteers. Everything editable in place; the LINE sweep
// (done centrally) writes into the same data.

const ACTION = { boat: "🚤", truck_drop: "🚛", food: "🍱", water: "💧", evacuate: "🚣", medical: "🩺", need: "⚠️", other: "📝" };

function Tile({ n, label, tone = "bg-white", onClick }) {
  return (
    <button onClick={onClick} className={`rounded-xl p-2 text-center shadow ${tone}`}>
      <p className="text-3xl font-black leading-none">{n}</p>
      <p className="mt-1 text-xs font-semibold">{label}</p>
    </button>
  );
}

function Fold({ id, title, children, open = false }) {
  return (
    <details id={id} open={open} className="scroll-mt-4 rounded-xl bg-white shadow">
      <summary className="cursor-pointer select-none p-3 text-lg font-bold">{title}</summary>
      <div className="border-t p-3">{children}</div>
    </details>
  );
}

export default function HqPage() {
  const key = useTeamKey();
  const [zones, setZones] = useState(null);
  const [board, setBoard] = useState(null);
  const [cases, setCases] = useState([]);
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editZone, setEditZone] = useState(null);

  const reload = () =>
    Promise.all([api("/ops"), api("/team/cases"), api("/zones/log").catch(() => [])])
      .then(([b, c, l]) => {
        setBoard({ notes: [], people: [], ...b });
        setCases(c);
        setLog(l);
        setUpdated(new Date());
        setError("");
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    api("/zones")
      .then((d) => setZones(d.zones))
      .catch((e) => setError(e.message));
    if (!key) return;
    reload();
    const t = setInterval(() => document.visibilityState === "visible" && reload(), 30000);
    return () => clearInterval(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const perZone = useMemo(() => {
    const out = {};
    for (const c of cases) {
      const z = c.zone || "?";
      const o = (out[z] = out[z] || { open: 0, helping: 0, done: 0, urgent: 0 });
      o[c.status === "done" ? "done" : c.status === "helping" ? "helping" : "open"] += 1;
      if (c.urgent && c.status !== "done") o.urgent += 1;
    }
    return out;
  }, [cases]);
  const total = useMemo(() => Object.values(perZone).reduce((a, o) => ({ open: a.open + o.open, helping: a.helping + o.helping, done: a.done + o.done, urgent: a.urgent + o.urgent }), { open: 0, helping: 0, done: 0, urgent: 0 }), [perZone]);

  if (!key) return <NoKey />;
  const b = board || { points: {}, hazards: [], boats: [], notes: [], people: [] };
  const liveHaz = b.hazards.filter((h) => !h.cleared_at);
  const openQ = b.notes.filter((n) => n.kind === "question" && !n.done);
  const short = b.notes.filter((n) => n.kind === "supply" && !n.done);
  const go = (id) => {
    const el = document.getElementById(id);
    if (el?.tagName === "DETAILS") el.open = true;
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  async function copy() {
    const text = summaryText(zones || [], b);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("คัดลอกข้อความนี้", text);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100 pb-10">
      <header className="bg-black px-3 py-3 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
          <div className="min-w-[10rem] flex-1">
            <h1 className="text-xl font-black">🧭 ศูนย์ทีมงาน</h1>
            <p className="text-sm text-neutral-300">{updated ? `อัปเดต ${updated.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} · รีเฟรชเองทุก 30 วิ` : "กำลังโหลด…"}</p>
          </div>
          <button onClick={copy} className="min-h-[44px] rounded-lg bg-green-600 px-3 text-sm font-bold">
            {copied ? "✅ คัดลอกแล้ว" : "📋 สรุปส่ง LINE"}
          </button>
          <button onClick={() => go("people")} className="min-h-[44px] rounded-lg bg-white/15 px-3 text-sm font-semibold">📞 รายชื่อ</button>
          <a href="/team" className="min-h-[44px] rounded-lg bg-white/15 px-3 py-2.5 text-sm font-semibold">🚶 หน้าทีมแจก</a>
          <a href="/zones" className="min-h-[44px] rounded-lg bg-white/15 px-3 py-2.5 text-sm">🗺️</a>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-3 px-3 py-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}

        {/* the numbers that matter, each one jumps to its section */}
        <section className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          <Tile n={updated ? total.open : "…"} label="🆘 เคสยังไม่มีคนไป" onClick={() => go("zones")} />
          <Tile n={updated ? total.urgent : "…"} label="🔴 ด่วน" tone={total.urgent ? "bg-red-600 text-white" : "bg-white"} onClick={() => go("zones")} />
          <Tile n={updated ? total.helping : "…"} label="🚶 กำลังไป" onClick={() => go("zones")} />
          <Tile n={updated ? liveHaz.length : "…"} label="⚠️ อันตราย" tone={liveHaz.length ? "bg-red-100" : "bg-white"} onClick={() => go("hazards")} />
          <Tile n={updated ? openQ.length : "…"} label="❓ รอสรุป" tone={openQ.length ? "bg-yellow-100" : "bg-white"} onClick={() => go("board")} />
          <Tile n={updated ? short.length : "…"} label="🛒 ทีมขาด" tone={short.length ? "bg-yellow-100" : "bg-white"} onClick={() => go("board")} />
        </section>

        {liveHaz.length > 0 && (
          <button onClick={() => go("hazards")} className="block w-full rounded-xl bg-red-600 p-3 text-left font-semibold text-white shadow">
            {liveHaz.map((h) => (
              <span key={h.id} className="block">
                {(HAZ[h.kind] || HAZ.other)[0]} {(HAZ[h.kind] || HAZ.other)[1]}
                {h.soi && ` ซ.${h.soi}`}
                {h.note && ` — ${h.note}`}
              </span>
            ))}
          </button>
        )}

        {(openQ.length > 0 || short.length > 0) && (
          <section className="grid gap-2 sm:grid-cols-2">
            {openQ.length > 0 && (
              <button onClick={() => go("board")} className="rounded-xl border-2 border-yellow-400 bg-yellow-50 p-3 text-left">
                <p className="font-bold">❓ รอสรุป</p>
                {openQ.slice(0, 5).map((n) => (
                  <p key={n.id} className="text-sm">
                    • {n.text}
                    {n.for_who && <span className="text-neutral-600"> ({n.for_who})</span>}
                  </p>
                ))}
              </button>
            )}
            {short.length > 0 && (
              <button onClick={() => go("board")} className="rounded-xl border-2 border-orange-400 bg-orange-50 p-3 text-left">
                <p className="font-bold">🛒 ทีมขาด</p>
                {short.slice(0, 5).map((n) => (
                  <p key={n.id} className="text-sm">
                    • {n.text}
                    {n.detail && <span className="text-neutral-600"> — {n.detail}</span>}
                  </p>
                ))}
              </button>
            )}
          </section>
        )}

        {/* zones: cases + drop point + last activity */}
        <section id="zones" className="scroll-mt-4">
          <h2 className="mb-2 text-lg font-black">📍 โซน A–I</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(updated ? zones || [] : []).map((z) => {
              const n = perZone[z.id] || { open: 0, helping: 0, done: 0, urgent: 0 };
              const p = b.points[z.id] || {};
              const shared = (z.drop.shared || [z.id])[0];
              const pp = shared !== z.id ? b.points[shared] || {} : p; // G, H: the person is at F's point
              const here = !!pp.person && pp.manned !== false;
              const last = log.find((e) => e.zone === z.id);
              return (
                <div key={z.id} className="rounded-xl border-l-8 bg-white p-3 shadow" style={{ borderColor: z.color }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl font-black text-white" style={{ background: z.color }}>
                      {z.id}
                    </span>
                    <div className="grid flex-1 grid-cols-4 gap-1 text-center text-xs">
                      <span className={`rounded py-1 ${n.open ? "bg-neutral-800 text-white" : "bg-neutral-100"}`}>
                        <b className="block text-lg leading-none">{n.open}</b>ค้าง
                      </span>
                      <span className={`rounded py-1 ${n.urgent ? "bg-red-600 text-white" : "bg-neutral-100"}`}>
                        <b className="block text-lg leading-none">{n.urgent}</b>ด่วน
                      </span>
                      <span className="rounded bg-blue-50 py-1">
                        <b className="block text-lg leading-none">{n.helping}</b>กำลังไป
                      </span>
                      <span className="rounded bg-green-50 py-1">
                        <b className="block text-lg leading-none">{n.done}</b>เสร็จ
                      </span>
                    </div>
                  </div>
                  <p className="mt-2 text-sm font-semibold">🚚 {p.place || pp.place || placeOf(z)}</p>
                  <p className="text-sm">
                    {pp.person ? (
                      <>
                        {here ? "✅" : "❌"} {pp.person}{" "}
                        {pp.phone && (
                          <a href={`tel:${pp.phone.replace(/[^0-9+]/g, "")}`} className="font-bold text-green-700 underline">
                            {pp.phone}
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="font-semibold text-amber-700">🙋 ยังไม่มีคนประจำจุด</span>
                    )}
                  </p>
                  {p.needs?.length > 0 && <p className="text-sm text-red-700">ขาด: {p.needs.map((k) => NEEDS[k]).join(" ")}</p>}
                  <p className="text-xs text-neutral-500">
                    {last ? `${ACTION[last.kind] || "📝"} ${last.note || ""} · ${timeAgo(last.at)} (${last.name})` : "ยังไม่มีบันทึกว่าเข้าไปทำอะไร"}
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <a href={`/team#zone=${z.id}`} className="flex min-h-[40px] items-center justify-center rounded-lg bg-black text-sm font-bold text-white">
                      📋 ดูเคสโซน {z.id}
                    </a>
                    <button onClick={() => setEditZone(editZone === z.id ? null : z.id)} className="min-h-[40px] rounded-lg border border-neutral-300 text-sm">
                      ✏️ จุดลงของ
                    </button>
                  </div>
                  {editZone === z.id && (
                    <div className="mt-2">
                      <PointCard zone={z} p={b.points[z.id]} onSaved={reload} />
                    </div>
                  )}
                </div>
              );
            })}
            {perZone["?"] && (
              <a href="/team#zone=?" className="rounded-xl bg-white p-3 shadow">
                <p className="font-bold">❔ เคสที่ยังไม่รู้โซน</p>
                <p className="text-sm">
                  ค้าง {perZone["?"].open} · ด่วน {perZone["?"].urgent} — แตะเพื่อดู (ช่วยใส่ซอยจะเข้าโซนเอง)
                </p>
              </a>
            )}
          </div>
        </section>

        <div id="board" className="scroll-mt-4">
          <h2 className="mb-2 text-lg font-black">📌 บอร์ด</h2>
          <Board notes={b.notes} onChange={reload} />
        </div>
        <Fold id="hazards" title={`⚠️ จุดอันตราย (${liveHaz.length})`} open={liveHaz.length > 0}>
          <Hazards hazards={b.hazards} onChange={reload} />
        </Fold>
        <Fold id="boats" title={`🚤 เรือ / อุปกรณ์ (${b.boats.length})`}>
          <Boats boats={b.boats} onChange={reload} />
        </Fold>
        <Fold id="people" title={`📞 รายชื่อ + เบอร์ (${b.people.length})`} open>
          <Roster people={b.people} insider onChange={reload} />
        </Fold>
        <p className="text-xs text-neutral-500">🔒 หน้านี้เปิดได้เฉพาะคนที่มีลิงก์ทีม · อย่าโพสต์ลิงก์ในกลุ่มสาธารณะ · ถ้าลิงก์หลุด ผู้ดูแลกด “เปลี่ยนลิงก์ทีม” ในหน้า /staff</p>
      </main>
    </div>
  );
}
