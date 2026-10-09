// Worklist for the electricians who check flooded houses (5–7 Oct 2026).
// Opened with the private link /tech#tk=<key> (it shows residents' phone numbers). Each technician types a name once;
// "รับงาน" / "เสร็จ" / "ไม่อยู่บ้าน" are recorded with that name and the time, so several technicians can split the
// village by zone, walk soi by soi, and the team can see how many houses are done.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { createBaseMap } from "./MapView";
import { drawTeams } from "./teamMarkers";

const SURVEY = "electric";
const STATUS = {
  todo: { label: "ยังไม่ตรวจ", color: "#dc2626", chip: "bg-red-100 text-red-800" },
  claimed: { label: "รับงานแล้ว", color: "#f59e0b", chip: "bg-amber-100 text-amber-900" },
  done: { label: "ตรวจเสร็จ", color: "#16a34a", chip: "bg-emerald-100 text-emerald-900" },
  absent: { label: "ไม่อยู่บ้าน", color: "#6b7280", chip: "bg-neutral-200 text-neutral-800" },
  again: { label: "ต้องกลับมาอีก", color: "#7c3aed", chip: "bg-violet-100 text-violet-900" },
};
// signs of a live fault: these houses go first
const URGENT = /ร้อน|ไหม้|ช็อต|ช๊อต|ไฟดูด|ไฟรั่ว|ไม่มีไฟ|ยกไม่ขึ้น|on breaker ไม่ได้|ประกาย|ควัน/;

