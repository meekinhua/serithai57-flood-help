import { useMemo, useState } from "react";
import { api, load, save } from "../api";
import MediaPicker, { mediaState } from "./MediaPicker";
import { PRICING, REPAIR_SERVICE_ORDER, SERVICE_CATEGORIES, categoryOf, paymentBadge, timeAgo } from "../config";

// Repair mode lists the after-flood trades first and hides the flood-only ones (boats, food, pets...).
const categoriesFor = (repair) => (repair ? REPAIR_SERVICE_ORDER.map((k) => [k, SERVICE_CATEGORIES[k]]) : Object.entries(SERVICE_CATEGORIES));

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const label = "mb-1 block font-medium";

const telHref = (phone) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const lineHref = (id) => `https://line.me/ti/p/~${encodeURIComponent(id.replace(/^@?/, ""))}`;

// ---------- Always-visible strip on the main page ----------
export function ServiceStrip({ services, paidNeeds, onOpen, onAdd }) {
  const counts = useMemo(() => {
    const c = {};
    for (const s of services) c[s.category] = (c[s.category] || 0) + 1;
    return c;
  }, [services]);
  const cats = Object.entries(SERVICE_CATEGORIES);
  return (
    <section aria-label="บอร์ดติดต่อ ช่าง รถ รับจ้าง" className="rounded-xl border-2 border-black bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 text-lg font-bold leading-tight">
          📇 บอร์ดติดต่อ: ช่าง · รถ · รับจ้าง
          <span className="block text-sm font-normal text-neutral-600">
            {services.length ? `มี ${services.length} รายให้โทรหาได้เลย` : "ยังไม่มีรายชื่อ ช่วยกันลงชื่อได้"}
            {paidNeeds > 0 && ` · มี ${paidNeeds} คนกำลังหาคนจ้าง`}
          </span>
        </h2>
        <button onClick={onAdd} className="min-h-[44px] rounded-lg bg-[#1E6B47] px-3 font-semibold text-white active:bg-[#154D33]">
          ➕ ลงชื่อรับงาน
        </button>
      </div>
      {/* horizontally scrollable category chips */}
      <div className="-mx-3 mt-2 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          <button onClick={() => onOpen({ tab: "providers" })} className="flex min-h-[44px] items-center gap-1 rounded-full bg-black px-4 text-sm font-semibold text-white">
            ทั้งหมด {services.length > 0 && <span className="rounded-full bg-white px-1.5 text-xs text-black">{services.length}</span>}
          </button>
          {paidNeeds > 0 && (
            <button onClick={() => onOpen({ tab: "hiring" })} className="flex min-h-[44px] items-center gap-1 rounded-full border-2 border-black bg-yellow-300 px-4 text-sm font-semibold">
              🙋 หาคนจ้าง <span className="rounded-full bg-black px-1.5 text-xs text-white">{paidNeeds}</span>
            </button>
          )}
          {cats.map(([key, [emoji, text]]) => (
            <button
              key={key}
              onClick={() => onOpen({ tab: "providers", category: key })}
              className={`flex min-h-[44px] items-center gap-1 whitespace-nowrap rounded-full border px-3 text-sm ${counts[key] ? "border-black font-semibold" : "border-neutral-300 text-neutral-500"}`}
            >
              <span aria-hidden="true">{emoji}</span> {text}
              {counts[key] > 0 && <span className="rounded-full bg-black px-1.5 text-xs text-white">{counts[key]}</span>}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- One provider card ----------
function ServiceCard({ s, admin, onChanged, onDeleted, repair }) {
  const [emoji, catText] = SERVICE_CATEGORIES[s.category] || ["📞", s.category];
  const editKey = load("serviceKeys", {})[s.id];
  const [error, setError] = useState("");
  const [reported, setReported] = useState(() => load("reportedServices", []).includes(s.id));
  const pricing = PRICING[s.pricing] || PRICING.ask;

  async function run(fn) {
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    }
  }

  const toggleAvailable = () => run(async () => onChanged(await api(`/services/${s.id}`, { method: "PATCH", headers: { "X-Edit-Key": editKey }, body: JSON.stringify({ available: !s.available }) })));

  const removeOwn = () =>
    run(async () => {
      if (!window.confirm("ลบรายชื่อของคุณออกจากบอร์ด?")) return;
      await api(`/services/${s.id}`, { method: "DELETE", headers: { "X-Edit-Key": editKey } });
      const keys = load("serviceKeys", {});
      delete keys[s.id];
      save("serviceKeys", keys);
      onDeleted(s.id);
    });

  const report = () =>
    run(async () => {
      if (!window.confirm("แจ้งว่าโทรไม่ติด / เบอร์ใช้ไม่ได้?")) return;
      onChanged(await api(`/services/${s.id}/report`, { method: "POST" }));
      save("reportedServices", [...load("reportedServices", []), s.id]);
      setReported(true);
    });

  const adminSet = (changes) => run(async () => onChanged(await api(`/admin/services/${s.id}`, { method: "PATCH", body: JSON.stringify(changes) })));
  const adminDelete = () =>
    run(async () => {
      if (!window.confirm(`ลบ ${s.name} ออกจากบอร์ด (สิทธิ์ผู้ดูแล)?`)) return;
      await api(`/admin/services/${s.id}`, { method: "DELETE" });
      onDeleted(s.id);
    });

  return (
    <li className={`anim-row rounded-xl border bg-white p-3 shadow-sm ${s.pinned ? "border-black ring-2 ring-black" : "border-neutral-200"} ${s.available ? "" : "opacity-70"}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl" aria-hidden="true">
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {s.pinned && <span className="rounded bg-black px-1.5 font-bold text-white">📌 แนะนำ</span>}
            {s.verified && <span className="rounded bg-emerald-600 px-1.5 font-bold text-white">✔ ผู้ดูแลยืนยันแล้ว</span>}
            <span className={`rounded px-1.5 font-semibold ${s.available ? "bg-emerald-100 text-emerald-800" : "bg-neutral-200 text-neutral-600"}`}>
              {s.available ? "🟢 ว่างรับงาน" : "🔴 ไม่ว่างตอนนี้"}
            </span>
          </div>
          <p className="mt-0.5 break-words text-lg font-bold leading-snug">{s.name}</p>
          <p className="text-sm text-neutral-600">
            {catText}
            {s.area && ` · ${s.area}`}
          </p>
          {s.detail && <p className="mt-1 whitespace-pre-wrap break-words">{s.detail}</p>}
          <p className="mt-1 font-semibold">
            {pricing.badge} {s.pricing === "paid" && s.price ? s.price : pricing.label}
          </p>
          {s.reports > 0 && <p className="mt-1 text-sm text-red-700">⚠️ มีคนแจ้งว่าติดต่อไม่ได้ {s.reports} ครั้ง</p>}
        </div>
      </div>
      {repair && <Reviews s={s} onChanged={onChanged} />}

      <div className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        <a href={telHref(s.phone)} className="flex min-h-[52px] items-center justify-center rounded-xl bg-[#1E6B47] px-3 text-lg font-bold text-white active:bg-[#154D33]">
          📞 {s.phone}
        </a>
        {s.line_id && (
          <a href={lineHref(s.line_id)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-center rounded-xl bg-[#06C755] px-3 font-bold text-white">
            LINE: {s.line_id}
          </a>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm">
        <span className="text-neutral-400">อัปเดต {timeAgo(s.updated_at)}</span>
        {editKey ? (
          <>
            <button onClick={toggleAvailable} className="min-h-[44px] font-semibold underline">
              {s.available ? "ตั้งเป็น: ไม่ว่าง" : "ตั้งเป็น: ว่างรับงาน"}
            </button>
            <button onClick={removeOwn} className="min-h-[44px] text-red-700 underline">
              ลบรายชื่อของฉัน
            </button>
          </>
        ) : (
          !reported && (
            <button onClick={report} className="min-h-[44px] text-neutral-500 underline">
              แจ้งว่าโทรไม่ติด
            </button>
          )
        )}
      </div>

      {admin && (
        <div className="mt-1 flex flex-wrap gap-2 border-t border-dashed border-neutral-300 pt-2 text-sm">
          <span className="self-center font-semibold">🛡️</span>
          <button onClick={() => adminSet({ verified: !s.verified })} className="min-h-[40px] rounded-lg border border-black px-2">
            {s.verified ? "ยกเลิกยืนยัน" : "✔ ยืนยัน"}
          </button>
          <button onClick={() => adminSet({ pinned: !s.pinned })} className="min-h-[40px] rounded-lg border border-black px-2">
            {s.pinned ? "เลิกปักหมุด" : "📌 ปักหมุด"}
          </button>
          <button onClick={adminDelete} className="min-h-[40px] rounded-lg bg-red-600 px-2 text-white">
            ลบ
          </button>
        </div>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

// ---------- Full board (inside a sheet) ----------
export function ServiceBoard({ services, setServices, posts, admin, initial = {}, onAdd, onOpenPost, repair = false }) {
  const [tab, setTab] = useState(initial.tab || "providers");
  const [category, setCategory] = useState(initial.category || "all");
  const [query, setQuery] = useState("");

  const paidOffers = posts.filter((p) => p.kind === "offer" && p.payment === "paid" && p.status !== "done");
  const paidNeeds = posts.filter((p) => p.kind === "need" && p.payment === "paid" && p.status !== "done");

  const q = query.trim().toLowerCase();
  const matches = (text) => !q || text.toLowerCase().includes(q);
  const shown = services.filter((s) => (category === "all" || s.category === category) && matches(`${s.name} ${s.detail} ${s.area} ${SERVICE_CATEGORIES[s.category]?.[1] || ""}`));

  const upsert = (s) => setServices((prev) => prev.map((x) => (x.id === s.id ? s : x)));
  const drop = (id) => setServices((prev) => prev.filter((x) => x.id !== id));

  return (
    <div className="space-y-3">
      {!repair && (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1" role="tablist">
          <button
            role="tab"
            aria-selected={tab === "providers"}
            onClick={() => setTab("providers")}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === "providers" ? "bg-white shadow" : "text-neutral-600"}`}
          >
            📇 คนรับจ้าง / ให้บริการ ({services.length + paidOffers.length})
          </button>
          <button
            role="tab"
            aria-selected={tab === "hiring"}
            onClick={() => setTab("hiring")}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === "hiring" ? "bg-white shadow" : "text-neutral-600"}`}
          >
            🙋 คนกำลังหาคนจ้าง ({paidNeeds.length})
          </button>
        </div>
      )}

      {tab === "providers" ? (
        <>
          <button onClick={onAdd} className="min-h-[48px] w-full rounded-xl border-2 border-dashed border-black font-semibold active:bg-neutral-50">
            {repair ? "➕ ลงชื่อช่าง / ร้าน หรือแนะนำช่างที่เคยใช้" : "➕ ลงชื่อรับงาน / ให้บริการ (ไม่ต้องสมัคร)"}
          </button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={repair ? "🔍 ค้นหา เช่น แอร์, ตู้เย็น, ทาสี" : "🔍 ค้นหา เช่น ไฟ, กระบะ, ขนของ"} className={input} />
          <div className="-mx-4 overflow-x-auto px-4 pb-1">
            <div className="flex w-max gap-2">
              {[["all", ["", "ทั้งหมด"]], ...categoriesFor(repair)].map(([key, [emoji, text]]) => (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  aria-pressed={category === key}
                  className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm ${category === key ? "bg-black font-semibold text-white" : "border border-neutral-300"}`}
                >
                  {emoji} {text}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-2">
            {shown.map((s) => (
              <ServiceCard key={s.id} s={s} admin={admin} onChanged={upsert} onDeleted={drop} repair={repair} />
            ))}
          </ul>
          {shown.length === 0 && (
            <p className="rounded-xl bg-neutral-100 p-4 text-center text-neutral-600">
              {services.length ? "ไม่พบในหมวด/คำค้นนี้" : "ยังไม่มีใครลงชื่อ ถ้าคุณรู้จักช่างหรือมีรถ/เรือ ช่วยลงชื่อให้เพื่อนบ้านได้เลย"}
            </p>
          )}
          {!repair && paidOffers.length > 0 && (category === "all" || category === "other") && !q && (
            <section>
              <h3 className="mb-1 mt-2 font-semibold">จากโพสต์ “ฉันช่วยได้” แบบรับจ้าง</h3>
              <ul className="space-y-2">
                {paidOffers.map((p) => (
                  <PostRow key={p.id} post={p} onOpen={onOpenPost} />
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <>
          <p className="rounded-xl bg-yellow-100 p-3 text-sm">
            เพื่อนบ้านเหล่านี้<b>ยินดีจ่ายค่าตอบแทน</b> ถ้าคุณช่วยได้ เปิดดูแล้วโทรหาหรือกด “ฉันจะไปช่วย”
          </p>
          <ul className="space-y-2">
            {paidNeeds.map((p) => (
              <PostRow key={p.id} post={p} onOpen={onOpenPost} />
            ))}
          </ul>
          {paidNeeds.length === 0 && <p className="rounded-xl bg-neutral-100 p-4 text-center text-neutral-600">ตอนนี้ยังไม่มีคนประกาศหาคนจ้าง</p>}
        </>
      )}
      <p className="text-xs text-neutral-500">ระบบไม่ได้รับเงิน ตกลงราคาและจ่ายกันเอง · ระวังมิจฉาชีพ: อย่าโอนเงินก่อนได้รับบริการ</p>
    </div>
  );
}

function PostRow({ post, onOpen }) {
  const [emoji, cat] = categoryOf(post);
  return (
    <li>
      <button onClick={() => onOpen(post.id)} className="w-full rounded-xl border border-neutral-200 bg-white p-3 text-left shadow-sm active:bg-neutral-50">
        <p className="font-semibold">
          {emoji} {cat} <span className="ml-1 rounded border border-black px-1.5 text-sm">{paymentBadge(post)}</span>
        </p>
        <p className="line-clamp-2 break-words text-sm text-neutral-700">{post.detail}</p>
        <p className="text-xs text-neutral-500">
          {post.name} · {timeAgo(post.created_at)}
          {post.place && ` · ${post.place}`}
        </p>
      </button>
    </li>
  );
}

// ---------- "List yourself" form ----------
export function ServiceForm({ onDone, prefill = {}, repair = false }) {
  const saved = load("contact", { name: "", phone: "" });
  const [form, setForm] = useState({
    category: prefill.category || "",
    name: repair ? "" : saved.name || "",
    phone: repair ? "" : saved.phone || "",
    line_id: "",
    detail: prefill.detail || "",
    pricing: "paid",
    price: prefill.price || "",
    area: "ในหมู่บ้าน",
  });
  const [self, setSelf] = useState(!repair); // repair mode: most people list a tradesman they used, not themselves
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState([]); // photos of the shop / the work
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function submit(e) {
    e.preventDefault();
    if (!form.category) return setError("กรุณาเลือกประเภทบริการ");
    if (mediaState(files).busy) return setError("รอรูปอัปโหลดเสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const base = { ...form, media_ids: mediaState(files).ids };
      const body = repair && !self ? { ...base, detail: `${form.detail}${form.detail ? " · " : ""}เพื่อนบ้านแนะนำ` } : base;
      const s = await api("/services", { method: "POST", body: JSON.stringify(body) });
      save("serviceKeys", { ...load("serviceKeys", {}), [s.id]: s.edit_key });
      if (self) save("contact", { ...load("contact", {}), name: form.name, phone: form.phone });
      onDone(s);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="svc-name">
            {repair ? "ชื่อช่าง หรือ ชื่อร้าน *" : "ชื่อ / ชื่อร้าน *"}
          </label>
          <input id="svc-name" required maxLength={80} value={form.name} onChange={(e) => set({ name: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="svc-phone">
            {repair ? "เบอร์โทร หรือ LINE / ชื่อ Facebook *" : "เบอร์โทร *"}
          </label>
          <input
            id="svc-phone"
            required
            type={repair ? "text" : "tel"}
            inputMode={repair ? "text" : "tel"}
            maxLength={40}
            value={form.phone}
            onChange={(e) => set({ phone: e.target.value })}
            className={input}
          />
        </div>
      </div>
      <fieldset>
        <legend className={label}>{repair ? "ทำอะไร / ขายอะไร *" : "ให้บริการอะไร *"}</legend>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {categoriesFor(repair).map(([key, [emoji, text]]) => (
            <button
              type="button"
              key={key}
              onClick={() => set({ category: key })}
              aria-pressed={form.category === key}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-3 text-left ${form.category === key ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
        {(form.category === "food" || form.category === "shop") && (
          <p className="mt-2 rounded-lg bg-[#FFF4D6] p-2.5 text-sm">
            ช่าง·ร้าน สำหรับร้านที่เปิดขายประจำ · ถ้าทำขายเองเป็นครั้งคราว รับสั่งล่วงหน้า หรือของเหลือใช้ ลงที่ <b>🛍️ ตลาดเพื่อนบ้าน</b> (เพื่อนบ้าน › ตลาด) จะมีปุ่มให้คนกดสั่ง/จอง
          </p>
        )}
      </fieldset>
      <div>
        <label className={label} htmlFor="svc-detail">
          รายละเอียดบริการ
        </label>
        <textarea
          id="svc-detail"
          rows={3}
          maxLength={500}
          value={form.detail}
          onChange={(e) => set({ detail: e.target.value })}
          className={input}
          placeholder="เช่น กระบะยกสูง 1 คัน รับส่งคน/ของ เข้า-ออกหมู่บ้าน ถึงถนนเสรีไทย"
        />
      </div>
      <fieldset>
        <legend className={label}>ค่าบริการ</legend>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(PRICING).map(([key, p]) => (
            <button
              type="button"
              key={key}
              onClick={() => set({ pricing: key })}
              aria-pressed={form.pricing === key}
              className={`min-h-[48px] rounded-lg border-2 px-2 text-sm font-semibold ${form.pricing === key ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              {p.badge} {p.label}
            </button>
          ))}
        </div>
        {form.pricing === "paid" && (
          <input maxLength={100} value={form.price} onChange={(e) => set({ price: e.target.value })} className={`${input} mt-2`} placeholder="เช่น 300 บาท/เที่ยว, 500 บาท/ชม., เริ่ม 200 บาท" />
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="svc-area">
            พื้นที่ให้บริการ
          </label>
          <input id="svc-area" maxLength={100} value={form.area} onChange={(e) => set({ area: e.target.value })} className={input} placeholder="เช่น ในหมู่บ้าน, ทั่วบึงกุ่ม" />
        </div>
        <div>
          <label className={label} htmlFor="svc-line">
            LINE ID (ไม่บังคับ)
          </label>
          <input id="svc-line" maxLength={40} value={form.line_id} onChange={(e) => set({ line_id: e.target.value })} className={input} />
        </div>
      </div>
      {repair && (
        <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-neutral-300 px-3 text-base">
          <input type="checkbox" checked={self} onChange={(e) => setSelf(e.target.checked)} className="h-5 w-5 accent-[#1E6B47]" />
          ฉันเป็นช่างเอง / เจ้าของร้าน
        </label>
      )}
      <p className="text-sm text-neutral-500">ชื่อ เบอร์ และ LINE จะแสดงให้ทุกคนเห็น</p>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <div>
        <p className="mb-1 font-medium">รูปร้าน / ผลงาน (ไม่บังคับ · ช่วยให้คนเลือกง่ายขึ้น)</p>
        <MediaPicker items={files} setItems={setFiles} max={3} />
      </div>
      <button type="submit" disabled={busy} className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : repair ? "ลงให้เพื่อนบ้านเห็น" : "📇 ลงชื่อในบอร์ดติดต่อ"}
      </button>
    </form>
  );
}

// ---------- Neighbours' reviews (repair mode) ----------
function Reviews({ s, onChanged }) {
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const reviews = [...(s.reviews || [])].reverse();
  async function send(e) {
    e.preventDefault();
    setErr("");
    try {
      onChanged(await api(`/services/${s.id}/review`, { method: "POST", body: JSON.stringify(form) }));
      save("contact", { ...load("contact", {}), name: form.name });
      setForm(null);
    } catch (e2) {
      setErr(e2.message);
    }
  }
  return (
    <div className="mt-2 rounded-lg bg-neutral-50 p-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <b>เพื่อนบ้านว่า</b>
        <span>👍 {s.good || 0}</span>
        <span>👎 {s.bad || 0}</span>
        {!form && (
          <button onClick={() => setForm({ name: load("contact", {}).name || "", good: true, text: "" })} className="ml-auto min-h-[40px] underline">
            ✍️ เคยใช้ เล่าให้ฟัง
          </button>
        )}
      </div>
      {reviews.slice(0, 3).map((r, i) => (
        <p key={i} className="mt-1 break-words">
          {r.good ? "👍" : "👎"} <b>{r.name}</b> {r.text} <span className="text-xs text-neutral-400">{timeAgo(r.at)}</span>
        </p>
      ))}
      {form && (
        <form onSubmit={send} className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {[
              [true, "👍 ดี แนะนำ"],
              [false, "👎 ไม่แนะนำ"],
            ].map(([v, t]) => (
              <button
                type="button"
                key={t}
                onClick={() => setForm({ ...form, good: v })}
                aria-pressed={form.good === v}
                className={`min-h-[44px] rounded-lg border-2 font-semibold ${form.good === v ? "border-black bg-black text-white" : "border-neutral-300 bg-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <input required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder="ชื่อเล่นของคุณ" />
          <input
            maxLength={200}
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            className={input}
            placeholder="เช่น มาตรงเวลา ราคา 800 ล้างแอร์ 2 เครื่อง งานเรียบร้อย"
          />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setForm(null)} className="min-h-[44px] rounded-lg border-2 border-black">
              ยกเลิก
            </button>
            <button className="min-h-[44px] rounded-lg bg-[#1E6B47] font-bold text-white">ส่ง</button>
          </div>
        </form>
      )}
      {err && <p className="mt-1 text-red-700">{err}</p>}
    </div>
  );
}
