import { useEffect, useState } from "react";
import { api, load, save } from "../api";
import { LOST_CATEGORIES, LOST_KINDS, timeAgo } from "../config";
import { mediaUrl } from "../media";
import MediaPicker, { mediaState } from "./MediaPicker";
import { input } from "./RepairBoards";

// หาย · เจอ: dogs, cats, things and papers lost (or found) in the flood. Photos first — that is how people
// recognise a pet. Anyone can add "I saw it at soi 24 this morning"; only the poster marks it reunited.
const label = "mb-1 block font-medium";

// pass a lost / found post on to a LINE group (or the phone's share sheet): every share is a link back here
export function shareLost(x) {
  const text = `${x.kind === "found" ? "🙌 มีคนเจอ" : "😢 ช่วยกันดู"} ${x.title}${x.soi ? ` (ซ.${x.soi})` : ""}\nใครเห็นบอกเจ้าของได้ที่ 👉 https://serithai57.com/#lost`;
  if (navigator.share) return navigator.share({ text }).catch(() => {});
  window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, "_blank");
}

// what neighbours will see: the same card as on their home page
export function LostPreview({ x, photo }) {
  const [emoji] = LOST_CATEGORIES[x.category] || ["🐾"];
  return (
    <div className="w-[168px] overflow-hidden rounded-2xl bg-white text-left shadow-sm ring-1 ring-[#E6EBE7]">
      {photo ? (
        <img src={photo} alt="" className="aspect-square w-full object-cover" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center bg-neutral-100 text-6xl" aria-hidden="true">
          {emoji}
        </div>
      )}
      <div className="p-2">
        <span className={`rounded px-1.5 text-sm font-bold text-white ${x.kind === "found" ? "bg-[#1E6B47]" : "bg-[#B42318]"}`}>{x.kind === "found" ? "🙌 มีคนเจอ" : "😢 หาย"}</span>
        <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug">{x.title || "(ชื่อ / ลักษณะ)"}</p>
        <p className="text-sm text-[#45504A]">{[x.soi && `ซ.${x.soi}`, "เมื่อสักครู่"].filter(Boolean).join(" · ")}</p>
      </div>
    </div>
  );
}