function techKey() {
  const m = window.location.hash.match(/[#&]tk=([A-Za-z0-9_-]{12,})/);
  if (m) {
    save("techKey", m[1]);
    window.history.replaceState(null, "", window.location.pathname);
  }
  return load("techKey", "");
}

function tapi(path, options = {}) {
  const name = load("techName", "");
  return api(path, { ...options, headers: { "X-Tech-Key": load("techKey", ""), ...(name ? { "X-Tech-Name": encodeURIComponent(name.slice(0, 40)) } : {}), ...options.headers } });
}

const statusOf = (r) => r.job?.status || "todo";
const mainSoi = (soi) => (String(soi || "").match(/\d+/) || [""])[0];
const isUrgent = (r) => URGENT.test(`${(r.picks || []).join(" ")} ${r.note || ""}`) || (r.picks || []).includes("ไฟรั่ว / ไฟดูด");
const time = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");

// 10 Oct 2026: two teams the same day (military electricians + Q ช่าง). Each team sees the houses that asked for it,
// with its own status; the first team keeps the original `job`, the others `jobs.<team>`.
const TEAMS = [
  ["army", "🪖 ทีมช่างทหาร"],
  ["q", "🔧 ทีม Q ช่าง"],
];

// ---------- 📊 sign-up report (9 Oct): this round's confirmations, new vs re-confirmed, by team; older ones still waiting ----------
const DONE_ST = ["done", "absent", "fine"];
export function segOf(r, round) {
  if (round && r.round === round) {
    const fresh = r.created_at && r.confirmed_at && new Date(r.confirmed_at) - new Date(r.created_at) < 5 * 60e3; // first sign-up was this confirmation
    return fresh ? "new" : "re";
  }
  const st = r.job?.status || "todo";
  return DONE_ST.includes(st) || ["fine", "hired"].includes(r.followup?.want) ? "olddone" : "pending";
}
function split(list) {
  const t = (r) => r.teams || [];
  return {
    army: list.filter((r) => t(r).includes("army") && !t(r).includes("q")).length,
    q: list.filter((r) => t(r).includes("q") && !t(r).includes("army")).length,
    both: list.filter((r) => t(r).includes("army") && t(r).includes("q")).length,
  };
}
function SignupReport({ all, list, teamLabel, seg, onSeg }) {
  const [open, setOpen] = useState(() => load("techReportOpen", true));
  const round = all.reduce((m, r) => (r.round && r.round > m ? r.round : m), "");
  const by = { new: [], re: [], pending: [], olddone: [] };
  for (const r of list) by[segOf(r, round)].push(r); // this team's houses
  const allConf = all.filter((r) => round && r.round === round);
  const today = new Date().toDateString();
  const todayN = allConf.filter((r) => r.confirmed_at && new Date(r.confirmed_at).toDateString() === today).length;
  const tot = split(allConf);
  const armyAll = tot.army + tot.both;
  const qAll = tot.q + tot.both;
  const Row = ({ k, icon, label, list, tone }) => {
    const sp = split(list);
    return (
      <button
        onClick={() => onSeg(seg === k ? "" : k)}
        aria-pressed={seg === k}
        className={`flex w-full items-center gap-2 rounded-xl border-2 p-2 text-left ${seg === k ? "border-black bg-amber-50" : "border-transparent bg-neutral-50"}`}
      >
        <span className="text-xl" aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] leading-tight">{label}</b>
          {(k === "new" || k === "re") && (
            <span className="block text-xs text-neutral-600">
              🪖 ทหาร {sp.army} · 🔧 Q {sp.q} · ทั้ง 2 ทีม {sp.both}
            </span>
          )}
        </span>
        <b className={`shrink-0 text-2xl ${tone}`}>{list.length}</b>
      </button>
    );
  };
  return (
    <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
      <button
        onClick={() => {
          setOpen(!open);
          save("techReportOpen", !open);
        }}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <b className="min-w-0 flex-1 text-lg">📊 ยอดลงทะเบียน{round ? ` รอบ ${round.slice(8)}/${round.slice(5, 7)}` : ""}</b>
        <span className="text-sm text-neutral-600">
          ยืนยันแล้ว {allConf.length} หลัง{todayN ? ` · วันนี้ +${todayN}` : ""} {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5 text-center">
            <div className="rounded-xl bg-[#E4F0E9] p-2">
              <b className="block text-2xl">{armyAll}</b>
              <span className="text-xs">🪖 ทีมทหาร (รวมขอทั้ง 2 ทีม)</span>
            </div>
            <div className="rounded-xl bg-[#E3EDF9] p-2">
              <b className="block text-2xl">{qAll}</b>
              <span className="text-xs">🔧 ทีม Q ช่าง (รวมขอทั้ง 2 ทีม)</span>
            </div>
          </div>
          <p className="pt-1 text-sm font-bold text-neutral-700">{teamLabel} · แยกกลุ่ม</p>
          <Row k="new" icon="🆕" label="ลงใหม่ รอบนี้" list={by.new} tone="text-emerald-700" />
          <Row k="re" icon="🔁" label="ลงซ้ำ ยืนยันจากรอบก่อน" list={by.re} tone="text-emerald-700" />
          <Row k="pending" icon="⏳" label="รอบก่อน ยังค้าง · ยังไม่ยืนยันรอบนี้" list={by.pending} tone="text-amber-700" />
          <Row k="olddone" icon="✅" label="รอบก่อน เสร็จแล้ว / ไม่ต้องแล้ว" list={by.olddone} tone="text-neutral-500" />
          <p className="text-xs text-neutral-500">แตะแถวเพื่อดูรายชื่อบ้านกลุ่มนั้นด้านล่าง · แตะอีกครั้งเพื่อเลิกกรอง</p>
        </div>
      )}
    </section>
  );
}

