import { useEffect, useRef, useState } from "react";
import {
  CATEGORIES,
  KINDS,
  NEED_WORDS,
  PAYMENT,
  URGENT_CATEGORIES,
  VILLAGE_CENTER,
  WATER_LEVELS,
  WATER_TREND,
  WATER_WHERE,
  categoryOf,
  guessNeedCategory,
  levelFromCm,
  peopleInText,
  timeAgo,
} from "../config";
import { api, load, save } from "../api";
import LocationPicker from "./LocationPicker";
import MediaPicker, { mediaState } from "./MediaPicker";
import WaterGauge from "./WaterGauge";

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

function Submit({ busy, children }) {
  return (
    <button type="submit" disabled={busy} className="min-h-[52px] w-full rounded-xl bg-black px-4 text-lg font-semibold text-white active:bg-neutral-800 disabled:opacity-60">
      {busy ? "กำลังส่ง…" : children}
    </button>
  );
}

// A question shown right above the submit button (instead of a native confirm() popup).
function Ask({ tone = "yellow", title, children, actions }) {
  const cls = tone === "red" ? "border-red-600 bg-red-50" : "border-black bg-yellow-100";
  return (
    <div role="alertdialog" aria-label={title} className={`anim-pop rounded-xl border-2 p-3 ${cls}`}>
      <p className="font-bold">{title}</p>
      {children && <div className="mt-1 text-sm">{children}</div>}
      <div className="mt-2 grid gap-2 min-[400px]:grid-cols-2">
        {actions.map(([text, onClick, primary]) => (
          <button
            type="button"
            key={text}
            onClick={onClick}
            className={`min-h-[48px] rounded-lg px-3 font-semibold ${primary ? "bg-black text-white" : "border-2 border-black bg-white"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const metres = (a, b) => Math.hypot((a.lat - b.lat) * 110540, (a.lng - b.lng) * 108000);
const normPlace = (s) => (s || "").replace(/\s+/g, "").replace(/บ้านเลขที่|เลขที่|ซอย|ซ\.|แยก/g, "");

export function PostForm({ kind: initialKind, posts = [], prefill = {}, onDone, onOpenExisting }) {
  const [kind, setKind] = useState(prefill.kind || initialKind);
  const k = KINDS[kind];
  const [contact, setContact] = useContact();
  const [category, setCategory] = useState(prefill.category || "");
  const [detail, setDetail] = useState(prefill.detail || "");
  const [place, setPlace] = useState("");
  const [people, setPeople] = useState("");
  const [peopleTouched, setPeopleTouched] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [urgentTouched, setUrgentTouched] = useState(false);
  const [payment, setPayment] = useState("free");
  const [price, setPrice] = useState("");
  const [loc, setLoc] = useState(prefill.loc || null);
  const [pinTouched, setPinTouched] = useState(Boolean(prefill.loc));
  const [general, setGeneral] = useState(false);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(null); // "need" | "pin" | {dup: post}
  const [skip, setSkip] = useState({}); // questions already answered "no, send anyway"
  const [switched, setSwitched] = useState(false);
  const pickerRef = useRef(null);
  const attached = mediaState(media);

  // Life-and-health categories switch "urgent" on by themselves unless the user already chose.
  function pickCategory(key) {
    setCategory(key);
    if (kind === "need" && !urgentTouched) setUrgent(URGENT_CATEGORIES.includes(key));
  }

  // Fill "people" from the text ("ผู้สูงอายุ 2 คน เด็ก 3 คน" -> 5) unless typed by hand.
  const textCount = peopleInText(detail);
  useEffect(() => {
    if (!peopleTouched && textCount != null) setPeople(String(textCount));
  }, [textCount, peopleTouched]);
  const peopleMismatch = kind === "need" && textCount != null && people !== "" && Number(people) !== textCount;

  function switchToNeed() {
    const guess = guessNeedCategory(`${detail} ${place}`);
    setKind("need");
    setCategory(guess);
    setUrgent(URGENT_CATEGORIES.includes(guess));
    setGeneral(false);
    setPayment("free");
    setSwitched(true);
    setAsk(null);
  }

  function findDuplicate() {
    if (kind !== "need" || !loc) return null;
    const mine = normPlace(place);
    return posts.find(
      (p) =>
        p.kind === "need" &&
        p.status !== "done" &&
        Date.now() - new Date(p.created_at).getTime() < 24 * 3600 * 1000 &&
        ((mine.length >= 3 && normPlace(p.place) === mine) || (p.category === category && metres(p, loc) < 30))
    );
  }

  async function submit(e) {
    e?.preventDefault();
    if (!category) return setError("กรุณาเลือกประเภท");
    if (!general && !loc) return setError("กรุณาเลือกตำแหน่ง");
    if (attached.busy) return setError("รอไฟล์แนบอัปโหลดให้เสร็จก่อน");
    setError("");
    // 1) A request filed as info/offer never reaches helpers' counts, red pins or the LINE summary.
    if (kind !== "need" && !skip.need && NEED_WORDS.test(`${detail} ${place}`)) return setAsk("need");
    // 2) Pin never moved: it sits on the village centre, not the house.
    if (!general && !pinTouched && !skip.pin) return setAsk("pin");
    // 3) Same house / same spot already has an open request.
    const dup = !skip.dup && findDuplicate();
    if (dup) return setAsk({ dup });

    setBusy(true);
    try {
      const where = general ? { lat: VILLAGE_CENTER[0], lng: VILLAGE_CENTER[1] } : loc;
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
          urgent: kind === "need" && urgent,
          general: kind !== "need" && general,
          pin_confirmed: pinTouched, // lets the app learn where house "4/xxx" really is
          payment: kind === "info" ? "free" : payment,
          price: payment === "paid" ? price.trim() : "",
          media_ids: attached.ids,
          ...where,
        }),
      });
      save("editKeys", { ...load("editKeys", {}), [post.id]: post.edit_key });
      onDone(post, { suggestBoard: kind === "offer" && payment === "paid", price: price.trim() });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Answering a question continues the submission with that question skipped.
  const proceed = (key) => {
    setSkip((s) => ({ ...s, [key]: true }));
    setAsk(null);
    setTimeout(() => document.getElementById("post-form")?.requestSubmit(), 0);
  };

  return (
    <form id="post-form" onSubmit={submit} className="space-y-4">
      {switched && (
        <p className="anim-pop rounded-xl border-2 border-black bg-yellow-100 p-3 text-sm font-semibold">
          เปลี่ยนเป็น “🆘 ขอความช่วยเหลือ” แล้ว ตรวจหมวดและปุ่มด่วนด้านล่าง แล้วกดส่งอีกครั้ง
        </p>
      )}

      {kind === "need" && (
        <button
          type="button"
          onClick={() => {
            setUrgent((u) => !u);
            setUrgentTouched(true);
          }}
          aria-pressed={urgent}
          className={`flex min-h-[64px] w-full items-center gap-3 rounded-xl border-4 px-4 text-left ${urgent ? "border-red-800 bg-red-600 text-white" : "border-red-500 bg-white text-red-700"}`}
        >
          <span
            aria-hidden="true"
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-4 text-xl font-black ${urgent ? "border-white bg-white text-red-600" : "border-red-500 bg-white"}`}
          >
            {urgent ? "✓" : ""}
          </span>
          <span>
            <span className="block text-lg font-bold leading-tight">{urgent ? "ด่วนมาก (เลือกแล้ว)" : "กดถ้าด่วนมาก"}</span>
            <span className="block text-sm leading-tight">มีผู้ป่วย ผู้สูงอายุติดเตียง เด็กเล็ก หรืออันตรายต่อชีวิต</span>
          </span>
        </button>
      )}

      <fieldset>
        <legend className={label}>ประเภท *</legend>
        <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
          {Object.entries(CATEGORIES[kind]).map(([key, [emoji, text]]) => (
            <button
              type="button"
              key={key}
              onClick={() => pickCategory(key)}
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
        {kind === "info" && (
          <p className="mt-2 text-sm text-neutral-600">
            ถ้า<b>คุณหรือเพื่อนบ้านต้องการความช่วยเหลือ</b> (ผู้สูงอายุ ผู้ป่วย ไม่มีอาหาร/ไฟ){" "}
            <button type="button" onClick={switchToNeed} className="font-semibold text-red-700 underline">
              กดที่นี่เพื่อขอความช่วยเหลือแทน
            </button>
          </p>
        )}
      </fieldset>

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
            kind === "need"
              ? "บอกว่าต้องการอะไร กี่คน ใครบ้าง เช่น ผู้สูงอายุ 2 คน ติดชั้น 2 น้ำระดับเอว ต้องการเรือ"
              : kind === "offer"
                ? "เช่น มีเรือพาย 1 ลำ นั่งได้ 3 คน ว่างทั้งวัน"
                : "เช่น ซอย 10 ต้นไม้ล้ม ใช้ได้เลนเดียว"
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <div>
          <label className={label} htmlFor="place">บ้านเลขที่ / ซอย / จุดสังเกต</label>
          <input id="place" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={200} className={input} placeholder="เช่น 4/123 ซอย 3 ตรงข้ามสโมสร" />
        </div>
        {kind !== "info" && (
          <div>
            <label className={label} htmlFor="people">{kind === "need" ? "จำนวนคน" : "รองรับได้ (คน)"}</label>
            <input
              id="people"
              type="number"
              inputMode="numeric"
              min={0}
              max={500}
              value={people}
              onChange={(e) => {
                setPeople(e.target.value);
                setPeopleTouched(true);
              }}
              className={input}
            />
          </div>
        )}
      </div>
      {peopleMismatch && (
        <p className="rounded-lg bg-yellow-100 p-2 text-sm">
          ในรายละเอียดเขียนว่า {textCount} คน แต่ช่องจำนวนคนใส่ {people} คน{" "}
          <button type="button" className="font-semibold underline" onClick={() => setPeople(String(textCount))}>
            ใช้ {textCount}
          </button>
        </p>
      )}

      <div>
        <span className={label}>รูป / คลิป (ไม่บังคับ)</span>
        <MediaPicker items={media} setItems={setMedia} max={4} />
      </div>

      <div ref={pickerRef}>
        <span className={label}>ตำแหน่ง *</span>
        {kind !== "need" && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            {[
              [false, "📍 ปักหมุดจุดเกิดเหตุ"],
              [true, "🏘️ ทั้งหมู่บ้าน / ไม่ระบุจุด"],
            ].map(([g, text]) => (
              <button
                type="button"
                key={text}
                onClick={() => setGeneral(g)}
                aria-pressed={general === g}
                className={`min-h-[44px] rounded-lg border-2 px-2 text-sm font-semibold ${general === g ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
              >
                {text}
              </button>
            ))}
          </div>
        )}
        {general ? (
          <p className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-600">ข่าวนี้จะแสดงในรายการโดยไม่ปักหมุดบนแผนที่ (เช่น ร้านเปิด จุดแจกของทั่วไป ข่าวจากเขต)</p>
        ) : (
          <>
            <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinTouched(true)} />
            {!pinTouched && <p className="mt-1 text-sm font-semibold text-red-700">⚠️ เลื่อนแผนที่ให้หมุดอยู่ที่บ้าน/จุดเกิดเหตุ หรือกด “ใช้ตำแหน่งปัจจุบัน”</p>}
          </>
        )}
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
      <p className="text-sm text-neutral-500">ชื่อแสดงในรายการ · เบอร์โทรแสดงเฉพาะเมื่อมีคนกดเปิดดูรายละเอียดเพื่อติดต่อ</p>

      {ask === "need" && (
        <Ask
          tone="red"
          title="ข้อความนี้ดูเหมือนมีคนต้องการความช่วยเหลือ"
          actions={[
            ["🆘 เปลี่ยนเป็นขอความช่วยเหลือ", switchToNeed, true],
            [`ไม่ใช่ ส่งเป็น “${k.label}”`, () => proceed("need")],
          ]}
        >
          ถ้าส่งเป็น “{k.label}” จะไม่ถูกนับเป็นคำขอ ไม่เป็นหมุดแดงบนแผนที่ และไม่อยู่ในสรุปที่ส่งเข้า LINE
        </Ask>
      )}
      {ask === "pin" && (
        <Ask
          title="📍 หมุดยังอยู่กลางหมู่บ้าน ยังไม่ได้เลื่อนไปที่บ้าน/จุดเกิดเหตุ"
          actions={[
            [
              "เลื่อนหมุดก่อน",
              () => {
                setAsk(null);
                pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              },
              true,
            ],
            ...(kind !== "need" ? [["เป็นข่าวทั้งหมู่บ้าน", () => { setGeneral(true); setAsk(null); }]] : []),
            ["ตำแหน่งถูกแล้ว ส่งเลย", () => proceed("pin")],
          ]}
        >
          คนที่จะไปช่วยจะเดินทางไปตามหมุดนี้
        </Ask>
      )}
      {ask?.dup && (
        <Ask
          title="มีคำขอที่บ้าน/จุดนี้อยู่แล้ว"
          actions={[
            ["เปิดคำขอเดิม (อัปเดตแทน)", () => onOpenExisting?.(ask.dup.id), true],
            ["เป็นคนละเรื่อง ส่งใหม่", () => proceed("dup")],
          ]}
        >
          {categoryOf(ask.dup)[0]} {categoryOf(ask.dup)[1]} · {ask.dup.place || "ไม่ระบุที่อยู่"} · {timeAgo(ask.dup.created_at)} — ถ้าเป็นเรื่องเดิม เปิดแล้วกด “ส่งข้อความอัปเดต” จะช่วยให้ไม่สับสน
        </Ask>
      )}

      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {!ask && <Submit busy={busy}>{attached.busy ? "⏳ รอไฟล์แนบ…" : `${k.emoji} ส่ง${k.label}`}</Submit>}
    </form>
  );
}

export function WaterForm({ onDone }) {
  const [contact, setContact] = useContact();
  const [level, setLevel] = useState(null);
  const [cm, setCm] = useState("");
  const [trend, setTrend] = useState(null);
  const [where, setWhere] = useState(null);
  const [note, setNote] = useState("");
  const [loc, setLoc] = useState(null);
  const [pinTouched, setPinTouched] = useState(false);
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ask, setAsk] = useState(null);
  const [skip, setSkip] = useState({});
  const pickerRef = useRef(null);
  const attached = mediaState(media);

  // Typing centimetres picks the matching body level (65 cm = ต้นขา, not เข่า).
  const cmNum = cm === "" ? null : Number(cm);
  const shownLevel = cmNum != null && !Number.isNaN(cmNum) ? levelFromCm(cmNum) : level;

  async function submit(e) {
    e?.preventDefault();
    if (shownLevel == null) return setError("กรุณาเลือกระดับน้ำ หรือใส่ความสูงเป็นเซนติเมตร");
    if (attached.busy) return setError("รอรูปอัปโหลดให้เสร็จก่อน");
    setError("");
    if (!pinTouched && !skip.pin) return setAsk("pin");
    const last = load("lastWater", null);
    if (!skip.dup && last && loc && Date.now() - last.at < 10 * 60 * 1000 && Math.hypot((last.lat - loc.lat) * 110540, (last.lng - loc.lng) * 108000) < 30) {
      return setAsk("dup");
    }
    setBusy(true);
    try {
      const w = await api("/water", {
        method: "POST",
        body: JSON.stringify({ level: shownLevel, cm: cmNum, trend, where, note: note.trim(), name: contact.name.trim(), media_ids: attached.ids, ...loc }),
      });
      save("lastWater", { at: Date.now(), lat: loc.lat, lng: loc.lng });
      onDone(w, { needHint: NEED_WORDS.test(note) ? note.trim() : "" });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const proceed = (key) => {
    setSkip((s) => ({ ...s, [key]: true }));
    setAsk(null);
    setTimeout(() => document.getElementById("water-form")?.requestSubmit(), 0);
  };

  const seg = (active) => `min-h-[44px] rounded-lg border-2 px-2 text-sm font-semibold ${active ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`;

  return (
    <form id="water-form" onSubmit={submit} className="space-y-4">
      <fieldset>
        <legend className={label}>ระดับน้ำตอนนี้ *</legend>
        <div className="mb-2 flex items-center gap-3">
          <WaterGauge level={shownLevel} className="h-40 w-auto shrink-0 rounded-xl border border-neutral-200" />
          <div className="min-w-0 flex-1 space-y-2">
            <label className="block text-sm font-medium" htmlFor="wcm">
              วัดได้กี่เซนติเมตร (ถ้ารู้)
            </label>
            <div className="flex items-center gap-2">
              <input id="wcm" type="number" inputMode="numeric" min={0} max={300} value={cm} onChange={(e) => setCm(e.target.value)} className={`${input} w-24`} placeholder="ซม." />
              {cmNum != null && !Number.isNaN(cmNum) && <span className="text-sm font-semibold">= {WATER_LEVELS[shownLevel].label}</span>}
            </div>
            <p className="text-xs text-neutral-500">ถ้าไม่รู้ เลือกระดับเทียบกับร่างกายด้านล่าง</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {WATER_LEVELS.map((w) => (
            <button
              type="button"
              key={w.level}
              onClick={() => {
                setLevel(w.level);
                setCm("");
              }}
              aria-pressed={shownLevel === w.level}
              className={`min-h-[56px] rounded-lg border-2 px-2 text-center ${shownLevel === w.level ? "border-neutral-900 ring-2 ring-neutral-900" : "border-neutral-200"}`}
              style={{ background: `${w.color}22` }}
            >
              <span className="mr-1 inline-block h-3 w-3 rounded-full align-middle" style={{ background: w.color }} />
              <span className="font-semibold">{w.label}</span>
              <span className="block text-sm text-neutral-600">{w.cm}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset>
          <legend className={label}>แนวโน้ม</legend>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(WATER_TREND).map(([key, [icon, text]]) => (
              <button type="button" key={key} onClick={() => setTrend(trend === key ? null : key)} aria-pressed={trend === key} className={seg(trend === key)}>
                {icon} {text}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className={label}>วัดที่ไหน</legend>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(WATER_WHERE).map(([key, [icon, text]]) => (
              <button type="button" key={key} onClick={() => setWhere(where === key ? null : key)} aria-pressed={where === key} className={seg(where === key)}>
                {icon} {text}
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <div>
        <span className={label}>รูประดับน้ำ (ไม่บังคับ)</span>
        <MediaPicker items={media} setItems={setMedia} max={1} allowVideo={false} />
      </div>
      <div ref={pickerRef}>
        <span className={label}>ตำแหน่ง *</span>
        <LocationPicker value={loc} onChange={setLoc} onTouched={() => setPinTouched(true)} />
        {!pinTouched && <p className="mt-1 text-sm font-semibold text-red-700">⚠️ เลื่อนแผนที่ให้หมุดอยู่ตรงจุดที่วัด หรือกด “ใช้ตำแหน่งปัจจุบัน”</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="wnote">หมายเหตุ</label>
          <input id="wnote" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className={input} placeholder="เช่น ซอย 34 น้ำเริ่มเน่า" />
        </div>
        <div>
          <label className={label} htmlFor="wname">ชื่อ (ไม่บังคับ)</label>
          <input id="wname" value={contact.name} onChange={(e) => setContact({ name: e.target.value })} maxLength={80} className={input} />
        </div>
      </div>
      <p className="text-xs text-neutral-500">ถ้าต้องการอาหาร ของใช้ หรือความช่วยเหลือ ใช้ปุ่ม “🆘 ขอความช่วยเหลือ” จะมีคนเห็นและติดต่อกลับ</p>

      {ask === "pin" && (
        <Ask
          title="📍 หมุดยังอยู่กลางหมู่บ้าน ยังไม่ได้เลื่อนไปจุดที่วัด"
          actions={[
            [
              "เลื่อนหมุดก่อน",
              () => {
                setAsk(null);
                pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              },
              true,
            ],
            ["ตำแหน่งถูกแล้ว ส่งเลย", () => proceed("pin")],
          ]}
        >
          ระดับน้ำจะถูกระบายสีบนแผนที่ตามหมุดนี้
        </Ask>
      )}
      {ask === "dup" && (
        <Ask
          title="คุณเพิ่งแจ้งระดับน้ำจุดนี้ไปไม่ถึง 10 นาที"
          actions={[
            ["ไม่ส่งซ้ำ", () => setAsk(null), true],
            ["ส่งอีกครั้ง (ระดับเปลี่ยน)", () => proceed("dup")],
          ]}
        />
      )}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {!ask && <Submit busy={busy}>💧 ส่งระดับน้ำ</Submit>}
    </form>
  );
}
