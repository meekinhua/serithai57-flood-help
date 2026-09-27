import { useState } from "react";
import { CATEGORIES, KINDS, PAYMENT, WATER_LEVELS } from "../config";
import { api, load, save } from "../api";
import LocationPicker from "./LocationPicker";
import MediaPicker, { mediaState } from "./MediaPicker";

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-neutral-600 focus:outline-none";
const label = "mb-1 block font-medium";

function useContact() {
  const [contact, setContact] = useState(() => load("contact", { name: "", phone: "" }));
  const update = (patch) => {
    const next = { ...contact, ...patch };
    setContact(next);
    save("contact", next);
  };
  return [contact, update];
}

function Submit({ busy, color, children }) {
  return (
    <button type="submit" disabled={busy} className={`min-h-[52px] w-full rounded-xl ${color} px-4 text-lg font-semibold text-white disabled:opacity-60`}>
      {busy ? "กำลังส่ง…" : children}
    </button>
  );
}

export function PostForm({ kind, onDone }) {
  const k = KINDS[kind];
  const [contact, setContact] = useContact();
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [place, setPlace] = useState("");
  const [people, setPeople] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [payment, setPayment] = useState("free");
  const [price, setPrice] = useState("");
  const [loc, setLoc] = useState(null);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = mediaState(media);

  async function submit(e) {
    e.preventDefault();
    if (!category) return setError("กรุณาเลือกประเภท");
    if (!loc) return setError("กรุณาเลือกตำแหน่ง");
    if (attached.busy) return setError("รอไฟล์แนบอัปโหลดให้เสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const post = await api("/posts", {
        method: "POST",
        body: JSON.stringify({
          kind,
          category,
          detail: detail.trim() || CATEGORIES[kind][category][1],
          place: place.trim(),
          name: contact.name.trim(),
          phone: contact.phone.trim(),
          people: people === "" ? null : Number(people),
          urgent,
          payment: kind === "info" ? "free" : payment,
          price: payment === "paid" ? price.trim() : "",
          media_ids: attached.ids,
          ...loc,
        }),
      });
      save("editKeys", { ...load("editKeys", {}), [post.id]: post.edit_key });
      onDone(post);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={label}>ประเภท *</legend>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {Object.entries(CATEGORIES[kind]).map(([key, [emoji, text]]) => (
            <button
              type="button"
              key={key}
              onClick={() => setCategory(key)}
              aria-pressed={category === key}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-3 text-left ${
                category === key ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white active:bg-neutral-50"
              }`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {kind === "need" && (
        <label className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border-2 border-red-300 bg-red-50 px-3">
          <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-6 w-6 accent-red-600" />
          <span className="font-semibold text-red-800">ด่วนมาก — มีอันตรายต่อชีวิต / ผู้ป่วย</span>
        </label>
      )}

      {PAYMENT[kind] && (
        <fieldset>
          <legend className={label}>ค่าใช้จ่าย</legend>
          <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
            {["free", "paid"].map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPayment(p)}
                aria-pressed={payment === p}
                className={`min-h-[48px] rounded-lg border-2 px-3 text-left ${payment === p ? "border-black bg-black text-white" : "border-neutral-200 bg-white active:bg-neutral-50"}`}
              >
                {p === "free" ? "🆓 " : "💰 "}
                {PAYMENT[kind][p]}
              </button>
            ))}
          </div>
          {payment === "paid" && (
            <div className="mt-2">
              <label className="sr-only" htmlFor="price">
                {kind === "need" ? "งบที่ยินดีจ่าย" : "ราคา"}
              </label>
              <input id="price" value={price} onChange={(e) => setPrice(e.target.value)} maxLength={100} className={input} placeholder={PAYMENT[kind].pricePlaceholder} />
              <p className="mt-1 text-sm text-neutral-500">ระบบไม่รับเงิน ผู้ขอและผู้ช่วยตกลงราคาและจ่ายกันเอง</p>
            </div>
          )}
        </fieldset>
      )}

      <div>
        <label className={label} htmlFor="detail">รายละเอียด</label>
        <textarea
          id="detail"
          rows={3}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          maxLength={1000}
          className={input}
          placeholder={
            kind === "need" ? "เช่น ผู้สูงอายุ 2 คน ติดชั้น 2 น้ำระดับเอว ต้องการเรือ" : kind === "offer" ? "เช่น มีเรือพาย 1 ลำ นั่งได้ 3 คน ว่างทั้งวัน" : "เช่น ซอย 2 น้ำสูงเกินเข่า รถเก๋งผ่านไม่ได้"
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div>
          <label className={label} htmlFor="place">บ้านเลขที่ / ซอย / จุดสังเกต</label>
          <input id="place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} className={input} placeholder="เช่น 99/12 ซอย 3 ตรงข้ามสโมสร" />
        </div>
        {kind !== "info" && (
          <div>
            <label className={label} htmlFor="people">{kind === "need" ? "จำนวนคน" : "รองรับได้ (คน)"}</label>
            <input id="people" type="number" inputMode="numeric" min={0} max={500} value={people} onChange={(e) => setPeople(e.target.value)} className={input} />
          </div>
        )}
      </div>

      <div>
        <span className={label}>รูป / คลิป (ไม่บังคับ)</span>
        <MediaPicker items={media} setItems={setMedia} max={4} />
      </div>

      <div>
        <span className={label}>ตำแหน่ง *</span>
        <LocationPicker value={loc} onChange={setLoc} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="name">ชื่อผู้แจ้ง *</label>
          <input id="name" required value={contact.name} onChange={(e) => setContact({ name: e.target.value })} maxLength={80} className={input} autoComplete="name" />
        </div>
        <div>
          <label className={label} htmlFor="phone">เบอร์โทร {kind !== "info" && "(แนะนำ)"}</label>
          <input id="phone" type="tel" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ phone: e.target.value })} maxLength={40} className={input} autoComplete="tel" />
        </div>
      </div>
      <p className="text-sm text-neutral-500">ชื่อและเบอร์จะแสดงให้ทุกคนที่เปิดหน้านี้เห็น เพื่อให้ติดต่อกลับได้</p>

      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <Submit busy={busy} color="bg-black active:bg-neutral-800">
        {attached.busy ? "⏳ รอไฟล์แนบ…" : `${k.emoji} ส่ง${k.label}`}
      </Submit>
    </form>
  );
}

export function WaterForm({ onDone }) {
  const [contact, setContact] = useContact();
  const [level, setLevel] = useState(null);
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState(null);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attached = mediaState(media);

  async function submit(e) {
    e.preventDefault();
    if (level == null) return setError("กรุณาเลือกระดับน้ำ");
    if (attached.busy) return setError("รอรูปอัปโหลดให้เสร็จก่อน");
    setBusy(true);
    setError("");
    try {
      const w = await api("/water", { method: "POST", body: JSON.stringify({ level, note: note.trim(), name: contact.name.trim(), media_ids: attached.ids, ...loc }) });
      onDone(w);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={label}>ระดับน้ำตอนนี้ *</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WATER_LEVELS.map((w) => (
            <button
              type="button"
              key={w.level}
              onClick={() => setLevel(w.level)}
              aria-pressed={level === w.level}
              className={`min-h-[56px] rounded-lg border-2 px-2 text-center ${level === w.level ? "border-neutral-900 ring-2 ring-neutral-900" : "border-neutral-200"}`}
              style={{ background: `${w.color}22` }}
            >
              <span className="mr-1 inline-block h-3 w-3 rounded-full align-middle" style={{ background: w.color }} />
              <span className="font-semibold">{w.label}</span>
              <span className="block text-sm text-neutral-600">{w.cm}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <span className={label}>รูประดับน้ำ (ไม่บังคับ)</span>
        <MediaPicker items={media} setItems={setMedia} max={1} allowVideo={false} />
      </div>
      <div>
        <span className={label}>ตำแหน่ง *</span>
        <LocationPicker value={loc} onChange={setLoc} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="wnote">หมายเหตุ</label>
          <input id="wnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="เช่น น้ำกำลังขึ้น / ลดลงแล้ว" />
        </div>
        <div>
          <label className={label} htmlFor="wname">ชื่อ (ไม่บังคับ)</label>
          <input id="wname" value={contact.name} onChange={(e) => setContact({ name: e.target.value })} maxLength={80} className={input} />
        </div>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <Submit busy={busy} color="bg-black active:bg-neutral-800">💧 ส่งระดับน้ำ</Submit>
    </form>
  );
}
