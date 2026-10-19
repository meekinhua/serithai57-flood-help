import { useMemo, useState } from "react";
import { api } from "../api";
import { pushKey } from "../sellerSync";
import {
  CATALOG_WORDS,
  FOOD_LEND,
  HOME_LEND,
  LEND_CATEGORIES,
  SERVICE_CATEGORIES,
  SERVICE_GROUPS,
  SERVICE_LEND,
  SHELVES,
  timeAgo,
} from "../config";
import { PRO_CATS, PRO_GROUPS } from "./Community";
import {
  ContactButton,
  NameField,
  input,
  label,
  remember,
  savedContact,
  useKeys,
} from "./RepairBoards";

// 📢 ประกาศหา (20 Oct 2026). Residents kept asking for things the menus had no door for — "someone to move a
// piano", "a builder to re-lay the floor", "a house to rent" — because every menu was laid out for sellers.
// A request is a lend item of kind "want" in the SAME category as the sellers / ช่าง (one taxonomy, both sides),
// so a mover browsing 💪 ขนของ sees the piano job, a builder on the ช่าง page sees the floor job.
// Type one sentence → the category is guessed from the catalog words (admin-editable) → fix it if wrong → post.

export const wantShelf = (x) =>
  PRO_CATS.includes(x.category)
    ? "pros"
    : SERVICE_LEND.includes(x.category) ||
        x.category === "hire" ||
        SERVICE_GROUPS.some((g) => g.cats.includes(x.category))
      ? "service"
      : HOME_LEND.includes(x.category)
        ? "home"
        : FOOD_LEND.includes(x.category)
          ? "food"
          : "goods";

export const openWants = (items) =>
  items.filter((x) => x.kind === "want" && x.status !== "closed");
const catLabel = (k) =>
  SERVICE_CATEGORIES[k] || LEND_CATEGORIES[k] || ["📢", "อื่นๆ"];

export function guessCat(text) {
  const t = text || "";
  for (const [k, rx] of Object.entries(CATALOG_WORDS)) {
    try {
      if (rx && new RegExp(rx, "i").test(t)) return k;
    } catch {}
  }
  return /ช่าง|ซ่อม/.test(t) ? "handyman" : "errand";
}

// every category, grouped the way people see them
function catGroups() {
  return [
    {
      title: "🔧 ช่างซ่อมบ้าน",
      cats: PRO_GROUPS.flatMap((g) => g.cats).filter(
        (k) => SERVICE_CATEGORIES[k],
      ),
    },
    {
      title: "🙋 บริการ",
      cats: SERVICE_GROUPS.flatMap((g) => g.cats).filter(
        (k) => SERVICE_CATEGORIES[k],
      ),
    },
    ...SHELVES.filter((s) => s.key !== "service").map((s) => ({
      title: `${s.icon} ${s.label}`,
      cats: (s.sell || []).filter((k) => LEND_CATEGORIES[k]),
    })),
  ];
}