export function LostBoard({ items, setItems, admin, onAdd }) {
  const [kind, setKind] = useState("all");
  const [cat, setCat] = useState("all");
  const keys = load("lostKeys", {});
  const shown = items.filter((x) => (kind === "all" || x.kind === kind) && (cat === "all" || x.category === cat));
  const upsert = (x) => setItems((prev) => (x.status === "reunited" ? prev.filter((y) => y.id !== x.id) : prev.map((y) => (y.id === x.id ? x : y))));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(LOST_KINDS).map(([k, v]) => (
          <button key={k} onClick={() => onAdd(k)} className={`min-h-[56px] rounded-xl px-2 font-bold ${k === "lost" ? "bg-black text-white" : "border-2 border-black bg-white"}`}>
            {v.emoji} {v.verb}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-neutral-200 p-1">
        {[
          ["all", "ทั้งหมด"],
          ["lost", "😢 ตามหา"],
          ["found", "🙌 มีคนเจอ"],
        ].map(([k, t]) => (
          <button key={k} onClick={() => setKind(k)} aria-pressed={kind === k} className={`min-h-[40px] rounded-lg text-sm font-semibold ${kind === k ? "bg-white shadow" : "text-neutral-600"}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          {[["all", ["", "ทั้งหมด"]], ...Object.entries(LOST_CATEGORIES)].map(([k, [emoji, text]]) => (
            <button
              key={k}
              onClick={() => setCat(k)}
              aria-pressed={cat === k}
              className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm ${cat === k ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}
            >
              {emoji} {text}
            </button>
          ))}
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {shown.map((x) => (
          <LostCard key={x.id} item={x} editKey={keys[x.id]} admin={admin} onChanged={upsert} onDeleted={(id) => setItems((p) => p.filter((y) => y.id !== id))} />
        ))}
      </ul>
      {!shown.length && <p className="rounded-xl bg-white p-4 text-center text-neutral-600">ยังไม่มีรายการ · หมาแมวหายตอนน้ำขึ้น ลงรูปไว้ เพื่อนบ้านช่วยกันดู</p>}
      <p className="text-xs text-neutral-500">เจอสัตว์ที่เจ้าของยังไม่มาตาม ให้น้ำ อาหาร ถ่ายรูปลง “เจอ” ไว้ · ระวังมิจฉาชีพ: อย่าโอนเงินค่าไถ่/ค่าส่งก่อนเห็นตัวจริง</p>
    </div>
  );
}

function LostCard({ item: x, editKey, admin, onChanged, onDeleted }) {
  const [emoji, catText] = LOST_CATEGORIES[x.category] || ["📦", x.category];
  const k = LOST_KINDS[x.kind];
  const [phone, setPhone] = useState(null);
  const [seen, setSeen] = useState(null);
  const [err, setErr] = useState("");
  const mine = !!editKey;
  const run = async (fn) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  const photo = x.media?.[0];
  return (
    <li className="anim-row overflow-hidden rounded-xl border bg-white shadow-sm">
      {photo ? (
        <a href={mediaUrl(photo.id)} target="_blank" rel="noreferrer" className="block">
          <img src={mediaUrl(photo.id, "thumb")} alt={x.title} loading="lazy" className="aspect-[4/3] w-full max-w-full object-cover" />
        </a>
      ) : (
        <div className="flex aspect-[4/3] max-w-full items-center justify-center bg-neutral-100 text-6xl" aria-hidden="true">
          {emoji}
        </div>
      )}
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className={`rounded px-1.5 font-bold ${x.kind === "lost" ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}>
            {k.emoji} {k.label}
          </span>
          <span className="text-neutral-600">
            {emoji} {catText}
          </span>
          {mine && <span className="rounded bg-yellow-200 px-1.5 font-semibold">ของฉัน</span>}
        </div>
        <p className="break-words text-lg font-bold leading-snug">{x.title}</p>
        {x.detail && <p className="whitespace-pre-wrap break-words text-sm">{x.detail}</p>}
        <p className="text-xs text-neutral-500">{[x.soi && `ซ.${x.soi}`, x.when_seen, x.name, timeAgo(x.created_at)].filter(Boolean).join(" · ")}</p>
        {x.media?.length > 1 && (
          <div className="flex gap-2">
            {x.media.slice(1).map((m) => (
              <a key={m.id} href={mediaUrl(m.id)} target="_blank" rel="noreferrer">
                <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="h-16 w-16 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
        {x.sightings?.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-sky-50 p-2 text-sm">
            {[...x.sightings]
              .reverse()
              .slice(0, 4)
              .map((s, i) => (
                <li key={i}>
                  👀 <b>{s.name}</b> {s.note} <span className="text-xs text-neutral-500">{timeAgo(s.at)}</span>
                </li>
              ))}
          </ul>
        )}
        <button onClick={() => shareLost(x)} className="min-h-[46px] w-full rounded-xl bg-[#06C755] font-bold text-white">
          📤 ส่งต่อในกลุ่ม LINE
        </button>
        {phone ? (
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex min-h-[48px] items-center justify-center rounded-xl bg-black text-lg font-bold text-white">
            📞 {phone}
          </a>
        ) : (
          <button onClick={() => run(async () => setPhone((await api(`/lost/${x.id}/contact`)).phone))} className="min-h-[48px] w-full rounded-xl bg-black font-bold text-white">
            {x.kind === "lost" ? "📞 ฉันเจอ · ติดต่อเจ้าของ" : "📞 ของฉันเอง · ติดต่อคนเจอ"}
          </button>
        )}
        {seen ? (
          <div className="space-y-2 rounded-lg border-2 border-black p-2">
            <input
              aria-label="เห็นที่ไหน"
              maxLength={200}
              value={seen.note}
              onChange={(e) => setSeen({ ...seen, note: e.target.value })}
              className={input}
              placeholder="เห็นที่ไหน เมื่อไหร่ เช่น ปากซอย 24 เมื่อเช้า"
            />
            <input aria-label="ชื่อของคุณ" maxLength={60} value={seen.name} onChange={(e) => setSeen({ ...seen, name: e.target.value })} className={input} placeholder="ชื่อเล่น (ไม่บังคับ)" />
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setSeen(null)} className="min-h-[44px] rounded-lg border-2 border-black">
                ยกเลิก
              </button>
              <button
                onClick={() =>
                  run(async () => {
                    onChanged(await api(`/lost/${x.id}/seen`, { method: "POST", body: JSON.stringify(seen) }));
                    setSeen(null);
                  })
                }
                className="min-h-[44px] rounded-lg bg-black font-bold text-white"
              >
                ส่ง
              </button>
            </div>
          </div>
        ) : (
          x.kind === "lost" && (
            <button onClick={() => setSeen({ note: "", name: load("contact", {}).name || "" })} className="min-h-[44px] w-full rounded-xl border-2 border-black font-semibold">
              👀 ฉันเห็นแถวนี้
            </button>
          )
        )}
        {(mine || admin) && (
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              onClick={() => run(async () => onChanged(await api(`/lost/${x.id}/status`, { method: "POST", headers: { "X-Edit-Key": editKey || "" }, body: JSON.stringify({ status: "reunited" }) })))}
              className="min-h-[44px] flex-1 rounded-lg bg-emerald-600 px-2 font-bold text-white"
            >
              🎉 ได้คืนแล้ว · ปิด
            </button>
            <button
              onClick={() =>
                window.confirm("ลบรายการนี้?") &&
                run(async () => {
                  await api(`/lost/${x.id}`, { method: "DELETE", headers: { "X-Edit-Key": editKey || "" } });
                  onDeleted(x.id);
                })
              }
              className="min-h-[44px] px-2 text-red-700 underline"
            >
              ลบ
            </button>
          </div>
        )}
        {err && <p className="text-sm text-red-700">{err}</p>}
      </div>
    </li>
  );
}

export function LostForm({ kind: initialKind = "lost", onDone }) {
  const c = load("contact", { name: "", phone: "" });
  const [form, setForm] = useState({ kind: initialKind, category: "", title: "", detail: "", soi: load("mySoi", ""), when_seen: "", name: c.name || "", phone: c.phone || "" });
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (p) => setForm((f) => ({ ...f, ...p }));
  const attached = mediaState(media);
  const lost = form.kind === "lost";
  async function submit(e) {
    e.preventDefault();
    if (!form.category) return setErr("เลือกว่าเป็นอะไร");
    setBusy(true);
    setErr("");
    try {
      const x = await api("/lost", { method: "POST", body: JSON.stringify({ ...form, media_ids: attached.ids }) });
      save("lostKeys", { ...load("lostKeys", {}), [x.id]: x.edit_key });
      save("contact", { ...load("contact", {}), name: form.name, phone: form.phone });
      onDone(x);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1">
        {Object.entries(LOST_KINDS).map(([k, v]) => (
          <button
            type="button"
            key={k}
            onClick={() => set({ kind: k })}
            aria-pressed={form.kind === k}
            className={`min-h-[44px] rounded-lg text-sm font-semibold ${form.kind === k ? "bg-white shadow" : "text-neutral-600"}`}
          >
            {v.emoji} {v.verb}
          </button>
        ))}
      </div>
      <fieldset>
        <legend className={label}>เป็นอะไร *</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(LOST_CATEGORIES).map(([k, [emoji, text]]) => (
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
        <p className={label}>รูป (สำคัญมาก โดยเฉพาะสัตว์เลี้ยง)</p>
        <MediaPicker items={media} setItems={setMedia} max={3} allowVideo={false} />
      </div>
      <div>
        <label className={label} htmlFor="lost-title">
          {lost ? "หายอะไร *" : "เจออะไร *"}
        </label>
        <input
          id="lost-title"
          required
          minLength={2}
          maxLength={80}
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          className={input}
          placeholder={lost ? "เช่น หมาไทยสีน้ำตาล ปลอกคอแดง ชื่อโบ้" : "เช่น แมวส้ม ตัวผู้ ไม่มีปลอกคอ"}
        />
      </div>
      <div>
        <label className={label} htmlFor="lost-detail">
          ลักษณะ / รายละเอียด
        </label>
        <textarea
          id="lost-detail"
          rows={3}
          maxLength={400}
          value={form.detail}
          onChange={(e) => set({ detail: e.target.value })}
          className={input}
          placeholder={lost ? "จุดสังเกต นิสัย กลัวคนไหม มีรางวัลไหม" : "ตอนนี้อยู่ที่ไหน ฝากเลี้ยงไว้ที่ใคร"}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="lost-soi">
            {lost ? "หายแถวซอย" : "เจอแถวซอย"}
          </label>
          <input id="lost-soi" maxLength={12} value={form.soi} onChange={(e) => set({ soi: e.target.value })} className={input} placeholder="เช่น 24" />
        </div>
        <div>
          <label className={label} htmlFor="lost-when">
            เมื่อไหร่
          </label>
          <input id="lost-when" maxLength={60} value={form.when_seen} onChange={(e) => set({ when_seen: e.target.value })} className={input} placeholder="เช่น หายตั้งแต่ 29 ก.ย. ตอนน้ำขึ้น" />
        </div>
        <div>
          <label className={label} htmlFor="lost-name">
            ชื่อเล่น *
          </label>
          <input id="lost-name" required maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label} htmlFor="lost-phone">
            เบอร์โทร *
          </label>
          <input id="lost-phone" required type="tel" inputMode="tel" maxLength={40} value={form.phone} onChange={(e) => set({ phone: e.target.value })} className={input} />
        </div>
      </div>
      <div className="rounded-2xl bg-[#F2F4F1] p-3">
        <p className="mb-2 text-sm font-bold text-[#45504A]">👀 ตัวอย่างที่เพื่อนบ้านจะเห็น{["dog", "cat", "pet"].includes(form.category) ? " (บนหน้าแรกของทุกคน)" : ""}</p>
        <LostPreview x={form} photo={media.find((m) => m.preview)?.preview} />
      </div>
      <p className="text-sm text-neutral-500">เบอร์แสดงเมื่อมีคนกดติดต่อทีละรายการ · ได้คืนแล้วกด “ได้คืนแล้ว” จากเครื่องนี้</p>
      {err && <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>}
      <button disabled={busy || attached.busy} className="min-h-[52px] w-full rounded-xl bg-black text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : attached.busy ? "รอรูปอัปโหลด…" : lost ? "😢 ลงประกาศตามหา" : "🙌 ลงประกาศว่าเจอ"}
      </button>
    </form>
  );
}

// ---------- the top of the home page: lost (and found) pets, loud only while it matters ----------
// Full card with the photo: new (first 2 days, until this phone has had it on screen for a while) or near my soi.
// After that it shrinks to one line; "ซ่อน" hides what is there now; a new one comes back full.
// A pet that went home gets one cheerful line for a day.
const PETS = ["dog", "cat", "pet"];
const soiNo = (s) => parseInt(String(s || "").match(/\d+/)?.[0] || "", 10);
export function PetAlert({ items, reunited = [], onOpen }) {
  const [hidden, setHidden] = useState(() => load("petHidden", []));
  const [seen] = useState(() => load("petSeen", {})); // id -> when this phone first showed it big
  const now = Date.now();
  const mySoi = soiNo(load("mySoi", ""));
  const pets = items.filter((x) => PETS.includes(x.category) && x.status !== "reunited" && !hidden.includes(x.id));
  const home = reunited.filter((x) => PETS.includes(x.category) && !hidden.includes(`r${x.id}`) && now - new Date(x.updated_at || x.created_at).getTime() < 24 * 3600e3);
  const ageH = (x) => (now - new Date(x.created_at).getTime()) / 3600e3;
  const near = (x) => mySoi && soiNo(x.soi) && Math.abs(soiNo(x.soi) - mySoi) <= 4;
  const big = pets.filter((x) => x.kind === "lost" && ((ageH(x) < 48 && (!seen[x.id] || now - seen[x.id] < 6 * 3600e3)) || (near(x) && ageH(x) < 7 * 24)));
  const slim = pets.filter((x) => !big.includes(x) && ageH(x) < 30 * 24);
  const bigIds = big.map((x) => x.id).join(",");
  useEffect(() => {
    const was = load("petSeen", {});
    const fresh = bigIds.split(",").filter((id) => id && !was[id]);
    if (fresh.length) save("petSeen", { ...was, ...Object.fromEntries(fresh.map((id) => [id, Date.now()])) });
  }, [bigIds]);
  if (!big.length && !slim.length && !home.length) return null;
  const hide = (ids) => {
    const next = [...hidden.slice(-100), ...ids];
    setHidden(next);
    save("petHidden", next);
  };
  const thumb = (x, cls) => {
    const photo = x.media?.[0];
    return photo ? (
      <img src={mediaUrl(photo.id, "thumb")} alt="" loading="lazy" className={`${cls} object-cover`} />
    ) : (
      <span className={`${cls} flex items-center justify-center bg-neutral-100`} aria-hidden="true">
        {(LOST_CATEGORIES[x.category] || ["🐾"])[0]}
      </span>
    );
  };
  return (
    <div className="mb-3 space-y-2">
      {home.map((x) => (
        <div key={x.id} className="flex items-center gap-2 rounded-2xl bg-[#E4F0E9] px-3 py-2">
          {thumb(x, "h-10 w-10 shrink-0 rounded-full text-xl")}
          <p className="min-w-0 flex-1 text-[15px] leading-snug">
            🎉 <b>เจอแล้ว!</b> {x.title} กลับบ้านแล้ว · ขอบคุณทุกคนที่ช่วยดู
          </p>
          <button onClick={() => hide([`r${x.id}`])} aria-label="ปิด" className="min-h-[40px] min-w-[40px] shrink-0 text-[#45504A]">
            ✕
          </button>
        </div>
      ))}
      {big.length > 0 && (
        <section className="rounded-[20px] border-2 border-[#E0A100] bg-[#FFF8E1] p-3" aria-label="สัตว์เลี้ยงหาย">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-lg font-bold leading-tight">🐾 ช่วยกันดู · สัตว์เลี้ยงหาย {big.length} ตัว</p>
            <button onClick={() => hide(big.map((x) => x.id))} className="min-h-[40px] shrink-0 text-sm font-bold text-[#45504A] underline">
              ซ่อน
            </button>
          </div>
          <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1">
            {big.map((x) => (
              <button key={x.id} onClick={onOpen} className="w-[168px] shrink-0 overflow-hidden rounded-2xl bg-white text-left shadow-sm">
                {thumb(x, "aspect-square w-full text-6xl")}
                <div className="p-2">
                  <span className="rounded bg-[#B42318] px-1.5 text-sm font-bold text-white">😢 หาย</span>
                  {near(x) ? <span className="ml-1 rounded bg-[#15201A] px-1.5 text-sm font-bold text-white">ใกล้บ้านคุณ</span> : null}
                  <p className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug">{x.title}</p>
                  <p className="text-sm text-[#45504A]">{[x.soi && `ซ.${x.soi}`, timeAgo(x.created_at)].filter(Boolean).join(" · ")}</p>
                </div>
              </button>
            ))}
          </div>
          <button onClick={onOpen} className="mt-1 min-h-[44px] w-full rounded-xl bg-white text-[15px] font-bold">
            เห็นตัวไหน? กดบอกเจ้าของ ›
          </button>
        </section>
      )}
      {slim.length > 0 && (
        // seen already: one quiet line that still says "they are still looking"
        <div className="flex items-center gap-2 rounded-2xl border border-[#E0C27A] bg-[#FFFBEF] px-3 py-1.5">
          <button onClick={onOpen} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left">
            <span className="flex shrink-0 -space-x-2">
              {slim.slice(0, 3).map((x) => (
                <span key={x.id}>{thumb(x, "h-8 w-8 rounded-full border-2 border-white text-base")}</span>
              ))}
            </span>
            <span className="min-w-0 flex-1 truncate text-[15px]">
              🐾 <b>{slim.some((x) => x.kind === "lost") ? "ยังตามหาอยู่" : "มีคนเจอ รอเจ้าของ"}</b> {slim.length} ตัว ·{" "}
              {slim
                .slice(0, 2)
                .map((x) => `${x.title.slice(0, 18)}${x.soi ? ` ซ.${x.soi}` : ""}`)
                .join(" · ")}
            </span>
            <span className="shrink-0 text-[#45504A]">›</span>
          </button>
          <button onClick={() => hide(slim.map((x) => x.id))} aria-label="ซ่อน" className="min-h-[40px] min-w-[36px] shrink-0 text-[#45504A]">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
