import { useCallback, useEffect, useMemo, useState } from "react";
import { api, load, save } from "../api";
import { mediaUrl } from "../media";
import MediaPicker, { mediaState } from "./MediaPicker";

// /fund — เงินสมทบทีมอาสา: a dashboard anyone can read in five seconds and check line by line.
// Top: the four numbers that matter (in, out, left, how much is checked against the bank). Then the flow over
// time, where the money came from / went, how complete the checking is, and the full ledger with evidence.
// Treasurer link: /fund#fk=<key> (kept on this phone); admins are treasurers too.
const PURPOSES = {
  food: ["🍱", "อาหาร / น้ำดื่ม"],
  sand: ["🧱", "กระสอบทราย"],
  labor: ["💪", "ค่าแรง"],
  supplies: ["🧰", "อุปกรณ์ / ของใช้"],
  general: ["🤝", "ทั่วไป"],
};
const STATUS = {
  confirmed: { label: "ตรวจแล้ว", icon: "✅", cls: "bg-emerald-100 text-emerald-800" },
  pending: { label: "รอตรวจ", icon: "⏳", cls: "bg-amber-100 text-amber-900" },
  rejected: { label: "ไม่พบยอด", icon: "❌", cls: "bg-red-100 text-red-800" },
};
const SOURCES = { slip: "สลิป", cash: "เงินสด", transfer: "เห็นในบัญชี", line: "จากรายการในกลุ่ม", self: "แจ้งเอง" };
const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const fmt = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const baht = (n) => `${fmt(n)} บาท`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const tOf = (d) => new Date(d.paid_at || d.created_at).getTime();