export default function TechPage() {
  const [key] = useState(techKey);
  const [team, setTeam] = useState(() => load("techTeam", ""));
  const [all, setAll] = useState(null);
  const [me, setMe] = useState(() => load("techName", ""));
  const [nameDraft, setNameDraft] = useState(me);
  // this team's view: its houses, its own job as `job` (so the rest of the page is unchanged)
  const rows = useMemo(() => {
    if (!all) return null;
    if (!team) return all;
    const asked = (r) => (r.teams || []).includes(team);
    return all
      .filter((r) => asked(r) || (team === "army" && !(r.teams || []).length))
      .map((r) => ({ ...r, job: team === "army" ? r.job : r.jobs?.[team], confirmed: asked(r) }))
      .sort((a, b) => b.confirmed - a.confirmed);
  }, [all, team]);
  const setRows = (fn) => setAll((rs) => fn(rs));
  const [zones, setZones] = useState(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState(() => load("techShow", "open")); // open | mine | done | all
  const [zone, setZone] = useState(() => load("techZone", ""));
  const [soi, setSoi] = useState("");
  const [seg, setSeg] = useState(""); // a report row picked: only those houses below
  const [busy, setBusy] = useState("");

  useEffect(() => {
    document.title = "งานช่างไฟ · เสรีไทย 57";
    api("/zones")
      .then(setZones)
      .catch(() => {});
  }, []);

  const refresh = () =>
    tapi(`/tech/${SURVEY}/jobs`)
      .then((r) => {
        setAll(r);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    if (!key) return;
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const soiZone = zones?.soi_zone || {};
  const zoneOf = (r) => soiZone[mainSoi(r.soi)] || "?";

  async function setStatus(r, status, note = "") {
    setBusy(r.house);
    try {
      const res = await tapi(`/tech/${SURVEY}/jobs`, { method: "POST", body: JSON.stringify({ house: r.house, status, note, team }) });
      setRows((rs) => rs.map((x) => (x.house !== r.house ? x : team && team !== "army" ? { ...x, jobs: { ...(x.jobs || {}), [team]: res.job } } : { ...x, job: res.job })));
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  }

  const counts = useMemo(() => {
    const c = { all: 0, todo: 0, claimed: 0, done: 0, absent: 0, again: 0 };
    const byTech = {};
    for (const r of rows || []) {
      c.all++;
      c[statusOf(r)]++;
      if (r.job?.tech && r.job.status !== "todo") {
        const t = (byTech[r.job.tech] = byTech[r.job.tech] || { done: 0, open: 0 });
        if (["done", "absent"].includes(r.job.status)) t.done++;
        else t.open++;
      }
    }
    return { c, byTech };
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows || [];
    if (show === "open") list = list.filter((r) => ["todo", "claimed", "again"].includes(statusOf(r)));
    if (show === "mine") list = list.filter((r) => r.job?.tech === me && statusOf(r) !== "todo");
    if (show === "done") list = list.filter((r) => ["done", "absent"].includes(statusOf(r)));
    if (zone) list = list.filter((r) => zoneOf(r) === zone);
    if (soi) list = list.filter((r) => mainSoi(r.soi) === soi);
    if (seg) {
      const round = (all || []).reduce((m, r) => (r.round && r.round > m ? r.round : m), "");
      list = list.filter((r) => segOf(r, round) === seg);
    }
    return list;
  }, [rows, show, zone, soi, me, zones, seg, all]); // eslint-disable-line react-hooks/exhaustive-deps

  // group by zone → soi so a technician walks one soi at a time
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of shown) {
      const k = `${zoneOf(r)}|${mainSoi(r.soi) || r.soi || "?"}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    for (const list of g.values()) list.sort((a, b) => isUrgent(b) - isUrgent(a));
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b, "th", { numeric: true }));
  }, [shown, zones]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key)
    return (
      <Shell>
        <p className="rounded-xl bg-amber-50 p-4">หน้านี้สำหรับทีมช่างเท่านั้น · เปิดจากลิงก์ที่ทีมอาสาส่งให้ครับ</p>
      </Shell>
    );

  if (!me)
    return (
      <Shell>
        <form
          className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = nameDraft.trim();
            if (!n) return;
            save("techName", n);
            setMe(n);
          }}
        >
          <h2 className="text-lg font-bold">ชื่อช่าง / ชื่อทีม</h2>
          <p className="text-sm text-neutral-600">ใส่ครั้งเดียว ใช้บันทึกว่าใครรับงานบ้านไหน (เช่น "ช่างเอก ทีม 1")</p>
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={40}
            className="min-h-[48px] w-full rounded-lg border border-neutral-300 px-3 text-lg"
            placeholder="ชื่อช่าง"
          />
          <button className="min-h-[48px] w-full rounded-xl bg-black font-bold text-white">เริ่มใช้งาน</button>
        </form>
      </Shell>
    );

  if (!team)
    return (
      <Shell>
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-lg font-bold">คุณอยู่ทีมไหน</h2>
          <p className="text-sm text-neutral-600">แต่ละทีมเห็นเฉพาะบ้านที่ขอทีมนั้น และบันทึกสถานะแยกกัน</p>
          {TEAMS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => {
                save("techTeam", k);
                setTeam(k);
              }}
              className="min-h-[56px] w-full rounded-xl border-2 border-black text-lg font-bold"
            >
              {label}
            </button>
          ))}
        </div>
      </Shell>
    );

  const pct = counts.c.all ? Math.round(((counts.c.done + counts.c.absent) / counts.c.all) * 100) : 0;
  return (
    <Shell
      right={
        <span className="flex flex-col items-end gap-1">
          <button
            onClick={() => {
              save("techName", "");
              setNameDraft(me);
              setMe("");
            }}
            title="เปลี่ยนชื่อช่าง"
            className="rounded-full bg-white/15 px-3 py-1 text-sm"
          >
            👷 {me}
          </button>
          <button
            onClick={() => {
              save("techTeam", "");
              setTeam("");
            }}
            title="เปลี่ยนทีม"
            className="rounded-full bg-white/15 px-3 py-0.5 text-xs"
          >
            {(TEAMS.find(([k]) => k === team) || ["", team])[1]} ⇄
          </button>
        </span>
      }
    >
      {err && <p className="mb-2 rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      {!rows ? (
        <p className="p-4 text-center text-neutral-500">กำลังโหลด…</p>
      ) : (
        <>
          {/* 9 Oct: one tab per team, so each team gets its own list (and its own job status) */}
          <div className="sticky top-0 z-20 -mx-1 mb-3 bg-[#f5f3ee]/95 px-1 py-1.5 backdrop-blur">
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm" role="tablist" aria-label="ทีมช่าง">
              {TEAMS.map(([k, label]) => {
                const n = (all || []).filter((r) => (r.teams || []).includes(k) || (k === "army" && !(r.teams || []).length)).length;
                const on = team === k;
                return (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={on}
                    onClick={() => {
                      save("techTeam", k);
                      setTeam(k);
                    }}
                    className={`min-h-[52px] rounded-xl px-1 text-[15px] font-bold leading-tight ${on ? "bg-black text-white" : "text-neutral-700"}`}
                  >
                    {label}
                    <span className={`block text-xs font-normal ${on ? "text-neutral-300" : "text-neutral-500"}`}>{n} หลัง</span>
                  </button>
                );
              })}
            </div>
          </div>
          <SignupReport
            all={all}
            list={rows}
            teamLabel={(TEAMS.find(([k]) => k === team) || ["", ""])[1]}
            seg={seg}
            onSeg={(k) => {
              setSeg(k);
              if (k) {
                setShow("all"); // the picked group, whatever their job status
                save("techShow", "all");
              }
            }}
          />
          <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex items-baseline justify-between">
              <b className="text-lg">
                ตรวจแล้ว {counts.c.done + counts.c.absent} / {counts.c.all} หลัง
              </b>
              <span className="text-sm text-neutral-600">{pct}%</span>
            </div>
            <div className="my-2 h-3 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {Object.entries(STATUS).map(([k, s]) => (
                <span key={k} className={`rounded-full px-2 py-1 font-semibold ${s.chip}`}>
                  {s.label} {counts.c[k]}
                </span>
              ))}
            </div>
            {Object.keys(counts.byTech).length > 0 && (
              <p className="mt-2 text-xs text-neutral-600">
                👷{" "}
                {Object.entries(counts.byTech)
                  .map(([t, n]) => `${t}: เสร็จ ${n.done}${n.open ? ` · ค้าง ${n.open}` : ""}`)
                  .join("  |  ")}
              </p>
            )}
          </section>

          <ZonePicker
            zones={zones}
            rows={rows}
            zone={zone}
            onZone={(z) => {
              setZone(z);
              setSoi("");
              save("techZone", z);
            }}
          />
          <TechMap zones={zones} rows={rows} zone={zone} soi={soi} me={me} onSoi={(s) => setSoi((cur) => (cur === s ? "" : s))} />

          <div className="my-3 space-y-2">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-white p-1 text-sm">
              {[
                ["open", "ยังต้องไป"],
                ["mine", "ของฉัน"],
                ["done", "เสร็จแล้ว"],
                ["all", "ทั้งหมด"],
              ].map(([k, t]) => (
                <button
                  key={k}
                  onClick={() => {
                    setShow(k);
                    save("techShow", k);
                  }}
                  className={`min-h-[40px] rounded-lg font-semibold ${show === k ? "bg-black text-white" : "text-neutral-700"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {soi && (
                <button onClick={() => setSoi("")} className="min-h-[36px] rounded-full bg-amber-200 px-3 text-sm font-bold">
                  ซอย {soi} ✕
                </button>
              )}
              {seg && (
                <button onClick={() => setSeg("")} className="min-h-[36px] rounded-full bg-amber-200 px-3 text-sm font-bold">
                  {{ new: "ลงใหม่", re: "ลงซ้ำ", pending: "รอบก่อนยังค้าง", olddone: "รอบก่อนเสร็จแล้ว" }[seg]} ✕
                </button>
              )}
            </div>
          </div>

          {groups.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-neutral-500">ไม่มีบ้านในรายการนี้</p>}
          {groups.map(([k, list]) => {
            const [z, s] = k.split("|");
            return (
              <section key={k} className="mb-3">
                <h3 className="sticky top-0 z-10 -mx-1 mb-1 bg-[#f5f3ee]/95 px-1 py-1 text-sm font-bold">
                  โซน {z} · ซอย {s} <span className="font-normal text-neutral-500">({list.length} หลัง)</span>
                </h3>
                <div className="space-y-2">
                  {list.map((r) => (
                    <Job key={r.house} r={r} me={me} busy={busy === r.house} onStatus={(st, note) => setStatus(r, st, note)} />
                  ))}
                </div>
              </section>
            );
          })}
          <p className="py-4 text-center text-xs text-neutral-500">อัปเดตเองทุก 30 วินาที · เบอร์โทรในหน้านี้ใช้ติดต่อเจ้าของบ้านเท่านั้น</p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, right }) {
  return (
    <div className="min-h-screen bg-[#f5f3ee] text-neutral-900">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-[#0b1622] px-4 py-3 text-white">
        <div>
          <b>⚡ งานช่างไฟ ตรวจบ้านหลังน้ำท่วม</b>
          <span className="block text-xs text-white/70">หมู่บ้านสหกรณ์เคหะสถาน 4 · เสาร์ 10 ต.ค.</span>
        </div>
        {right}
      </header>
      <main className="mx-auto max-w-2xl px-3 py-3">{children}</main>
    </div>
  );
}

const ASK = {
  done: ["บันทึกสั้นๆ (ถ้ามี) เช่น เปลี่ยนเบรกเกอร์ / ปลอดภัยแล้ว", "✅ ยืนยัน ตรวจเสร็จ", "bg-emerald-600 text-white"],
  absent: ["หมายเหตุ (ถ้ามี) เช่น โทรแล้วไม่รับ", "🚪 ยืนยัน ไม่อยู่บ้าน", "bg-neutral-700 text-white"],
  again: ["ต้องกลับมาทำอะไร (ถ้ามี)", "↩︎ ยืนยัน ต้องกลับมาอีก", "bg-violet-700 text-white"],
};

function Job({ r, me, busy, onStatus }) {
  const [ask, setAsk] = useState(""); // which status is waiting for a note
  const [note, setNote] = useState("");
  const pick = (st) => {
    if (!ASK[st]) return onStatus(st, "");
    setNote(r.job?.note || "");
    setAsk(st);
  };
  const st = statusOf(r);
  const s = STATUS[st];
  const urgent = isUrgent(r) && !["done", "absent"].includes(st);
  const mine = r.job?.tech === me;
  const btn = "min-h-[44px] flex-1 rounded-lg px-2 text-sm font-bold disabled:opacity-50";
  return (
    <article className={`rounded-xl border-l-8 bg-white p-3 shadow-sm ${urgent ? "ring-2 ring-red-500" : ""}`} style={{ borderLeftColor: s.color }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="text-lg">{r.house}</b> <span className="text-neutral-600">ซ.{r.soi || "?"}</span>
          {r.confirmed ? (
            <span className="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-xs font-bold text-white">✅ ยืนยันเสาร์</span>
          ) : (r.teams || []).length === 0 && r.round === undefined ? (
            <span className="ml-1 rounded bg-neutral-200 px-1.5 py-0.5 text-xs font-bold text-neutral-700">รอบก่อน · ยังไม่ยืนยัน</span>
          ) : null}
          {(r.teams || []).length > 1 && <span className="ml-1 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-bold text-blue-900">ขอทั้ง 2 ทีม</span>}
          {urgent && <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">ด่วน</span>}
          <span className="block text-sm">{r.name || "—"}</span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      {r.phone && (
        <a href={`tel:${r.phone}`} className="mt-1 inline-block font-semibold text-blue-700 underline">
          📞 {r.phone.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}
        </a>
      )}
      {(r.picks || []).length > 0 && <p className="mt-1 text-sm">⚠️ {r.picks.join(" · ")}</p>}
      {r.note && <p className="mt-1 whitespace-pre-line break-words text-sm text-neutral-700">📝 {r.note}</p>}
      {r.job?.tech && st !== "todo" && (
        <p className="mt-1 text-xs text-neutral-600">
          👷 {r.job.tech} · {time(r.job.at)}
          {r.job.note ? ` · ${r.job.note}` : ""}
        </p>
      )}
      {ask ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            onStatus(ask, note.trim());
            setAsk("");
          }}
        >
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder={ASK[ask][0]}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
          <div className="flex gap-1">
            <button disabled={busy} className={`${btn} ${ASK[ask][2]}`}>
              {ASK[ask][1]}
            </button>
            <button type="button" onClick={() => setAsk("")} className={`${btn} max-w-[30%] border-2 border-neutral-300`}>
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex gap-1">
          {st === "todo" || st === "again" ? (
            <button disabled={busy} onClick={() => pick("claimed")} className={`${btn} bg-amber-400`}>
              🙋 รับงาน
            </button>
          ) : null}
          {st !== "done" && (
            <button disabled={busy} onClick={() => pick("done")} className={`${btn} bg-emerald-600 text-white`}>
              ✅ ตรวจเสร็จ
            </button>
          )}
          {(st === "claimed" || st === "todo") && (
            <button disabled={busy} onClick={() => pick("absent")} className={`${btn} border-2 border-neutral-400`}>
              🚪 ไม่อยู่
            </button>
          )}
          {(st === "done" || st === "absent") && (
            <button disabled={busy} onClick={() => pick("again")} className={`${btn} border-2 border-violet-500 text-violet-800`}>
              ↩︎ ต้องกลับมาอีก
            </button>
          )}
          {st === "claimed" && mine && (
            <button disabled={busy} onClick={() => pick("todo")} className={`${btn} border-2 border-neutral-300 text-neutral-600`}>
              คืนงาน
            </button>
          )}
        </div>
      )}
    </article>
  );
}

// "ซ.1–6": zones are named A–I on the plans, but technicians know the soi numbers
export function zoneRange(z) {
  const n = (z.sois || []).map((x) => parseInt(x, 10)).filter((x) => !Number.isNaN(x));
  return n.length ? `ซ.${Math.min(...n)}–${Math.max(...n)}` : "";
}

function ZonePicker({ zones, rows, zone, onZone }) {
  if (!zones) return null;
  const open = {};
  for (const r of rows) {
    if (["done", "absent"].includes(statusOf(r))) continue;
    const z = zones.soi_zone[mainSoi(r.soi)] || "?";
    open[z] = (open[z] || 0) + 1;
  }
  const all = Object.values(open).reduce((x, y) => x + y, 0);
  const cell = (on) => `flex min-h-[52px] flex-col items-center justify-center rounded-xl border-2 px-1 text-center leading-tight ${on ? "border-black bg-black text-white" : "bg-white"}`;
  return (
    <div className="mb-2">
      <p className="mb-1 text-sm font-semibold">เลือกโซนที่จะไป (แผนที่และรายการจะเหลือเฉพาะโซนนั้น)</p>
      <div className="grid grid-cols-5 gap-1">
        <button onClick={() => onZone("")} className={cell(zone === "")}>
          <b>ทุกโซน</b>
          <span className="text-[11px]">เหลือ {all}</span>
        </button>
        {zones.zones.map((z) => (
          <button key={z.id} onClick={() => onZone(z.id)} className={cell(zone === z.id)} style={zone === z.id ? undefined : { borderColor: z.color }}>
            <b>
              <span style={{ color: zone === z.id ? "#fff" : z.color }}>●</span> {z.id}
            </b>
            <span className="text-[11px]">{zoneRange(z)}</span>
            <span className="text-[11px] opacity-80">เหลือ {open[z.id] || 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// One circle per soi: the number of houses still to visit; red = still open, green = all done. Tap = show that soi.
function TechMap({ zones, rows, zone, soi, me, onSoi }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const meRef = useRef(null); // GPS dot + accuracy circle
  const teamsRef = useRef(null); // other teams' positions
  const sentRef = useRef(0); // last time this phone shared its position
  const watchRef = useRef(null);
  const [sois, setSois] = useState(null);
  const [gps, setGps] = useState(""); // "" | "wait" | "on" | error text
  useEffect(() => {
    api("/sois")
      .then((d) => setSois(d.sois))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!zones || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomAnimation = false; // removing a map mid-animation crashes Leaflet
    L.polyline(zones.main_road, { color: "#facc15", weight: 5, opacity: 0.9, interactive: false }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    meRef.current = L.layerGroup().addTo(map);
    teamsRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      if (watchRef.current != null) {
        navigator.geolocation?.clearWatch(watchRef.current);
        share({ on: false });
      }
      map.stop();
      map.off();
      map.remove();
    };
  }, [zones]);
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !sois) return;
    layer.clearLayers();
    const zi = zones.zones.findIndex((z) => z.id === zone);
    // every house as a small dot in its zone colour: shows where each zone is on the ground
    const pts = [];
    for (const [lat, lng, i] of zones.houses) {
      if (zone && i !== zi) continue;
      pts.push([lat, lng]);
      L.circleMarker([lat, lng], { radius: zone ? 3 : 2, weight: 0, fillOpacity: zone ? 0.55 : 0.35, fillColor: zones.zones[i].color, interactive: false }).addTo(layer);
    }
    if (!zone)
      for (const z of zones.zones)
        L.marker(z.center, {
          interactive: false,
          icon: L.divIcon({
            className: "",
            iconSize: [60, 24],
            iconAnchor: [30, 12],
            html: `<div style="text-align:center;font:700 13px/1 sans-serif;color:${z.color};text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff">${z.id}<br><span style="font-size:9px">${zoneRange(z)}</span></div>`,
          }),
        }).addTo(layer);
    const by = {};
    for (const r of rows) {
      const k = mainSoi(r.soi);
      if (!sois[k] || (zone && zones.soi_zone[k] !== zone)) continue;
      by[k] = by[k] || { open: 0, all: 0, urgent: 0 };
      by[k].all++;
      if (!["done", "absent"].includes(statusOf(r))) {
        by[k].open++;
        if (isUrgent(r)) by[k].urgent++;
      }
    }
    for (const [k, v] of Object.entries(by)) {
      const color = v.open === 0 ? "#16a34a" : v.urgent ? "#dc2626" : "#f59e0b";
      const size = k === soi ? 40 : 30;
      const icon = L.divIcon({
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:#fff;border:3px solid ${k === soi ? "#000" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 11px/1 sans-serif">${v.open || "✓"}<span style="font-size:8px;font-weight:600">ซ.${k}</span></div>`,
      });
      L.marker(sois[k].center, { icon, zIndexOffset: 500 })
        .on("click", () => onSoi(k))
        .addTo(layer);
    }
    if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [10, 10], animate: false });
  }, [rows, sois, soi, zones, zone]); // eslint-disable-line react-hooks/exhaustive-deps

  // where the other teams are (every 20 s)
  useEffect(() => {
    if (!zones) return;
    const go = () =>
      tapi(`/tech/${SURVEY}/pos`)
        .then(
          (list) =>
            teamsRef.current &&
            drawTeams(
              teamsRef.current,
              list.filter((t) => t.name !== me || watchRef.current == null),
              me,
            ),
        )
        .catch(() => {});
    go();
    const t = setInterval(go, 20000);
    return () => clearInterval(t);
  }, [zones, me]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = (body) => tapi(`/tech/${SURVEY}/pos`, { method: "POST", body: JSON.stringify(body) }).catch(() => {});

  function locate() {
    const map = mapRef.current;
    if (!navigator.geolocation) return setGps("มือถือนี้ไม่รองรับ GPS");
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
      meRef.current?.clearLayers();
      share({ on: false });
      return setGps("");
    }
    setGps("wait");
    let first = true;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const ll = [pos.coords.latitude, pos.coords.longitude];
        const me = meRef.current;
        if (!me || !mapRef.current) return;
        me.clearLayers();
        L.circle(ll, { radius: Math.min(pos.coords.accuracy || 20, 150), color: "#2563eb", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(me);
        L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }).bindTooltip("คุณอยู่ตรงนี้").addTo(me);
        if (Date.now() - sentRef.current > 20000) {
          sentRef.current = Date.now();
          share({ on: true, lat: ll[0], lng: ll[1], acc: pos.coords.accuracy || 0 });
        }
        if (first) map.setView(ll, Math.max(map.getZoom(), 17), { animate: false });
        first = false;
        setGps("on");
      },
      (e) => {
        setGps(e.code === 1 ? "ยังไม่ได้อนุญาตให้ใช้ตำแหน่ง · กดอนุญาตตำแหน่งในเบราว์เซอร์ หรือเปิดลิงก์ใน Chrome/Safari" : "หาตำแหน่งไม่ได้ ลองใหม่อีกครั้ง (อยู่กลางแจ้งจะแม่นกว่า)");
        if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  return (
    <div>
      <div className="relative">
        <div ref={el} className="h-[45vh] min-h-[300px] w-full overflow-hidden rounded-2xl" />
        <button onClick={locate} className={`absolute bottom-3 right-3 z-[500] rounded-full px-4 py-2 text-sm font-bold shadow-lg ${gps === "on" ? "bg-blue-600 text-white" : "bg-white text-black"}`}>
          {gps === "wait" ? "กำลังหา…" : gps === "on" ? "📍 ปิดตำแหน่ง" : "📍 ตำแหน่งฉัน"}
        </button>
      </div>
      {gps && !["wait", "on"].includes(gps) && <p className="mt-1 rounded bg-amber-100 p-2 text-xs">{gps}</p>}
      <p className="mt-1 text-xs text-neutral-600">
        จุดเล็กสี = บ้านในแต่ละโซน · วงกลม = จำนวนบ้านที่ยังต้องไปในซอยนั้น (🔴 มีบ้านด่วน · 🟠 รอตรวจ · 🟢 เสร็จหมด) · แตะวงกลม = ดูเฉพาะซอยนั้น · 📍 = ตำแหน่งมือถือคุณ (จุดสีน้ำเงิน) · 👷 =
        ทีมช่างที่เปิดตำแหน่งอยู่ · เมื่อเปิด 📍 ทีมอื่นและหน้าเว็บหมู่บ้านจะเห็นชื่อทีมคุณบนแผนที่ (ปิดแล้วหายทันที)
      </p>
    </div>
  );
}