/** "📢 มีคนกำลังหา" — the open requests for this shelf (or the ช่าง page), each with "ฉันช่วยได้" */
export function WantStrip({ items, shelf, onPost, title }) {
  const list = openWants(items)
    .filter((x) => (shelf ? wantShelf(x) === shelf : wantShelf(x) !== "pros"))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!list.length) return null;
  return (
    <section className="space-y-2 rounded-2xl border-2 border-[#F2B872] bg-[#FFF8EC] p-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[17px] font-bold">
          {title || "📢 มีคนกำลังหา"} ({list.length})
        </h3>
        {onPost && (
          <button
            onClick={onPost}
            className="min-h-[40px] rounded-full border-2 border-[#15201A] bg-white px-3 text-sm font-bold"
          >
            + ประกาศหา
          </button>
        )}
      </div>
      <p className="text-sm text-[#5C3B00]">
        รับงานนี้ได้ / มีของ? กด “ฉันช่วยได้” แล้วโทรคุยกันเลย
      </p>
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <ul className="flex w-max gap-2">
          {list.map((x) => {
            const [e, t] = catLabel(x.category);
            return (
              <li
                key={x.id}
                id={`want-${x.id}`}
                className="flex w-[260px] scroll-mt-28 flex-col gap-1.5 rounded-xl border border-[#E8D9B8] bg-white p-3"
              >
                <span className="text-sm font-semibold text-[#8A4B00]">
                  {e} {t}
                </span>
                <b className="line-clamp-3 text-[16px] leading-snug">
                  {x.title}
                </b>
                {x.detail && (
                  <span className="line-clamp-2 text-sm text-[#45504A]">
                    {x.detail}
                  </span>
                )}
                <span className="text-sm text-[#45504A]">
                  {[x.soi && `📍 ซ.${x.soi}`, timeAgo(x.created_at)]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <div className="mt-auto pt-1">
                  <ContactButton
                    path={`/lend/${x.id}/contact`}
                    text="📞 ฉันช่วยได้"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** the short form: one sentence, a guessed category you can change, soi, contact */
export function WantForm({ hint = "", onDone }) {
  const c = savedContact();
  const [, addKey] = useKeys("lendKeys");
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [picking, setPicking] = useState(false);
  const [soi, setSoi] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("mySoi") || '""');
    } catch {
      return "";
    }
  });
  const [name, setName] = useState(c.name || "");
  const [phone, setPhone] = useState(c.phone || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const guessed = useMemo(() => guessCat(text), [text]);
  const category = cat || guessed;
  const [e, t] = catLabel(category);
  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const words = text.trim();
      const said = words.match(/(?:ซ\.?|ซอย|แยก)\s*(\d{1,3}(?:\/\d{1,2})?)/);
      const x = await api("/lend", {
        method: "POST",
        body: JSON.stringify({
          kind: "want",
          category,
          title: words.slice(0, 80),
          detail: words.slice(80, 400),
          soi: (soi || (said && said[1]) || "").slice(0, 12),
          name,
          phone,
          notify_endpoint: "",
          media_ids: [],
        }),
      });
      remember(name, phone);
      addKey(x.id, x.edit_key);
      pushKey("lend", x.id, x.edit_key);
      onDone && onDone(x);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="rounded-lg bg-[#FFF8EC] p-2.5 text-sm text-[#5C3B00]">
        📢 พิมพ์สิ่งที่อยากได้ หรืออยากจ้าง · เพื่อนบ้านที่รับงานได้ / มีของ
        จะเห็นแล้วโทรหาคุณเอง
      </p>
      <div>
        <label className={label} htmlFor="want-text">
          อยากได้อะไร / อยากจ้างทำอะไร *
        </label>
        <textarea
          id="want-text"
          required
          minLength={4}
          maxLength={400}
          rows={3}
          value={text}
          onChange={(ev) => setText(ev.target.value)}
          className={input}
          placeholder={
            hint ||
            "เช่น หาคนช่วยยกเปียโนไปอีกห้อง ซ.55 เสาร์นี้ · หาช่างเทพื้นปูนทั้งบ้าน · หาเช่าบ้านในหมู่บ้าน 2 หลัง"
          }
        />
      </div>
      <div>
        <p className={label}>
          หมวด{" "}
          {cat ? (
            ""
          ) : (
            <span className="text-sm font-normal text-[#45504A]">
              (เดาจากที่พิมพ์ · ผิดกดเปลี่ยนได้)
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setPicking(!picking)}
          className="flex min-h-[48px] w-full items-center gap-2 rounded-xl border-2 border-[#15201A] bg-white px-3 text-left font-bold"
        >
          <span className="text-xl">{e}</span>
          <span className="min-w-0 flex-1">{t}</span>
          <span className="text-sm font-semibold text-[#1F4F8A] underline">
            {picking ? "ปิด" : "เปลี่ยน"}
          </span>
        </button>
        {picking && (
          <div className="mt-2 max-h-72 space-y-3 overflow-y-auto rounded-xl border border-[#DCE2DD] p-2">
            {catGroups().map((g) => (
              <div key={g.title}>
                <p className="mb-1 text-sm font-bold text-[#45504A]">
                  {g.title}
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {g.cats.map((k) => (
                    <button
                      type="button"
                      key={k}
                      onClick={() => {
                        setCat(k);
                        setPicking(false);
                      }}
                      className={`min-h-[44px] rounded-lg border-2 px-2 text-left text-sm ${category === k ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
                    >
                      {catLabel(k)[0]} {catLabel(k)[1]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <label className={label} htmlFor="want-soi">
          ซอย
        </label>
        <input
          id="want-soi"
          maxLength={12}
          value={soi}
          onChange={(ev) => setSoi(ev.target.value)}
          className={input}
          placeholder="เช่น 23 หรือ 34/4"
        />
      </div>
      <NameField id="want-name" value={name} onChange={setName} />
      <div>
        <label className={label} htmlFor="want-phone">
          เบอร์โทร *
        </label>
        <input
          id="want-phone"
          required
          type="tel"
          inputMode="tel"
          maxLength={40}
          value={phone}
          onChange={(ev) => setPhone(ev.target.value)}
          className={input}
          placeholder="เบอร์ให้คนที่ช่วยได้โทรกลับ"
        />
        <p className="mt-1 text-sm text-neutral-600">
          เบอร์โชว์เฉพาะตอนมีคนกด “ฉันช่วยได้”
        </p>
      </div>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      <button
        disabled={busy}
        className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-60"
      >
        {busy ? "กำลังลง…" : "📢 ประกาศหา"}
      </button>
    </form>
  );
}
