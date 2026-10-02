import { useCallback, useEffect, useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { mediaUrl } from "../media";
import MediaPicker, { mediaState } from "./MediaPicker";

// /fund — เงินสมทบทีมอาสา: one public ledger instead of slips in the LINE group. Nobody fills in a form:
// the entries come from the running tallies people post in the village chat (tools/fund_sweep.py).
// Treasurer link: /fund#fk=<key> (kept on this phone, sent as X-Fund-Key); admins are treasurers too.
const PURPOSES = {
  food: "🍱 อาหาร / น้ำอาสา",
  sand: "🧱 กระสอบทราย",
  labor: "💪 ค่าแรง",
  general: "🤝 ทั่วไป",
};
const STATUS = {
  pending: { label: "⏳ รอตรวจกับบัญชี", cls: "bg-amber-100 text-amber-900" },
  confirmed: { label: "✅ ตรวจแล้ว", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "❌ ไม่พบยอด", cls: "bg-red-100 text-red-800" },
};
const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const baht = (n) => `${Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท`;

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
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  }
}

export default function FundPage() {
  const [key] = useState(() => fundKey());
  const [data, setData] = useState(null);
  const [tre, setTre] = useState(null); // treasurer view, if allowed
  const [tab, setTab] = useState("in");
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

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

  if (!data) return <p className="p-6 text-center text-neutral-500">{err || "กำลังโหลด…"}</p>;
  const t = data.totals;
  const acc = data.account;

  async function copySummary() {
    const lines = [
      "💰 สรุปเงินสมทบทีมอาสา หมู่บ้านสหกรณ์ฯ 4",
      `ณ ${new Date().toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      `💰 ยอดสมทบ ${baht(t.received + t.pending)} (${t.count_confirmed + t.count_pending} รายการ)`,
      t.count_pending ? `   ✅ ตรวจกับบัญชีแล้ว ${baht(t.received)} · ⏳ รอตรวจ ${baht(t.pending)}` : "   ✅ ตรวจกับบัญชีครบแล้ว",
      `🧾 ใช้ไป ${baht(t.spent)} · 💵 คงเหลือ ${baht(t.received + t.pending - t.spent)}`,
      "",
      "ดูรายการรับ-จ่ายทั้งหมดได้ที่",
      `${window.location.origin}/fund`,
    ].filter((x) => x !== "");
    await copy(lines.join("\n"));
    setToast("คัดลอกสรุปแล้ว วางในกลุ่ม LINE ได้เลย");
  }

  return (
    <div className="min-h-screen bg-stone-100 text-neutral-900">
      <header className="sticky top-0 z-[900] bg-black text-white shadow">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
          <a href="/" className="min-h-[44px] min-w-[44px] rounded-lg bg-white/10 px-3 text-xl leading-[44px]" aria-label="กลับหน้าแรก">‹</a>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">💰 เงินสมทบทีมอาสา</h1>
            <p className="truncate text-xs text-neutral-400">หมู่บ้านสหกรณ์ฯ 4 · บัญชีเดียว ยอดเดียว ทุกคนเห็น</p>
          </div>
          <button onClick={copySummary} className="min-h-[44px] shrink-0 rounded-lg bg-white/10 px-3 text-sm font-semibold">📋 สรุปไป LINE</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-3 px-3 pb-10 pt-3">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat big label="💰 ยอดสมทบทั้งหมด" value={baht(t.received + t.pending)} sub={`${t.count_confirmed + t.count_pending} รายการ`} />
          <Stat label="✅ ตรวจกับบัญชีแล้ว" value={baht(t.received)} sub={t.count_pending ? `รอตรวจอีก ${baht(t.pending)}` : "ครบแล้ว"} />
          <Stat label="🧾 ใช้ไปแล้ว" value={baht(t.spent)} />
          <Stat big label="💵 คงเหลือ" value={baht(t.received + t.pending - t.spent)} />
        </section>

        {acc && (
          <section className="rounded-2xl border-4 border-black bg-white p-3">
            <p className="text-sm font-semibold text-neutral-600">บัญชีรับเงินสมทบ</p>
            <p className="text-lg font-bold">{acc.bank} · {acc.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="select-all text-2xl font-black tabular-nums tracking-wide">{acc.number}</span>
              <button onClick={() => copy(acc.number.replace(/\D/g, "")).then(() => setToast("คัดลอกเลขบัญชีแล้ว"))} className="min-h-[40px] rounded-lg border-2 border-black px-3 text-sm font-semibold">
                คัดลอกเลขบัญชี
              </button>
            </div>
            {acc.note && <p className="mt-1 text-sm text-neutral-700">{acc.note}</p>}
          </section>
        )}

        <p className="rounded-xl bg-white p-3 text-sm text-neutral-700">
          ยอดในหน้านี้รวบรวมจากรายการรวมยอดในกลุ่ม LINE หมู่บ้าน อัปเดตเป็นรอบ ไม่ต้องกรอกเอง · ⏳ = รอเหรัญญิกตรวจกับบัญชี · ✅ = ตรวจแล้ว
        </p>

        {tre && <Treasurer tre={tre} onChanged={reload} setToast={setToast} keyMode={!!key} />}

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
          {[["in", `รายการรับ (${data.donations.length})`], ["out", `รายการจ่าย (${data.expenses.length})`]].map(([k, txt]) => (
            <button key={k} onClick={() => setTab(k)} aria-pressed={tab === k} className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === k ? "bg-white shadow" : "text-neutral-600"}`}>
              {txt}
            </button>
          ))}
        </div>

        {tab === "in" ? (
          <ul className="divide-y divide-neutral-200 rounded-xl bg-white">
            {data.donations.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <b className="break-words">{d.name}</b>
                  <span className="block text-xs text-neutral-500">
                    {PURPOSES[d.purpose]} · {d.transferred_at || timeAgo(d.created_at)}
                    {d.source === "cash" && " · เงินสด"}
                    {d.source === "line" && " · จากกลุ่ม LINE"}
                  </span>
                </span>
                <span className={`rounded px-1.5 text-xs font-semibold ${STATUS[d.status].cls}`}>{STATUS[d.status].label}</span>
                <b className="w-28 text-right tabular-nums">{baht(d.amount)}</b>
              </li>
            ))}
            {!data.donations.length && <li className="p-4 text-center text-neutral-500">ยังไม่มีรายการ</li>}
          </ul>
        ) : (
          <ul className="space-y-2">
            {data.expenses.map((x) => (
              <li key={x.id} className="rounded-xl bg-white p-3">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <b className="break-words">{x.item}</b>
                    <span className="block text-xs text-neutral-500">
                      {PURPOSES[x.purpose]} · {x.spent_at || timeAgo(x.created_at)}
                      {x.paid_by && ` · จ่ายโดย ${x.paid_by}`}
                    </span>
                    {x.note && <span className="block text-sm">{x.note}</span>}
                  </span>
                  <b className="tabular-nums">{baht(x.amount)}</b>
                </div>
                {x.receipts?.length > 0 && (
                  <div className="mt-2 flex gap-2">
                    {x.receipts.map((m) => (
                      <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noreferrer">
                        <img src={mediaUrl(m.id, "thumb")} alt="ใบเสร็จ" loading="lazy" className="h-16 w-16 rounded object-cover" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {!data.expenses.length && <li className="rounded-xl bg-white p-4 text-center text-neutral-500">ยังไม่มีรายการจ่าย</li>}
          </ul>
        )}

        <p className="text-xs text-neutral-500">
          เว็บนี้ไม่ได้รับหรือโอนเงิน เป็นสมุดบัญชีให้ทุกคนเห็นตรงกัน · ระวังมิจฉาชีพ: โอนเฉพาะบัญชีที่แสดงในหน้านี้ ถ้ามีคนส่งเลขบัญชีอื่นมา ให้ถามทีมอาสาก่อน
        </p>
      </main>

      {toast && (
        <div role="status" className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Stat({ label: l, value, sub, big }) {
  return (
    <div className={`rounded-xl p-2 ${big ? "bg-black text-white" : "bg-white"}`}>
      <p className={`text-xs ${big ? "text-neutral-300" : "text-neutral-500"}`}>{l}</p>
      <p className="text-lg font-black tabular-nums sm:text-xl">{value}</p>
      {sub && <p className={`text-xs ${big ? "text-neutral-300" : "text-neutral-500"}`}>{sub}</p>}
    </div>
  );
}

// ---------- treasurer: check reports against the bank app, add cash, record spending ----------
function Treasurer({ tre, onChanged, setToast, keyMode }) {
  const [name, setName] = useState(() => load("fundName", ""));
  const [show, setShow] = useState("pending");
  const [add, setAdd] = useState(null); // "in" | "out"
  const [edit, setEdit] = useState({}); // id -> amount text
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
  const list = tre.donations.filter((d) => show === "all" || d.status === show);
  const added = (msg) => {
    setAdd(null);
    onChanged();
    setToast(msg);
  };
  const review = (d, status) =>
    run(
      () => fapi(`/fund/donations/${d.id}/review`, { method: "POST", body: JSON.stringify({ status, amount: edit[d.id] ? Number(edit[d.id]) : null }) }),
      status === "confirmed" ? "✅ ตรวจแล้ว" : status === "rejected" ? "บันทึกว่าไม่พบยอด" : "ย้ายกลับไปรอตรวจ"
    );
  return (
    <section className="space-y-3 rounded-2xl border-4 border-amber-500 bg-amber-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-bold">🔑 โหมดเหรัญญิก {tre.who && <span className="text-sm font-normal">· {tre.who}</span>}</h2>
        {keyMode && (
          <input
            aria-label="ชื่อเหรัญญิก"
            maxLength={40}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              save("fundName", e.target.value);
            }}
            className="min-h-[40px] w-40 rounded-lg border border-neutral-300 px-2 text-sm"
            placeholder="ชื่อคุณ (บันทึกว่าใครตรวจ)"
          />
        )}
      </div>
      <p className="text-sm">เปิดแอปธนาคาร เทียบทีละรายการ: เจอยอดตรงกด ✅ · ไม่เจอกด ❌ · ยอดไม่ตรง แก้ตัวเลขก่อนกด ✅</p>
      <div className="flex flex-wrap gap-2">
        {[["pending", `⏳ รอตรวจ (${tre.totals.count_pending})`], ["confirmed", "✅ ตรวจแล้ว"], ["rejected", "❌ ไม่พบ"], ["all", "ทั้งหมด"]].map(([k, txt]) => (
          <button key={k} onClick={() => setShow(k)} aria-pressed={show === k} className={`min-h-[40px] rounded-full px-3 text-sm ${show === k ? "bg-black font-semibold text-white" : "border border-neutral-400 bg-white"}`}>
            {txt}
          </button>
        ))}
        <button onClick={() => setAdd(add === "in" ? null : "in")} className="min-h-[40px] rounded-full border-2 border-black bg-white px-3 text-sm font-semibold">➕ รับเงินสด / ยอดที่ไม่มีคนแจ้ง</button>
        <button onClick={() => setAdd(add === "out" ? null : "out")} className="min-h-[40px] rounded-full border-2 border-black bg-white px-3 text-sm font-semibold">🧾 บันทึกรายจ่าย</button>
      </div>
      {add && (add === "in" ? <AddDonation onDone={() => added("บันทึกรายรับแล้ว")} /> : <AddExpense onDone={() => added("บันทึกรายจ่ายแล้ว")} />)}
      <ul className="space-y-2">
        {list.map((d) => (
          <li key={d.id} className="rounded-xl bg-white p-2">
            <div className="flex flex-wrap items-start gap-2">
              {d.slip?.[0] ? (
                <a href={mediaUrl(d.slip[0].id)} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={mediaUrl(d.slip[0].id, "thumb")} alt="สลิป" className="h-20 w-16 rounded object-cover" />
                </a>
              ) : (
                <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded bg-neutral-100 text-xs text-neutral-500">ไม่มีสลิป</span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-lg font-black tabular-nums">{baht(d.amount)}</p>
                <p>
                  <b>{d.name}</b>
                  {d.anonymous && " (ไม่ออกนาม)"}
                  {d.house && ` · ${d.house}`}
                </p>
                <p className="text-neutral-600">
                  {PURPOSES[d.purpose]} · โอน {d.transferred_at || "-"} · แจ้ง {timeAgo(d.created_at)}
                  {d.source !== "form" && ` · ${d.source === "cash" ? "เงินสด" : "เหรัญญิกบันทึก"}`}
                </p>
                {d.note && <p>{d.note}</p>}
                {d.reviewed_by && <p className="text-xs text-neutral-500">{STATUS[d.status].label} โดย {d.reviewed_by}</p>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input aria-label="แก้ยอด" inputMode="decimal" value={edit[d.id] ?? ""} onChange={(e) => setEdit({ ...edit, [d.id]: e.target.value })} className="min-h-[40px] w-28 rounded-lg border border-neutral-300 px-2 text-sm" placeholder="แก้ยอด" />
              {d.status !== "confirmed" && <button onClick={() => review(d, "confirmed")} className="min-h-[40px] rounded-lg bg-emerald-600 px-3 font-bold text-white">✅ เจอยอด</button>}
              {d.status !== "rejected" && <button onClick={() => review(d, "rejected")} className="min-h-[40px] rounded-lg bg-red-600 px-3 font-bold text-white">❌ ไม่พบ</button>}
              {d.status !== "pending" && <button onClick={() => review(d, "pending")} className="min-h-[40px] rounded-lg border border-black px-3">↩️ รอตรวจ</button>}
              <button
                onClick={() => window.confirm(`ลบรายการ ${d.name} ${baht(d.amount)}? (ใช้กับรายการซ้ำ/แจ้งผิด)`) && run(() => fapi(`/fund/donations/${d.id}`, { method: "DELETE" }), "ลบแล้ว")}
                className="min-h-[40px] px-2 text-sm text-red-700 underline"
              >
                ลบ (ซ้ำ)
              </button>
            </div>
          </li>
        ))}
        {!list.length && <li className="rounded-xl bg-white p-3 text-center text-neutral-500">ไม่มีรายการ</li>}
      </ul>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
    </section>
  );
}

function AddDonation({ onDone }) {
  const [f, setF] = useState({ name: "", house: "", amount: "", transferred_at: "", purpose: "food", source: "cash", note: "" });
  const [err, setErr] = useState("");
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function submit(e) {
    e.preventDefault();
    try {
      await fapi("/fund/treasurer/donations", { method: "POST", body: JSON.stringify({ ...f, amount: Number(f.amount), status: "confirmed" }) });
      onDone();
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl bg-white p-2 sm:grid-cols-2">
      <input required maxLength={60} value={f.name} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อผู้ให้" aria-label="ชื่อผู้ให้" />
      <input required type="number" inputMode="decimal" min="1" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={input} placeholder="จำนวนเงิน" aria-label="จำนวนเงิน" />
      <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={input} aria-label="ช่องทาง">
        <option value="cash">เงินสด</option>
        <option value="transfer">โอน (เห็นในแอปธนาคาร)</option>
        <option value="line">จากรายการในกลุ่ม LINE</option>
      </select>
      <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} className={input} aria-label="สมทบค่าอะไร">
        {Object.entries(PURPOSES).map(([k, v]) => (
          <option key={k} value={k}>{v}</option>
        ))}
      </select>
      <input maxLength={40} value={f.transferred_at} onChange={(e) => set({ transferred_at: e.target.value })} className={input} placeholder="เมื่อไหร่" aria-label="เมื่อไหร่" />
      <button className="min-h-[44px] rounded-lg bg-black font-bold text-white">บันทึกรายรับ (ตรวจแล้ว)</button>
      {err && <p className="text-red-700 sm:col-span-2">{err}</p>}
    </form>
  );
}

function AddExpense({ onDone }) {
  const [f, setF] = useState({ item: "", amount: "", purpose: "food", paid_by: load("fundName", ""), spent_at: "", note: "" });
  const [rc, setRc] = useState([]);
  const [err, setErr] = useState("");
  const st = mediaState(rc);
  const set = (p) => setF((x) => ({ ...x, ...p }));
  async function submit(e) {
    e.preventDefault();
    try {
      await fapi("/fund/expenses", { method: "POST", body: JSON.stringify({ ...f, amount: Number(f.amount), receipt_ids: st.ids }) });
      onDone();
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-2 rounded-xl bg-white p-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <input required minLength={2} maxLength={120} value={f.item} onChange={(e) => set({ item: e.target.value })} className={input} placeholder="ซื้ออะไร เช่น ข้าวกล่อง 100 กล่อง" aria-label="ซื้ออะไร" />
        <input required type="number" inputMode="decimal" min="1" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={input} placeholder="จำนวนเงิน" aria-label="จำนวนเงิน" />
        <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} className={input} aria-label="หมวด">
          {Object.entries(PURPOSES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input maxLength={60} value={f.paid_by} onChange={(e) => set({ paid_by: e.target.value })} className={input} placeholder="ใครจ่าย" aria-label="ใครจ่าย" />
        <input maxLength={40} value={f.spent_at} onChange={(e) => set({ spent_at: e.target.value })} className={input} placeholder="เมื่อไหร่" aria-label="เมื่อไหร่" />
        <input maxLength={200} value={f.note} onChange={(e) => set({ note: e.target.value })} className={input} placeholder="หมายเหตุ" aria-label="หมายเหตุ" />
      </div>
      <MediaPicker items={rc} setItems={setRc} max={3} allowVideo={false} />
      <button disabled={st.busy} className="min-h-[44px] w-full rounded-lg bg-black font-bold text-white disabled:opacity-60">{st.busy ? "รอรูปใบเสร็จ…" : "บันทึกรายจ่าย"}</button>
      {err && <p className="text-red-700">{err}</p>}
    </form>
  );
}
