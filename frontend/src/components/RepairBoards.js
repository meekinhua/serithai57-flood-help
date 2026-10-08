import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { ISSUE_STATUS, ISSUE_TYPES, JOB_STATUS, JOB_TYPES, JOB_VERBS, LEND_CATEGORIES, LEND_KINDS, LEND_STATUS, timeAgo } from "../config";
import { mediaUrl } from "../media";
import { createBaseMap } from "./MapView";
import LocationPicker from "./LocationPicker";
import MediaPicker, { mediaState } from "./MediaPicker";

// After the flood: lend & borrow, ask for hands, soi problems, and the after-flood checklist.
// Same rules as the flood board: no accounts, an edit key in this browser, phones shown one item at a time.

export const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const label = "mb-1 block font-medium";
const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, "")}`;

// Edit keys live in localStorage; read them on every render so a board sees a key the form just saved.
function useKeys(store) {
  const [, setTick] = useState(0);
  const keys = load(store, {});
  const add = (id, key) => {
    save(store, { ...load(store, {}), [id]: key });
    setTick((t) => t + 1);
  };
  const drop = (id) => {
    const next = { ...load(store, {}) };
    delete next[id];
    save(store, next);
    setTick((t) => t + 1);
  };
  return [keys, add, drop];
}

function savedContact() {
  return load("contact", { name: "", phone: "" });
}

function remember(name, phone) {
  save("contact", { ...savedContact(), ...(name ? { name } : {}), ...(phone ? { phone } : {}) });
}

function Chips({ options, value, onChange, all = "ทั้งหมด", counts = {} }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 pb-1">
      <div className="flex w-max gap-2">
        {[["all", ["", all]], ...Object.entries(options)].map(([key, [emoji, text]]) => (
          <button
            key={key}
            onClick={() => onChange(key)}
            aria-pressed={value === key}
            className={`flex min-h-[40px] items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm ${value === key ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}
          >
            {emoji} {text}
            {key !== "all" && counts[key] > 0 && <span className={`rounded-full px-1.5 text-xs ${value === key ? "bg-white text-black" : "bg-black text-white"}`}>{counts[key]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Badge({ cls, children }) {
  return <span className={`rounded px-1.5 text-sm font-semibold ${cls}`}>{children}</span>;
}

// Tap to show the phone (one item at a time, like the flood board)
function ContactButton({ path, text = "📞 ดูเบอร์ติดต่อ" }) {
  const [c, setC] = useState(null);
  const [err, setErr] = useState("");
  if (c)
    return (
      <div className="space-y-1">
        {c.phone ? (
          <a href={telHref(c.phone)} className="flex min-h-[52px] items-center justify-center rounded-xl bg-[#1E6B47] px-3 text-lg font-bold text-white">
            📞 {c.phone}
          </a>
        ) : (
          <p className="rounded-lg bg-neutral-100 p-2 text-sm">ไม่ได้ใส่เบอร์ไว้</p>
        )}
        {c.house && <p className="text-sm">🏠 บ้านเลขที่ {c.house}</p>}
      </div>
    );
  return (
    <>
      <button
        onClick={() =>
          api(path)
            .then(setC)
            .catch((e) => setErr(e.message))
        }
        className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] px-3 font-bold text-white active:bg-[#154D33]"
      >
        {text}
      </button>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </>
  );
}

function Photos({ media }) {
  if (!media?.length) return null;
  return (
    <div className="mt-2 flex gap-2">
      {media.map((m) => (
        <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noreferrer">
          <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="h-20 w-20 rounded-lg object-cover" />
        </a>
      ))}
    </div>
  );
}

function History({ items }) {
  if (!items?.length) return null;
  return (
    <details className="mt-1 text-sm text-neutral-600">
      <summary className="min-h-[36px] cursor-pointer">ประวัติ ({items.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {[...items].reverse().map((h, i) => (
          <li key={i}>
            {timeAgo(h.at)} · <b>{h.by}</b> {h.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

function NameField({ value, onChange, id, labelText = "ชื่อเล่น *" }) {
  return (
    <div>
      <label className={label} htmlFor={id}>
        {labelText}
      </label>
      <input id={id} required maxLength={60} value={value} onChange={(e) => onChange(e.target.value)} className={input} />
    </div>
  );
}

function SoiField({ value, onChange, id }) {
  return (
    <div>
      <label className={label} htmlFor={id}>
        ซอย / แยก
      </label>
      <input id={id} maxLength={12} value={value} onChange={(e) => onChange(e.target.value)} className={input} placeholder="เช่น 15, 34/5" />
    </div>
  );
}

// =====================================================================
// 🧰 ยืม · ให้ยืม · ให้ฟรี · ตามหา
// =====================================================================
export function LendBoard({ items, setItems, admin, onAdd }) {
  const [kind, setKind] = useState("all");
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [keys, , dropKey] = useKeys("lendKeys");
  const counts = useMemo(() => items.reduce((c, x) => ({ ...c, [x.category]: (c[x.category] || 0) + 1 }), {}), [items]);
  const query = q.trim().toLowerCase();
  const shown = items.filter(
    (x) => (kind === "all" || x.kind === kind) && (cat === "all" || x.category === cat) && (!query || `${x.title} ${x.detail} ${x.soi} ${x.name}`.toLowerCase().includes(query)),
  );
  const upsert = (x) => setItems((prev) => prev.map((y) => (y.id === x.id ? x : y)));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Object.entries(LEND_KINDS).map(([k, v]) => (
          <button key={k} onClick={() => onAdd(k)} className="min-h-[56px] rounded-xl border-2 border-black bg-white px-1 text-sm font-bold leading-tight active:bg-neutral-100">
            {v.emoji} {v.verb}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1 rounded-xl bg-neutral-200 p-1">
        {[["all", "ทั้งหมด"], ...Object.entries(LEND_KINDS).map(([k, v]) => [k, `${v.emoji} ${v.label}`])].map(([k, t]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`min-h-[40px] rounded-lg text-xs font-semibold sm:text-sm ${kind === k ? "bg-white shadow" : "text-neutral-600"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ค้นหา เช่น ฉีดน้ำ, บันได, ซอย 15" className={input} />
      <Chips options={LEND_CATEGORIES} value={cat} onChange={setCat} counts={counts} />
      <ul className="space-y-2">
        {shown.map((x) => (
          <LendCard
            key={x.id}
            item={x}
            editKey={keys[x.id]}
            admin={admin}
            onChanged={upsert}
            onDeleted={(id) => {
              dropKey(id);
              setItems((p) => p.filter((y) => y.id !== id));
            }}
          />
        ))}
      </ul>
      {!shown.length && (
        <p className="rounded-xl bg-white p-4 text-center text-neutral-600">
          {items.length ? "ไม่พบในหมวด/คำค้นนี้" : "ยังไม่มีใครลงของ · มีเครื่องฉีดน้ำ บันได ปั๊ม อยู่บ้าน? ลงให้เพื่อนบ้านยืมได้เลย"}
        </p>
      )}
      <p className="text-xs text-neutral-500">ตกลงเรื่องมัดจำ / ค่าน้ำมัน / วันคืน กันเอง · ถ่ายรูปสภาพของก่อนให้ยืม · ระบบไม่รับเงิน</p>
    </div>
  );
}

function LendCard({ item: x, editKey, admin, onChanged, onDeleted }) {
  const [emoji, catText] = LEND_CATEGORIES[x.category] || ["📦", x.category];
  const k = LEND_KINDS[x.kind];
  const st = LEND_STATUS[x.status];
  const [open, setOpen] = useState(false);
  const mine = !!editKey;
  return (
    <li className={`anim-row rounded-xl border bg-white p-3 shadow-sm ${x.status === "closed" ? "opacity-60" : ""}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl" aria-hidden="true">
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge cls="bg-black text-white">
              {k.emoji} {k.label}
            </Badge>
            {x.kind !== "want" && (
              <Badge cls={st.cls}>
                {st.label}
                {x.status === "lent" && x.until ? ` · ${x.until}` : ""}
              </Badge>
            )}
            {x.queue_count > 0 && <Badge cls="bg-sky-100 text-sky-800">รอคิว {x.queue_count}</Badge>}
            {mine && <Badge cls="bg-yellow-200">ของฉัน</Badge>}
          </span>
          <span className="mt-0.5 block break-words text-lg font-bold leading-snug">{x.title}</span>
          {x.price && <span className="block text-lg font-bold text-[#8F2A1C]">{x.price}</span>}
          <span className="block text-sm text-neutral-600">
            {catText} · {x.name}
            {x.soi && ` · ซ.${x.soi}`} · {timeAgo(x.created_at)}
          </span>
        </span>
        <span className="text-neutral-400">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {x.detail && <p className="whitespace-pre-wrap break-words">{x.detail}</p>}
          <Photos media={x.media} />
          {mine || admin ? <LendOwner item={x} editKey={editKey} onChanged={onChanged} onDeleted={onDeleted} /> : <LendVisitor item={x} onChanged={onChanged} />}
          <History items={x.history} />
        </div>
      )}
    </li>
  );
}

function LendVisitor({ item: x, onChanged }) {
  const c = savedContact();
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  if (x.status === "closed") return <p className="text-sm text-neutral-500">รายการนี้ปิดแล้ว</p>;
  if (x.kind !== "lend") return <ContactButton path={`/lend/${x.id}/contact`} text={x.kind === "give" ? "📞 ติดต่อขอรับ" : x.kind === "sell" ? "📞 ติดต่อผู้ขาย" : "📞 ฉันมี · ติดต่อคนตามหา"} />;
  async function join(e) {
    e.preventDefault();
    setErr("");
    try {
      onChanged(await api(`/lend/${x.id}/queue`, { method: "POST", body: JSON.stringify(form) }));
      remember(form.name, form.phone);
      setDone(true);
      setForm(null);
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <div className="space-y-2">
      {done && <p className="rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-800">✅ ต่อคิวแล้ว เจ้าของจะเห็นชื่อและเบอร์คุณ แล้วโทรกลับ</p>}
      {form ? (
        <form onSubmit={join} className="space-y-2 rounded-xl border-2 border-black p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <NameField id={`q-name-${x.id}`} value={form.name} onChange={(name) => setForm({ ...form, name })} />
            <div>
              <label className={label} htmlFor={`q-phone-${x.id}`}>
                เบอร์โทร *
              </label>
              <input id={`q-phone-${x.id}`} required type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
            </div>
          </div>
          <input maxLength={160} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={input} placeholder="ใช้เมื่อไหร่ นานแค่ไหน เช่น เสาร์เช้า ครึ่งวัน" />
          <p className="text-xs text-neutral-500">ชื่อ/เบอร์ เห็นเฉพาะเจ้าของของชิ้นนี้</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm(null)} className="min-h-[48px] rounded-xl border-2 border-black font-semibold">
              ยกเลิก
            </button>
            <button className="min-h-[48px] rounded-xl bg-[#1E6B47] font-bold text-white">ต่อคิว</button>
          </div>
        </form>
      ) : (
        !done && (
          <button onClick={() => setForm({ name: c.name || "", phone: c.phone || "", note: "" })} className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] px-3 font-bold text-white">
            🙋 ขอยืม (ต่อคิว){x.queue_count ? ` · รออยู่ ${x.queue_count}` : ""}
          </button>
        )
      )}
      <ContactButton path={`/lend/${x.id}/contact`} text="📞 หรือโทรหาเจ้าของ" />
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

function LendOwner({ item: x, editKey, onChanged, onDeleted }) {
  const [full, setFull] = useState(null);
  const [lendTo, setLendTo] = useState(null); // {lent_to, until}
  const [err, setErr] = useState("");
  const headers = { "X-Edit-Key": editKey || "" };
  useEffect(() => {
    api(`/lend/${x.id}/owner`, { headers })
      .then(setFull)
      .catch((e) => setErr(e.message));
  }, [x.id, x.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const patch = (body) => run(async () => onChanged(await api(`/lend/${x.id}`, { method: "PATCH", headers, body: JSON.stringify(body) })));
  const queue = (full?.queue || []).filter((q) => !q.done);
  return (
    <div className="space-y-2 rounded-xl bg-yellow-50 p-3">
      <p className="font-bold">🔑 จัดการของคุณ</p>
      {x.kind === "lend" && (
        <>
          <p className="text-sm font-semibold">คิวขอยืม ({queue.length})</p>
          <ul className="space-y-1">
            {queue.map((q, i) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm">
                <b>
                  {i + 1}. {q.name}
                </b>
                <a href={telHref(q.phone)} className="font-semibold underline">
                  📞 {q.phone}
                </a>
                {q.note && <span className="w-full text-neutral-600">{q.note}</span>}
                <button onClick={() => setLendTo({ lent_to: q.name, until: "" })} className="min-h-[40px] rounded-lg bg-[#1E6B47] px-2 text-white">
                  ให้คนนี้ยืม
                </button>
                <button onClick={() => run(async () => setFull(await api(`/lend/${x.id}/queue/${q.id}/done`, { method: "POST", headers })))} className="min-h-[40px] px-2 underline">
                  เอาออกจากคิว
                </button>
              </li>
            ))}
            {!queue.length && <li className="text-sm text-neutral-500">ยังไม่มีคนขอคิว</li>}
          </ul>
          {lendTo ? (
            <div className="space-y-2 rounded-lg border-2 border-black bg-white p-2">
              <input maxLength={60} value={lendTo.lent_to} onChange={(e) => setLendTo({ ...lendTo, lent_to: e.target.value })} className={input} placeholder="ให้ใครยืม" />
              <input maxLength={40} value={lendTo.until} onChange={(e) => setLendTo({ ...lendTo, until: e.target.value })} className={input} placeholder="คืนเมื่อไหร่ เช่น คืนเสาร์ 4 ต.ค." />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setLendTo(null)} className="min-h-[44px] rounded-lg border-2 border-black">
                  ยกเลิก
                </button>
                <button
                  onClick={() => {
                    patch({ status: "lent", ...lendTo });
                    setLendTo(null);
                  }}
                  className="min-h-[44px] rounded-lg bg-[#1E6B47] font-bold text-white"
                >
                  บันทึก ให้ยืมแล้ว
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {x.status !== "lent" ? (
                <button onClick={() => setLendTo({ lent_to: queue[0]?.name || "", until: "" })} className="min-h-[44px] rounded-lg bg-[#1E6B47] font-semibold text-white">
                  📤 ให้ยืมไปแล้ว
                </button>
              ) : (
                <button onClick={() => patch({ status: "available" })} className="min-h-[44px] rounded-lg bg-[#1E6B47] font-semibold text-white">
                  📥 ได้คืนแล้ว · ว่าง
                </button>
              )}
              <button onClick={() => patch({ status: "closed" })} className="min-h-[44px] rounded-lg border-2 border-black font-semibold">
                ปิดรายการ
              </button>
            </div>
          )}
        </>
      )}
      {x.kind !== "lend" && x.status !== "closed" && (
        <button onClick={() => patch({ status: "closed" })} className="min-h-[44px] w-full rounded-lg bg-[#1E6B47] font-semibold text-white">
          {x.kind === "give" ? "✅ มีคนรับไปแล้ว · ปิด" : x.kind === "sell" ? "✅ ขายแล้ว · ปิด" : "✅ หาได้แล้ว · ปิด"}
        </button>
      )}
      {x.status === "closed" && (
        <button onClick={() => patch({ status: "available" })} className="min-h-[44px] w-full rounded-lg border-2 border-black font-semibold">
          เปิดรายการอีกครั้ง
        </button>
      )}
      <button
        onClick={() =>
          window.confirm("ลบรายการนี้?") &&
          run(async () => {
            await api(`/lend/${x.id}`, { method: "DELETE", headers });
            onDeleted(x.id);
          })
        }
        className="min-h-[40px] text-sm text-red-700 underline"
      >
        ลบรายการ
      </button>
      {err && <p className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

export function LendForm({ kind: initialKind = "lend", onDone }) {
  const c = savedContact();
  const [, addKey] = useKeys("lendKeys");
  const [form, setForm] = useState({ kind: initialKind, category: "", title: "", detail: "", price: "", soi: load("mySoi", ""), name: c.name || "", phone: c.phone || "" });
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!form.category) return setErr("เลือกประเภทของ");
    setBusy(true);
    setErr("");
    try {
      const x = await api("/lend", { method: "POST", body: JSON.stringify({ ...form, media_ids: attached.ids }) });
      addKey(x.id, x.edit_key);
      remember(form.name, form.phone);
      save("mySoi", form.soi);
      onDone(x);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  const want = form.kind === "want";
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1 min-[400px]:grid-cols-4">
        {Object.entries(LEND_KINDS).map(([k, v]) => (
          <button
            type="button"
            key={k}
            onClick={() => set({ kind: k })}
            aria-pressed={form.kind === k}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${form.kind === k ? "bg-white shadow" : "text-neutral-600"}`}
          >
            {v.emoji} {v.label}
          </button>
        ))}
      </div>
      <fieldset>
        <legend className={label}>เป็นของประเภทไหน *</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(LEND_CATEGORIES).map(([k, [emoji, text]]) => (
            <button
              type="button"
              key={k}
              onClick={() => set({ category: k })}
              aria-pressed={form.category === k}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-2 text-left text-sm ${form.category === k ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={label} htmlFor="lend-title">
          {want ? "ตามหาอะไร *" : form.kind === "sell" ? "ขายอะไร *" : "ของอะไร *"}
        </label>
        <input
          id="lend-title"
          required
          minLength={2}
          maxLength={80}
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          className={input}
          placeholder={want ? "เช่น บันไดสูง 3 เมตร ขอยืมครึ่งวัน" : "เช่น เครื่องฉีดน้ำแรงดันสูง Karcher K3"}
        />
      </div>
      {form.kind === "sell" && (
        <div>
          <label className={label} htmlFor="lend-price">
            ราคา *
          </label>
          <input id="lend-price" required maxLength={60} value={form.price} onChange={(e) => set({ price: e.target.value })} className={input} placeholder="เช่น 150 บาท, ต่อรองได้" />
        </div>
      )}
      <div>
        <label className={label} htmlFor="lend-detail">
          รายละเอียด
        </label>
        <textarea
          id="lend-detail"
          rows={3}
          maxLength={400}
          value={form.detail}
          onChange={(e) => set({ detail: e.target.value })}
          className={input}
          placeholder={want ? "ใช้ทำอะไร ใช้เมื่อไหร่" : "สภาพ / ยืมได้นานเท่าไหร่ / มัดจำไหม / มารับที่ไหน / ต้องใช้ปลั๊กหรือน้ำมัน"}
        />
      </div>
      {!want && (
        <div>
          <p className={label}>รูป (ไม่บังคับ)</p>
          <MediaPicker items={media} setItems={setMedia} max={3} allowVideo={false} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <NameField id="lend-name" value={form.name} onChange={(name) => set({ name })} />
        <div>
          <label className={label} htmlFor="lend-phone">
            เบอร์โทร {want ? "" : "*"}
          </label>
          <input id="lend-phone" required={!want} type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
        </div>
        <SoiField id="lend-soi" value={form.soi} onChange={(soi) => set({ soi })} />
      </div>
      <p className="text-sm text-neutral-500">เบอร์จะแสดงเมื่อมีคนกดดูทีละรายการ · คนขอยืมต่อคิวไว้ คุณเห็นชื่อและเบอร์เขา · จัดการ/ปิดรายการได้จากเครื่องนี้</p>
      {err && <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>}
      <button disabled={busy || attached.busy} className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : attached.busy ? "รอรูปอัปโหลด…" : `${LEND_KINDS[form.kind].emoji} ลงรายการ`}
      </button>
    </form>
  );
}

// =====================================================================
// 🙋 ขอแรง / อาสาไปช่วย
// =====================================================================
const FREE_TYPES = Object.fromEntries(Object.entries(JOB_TYPES).filter(([k]) => k !== "hire"));
export function JobBoard({ jobs: all, setJobs, admin, onAdd, onPaid }) {
  const [kind, setKind] = useState("need");
  const [type, setType] = useState("all");
  const [keys, , dropKey] = useKeys("jobKeys");
  const jobs = all.filter((j) => j.type !== "hire"); // paid "หาช่าง" posts are listed on ช่าง·ร้าน
  const list = jobs.filter((j) => j.kind === kind && (type === "all" || j.type === type));
  const counts = useMemo(() => jobs.filter((j) => j.kind === kind).reduce((c, x) => ({ ...c, [x.type]: (c[x.type] || 0) + 1 }), {}), [jobs, kind]);
  const upsert = (j) => setJobs((prev) => prev.map((y) => (y.id === j.id ? j : y)));
  const needs = jobs.filter((j) => j.kind === "need").length;
  const offers = jobs.filter((j) => j.kind === "offer").length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onAdd("need")} className="min-h-[56px] rounded-xl bg-[#1E6B47] px-2 font-bold text-white">
          🙋 ขอแรง / ขอติดรถ / ฝากซื้อ
        </button>
        <button onClick={() => onAdd("offer")} className="min-h-[56px] rounded-xl border-2 border-black bg-white px-2 font-bold">
          💪 ฉันช่วยได้ / มีรถออกไป
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["need", `ขอความช่วยเหลือ (${needs})`],
          ["offer", `พร้อมช่วย / มีรถ (${offers})`],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-[44px] rounded-lg text-sm font-semibold ${kind === k ? "bg-white shadow" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      {onPaid && (
        <button onClick={onPaid} className="min-h-[44px] w-full rounded-xl bg-[#F2F4F1] px-3 text-left text-[15px]">
          ช่วยกันด้วยน้ำใจ ไม่มีค่าจ้าง · <b>จะจ้างช่าง หรือรับจ้าง/มีร้าน → ช่าง·ร้าน ›</b>
        </button>
      )}
      <Chips options={FREE_TYPES} value={type} onChange={setType} counts={counts} />
      <ul className="space-y-2">
        {list.map((j) => (
          <JobCard
            key={j.id}
            job={j}
            mine={!!keys[j.id]}
            editKey={keys[j.id]}
            admin={admin}
            onChanged={upsert}
            onDeleted={(id) => {
              dropKey(id);
              setJobs((p) => p.filter((y) => y.id !== id));
            }}
          />
        ))}
      </ul>
      {!list.length && (
        <p className="rounded-xl bg-white p-4 text-center text-neutral-600">
          {kind === "need" ? "ตอนนี้ยังไม่มีบ้านไหนขอแรง · บ้านผู้สูงอายุ / อยู่คนเดียว ลงไว้ได้เลย อาสาจะเห็น" : "ยังไม่มีอาสาลงชื่อ · ว่างวันไหน ลงไว้ให้บ้านที่ต้องการแรงเห็น"}
        </p>
      )}
    </div>
  );
}

// the paid "หาช่าง" posts, shown on ช่าง·ร้าน for the tradesmen
export function HireList({ jobs, setJobs, admin }) {
  const [keys, , dropKey] = useKeys("jobKeys");
  const upsert = (j) => setJobs((prev) => prev.map((y) => (y.id === j.id ? j : y)));
  return (
    <ul className="space-y-2">
      {jobs.map((j) => (
        <JobCard
          key={j.id}
          job={j}
          mine={!!keys[j.id]}
          editKey={keys[j.id]}
          admin={admin}
          onChanged={upsert}
          onDeleted={(id) => {
            dropKey(id);
            setJobs((p) => p.filter((y) => y.id !== id));
          }}
        />
      ))}
    </ul>
  );
}

function JobCard({ job: j, mine, editKey, admin, onChanged, onDeleted }) {
  const [emoji, typeText] = JOB_TYPES[j.type] || ["🙋", j.type];
  const st = JOB_STATUS[j.status];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(() => savedContact().name || "");
  const [err, setErr] = useState("");
  const joined = load("jobsJoined", []).includes(j.id);
  const run = async (fn) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const join = () =>
    run(async () => {
      if (!name.trim()) throw new Error("ใส่ชื่อก่อน");
      onChanged(await api(`/jobs/${j.id}/join`, { method: "POST", body: JSON.stringify({ name }) }));
      remember(name.trim());
      save("jobsJoined", [...load("jobsJoined", []), j.id]);
    });
  const setStatus = (status) => run(async () => onChanged(await api(`/jobs/${j.id}/status`, { method: "POST", body: JSON.stringify({ status, name: name || j.name }) })));
  return (
    <li data-item={j.id} className={`anim-row scroll-mt-28 rounded-xl border bg-white p-3 shadow-sm ${j.status === "done" ? "opacity-60" : ""}`}>
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl" aria-hidden="true">
          {emoji}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge cls={st.cls}>{j.kind === "offer" && j.status === "open" ? "ว่าง พร้อมช่วย" : st.label}</Badge>
            {(j.kind === "need" || j.type === "ride") && (
              <Badge cls="bg-neutral-100">
                {j.type === "ride" ? "🚗" : "👥"} {j.helpers.length}/{j.people} {j.type === "ride" && j.kind === "offer" ? "ที่นั่ง" : "คน"}
              </Badge>
            )}
            {mine && <Badge cls="bg-yellow-200">ของฉัน</Badge>}
          </span>
          <span className="mt-0.5 block font-bold">{typeText}</span>
          <span className="line-clamp-2 block break-words text-sm text-neutral-700">{j.detail}</span>
          <span className="block text-xs text-neutral-500">
            {j.name}
            {j.soi && ` · ซ.${j.soi}`}
            {j.when && ` · 🗓️ ${j.when}`} · {timeAgo(j.created_at)}
          </span>
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="whitespace-pre-wrap break-words">{j.detail}</p>
          {j.helpers.length > 0 && (
            <p className="text-sm">
              {j.kind === "need" ? "💪 ไปช่วย:" : "🏠 ขอให้มาช่วย:"} {j.helpers.map((h) => h.name).join(" · ")}
            </p>
          )}
          {j.status !== "done" && !mine && (
            <div className="flex gap-2">
              <input aria-label="ชื่อของคุณ" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="ชื่อเล่นของคุณ" />
              <button onClick={join} disabled={joined} className="min-h-[44px] shrink-0 rounded-xl border border-[#1E6B47] bg-white px-3 font-bold text-[#1E6B47] disabled:opacity-50">
                {joined ? "✓ ลงชื่อแล้ว" : JOB_VERBS[j.type] ? JOB_VERBS[j.type][j.kind === "need" ? 0 : 1] : j.kind === "need" ? "🙋 ฉันจะไปช่วย" : "🏠 ขอให้มาช่วยบ้านฉัน"}
              </button>
            </div>
          )}
          <ContactButton path={`/jobs/${j.id}/contact`} text={j.kind === "need" ? "📞 ดูเบอร์ / บ้านเลขที่ เพื่อนัดเวลา" : "📞 ดูเบอร์อาสา"} />
          <div className="flex flex-wrap gap-2 text-sm">
            {j.status !== "scheduled" && j.status !== "done" && (
              <button onClick={() => setStatus("scheduled")} className="min-h-[40px] rounded-lg border border-black px-2">
                🗓️ นัดกันแล้ว
              </button>
            )}
            {j.status !== "done" && (
              <button onClick={() => setStatus("done")} className="min-h-[40px] rounded-lg border border-black px-2">
                ✅ เสร็จแล้ว
              </button>
            )}
            {j.status !== "open" && (
              <button onClick={() => setStatus("open")} className="min-h-[40px] rounded-lg border border-black px-2">
                ↩️ ยังต้องการคน
              </button>
            )}
            {(mine || admin) && (
              <button
                onClick={() =>
                  window.confirm("ลบประกาศนี้?") &&
                  run(async () => {
                    await api(`/jobs/${j.id}`, { method: "DELETE", headers: { "X-Edit-Key": editKey || "" } });
                    onDeleted(j.id);
                  })
                }
                className="min-h-[40px] px-2 text-red-700 underline"
              >
                ลบ
              </button>
            )}
          </div>
          <History items={j.history} />
        </div>
      )}
      {err && <p className="mt-1 text-sm text-red-700">{err}</p>}
    </li>
  );
}

export function JobForm({ kind = "need", jobType = "", onDone }) {
  const c = savedContact();
  const [, addKey] = useKeys("jobKeys");
  const [form, setForm] = useState({ kind, type: jobType, detail: "", soi: load("mySoi", ""), house: "", when: "", people: kind === "need" ? 2 : 1, name: c.name || "", phone: c.phone || "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const need = form.kind === "need";
  async function submit(e) {
    e.preventDefault();
    if (!form.type) return setErr(need ? "เลือกงานที่ต้องการให้ช่วย" : "เลือกงานที่ช่วยได้");
    setBusy(true);
    setErr("");
    try {
      const j = await api("/jobs", { method: "POST", body: JSON.stringify({ ...form, people: Number(form.people) || 1 }) });
      addKey(j.id, j.edit_key);
      remember(form.name, form.phone);
      save("mySoi", form.soi);
      onDone(j);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={label}>{need ? "ต้องการอะไร *" : "ช่วยอะไรได้ *"}</legend>
        {jobType !== "hire" && <p className="mb-2 text-sm text-neutral-600">{need ? "ขอแรงเพื่อนบ้าน ช่วยกันด้วยน้ำใจ" : "ช่วยเพื่อนบ้านด้วยน้ำใจ"} · ถ้าคิดค่าจ้าง ลงที่ ช่าง·ร้าน</p>}
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {Object.entries(jobType === "hire" ? { hire: JOB_TYPES.hire } : FREE_TYPES).map(([k, [emoji, text]]) => (
            <button
              type="button"
              key={k}
              onClick={() => set({ type: k })}
              aria-pressed={form.type === k}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-2 text-left text-sm ${form.type === k ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={label} htmlFor="job-detail">
          รายละเอียด *
        </label>
        <textarea
          id="job-detail"
          required
          minLength={3}
          rows={3}
          maxLength={400}
          value={form.detail}
          onChange={(e) => set({ detail: e.target.value })}
          className={input}
          placeholder={
            form.type === "ride"
              ? need
                ? "เช่น รถจมน้ำ ต้องไปหาหมอที่ รพ.นพรัตน์ พรุ่งนี้เช้า 2 คน"
                : "เช่น จะออกไปโลตัส/ตลาด บ่าย 3 ขากลับรับได้"
              : form.type === "errand"
                ? need
                  ? "เช่น ฝากซื้อยาความดัน + ถุงดำ ให้ยายซอย 6"
                  : "เช่น จะไปแม็คโคร รับฝากซื้อของได้"
                : form.type === "hire"
                  ? "เช่น หาช่างไฟ ปลั๊กชั้นล่างจมน้ำ ยังไม่กล้าเปิดเบรกเกอร์ / ช่างดูปั๊มน้ำ"
                  : need
                    ? "เช่น ชั้นล่างมีโคลน 2 ห้อง ตู้เสื้อผ้าพัง ต้องยกออก มีน้ำยา/ไม้ถูให้"
                    : "เช่น ว่างเสาร์-อาทิตย์ มีแรง 2 คน มีเครื่องฉีดน้ำ"
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="job-when">
            {need ? "สะดวกวันไหน" : "ว่างวันไหน"}
          </label>
          <input id="job-when" maxLength={60} value={form.when} onChange={(e) => set({ when: e.target.value })} className={input} placeholder="เช่น เสาร์ 4 ต.ค. 9 โมง" />
        </div>
        {(need || form.type === "ride") && (
          <div>
            <label className={label} htmlFor="job-people">
              {form.type === "ride" ? (need ? "กี่คนจะไป" : "ว่างกี่ที่นั่ง") : "ต้องการกี่คน"}
            </label>
            <input id="job-people" type="number" min={1} max={30} value={form.people} onChange={(e) => set({ people: e.target.value })} className={input} />
          </div>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <NameField id="job-name" value={form.name} onChange={(name) => set({ name })} />
        <div>
          <label className={label} htmlFor="job-phone">
            เบอร์โทร *
          </label>
          <input id="job-phone" required type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
        </div>
        <SoiField id="job-soi" value={form.soi} onChange={(soi) => set({ soi })} />
        {need && (
          <div>
            <label className={label} htmlFor="job-house">
              บ้านเลขที่ (ไม่บังคับ)
            </label>
            <input id="job-house" maxLength={20} value={form.house} onChange={(e) => set({ house: e.target.value })} className={input} placeholder="4/xxx" />
          </div>
        )}
      </div>
      <p className="text-sm text-neutral-500">เบอร์และบ้านเลขที่ แสดงเฉพาะคนที่กดดูทีละรายการ</p>
      {err && <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>}
      <button disabled={busy} className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : need ? "🙋 ลงประกาศขอแรง" : "💪 ลงชื่ออาสา"}
      </button>
    </form>
  );
}

// =====================================================================
// 🗑️ ปัญหาในซอย
// =====================================================================
// 7 Oct: a tool for the village office (คหบาล), not a complaint wall: one tap sends the open reports,
// soi by soi with how many neighbours confirmed each, to the office's LINE; the office sets the status here.
function OfficeSummary({ issues }) {
  const bySoi = {};
  for (const x of issues) (bySoi[x.soi || "ไม่ระบุซอย"] = bySoi[x.soi || "ไม่ระบุซอย"] || []).push(x);
  const sois = Object.keys(bySoi).sort((a, b) => (parseInt(a, 10) || 999) - (parseInt(b, 10) || 999));
  const lines = sois.flatMap((soi) =>
    bySoi[soi].map(
      (x) => `• ซ.${soi} ${ISSUE_TYPES[x.type]?.[1] || ""}${x.detail ? ` · ${x.detail}` : ""}${x.votes > 1 ? ` (เพื่อนบ้านยืนยัน ${x.votes})` : ""}${x.status === "reported" ? " · ส่งต่อแล้ว" : ""}`,
    ),
  );
  const text = `เรื่องที่ลูกบ้านแจ้งไว้ ยังไม่เสร็จ ${issues.length} เรื่อง
${lines.join("\n")}
รูป/ตำแหน่ง/อัปเดตสถานะ: ${window.location.origin}/#issues`;
  return (
    <a
      href={`https://line.me/R/share?text=${encodeURIComponent(text)}`}
      target="_blank"
      rel="noreferrer"
      className="flex min-h-[52px] w-full items-center justify-center rounded-xl border-2 border-[#06c755] bg-white text-base font-bold text-[#0B6B33]"
    >
      ส่งสรุปให้สำนักงานคหบาลทาง LINE ({issues.length} เรื่อง)
    </a>
  );
}

export function IssueBoard({ issues, setIssues, admin, onAdd }) {
  const [type, setType] = useState("all");
  const [showFixed, setShowFixed] = useState(false);
  const [all, setAll] = useState(null);
  useEffect(() => {
    if (showFixed)
      api("/issues?include_fixed=true")
        .then(setAll)
        .catch(() => {});
  }, [showFixed, issues]);
  const source = showFixed && all ? all : issues;
  const list = source.filter((x) => type === "all" || x.type === type);
  const counts = useMemo(() => issues.reduce((c, x) => ({ ...c, [x.type]: (c[x.type] || 0) + 1 }), {}), [issues]);
  const upsert = (x) => {
    setIssues((prev) => (x.status === "fixed" && !showFixed ? prev.filter((y) => y.id !== x.id) : prev.map((y) => (y.id === x.id ? x : y))));
    setAll((prev) => prev && prev.map((y) => (y.id === x.id ? x : y)));
  };
  return (
    <div className="space-y-3">
      <button onClick={onAdd} className="min-h-[56px] w-full rounded-xl bg-[#1E6B47] px-2 text-lg font-bold text-white">
        📍 แจ้งปัญหาในซอย
      </button>
      {issues.length > 0 && <OfficeSummary issues={issues} />}
      <IssueMap issues={list} />
      <Chips options={ISSUE_TYPES} value={type} onChange={setType} counts={counts} />
      <label className="flex min-h-[44px] items-center gap-2 text-sm">
        <input type="checkbox" checked={showFixed} onChange={(e) => setShowFixed(e.target.checked)} className="h-5 w-5" /> แสดงที่แก้แล้วด้วย
      </label>
      <ul className="space-y-2">
        {list.map((x) => (
          <IssueCard key={x.id} issue={x} admin={admin} onChanged={upsert} onDeleted={(id) => setIssues((p) => p.filter((y) => y.id !== id))} />
        ))}
      </ul>
      {!list.length && <p className="rounded-xl bg-white p-4 text-center text-neutral-600">ยังไม่มีปัญหาที่ค้างอยู่ 🎉</p>}
      <div className="rounded-xl border-2 border-black bg-white p-3 text-sm">
        <b>ส่งต่อให้เขตแก้:</b> แจ้งผ่าน{" "}
        <a href="https://citydata.traffy.in.th/" target="_blank" rel="noreferrer" className="font-semibold underline">
          Traffy Fondue
        </a>{" "}
        หรือโทร <b>1555</b> (กทม.) · สำนักงานเขตบึงกุ่ม · ไฟฟ้า/สายไฟ แจ้งการไฟฟ้ามีนบุรี
        <span className="block text-neutral-600">แจ้งแล้วกด “แจ้งเขตแล้ว” พร้อมเลขเรื่อง เพื่อนบ้านจะได้ไม่แจ้งซ้ำ</span>
      </div>
    </div>
  );
}

function issueIcon(x) {
  const [emoji] = ISSUE_TYPES[x.type] || ["📍"];
  const ring = x.status === "fixed" ? "#16a34a" : x.status === "reported" ? "#d97706" : "#dc2626";
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:9999px;background:#fff;border:3px solid ${ring};box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:17px">${emoji}</div>`,
  });
}

function IssueMap({ issues }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  useEffect(() => {
    map.current = createBaseMap(el.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => map.current.remove();
  }, []);
  useEffect(() => {
    layer.current.clearLayers();
    for (const x of issues) {
      if (x.lat == null) continue;
      const [, text] = ISSUE_TYPES[x.type] || ["", ""];
      L.marker([x.lat, x.lng], { icon: issueIcon(x) })
        .bindTooltip(`${text}${x.soi ? ` · ซ.${x.soi}` : ""} · ${ISSUE_STATUS[x.status].label}`, { direction: "top", offset: [0, -14] })
        .addTo(layer.current);
    }
  }, [issues]);
  return <div ref={el} className="isolate h-64 overflow-hidden rounded-xl border border-neutral-300 sm:h-80" aria-label="แผนที่ปัญหาในซอย" />;
}

function IssueCard({ issue: x, admin, onChanged, onDeleted }) {
  const [emoji, text] = ISSUE_TYPES[x.type] || ["📍", x.type];
  const st = ISSUE_STATUS[x.status];
  const [voted, setVoted] = useState(() => load("issueVotes", []).includes(x.id));
  const [note, setNote] = useState(null); // status form: {status, note}
  const [err, setErr] = useState("");
  const run = async (fn) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const vote = () =>
    run(async () => {
      onChanged(await api(`/issues/${x.id}/plusone`, { method: "POST" }));
      save("issueVotes", [...load("issueVotes", []), x.id]);
      setVoted(true);
    });
  const send = () =>
    run(async () => {
      onChanged(await api(`/issues/${x.id}/status`, { method: "POST", body: JSON.stringify({ ...note, name: savedContact().name || "" }) }));
      setNote(null);
    });
  return (
    <li className="anim-row rounded-xl border bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl" aria-hidden="true">
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge cls={st.cls}>{st.label}</Badge>
            <span className="text-sm text-neutral-600">👀 เจอ {x.votes} คน</span>
          </div>
          <p className="font-bold">
            {text}
            {x.soi && ` · ซ.${x.soi}`}
          </p>
          {x.detail && <p className="break-words text-sm">{x.detail}</p>}
          <p className="text-xs text-neutral-500">
            {x.name || "ไม่ระบุชื่อ"} · {timeAgo(x.created_at)}
          </p>
          <Photos media={x.media} />
        </div>
      </div>
      {note ? (
        <div className="mt-2 space-y-2 rounded-lg border-2 border-black p-2">
          <input
            maxLength={160}
            value={note.note}
            onChange={(e) => setNote({ ...note, note: e.target.value })}
            className={input}
            placeholder={note.status === "reported" ? "แจ้งที่ไหน เลขเรื่อง เช่น Traffy #2026-XXXX" : "หมายเหตุ เช่น รถเขตมาเก็บแล้ว"}
          />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setNote(null)} className="min-h-[44px] rounded-lg border-2 border-black">
              ยกเลิก
            </button>
            <button onClick={send} className="min-h-[44px] rounded-lg bg-[#1E6B47] font-bold text-white">
              บันทึก
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          {x.status !== "fixed" && (
            <button onClick={vote} disabled={voted} className="min-h-[40px] rounded-lg border border-black px-2 disabled:opacity-50">
              {voted ? "✓ เจอด้วย" : "👀 ฉันก็เจอ"}
            </button>
          )}
          {x.status === "open" && (
            <button onClick={() => setNote({ status: "reported", note: "" })} className="min-h-[40px] rounded-lg border border-black px-2">
              📨 แจ้งเขตแล้ว
            </button>
          )}
          {x.status !== "fixed" && (
            <button onClick={() => setNote({ status: "fixed", note: "" })} className="min-h-[40px] rounded-lg border border-black px-2">
              ✅ แก้แล้ว
            </button>
          )}
          {x.status === "fixed" && (
            <button onClick={() => setNote({ status: "open", note: "" })} className="min-h-[40px] rounded-lg border border-black px-2">
              ↩️ ยังไม่หาย
            </button>
          )}
          {admin && (
            <button
              onClick={() =>
                window.confirm("ลบรายการนี้ (ผู้ดูแล)?") &&
                run(async () => {
                  await api(`/admin/issues/${x.id}`, { method: "DELETE" });
                  onDeleted(x.id);
                })
              }
              className="min-h-[40px] px-2 text-red-700 underline"
            >
              ลบ
            </button>
          )}
        </div>
      )}
      <History items={x.history} />
      {err && <p className="mt-1 text-sm text-red-700">{err}</p>}
    </li>
  );
}

export function IssueForm({ onDone }) {
  const [form, setForm] = useState({ type: "", detail: "", soi: load("mySoi", ""), name: savedContact().name || "" });
  const [loc, setLoc] = useState(null);
  const [pinned, setPinned] = useState(false);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!form.type) return setErr("เลือกประเภทปัญหา");
    if (!pinned && !form.soi.trim()) return setErr("บอกซอย หรือเลื่อนแผนที่ปักหมุดตรงจุด");
    setBusy(true);
    setErr("");
    try {
      const x = await api("/issues", { method: "POST", body: JSON.stringify({ ...form, ...(pinned && loc ? loc : {}), media_ids: attached.ids }) });
      save("issueVotes", [...load("issueVotes", []), x.id]);
      if (form.name) remember(form.name);
      onDone(x);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={label}>ปัญหาอะไร *</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(ISSUE_TYPES).map(([k, [emoji, text]]) => (
            <button
              type="button"
              key={k}
              onClick={() => set({ type: k })}
              aria-pressed={form.type === k}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-2 text-left text-sm ${form.type === k ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <p className={label}>ตรงไหน (เลื่อนแผนที่ให้หมุดอยู่ตรงจุด)</p>
        <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinned(true)} />
        {!pinned && <p className="mt-1 text-sm text-neutral-500">ยังไม่ได้ปักหมุด · ใส่แค่ซอยก็ได้</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SoiField id="issue-soi" value={form.soi} onChange={(soi) => set({ soi })} />
        <NameField id="issue-name" labelText="ชื่อ (ไม่บังคับ)" value={form.name} onChange={(name) => set({ name })} />
      </div>
      <div>
        <label className={label} htmlFor="issue-detail">
          รายละเอียด
        </label>
        <textarea
          id="issue-detail"
          rows={2}
          maxLength={300}
          value={form.detail}
          onChange={(e) => set({ detail: e.target.value })}
          className={input}
          placeholder="เช่น ฟูก+ตู้พัง กองหน้าบ้าน 3 หลัง ปากซอย"
        />
      </div>
      <div>
        <p className={label}>รูป (ไม่บังคับ)</p>
        <MediaPicker items={media} setItems={setMedia} max={2} allowVideo={false} />
      </div>
      {err && <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>}
      <button disabled={busy || attached.busy} className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : attached.busy ? "รอรูปอัปโหลด…" : "📍 แจ้งปัญหา"}
      </button>
    </form>
  );
}

// =====================================================================
// 📋 หลังน้ำลด ทำอะไรก่อน (checklist kept on this phone)
// =====================================================================
const AFTER_FLOOD = [
  {
    title: "🌧️ ฝนตกหนักอีกรอบ (เพิ่งแห้ง)",
    items: [
      "ยังไม่ต้องยกของลงชั้นล่าง เก็บของสำคัญ เอกสาร ยา ไว้ที่สูงต่อ",
      "ขยะเปียกเก็บในถุงดำ ในบ้าน · ของพังชิ้นใหญ่อย่าวางขวางท่อระบายน้ำ",
      "เคลียร์ใบไม้ ขยะ ที่ปิดท่อหน้าบ้าน ให้น้ำฝนระบายได้",
      "เห็นน้ำขึ้นบนถนน หรือคลองใกล้ล้น แจ้งในกล่อง “เฝ้าระวังน้ำ” ด้านบน",
      "ฝนฟ้าคะนอง อยู่ห่างเสาไฟ สายไฟ ต้นไม้ที่โยก",
    ],
  },
  {
    title: "⚡ ก่อนเข้าบ้าน",
    items: [
      "ปิดเบรกเกอร์ไว้ก่อน ถ้าปลั๊ก/เต้ารับเคยจมน้ำ ให้ช่างไฟตรวจก่อนเปิด",
      "ปิดวาล์วแก๊ส ถ้าได้กลิ่นแก๊ส ห้ามจุดไฟหรือกดสวิตช์",
      "ใส่รองเท้าบู๊ท ถุงมือยาง หน้ากาก · ระวังงู ตะขาบ เศษแก้ว",
      "เปิดประตูหน้าต่างระบายอากาศก่อนเริ่มงาน",
    ],
  },
  {
    title: "📸 ถ่ายรูปก่อนล้าง (ใช้ขอเยียวยา / เคลมประกัน)",
    items: ["ภาพรวมแต่ละห้อง และคราบระดับน้ำบนผนัง", "ของเสียหายทีละชิ้น ก่อนยกไปทิ้ง", "รถ / มอเตอร์ไซค์ที่จมน้ำ (อย่าสตาร์ทจนช่างตรวจ)", "แจ้งบริษัทประกันบ้าน/รถ เร็วที่สุด"],
  },
  {
    title: "🧽 ล้างบ้าน",
    items: [
      "ตักโคลนออกก่อนฉีดน้ำ ล้างจากบนลงล่าง จากในออกนอก",
      "ฆ่าเชื้อพื้นผิวด้วยน้ำยาฟอกขาวผสมน้ำตามฉลาก · ห้ามผสมกับน้ำยาล้างห้องน้ำ (เกิดแก๊สพิษ)",
      "ทิ้งอาหาร ยา เครื่องสำอางที่โดนน้ำ · ของในตู้เย็นที่ไฟดับนาน",
      "ฟูก พรม โซฟาผ้าที่จมน้ำ ส่วนใหญ่ต้องทิ้ง (เชื้อรา)",
      "ผนังเปียก เปิดพัดลม/ปล่อยให้แห้งหลายวันก่อนทาสีใหม่",
    ],
  },
  {
    title: "🔌 เครื่องใช้ไฟฟ้า",
    items: ["เครื่องใช้ที่จมน้ำ อย่าเสียบปลั๊กลองจนแห้งสนิทและช่างตรวจ", "แอร์ (คอยล์ร้อนที่วางพื้น) ตู้เย็น เครื่องซักผ้า ให้ช่างดูก่อนเปิด", "ปั๊มน้ำ / ถังเก็บน้ำ ล้างและตรวจก่อนใช้น้ำ"],
  },
  {
    title: "🚗 รถจมน้ำ",
    items: [
      "อย่าสตาร์ท อย่าลองบิดกุญแจ (เครื่องดูดน้ำเข้า พังหนักกว่าเดิม)",
      "ถ่ายรูปรถและระดับคราบน้ำ แล้วแจ้งประกันก่อน · ชั้น 1 ส่วนใหญ่คุ้มครองน้ำท่วม",
      "ถอดขั้วแบตเตอรี่ · ให้ช่างเช็กน้ำมันเครื่อง กรองอากาศ ระบบไฟ ก่อนใช้",
      "ต้องลากไปอู่ หาช่าง/รถยกในแท็บ “ช่าง · ร้าน” หมวดซ่อมรถ",
      "ยังไม่มีรถใช้ ขอติดรถเพื่อนบ้านในแท็บ “ขอแรง · ติดรถ”",
    ],
  },
  {
    title: "🐾 สัตว์เลี้ยง",
    items: [
      "หมาแมวหาย ลงรูปในแท็บ “หาย · เจอ” เพื่อนบ้านช่วยกันดู",
      "เจอสัตว์หลง ให้น้ำ อาหาร ถ่ายรูปลง “เจอ” · อย่าโอนเงินให้ใครก่อนเห็นตัวจริง",
      "สัตว์ที่แช่น้ำ เช็ดตัวให้แห้ง สังเกตแผล ซึม ไม่กิน พาไปหาหมอ",
    ],
  },
  {
    title: "🩺 สุขภาพ",
    items: [
      "มีแผลที่เท้า ล้างสบู่ เช็ดแห้ง ทายา อย่าลุยน้ำขัง",
      "มีไข้ ปวดกล้ามเนื้อน่อง ตาแดง ภายใน 2–30 วันหลังลุยน้ำ รีบไปหาหมอ บอกว่าลุยน้ำ (ฉี่หนู)",
      "เหนื่อย นอนไม่หลับ เครียด คุยกับเพื่อนบ้าน หรือโทรสายด่วนสุขภาพจิต 1323",
    ],
  },
  {
    title: "📝 ขอเงินเยียวยา",
    items: [
      "ลงทะเบียนผ่านแอป “ทางรัฐ” ได้แล้ว (เปิดตั้งแต่ 2 ต.ค.)",
      "ถ่ายรูปความเสียหาย",
      "แจ้งความลงบันทึกประจำวันที่สถานีตำรวจ",
      "ยื่นเรื่องที่สำนักงานเขตบึงกุ่ม (หรือช่องทางออนไลน์ที่เขตประกาศ)",
      "รอเจ้าหน้าที่ลงตรวจ · เงินโอนเข้าพร้อมเพย์ (สอบถามหลักเกณฑ์ 1555 / ปภ. 1784)",
    ],
  },
  {
    title: "🗑️ ขยะน้ำท่วม",
    items: ["แยกของพังชิ้นใหญ่ / ขยะทั่วไป / ของมีคม กองหน้าบ้านไม่ขวางทาง", "กองรอเก็บนาน แจ้งในแท็บ “ปัญหาซอย” เพื่อนบ้านจะช่วยกดว่าเจอด้วย"],
  },
];

export function AfterFloodGuide() {
  const [done, setDone] = useState(() => load("afterFloodChecks", {}));
  const toggle = (id) => {
    const next = { ...done, [id]: !done[id] };
    setDone(next);
    save("afterFloodChecks", next);
  };
  const total = AFTER_FLOOD.reduce((n, s) => n + s.items.length, 0);
  const count = Object.values(done).filter(Boolean).length;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-3">
        <p className="font-bold">
          เช็กลิสต์บ้านของฉัน · ทำแล้ว {count}/{total}
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200">
          <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${(count / total) * 100}%` }} />
        </div>
        <p className="mt-1 text-xs text-neutral-500">ติ๊กเก็บไว้ในเครื่องนี้เท่านั้น</p>
      </div>
      {AFTER_FLOOD.map((s, si) => (
        <section key={s.title} className="rounded-xl bg-white p-3">
          <h3 className="mb-1 text-lg font-bold">{s.title}</h3>
          <ul className="space-y-1">
            {s.items.map((t, ii) => {
              const id = `${si}.${ii}`;
              return (
                <li key={id}>
                  <label className="flex min-h-[44px] cursor-pointer items-start gap-3 py-1">
                    <input type="checkbox" checked={!!done[id]} onChange={() => toggle(id)} className="mt-0.5 h-6 w-6 shrink-0" />
                    <span className={done[id] ? "text-neutral-400 line-through" : ""}>{t}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