function fundKey() {
  const m = window.location.hash.match(/[#&]fk=([A-Za-z0-9_-]{16,})/);
  if (m) {
    save("fundKey", m[1]);
    window.history.replaceState(null, "", window.location.pathname);
  }
  return load("fundKey", "");
}

function fapi(path, options = {}) {
  const key = load("fundKey", "");
  const name = load("fundName", "");
  return api(path, { ...options, headers: { ...(key ? { "X-Fund-Key": key } : {}), ...(name ? { "X-Fund-Name": encodeURIComponent(name.slice(0, 40)) } : {}), ...options.headers } });
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function sumBy(list, key) {
  const out = {};
  for (const d of list) out[d[key] || "general"] = (out[d[key] || "general"] || 0) + d.amount;
  return out;
}

export default function FundPage() {
  useState(() => fundKey());
  const [data, setData] = useState(null);
  const [tre, setTre] = useState(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const reload = useCallback(async () => {
    try {
      setData(await api("/fund"));
    } catch (e) {
      setErr(e.message);
    }
    fapi("/fund/treasurer")
      .then(setTre)
      .catch(() => setTre(null));
  }, []);
  useEffect(() => {
    document.title = "เงินสมทบทีมอาสา · เสรีไทย 57";
    reload();
    const t = setInterval(reload, 30000);
    return () => clearInterval(t);
  }, [reload]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const m = useMemo(() => {
    if (!data) return null;
    const ins = data.donations;
    const live = ins.filter((d) => d.status !== "rejected");
    const ok = ins.filter((d) => d.status === "confirmed");
    const wait = ins.filter((d) => d.status === "pending");
    const total = live.reduce((s, d) => s + d.amount, 0);
    const confirmed = ok.reduce((s, d) => s + d.amount, 0);
    const spent = data.expenses.reduce((s, d) => s + d.amount, 0);
    return {
      total,
      confirmed,
      spent,
      left: total - spent,
      n: live.length,
      nOk: ok.length,
      nWait: wait.length,
      nRejected: ins.length - live.length,
      nSlip: live.filter((d) => d.has_slip).length,
      nRef: live.filter((d) => d.ref_tail).length,
      nReceipt: data.expenses.filter((x) => x.receipts?.length).length,
      inBy: sumBy(live, "purpose"),
      outBy: sumBy(data.expenses, "purpose"),
    };
  }, [data]);

  if (!data || !m) return <p className="p-6 text-center text-neutral-500">{err || "กำลังโหลด…"}</p>;

  async function copySummary() {
    const lines = [
      "💰 สรุปเงินสมทบทีมอาสา หมู่บ้านสหกรณ์ฯ 4",
      `ณ ${when(new Date().toISOString())}`,
      `รับ ${baht(m.total)} (${m.n} รายการ) · ตรวจกับบัญชีแล้ว ${baht(m.confirmed)}`,
      `ใช้ไป ${baht(m.spent)} · คงเหลือ ${baht(m.left)}`,
      "",
      "ดูทุกรายการ พร้อมหลักฐาน:",
      `${window.location.origin}/fund`,
    ];
    await copy(lines.join("\n"));
    setToast("คัดลอกสรุปแล้ว วางในกลุ่ม LINE ได้เลย");
  }

  return (
    <div className="min-h-screen bg-stone-100 text-neutral-900">
      <header className="sticky top-0 z-[900] bg-black text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2">
          <a href="/" className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-white/10 text-xl" aria-label="กลับหน้าแรก">‹</a>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">💰 เงินสมทบทีมอาสา</h1>
            <p className="truncate text-xs text-neutral-400">หมู่บ้านสหกรณ์ฯ 4 · อัปเดตล่าสุด {when(data.updated_at)}</p>
          </div>
          <button onClick={copySummary} className="min-h-[44px] shrink-0 rounded-lg bg-white/10 px-3 text-sm font-semibold">📋 สรุปไป LINE</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-3 pb-12 pt-3">
        {/* 1. the four numbers */}
        <section className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="สรุปยอด">
          <Kpi tone="dark" label="รับเข้าทั้งหมด" value={baht(m.total)} sub={`${m.n} รายการ`} />
          <Kpi label="ใช้ไปแล้ว" value={baht(m.spent)} sub={`${data.expenses.length} รายการ`} />
          <Kpi tone="green" label="คงเหลือ" value={baht(m.left)} sub={m.total ? `${Math.round((m.left / m.total) * 100)}% ของยอดรับ` : ""} />
          <Kpi label="ตรวจกับบัญชีแล้ว" value={`${m.total ? Math.round((m.confirmed / m.total) * 100) : 0}%`} sub={`${baht(m.confirmed)} · รอตรวจ ${m.nWait}`} bar={m.total ? m.confirmed / m.total : 0} />
        </section>

        {data.options?.self_report && (
          <SelfReport
            onDone={() => {
              reload();
              setToast("แจ้งแล้ว ขอบคุณมากครับ 🙏 เหรัญญิกจะตรวจกับบัญชีแล้วขึ้น ✅");
            }}
          />
        )}

        {/* 2. flow over time */}
        <Card title="เงินเข้า – ออก ตามเวลา" note="ยอดสะสม">
          <FlowChart donations={data.donations.filter((d) => d.status !== "rejected")} expenses={data.expenses} />
        </Card>

        {/* 3. where from / where to + how complete the checking is */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="รับเข้า ตามวัตถุประสงค์">
            <Bars data={m.inBy} total={m.total} color="bg-neutral-900" />
          </Card>
          <Card title="ใช้ไป ตามหมวด">
            {m.spent ? <Bars data={m.outBy} total={m.spent} color="bg-amber-500" /> : <p className="text-sm text-neutral-500">ยังไม่มีรายจ่าย</p>}
          </Card>
          <Card title="ความครบถ้วนของการตรวจสอบ">
            <Check ok={m.nOk} of={m.n} label="ตรวจกับบัญชีธนาคารแล้ว" />
            <Check ok={m.nSlip} of={m.n} label="มีสลิปเป็นหลักฐาน" />
            <Check ok={m.nRef} of={m.n} label="มีเลขที่รายการ (กันลงซ้ำ)" />
            <Check ok={m.nReceipt} of={data.expenses.length} label="รายจ่ายมีใบเสร็จ" />
            {m.nRejected > 0 && <p className="mt-1 text-sm text-red-700">❌ ไม่พบยอดในบัญชี {m.nRejected} รายการ (ไม่นับรวม)</p>}
          </Card>
        </div>

        {tre && <Treasurer tre={tre} onChanged={reload} setToast={setToast} />}

        {/* 4. the ledger */}
        <Ledger data={data} />

        {data.account && (
          <Card title="บัญชีรับเงินสมทบ">
            <p className="font-semibold">{data.account.bank} · {data.account.name}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="select-all text-xl font-black tabular-nums">{data.account.number}</span>
              <button onClick={() => copy(data.account.number.replace(/\D/g, "")).then(() => setToast("คัดลอกเลขบัญชีแล้ว"))} className="min-h-[40px] rounded-lg border-2 border-black px-3 text-sm font-semibold">
                คัดลอก
              </button>
            </div>
            {data.account.note && <p className="text-sm text-neutral-600">{data.account.note}</p>}
          </Card>
        )}

        <section className="rounded-xl bg-white p-3 text-sm text-neutral-600">
          <b className="text-neutral-900">ตรวจสอบยอดของตัวเอง:</b> หาชื่อหรือเวลาโอนในตารางรายรับ แล้วดูเลขท้าย 4 ตัวของเลขที่รายการให้ตรงกับสลิปของคุณ ·
          ✅ = เหรัญญิกเห็นยอดในบัญชีแล้ว · ⏳ = รอตรวจ · แตะรูปสลิปเพื่อดูเต็ม · บ้านเลขที่และเลขที่รายการเต็มเห็นเฉพาะเหรัญญิก · เว็บนี้ไม่ได้รับหรือโอนเงิน ·
          ระวังมิจฉาชีพ: โอนเฉพาะบัญชีที่ทีมอาสาประกาศ
        </section>
      </main>

      {toast && (
        <div role="status" className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Card({ title, note, children }) {
  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm">
      <h2 className="mb-2 flex items-baseline gap-2 font-bold">
        {title}
        {note && <span className="text-xs font-normal text-neutral-500">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone, bar }) {
  const cls = tone === "dark" ? "bg-black text-white" : tone === "green" ? "bg-emerald-700 text-white" : "bg-white";
  const muted = tone ? "text-white/70" : "text-neutral-500";
  return (
    <div className={`rounded-2xl p-3 shadow-sm ${cls}`}>
      <p className={`text-xs font-semibold ${muted}`}>{label}</p>
      <p className="text-xl font-black tabular-nums sm:text-2xl">{value}</p>
      {bar != null && (
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-neutral-200" aria-hidden="true">
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
      {sub && <p className={`mt-0.5 text-xs ${muted}`}>{sub}</p>}
    </div>
  );
}

function Bars({ data, total, color }) {
  const rows = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <p className="text-sm text-neutral-500">ยังไม่มีข้อมูล</p>;
  return (
    <ul className="space-y-2">
      {rows.map(([k, v]) => (
        <li key={k}>
          <div className="flex justify-between gap-2 text-sm">
            <span>{PURPOSES[k]?.[0]} {PURPOSES[k]?.[1] || k}</span>
            <span className="tabular-nums">
              {fmt(v)} <span className="text-neutral-500">({Math.round((v / total) * 100)}%)</span>
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${(v / total) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Check({ ok, of, label }) {
  const done = of > 0 && ok === of;
  return (
    <div className="mb-2">
      <div className="flex justify-between gap-2 text-sm">
        <span>{done ? "✅" : "⬜"} {label}</span>
        <span className="font-semibold tabular-nums">{ok}/{of}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
        <div className={`h-full rounded-full ${done ? "bg-emerald-600" : "bg-amber-400"}`} style={{ width: of ? `${(ok / of) * 100}%` : "0%" }} />
      </div>
    </div>
  );
}

// Cumulative money in (black) and out (amber) over time, one scale, labelled at the ends.
function FlowChart({ donations, expenses }) {
  const ev = [...donations.map((d) => ({ t: tOf(d), in: d.amount, out: 0 })), ...expenses.map((x) => ({ t: tOf(x), in: 0, out: x.amount }))].sort((a, b) => a.t - b.t);
  if (!ev.length) return <p className="text-sm text-neutral-500">ยังไม่มีรายการ</p>;
  const W = 640, H = 180, L = 56, R = 12, T = 12, B = 26;
  const t0 = ev[0].t;
  const t1 = Math.max(ev[ev.length - 1].t, t0 + 60000);
  const pts = [];
  let cin = 0;
  let cout = 0;
  for (const e of ev) {
    cin += e.in;
    cout += e.out;
    pts.push({ t: e.t, cin, cout });
  }
  const maxY = Math.max(cin, 1);
  const x = (t) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  const step = (key) => pts.reduce((p, q, i) => p + (i ? ` H${x(q.t).toFixed(1)}` : `M${x(q.t).toFixed(1)},${y(0)}`) + ` V${y(q[key]).toFixed(1)}`, "") + ` H${x(t1)}`;
  const ticks = [0, maxY / 2, maxY];
  const tl = (t) => new Date(t).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-full" role="img" aria-label={`ยอดสะสม รับ ${fmt(cin)} บาท ใช้ ${fmt(cout)} บาท`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e5e5e5" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#737373">{fmt(Math.round(v))}</text>
          </g>
        ))}
        <path d={step("cin")} fill="none" stroke="#111" strokeWidth="2.5" />
        {cout > 0 && <path d={step("cout")} fill="none" stroke="#f59e0b" strokeWidth="2.5" />}
        <circle cx={x(t1)} cy={y(cin)} r="4" fill="#111" />
        <text x={L} y={H - 6} fontSize="11" fill="#737373">{tl(t0)}</text>
        <text x={W - R} y={H - 6} fontSize="11" fill="#737373" textAnchor="end">{tl(t1)}</text>
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 text-sm">
        <span><span className="mr-1 inline-block h-2.5 w-4 rounded bg-neutral-900 align-middle" />รับสะสม {baht(cin)}</span>
        <span><span className="mr-1 inline-block h-2.5 w-4 rounded bg-amber-500 align-middle" />ใช้สะสม {baht(cout)}</span>
      </p>
    </div>
  );
}

function Ledger({ data }) {
  const [tab, setTab] = useState("in");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("time");
  const query = q.trim().toLowerCase();
  const ins = data.donations
    .filter((d) => (status === "all" || d.status === status) && (!query || `${d.name} ${d.ref_tail} ${fmt(d.amount)} ${d.amount}`.toLowerCase().includes(query)))
    .sort((a, b) => (sort === "amount" ? b.amount - a.amount : tOf(b) - tOf(a)));
  const outs = data.expenses
    .filter((x) => !query || `${x.item} ${x.paid_by} ${x.amount}`.toLowerCase().includes(query))
    .sort((a, b) => (sort === "amount" ? b.amount - a.amount : tOf(b) - tOf(a)));

  function csv() {
    const rows = [["ประเภท", "เวลา", "ชื่อ/รายการ", "ยอด", "วัตถุประสงค์", "สถานะ", "เลขที่รายการ (ท้าย)", "หลักฐาน"]];
    for (const d of data.donations) rows.push(["รับ", when(d.paid_at || d.created_at), d.name, d.amount, PURPOSES[d.purpose]?.[1] || "", STATUS[d.status].label, d.ref_tail, d.has_slip ? "สลิป" : ""]);
    for (const x of data.expenses) rows.push(["จ่าย", when(x.paid_at || x.created_at), x.item, x.amount, PURPOSES[x.purpose]?.[1] || "", "", "", x.receipts?.length ? "ใบเสร็จ" : ""]);
    const text = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    a.download = "เงินสมทบทีมอาสา.csv";
    a.click();
  }

  return (
    <Card title="บัญชีรายการ">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {[["in", `รายรับ (${data.donations.length})`], ["out", `รายจ่าย (${data.expenses.length})`]].map(([k, t]) => (
          <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === k ? "bg-white shadow" : "text-neutral-600"}`}>{t}</button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className={`${input} w-full`} placeholder="🔍 ค้นหาชื่อ / ยอด / เลขท้าย 4 ตัว" aria-label="ค้นหา" />
        {tab === "in" && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="min-h-[44px] flex-1 rounded-lg border border-neutral-300 px-2" aria-label="สถานะ">
            <option value="all">ทุกสถานะ</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-[44px] flex-1 rounded-lg border border-neutral-300 px-2" aria-label="เรียง">
          <option value="time">ล่าสุดก่อน</option>
          <option value="amount">ยอดมากก่อน</option>
        </select>
        <button onClick={csv} className="min-h-[44px] rounded-lg border-2 border-black px-3 text-sm font-semibold">⬇️ CSV</button>
      </div>
      <div className="-mx-3 mt-2 overflow-x-auto px-3">
        {tab === "in" ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr className="border-b">
                <th className="py-2 pr-2 font-semibold">เวลาโอน</th>
                <th className="py-2 pr-2 font-semibold">ชื่อ</th>
                <th className="py-2 pr-2 text-right font-semibold">ยอด (บาท)</th>
                <th className="hidden py-2 pr-2 font-semibold sm:table-cell">สถานะ</th>
                <th className="hidden py-2 font-semibold sm:table-cell">หลักฐาน</th>
              </tr>
            </thead>
            <tbody>
              {ins.map((d) => (
                <tr key={d.id} className={`border-b last:border-0 ${d.status === "rejected" ? "text-neutral-400 line-through" : ""}`}>
                  <td className="whitespace-nowrap py-2 pr-2 tabular-nums">{when(d.paid_at || d.created_at)}</td>
                  <td className="py-2 pr-2">
                    {d.name}
                    <span className="block text-xs text-neutral-500">{PURPOSES[d.purpose]?.[1]} · {SOURCES[d.source] || ""}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1 text-xs sm:hidden">
                      <span className={`rounded px-1.5 font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].icon} {STATUS[d.status].label}</span>
                      <SlipLink d={d} />
                      {d.ref_tail && <span className="font-mono text-neutral-600">…{d.ref_tail}</span>}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">{fmt(d.amount)}</td>
                  <td className="hidden py-2 pr-2 sm:table-cell"><span className={`whitespace-nowrap rounded px-1.5 text-xs font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].icon} {STATUS[d.status].label}</span></td>
                  <td className="hidden whitespace-nowrap py-2 text-xs sm:table-cell">
                    <span className="flex items-center gap-1">
                      <SlipLink d={d} big />
                      {!d.has_slip && "—"}
                      {d.ref_tail && <span className="font-mono text-neutral-600">…{d.ref_tail}</span>}
                    </span>
                  </td>
                </tr>
              ))}
              {!ins.length && <tr><td colSpan={5} className="py-4 text-center text-neutral-500">ไม่มีรายการ</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-bold">
                <td colSpan={2} className="py-2">รวม {ins.length} รายการ{status === "all" ? " (ไม่นับ ❌)" : ""}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{fmt(ins.filter((d) => d.status !== "rejected").reduce((s, d) => s + d.amount, 0))}</td>
                <td colSpan={2} className="hidden sm:table-cell" />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr className="border-b">
                <th className="py-2 pr-2 font-semibold">เวลา</th>
                <th className="py-2 pr-2 font-semibold">รายการ</th>
                <th className="py-2 pr-2 text-right font-semibold">ยอด (บาท)</th>
                <th className="py-2 font-semibold">ใบเสร็จ</th>
              </tr>
            </thead>
            <tbody>
              {outs.map((x) => (
                <tr key={x.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-2 tabular-nums">{when(x.paid_at || x.created_at)}</td>
                  <td className="py-2 pr-2">
                    {x.item}
                    <span className="block text-xs text-neutral-500">{PURPOSES[x.purpose]?.[1]}{x.paid_by && ` · จ่ายโดย ${x.paid_by}`}{x.note && ` · ${x.note}`}</span>
                  </td>
                  <td className="py-2 pr-2 text-right font-semibold tabular-nums">{fmt(x.amount)}</td>
                  <td className="py-2">
                    <span className="flex gap-1">
                      {(x.receipts || []).map((r) => (
                        <a key={r.id} href={mediaUrl(r.id)} target="_blank" rel="noreferrer"><img src={mediaUrl(r.id, "thumb")} alt="ใบเสร็จ" className="h-10 w-10 rounded object-cover" /></a>
                      ))}
                      {!x.receipts?.length && "—"}
                    </span>
                  </td>
                </tr>
              ))}
              {!outs.length && <tr><td colSpan={4} className="py-4 text-center text-neutral-500">ยังไม่มีรายจ่าย</td></tr>}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-black font-bold">
                <td colSpan={2} className="py-2">รวม {outs.length} รายการ</td>
                <td className="py-2 pr-2 text-right tabular-nums">{fmt(outs.reduce((s, x) => s + x.amount, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </Card>
  );
}

// ---------- treasurer: add with evidence, check against the bank app, record spending ----------
function Treasurer({ tre, onChanged, setToast }) {
  const [name, setName] = useState(() => load("fundName", ""));
  const [form, setForm] = useState(null); // {mode: "in"|"out", edit?}
  const [show, setShow] = useState("pending");
  const [err, setErr] = useState("");
  const run = async (fn, ok) => {
    setErr("");
    try {
      await fn();
      if (ok) setToast(ok);
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  };
  const saved = (msg) => {
    setForm(null);
    onChanged();
    setToast(msg);
  };
  const setStatus = (d, status, msg) => run(() => fapi(`/fund/donations/${d.id}`, { method: "PATCH", body: JSON.stringify({ status }) }), msg);
  const list = tre.donations.filter((d) => show === "all" || d.status === show);
  const counts = tre.donations.reduce((c, d) => ({ ...c, [d.status]: (c[d.status] || 0) + 1 }), {});
  return (
    <section className="space-y-3 rounded-2xl border-4 border-amber-500 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-bold">🔑 เหรัญญิก · {tre.who}</h2>
        <input
          aria-label="ชื่อคุณ"
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            save("fundName", e.target.value);
          }}
          className="min-h-[40px] w-44 rounded-lg border border-neutral-300 px-2 text-sm"
          placeholder="ชื่อคุณ (บันทึกว่าใครตรวจ)"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setForm({ mode: "in" })} className="min-h-[48px] rounded-xl bg-black font-bold text-white">➕ ลงรายรับ + สลิป</button>
        <button onClick={() => setForm({ mode: "out" })} className="min-h-[48px] rounded-xl border-2 border-black bg-white font-bold">🧾 ลงรายจ่าย + ใบเสร็จ</button>
      </div>
      {form?.mode === "in" && <DonationForm key={form.edit?.id || "new"} edit={form.edit} onClose={() => setForm(null)} onSaved={saved} />}
      {form?.mode === "out" && <ExpenseForm onClose={() => setForm(null)} onSaved={saved} />}
      <p className="text-sm">เปิดแอปธนาคาร เทียบทีละรายการ (ยอด + เวลา + เลขที่รายการ) → ✅ เจอ · ❌ ไม่เจอ · ✏️ แก้ถ้าพิมพ์ผิด</p>
      <div className="flex flex-wrap gap-2">
        {[["pending", `⏳ รอตรวจ (${counts.pending || 0})`], ["confirmed", `✅ (${counts.confirmed || 0})`], ["rejected", `❌ (${counts.rejected || 0})`], ["all", "ทั้งหมด"]].map(([k, t]) => (
          <button key={k} onClick={() => setShow(k)} aria-pressed={show === k} className={`min-h-[40px] rounded-full px-3 text-sm ${show === k ? "bg-black font-semibold text-white" : "border border-neutral-400 bg-white"}`}>{t}</button>
        ))}
      </div>
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id} className="flex flex-wrap items-start gap-2 rounded-xl bg-white p-2">
            {d.slip?.[0] ? (
              <a href={mediaUrl(d.slip[0].id)} target="_blank" rel="noreferrer" className="shrink-0">
                <img src={mediaUrl(d.slip[0].id, "thumb")} alt="สลิป" className="h-24 rounded object-cover" style={{ width: "4.5rem" }} />
              </a>
            ) : (
              <span className="flex h-24 shrink-0 items-center justify-center rounded bg-neutral-100 px-1 text-center text-xs text-neutral-500" style={{ width: "4.5rem" }}>ไม่มีสลิป</span>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-lg font-black tabular-nums">{baht(d.amount)}</p>
              <p>
                <b>{d.name}</b>
                {d.house && ` · ${d.house}`}
                {d.anonymous && " · ไม่ออกนาม"}
              </p>
              <p className="text-neutral-600">{when(d.paid_at)} · {d.bank || "-"} · {SOURCES[d.source]}</p>
              {d.ref && <p className="break-all font-mono text-xs">#{d.ref}</p>}
              {d.note && <p className="text-xs">{d.note}</p>}
              {d.reviewed_by && <p className="text-xs text-neutral-500">{STATUS[d.status].icon} โดย {d.reviewed_by}</p>}
            </div>
            <div className="flex w-full flex-wrap gap-2">
              {d.status !== "confirmed" && <button onClick={() => setStatus(d, "confirmed", "✅ ตรวจแล้ว")} className="min-h-[40px] rounded-lg bg-emerald-600 px-3 font-bold text-white">✅ เจอยอด</button>}
              {d.status !== "rejected" && <button onClick={() => setStatus(d, "rejected", "บันทึกว่าไม่พบยอด")} className="min-h-[40px] rounded-lg bg-red-600 px-3 font-bold text-white">❌ ไม่พบ</button>}
              {d.status !== "pending" && <button onClick={() => setStatus(d, "pending")} className="min-h-[40px] rounded-lg border border-black px-3">↩️ รอตรวจ</button>}
              <button onClick={() => setForm({ mode: "in", edit: d })} className="min-h-[40px] rounded-lg border border-black px-3">✏️ แก้ / แนบสลิป</button>
              <button onClick={() => window.confirm(`ลบ ${d.name} ${baht(d.amount)}?`) && run(() => fapi(`/fund/donations/${d.id}`, { method: "DELETE" }), "ลบแล้ว")} className="min-h-[40px] px-2 text-sm text-red-700 underline">ลบ</button>
            </div>
          </li>
        ))}
        {!list.length && <li className="rounded-xl bg-white p-3 text-center text-neutral-500">ไม่มีรายการ</li>}
      </ul>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
    </section>
  );
}

const toLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function DonationForm({ edit, onClose, onSaved }) {
  const [f, setF] = useState(() => ({
    name: edit?.name || "",
    house: edit?.house || "",
    anonymous: edit?.anonymous || false,
    amount: edit?.amount || "",
    paid_at: toLocalInput(edit?.paid_at),
    bank: edit?.bank || "",
    ref: edit?.ref || "",
    purpose: edit?.purpose || "food",
    note: edit?.note || "",
    status: edit?.status || "pending",
    source: edit?.source || "slip",
  }));
  const [slip, setSlip] = useState([]);
  const [err, setErr] = useState("");
  const st = mediaState(slip);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function submit(e) {
    e.preventDefault();
    setErr("");
    const body = { ...f, amount: Number(f.amount), paid_at: f.paid_at ? new Date(f.paid_at).toISOString() : null };
    if (st.ids[0]) body.slip_id = st.ids[0];
    if (edit) delete body.source;
    try {
      await fapi(edit ? `/fund/donations/${edit.id}` : "/fund/donations", { method: edit ? "PATCH" : "POST", body: JSON.stringify(body) });
      onSaved(edit ? "แก้ไขแล้ว" : "ลงรายรับแล้ว");
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="font-bold">{edit ? "✏️ แก้รายการรับ" : "➕ ลงรายรับพร้อมหลักฐาน"}</p>
      <div>
        <p className="mb-1 text-sm font-medium">สลิป {edit?.slip?.length ? "(มีแล้ว · แนบใหม่เพื่อแทน)" : ""}</p>
        <MediaPicker items={slip} setItems={setSlip} max={1} allowVideo={false} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input required inputMode="decimal" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={`${input} text-lg font-bold`} placeholder="ยอด (บาท) *" aria-label="ยอด" />
        <input type="datetime-local" value={f.paid_at} onChange={(e) => set({ paid_at: e.target.value })} className={input} aria-label="เวลาโอนตามสลิป" />
        <input required maxLength={60} value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อตามสลิป / ในกลุ่ม *" aria-label="ชื่อ" />
        <input maxLength={60} value={f.ref} onChange={(e) => set({ ref: e.target.value })} className={`${input} font-mono`} placeholder="เลขที่รายการ (กันลงซ้ำ)" aria-label="เลขที่รายการ" />
        <input maxLength={30} value={f.bank} onChange={(e) => set({ bank: e.target.value })} className={input} placeholder="ธนาคารผู้โอน" aria-label="ธนาคาร" />
        <input maxLength={20} value={f.house} onChange={(e) => set({ house: e.target.value })} className={input} placeholder="บ้านเลขที่ (เห็นเฉพาะเหรัญญิก)" aria-label="บ้านเลขที่" />
        <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} className={input} aria-label="วัตถุประสงค์">
          {Object.entries(PURPOSES).map(([k, [i, t]]) => <option key={k} value={k}>{i} {t}</option>)}
        </select>
        <select value={f.status} onChange={(e) => set({ status: e.target.value })} className={input} aria-label="สถานะ">
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        {!edit && (
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={input} aria-label="ที่มา">
            {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <input maxLength={200} value={f.note} onChange={(e) => set({ note: e.target.value })} className={input} placeholder="หมายเหตุ / บันทึกช่วยจำในสลิป" aria-label="หมายเหตุ" />
      </div>
      <label className="flex min-h-[40px] items-center gap-2 text-sm">
        <input type="checkbox" checked={f.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} className="h-5 w-5" /> ไม่ประสงค์ออกนาม
      </label>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="min-h-[48px] rounded-xl border-2 border-black font-semibold">ยกเลิก</button>
        <button disabled={st.busy} className="min-h-[48px] rounded-xl bg-black font-bold text-white disabled:opacity-60">{st.busy ? "รอสลิป…" : "บันทึก"}</button>
      </div>
    </form>
  );
}

function ExpenseForm({ onClose, onSaved }) {
  const [f, setF] = useState({ item: "", amount: "", purpose: "food", paid_by: load("fundName", ""), paid_at: toLocalInput(new Date().toISOString()), note: "" });
  const [rc, setRc] = useState([]);
  const [err, setErr] = useState("");
  const st = mediaState(rc);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function submit(e) {
    e.preventDefault();
    setErr("");
    try {
      await fapi("/fund/expenses", { method: "POST", body: JSON.stringify({ ...f, amount: Number(f.amount), paid_at: f.paid_at ? new Date(f.paid_at).toISOString() : null, receipt_ids: st.ids }) });
      onSaved("ลงรายจ่ายแล้ว");
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="font-bold">🧾 ลงรายจ่ายพร้อมใบเสร็จ</p>
      <MediaPicker items={rc} setItems={setRc} max={4} allowVideo={false} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input required minLength={2} maxLength={120} value={f.item} onChange={(e) => set({ item: e.target.value })} className={input} placeholder="ซื้ออะไร เช่น ข้าวกล่อง 100 กล่อง *" aria-label="ซื้ออะไร" />
        <input required inputMode="decimal" type="number" min="0.01" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={`${input} font-bold`} placeholder="ยอด (บาท) *" aria-label="ยอด" />
        <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} className={input} aria-label="หมวด">
          {Object.entries(PURPOSES).map(([k, [i, t]]) => <option key={k} value={k}>{i} {t}</option>)}
        </select>
        <input type="datetime-local" value={f.paid_at} onChange={(e) => set({ paid_at: e.target.value })} className={input} aria-label="เวลาจ่าย" />
        <input maxLength={60} value={f.paid_by} onChange={(e) => set({ paid_by: e.target.value })} className={input} placeholder="ใครจ่าย" aria-label="ใครจ่าย" />
        <input maxLength={200} value={f.note} onChange={(e) => set({ note: e.target.value })} className={input} placeholder="หมายเหตุ" aria-label="หมายเหตุ" />
      </div>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="min-h-[48px] rounded-xl border-2 border-black font-semibold">ยกเลิก</button>
        <button disabled={st.busy} className="min-h-[48px] rounded-xl bg-black font-bold text-white disabled:opacity-60">{st.busy ? "รอใบเสร็จ…" : "บันทึก"}</button>
      </div>
    </form>
  );
}

// The slip itself, when the ledger shows slips publicly: a thumbnail that opens the full picture.
function SlipLink({ d, big = false }) {
  const m = d.slip?.[0];
  if (!m) return d.has_slip ? <span>📎</span> : null;
  return (
    <a href={mediaUrl(m.id)} target="_blank" rel="noreferrer" title="ดูสลิป" className="shrink-0">
      <img src={mediaUrl(m.id, "thumb")} alt={`สลิป ${d.name}`} loading="lazy" className={`${big ? "h-12 w-9" : "h-10 w-8"} rounded border object-cover`} />
    </a>
  );
}

// Donors report their own transfer with the slip (only when the treasurer has switched it on).
function SelfReport({ onDone }) {
  const [open, setOpen] = useState(false);
  const c = load("contact", {});
  const [f, setF] = useState({ name: c.name || "", house: "", anonymous: false, amount: "", paid_at: "", bank: "", ref: "", purpose: "food", note: "" });
  const [slip, setSlip] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const st = mediaState(slip);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function submit(e) {
    e.preventDefault();
    if (!st.ids[0]) return setErr("แนบรูปสลิปก่อน");
    setBusy(true);
    setErr("");
    try {
      await api("/fund/report", { method: "POST", body: JSON.stringify({ ...f, amount: Number(f.amount), paid_at: f.paid_at ? new Date(f.paid_at).toISOString() : null, slip_id: st.ids[0] }) });
      setOpen(false);
      setSlip([]);
      setF((x) => ({ ...x, amount: "", paid_at: "", ref: "", note: "" }));
      onDone();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="min-h-[56px] w-full rounded-2xl bg-emerald-600 px-3 text-lg font-bold text-white shadow">
        ✅ โอนแล้ว · แนบสลิปที่นี่
        <span className="block text-sm font-normal">ยอดจะขึ้นเป็น ⏳ รอตรวจ จนเหรัญญิกเห็นในบัญชี</span>
      </button>
    );
  return (
    <form onSubmit={submit} className="space-y-2 rounded-2xl border-2 border-emerald-600 bg-white p-3">
      <p className="text-lg font-bold">✅ แจ้งโอนเงินสมทบ</p>
      <div>
        <p className="mb-1 text-sm font-medium">รูปสลิป *</p>
        <MediaPicker items={slip} setItems={setSlip} max={1} allowVideo={false} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input required inputMode="decimal" type="number" min="1" step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={`${input} text-lg font-bold`} placeholder="ยอดที่โอน (บาท) *" aria-label="ยอด" />
        <input type="datetime-local" value={f.paid_at} onChange={(e) => set({ paid_at: e.target.value })} className={input} aria-label="เวลาโอน" />
        <input required maxLength={60} value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อ *" aria-label="ชื่อ" />
        <input maxLength={20} value={f.house} onChange={(e) => set({ house: e.target.value })} className={input} placeholder="บ้านเลขที่ (เห็นเฉพาะเหรัญญิก)" aria-label="บ้านเลขที่" />
        <input maxLength={60} value={f.ref} onChange={(e) => set({ ref: e.target.value })} className={`${input} font-mono`} placeholder="เลขที่รายการในสลิป (ถ้ามี)" aria-label="เลขที่รายการ" />
        <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} className={input} aria-label="สมทบค่าอะไร">
          {Object.entries(PURPOSES).map(([k, [i, t]]) => <option key={k} value={k}>{i} {t}</option>)}
        </select>
      </div>
      <label className="flex min-h-[40px] items-center gap-2 text-sm">
        <input type="checkbox" checked={f.anonymous} onChange={(e) => set({ anonymous: e.target.checked })} className="h-5 w-5" /> ไม่ประสงค์ออกนาม
      </label>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setOpen(false)} className="min-h-[48px] rounded-xl border-2 border-black font-semibold">ยกเลิก</button>
        <button disabled={busy || st.busy} className="min-h-[48px] rounded-xl bg-emerald-600 font-bold text-white disabled:opacity-60">{busy ? "กำลังส่ง…" : st.busy ? "รอสลิปอัปโหลด…" : "ส่ง"}</button>
      </div>
    </form>
  );
}
