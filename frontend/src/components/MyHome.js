import { useEffect, useMemo, useRef, useState } from "react";
import { api, load, save } from "../api";
import LocationPicker from "./LocationPicker";
import Nearby from "./Nearby";
import { useT } from "./Texts";
import { MYHOME_CHANGED, cleanHouse } from "./SurveyBox";
import { PRO_GROUPS, goodOf, rememberCall } from "./Community";
import { MediaStrip, MediaThumb } from "./MediaGallery";
import { AidRow, CheckinCard, InstallCard, OutageRow, PlanRow, ReviewPrompt, shareFamily, takeFamilyParam } from "./HomePlus";
import { waterOf } from "../config";

// บ้านฉัน (7 Oct 2026): a house number typed once (or taken from the electricians' sign-up on this phone) and
// the page shows what concerns that house: the regular rubbish round of its soi, its electrical check, the
// water in front of it right now (one tap), open problems in its soi to report to the office. No login.

const WATER_TAPS = [
  { key: "dry", label: "แห้ง", level: 0, where: "street", cls: "border-[#1E6B47] text-[#1E6B47]" },
  { key: "street", label: "น้ำขังถนน", level: 1, where: "street", cls: "border-[#B45F06] text-[#7A4104]" },
  { key: "house", label: "น้ำเข้าบ้าน", level: 2, where: "house", cls: "border-[#B42318] text-[#B42318]" },
];
const ELECTRIC = {
  done: ["ช่างตรวจแล้ว", "text-[#1E6B47]"],
  absent: ["ช่างมาแล้ว แต่ไม่มีคนอยู่", "text-[#B45F06]"],
  again: ["ช่างนัดกลับมาอีก", "text-[#B45F06]"],
  claimed: ["ช่างรับงานแล้ว", "text-[#1F5FA8]"],
  todo: ["ลงชื่อไว้ ยังไม่ได้ตรวจ · รอสรุปกับทีมช่าง", "text-[#45504A]"],
};

// ---------- the water at my door, read from what the neighbours reported (for owners who are away) ----------
const NEAR_H = 6; // hours a report still counts
function metres(a, b) {
  const dy = (a.lat - b.lat) * 111320;
  const dx = (a.lng - b.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
function ago(t) {
  const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  return m < 60 ? `${m} นาทีที่แล้ว` : `${Math.round(m / 60)} ชม.ที่แล้ว`;
}

function WaterRow({ info, water, onAsk, sent, onTap }) {
  const exact = info.precision === "house";
  const radius = exact ? 150 : 300;
  const near = useMemo(() => {
    const t = Date.now();
    return (water || [])
      .filter((w) => w.lat && w.lng && t - new Date(w.created_at).getTime() < NEAR_H * 3600e3 && w.name !== `บ้าน ${info.house}`)
      .map((w) => ({ ...w, m: metres(info, w) }))
      .filter((w) => w.m <= radius)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [water, info, radius]);
  const last = near[0];
  const lv = last ? waterOf(last.level) : null;
  const wet = near.filter((w) => w.level > 0).length;
  const t = useT();
  return (
    <Row icon="💧" title={t("myhome.water.title", "น้ำหน้าบ้านคุณ")}>
      {last ? (
        <div className="flex items-center gap-3 rounded-2xl p-3" style={{ background: `${lv.color}1A`, border: `2px solid ${lv.color}` }}>
          <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: lv.color }} />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">{last.level === 0 ? "แห้ง ไม่ท่วม" : last.where === "house" ? "มีน้ำเข้าบ้านแถวนี้" : `น้ำ${lv.label} (${lv.cm})`}</p>
            <p className="text-sm text-[#33403A]">
              เพื่อนบ้านแจ้ง {ago(last.created_at)} · ห่าง ~{Math.max(10, Math.round(last.m / 10) * 10)} ม.
              {near.length > 1 ? ` · ${NEAR_H} ชม.นี้ ${near.length} ครั้ง (มีน้ำ ${wet})` : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-[#33403A]">{t("myhome.water.none", "{h} ชม.ที่ผ่านมา ยังไม่มีใครแจ้งแถวบ้านคุณ", { h: NEAR_H })}</p>
      )}
      {!exact && <p className="text-sm text-[#7A4104]">{t("myhome.water.rough", "ดูจากทั้งแถวซอย · ปักหมุดบ้านแล้วจะแม่นขึ้น")}</p>}
      {sent ? (
        <p className="text-[15px] font-bold text-[#1E6B47]">{t("myhome.water.thanks", "ขอบคุณที่แจ้ง ({what}) เพื่อนบ้านเห็นแล้ว", { what: sent })}</p>
      ) : (
        <>
          <p className="pt-1 text-[15px] font-bold">{t("myhome.water.ask", "อยู่บ้าน? กดบอกเพื่อนบ้านว่าตอนนี้เป็นแบบไหน")}</p>
          <div className="grid grid-cols-3 gap-2">
            {WATER_TAPS.map((w) => (
              <button key={w.label} onClick={() => onTap(w)} className={`min-h-[52px] rounded-xl border-2 bg-white px-1 text-[15px] font-bold leading-tight ${w.cls}`}>
                {t(`myhome.water.${w.key}`, w.label)}
              </button>
            ))}
          </div>
        </>
      )}
      {onAsk && (
        <button onClick={onAsk} className="min-h-[48px] w-full rounded-xl bg-[#F2F4F1] px-3 text-[15px] font-bold text-[#154D33]">
          {t("myhome.water.away", "ไม่อยู่บ้าน? ฝากเพื่อนบ้านใกล้ๆ ช่วยดูให้ ›")}
        </button>
      )}
    </Row>
  );
}

function Row({ icon, title, children, hi, onFold, id }) {
  return (
    <div id={id} className={`border-t border-[#E6EBE7] py-3 ${hi ? "-mx-4 bg-[#FFF8E1] px-4" : ""}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-base font-bold text-[#15201A]">
          {icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </p>
        {onFold && (
          <button onClick={onFold} className="-my-2 min-h-[44px] shrink-0 px-1 text-[15px] font-bold text-[#45504A]">
            หุบ ▴
          </button>
        )}
      </div>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
  );
}

// ---------- the electrical check: what now for the houses the Ministry team didn't reach ----------
// 7 Oct: only "still interested" (free) or "not any more" (fine); group / hired are older answers, still shown
const WANTS = {
  free: ["ยังสนใจ ให้ช่างฟรีมาตรวจ", "ถ้าทีมช่างกลับมา ทีมอาสาจะติดต่อก่อนเข้า"],
  group: ["รวมกลุ่มเพื่อนบ้านในซอย จ้างช่างไฟเอกชน", ""],
  hired: ["จ้างช่างเองแล้ว", ""],
  fine: ["ไม่สนใจแล้ว", ""],
};
const SAFE = [
  "ได้กลิ่นไหม้ ไฟกระพริบ หรือเบรกเกอร์ตัดซ้ำ: ปิดเบรกเกอร์วงจรนั้นไว้ แล้วเรียกช่าง",
  "ปลั๊กและสวิตช์ที่เคยจมน้ำ อย่าเพิ่งใช้ จนกว่าจะแห้งสนิทและช่างดูแล้ว",
  "เครื่องใช้ไฟฟ้าที่จมน้ำ (ตู้เย็น ปั๊ม แอร์ เครื่องซักผ้า) ให้ช่างเช็กก่อนเสียบ",
  "มีเครื่องตัดไฟรั่ว ให้กดปุ่ม TEST ต้องตัดไฟทันที ถ้าไม่ตัด ให้ช่างดู",
  "ห้ามจับสายไฟ ปลั๊ก หรือเบรกเกอร์ ตอนมือหรือเท้าเปียก",
];

// the neighbours' tradesmen of some categories on the contact board: trusted first, numbers that didn't answer last
function ProsPick({ services, cats, title, none, all, add, onAll }) {
  const [more, setMore] = useState(false);
  // most recommended first ("เคยใช้ ดี"), then the ones the team checked, numbers that didn't answer last
  const all_ = (services || [])
    .filter((x) => cats.includes(x.category) && x.available !== false)
    .sort((a, b) => goodOf(b) - goodOf(a) || (a.reports || 0) - (b.reports || 0) || b.verified - a.verified || b.pinned - a.pinned);
  const list = more ? all_ : all_.slice(0, 5);
  return (
    <div className="space-y-2 rounded-2xl bg-[#F2F4F1] p-3">
      <p className="text-[15px] font-bold">
        {title} {all_.length > 0 && <span className="font-normal text-[#45504A]">· {all_.length} ราย</span>}
      </p>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((x) => {
            const digits = (x.phone || "").replace(/[^\d]/g, "");
            const good = goodOf(x);
            return (
              <li key={x.id} className="flex items-center gap-3 rounded-xl bg-white p-3">
                <MediaThumb media={x.media || []} />
                <div className="min-w-0 flex-1">
                  <b className="block text-base leading-snug">{x.name}</b>
                  {x.detail && <p className="line-clamp-1 text-sm text-[#33403A]">{x.detail}</p>}
                  <p className={`text-sm ${good ? "font-bold text-[#1E6B47]" : "text-[#45504A]"}`}>
                    {good ? `👍 เพื่อนบ้านแนะนำ ${good} คน` : "ยังไม่มีคนแนะนำ"}
                    {x.reports > 0 ? <span className="font-normal text-[#B42318]"> · โทรไม่ติด {x.reports}</span> : ""}
                  </p>
                  {digits.length < 9 && x.phone && <p className="text-[15px]">ติดต่อ: {x.phone}</p>}
                </div>
                {digits.length >= 9 && (
                  <a
                    href={`tel:${digits}`}
                    onClick={() => rememberCall(x)}
                    aria-label={`โทร ${x.name} ${x.phone}`}
                    className="flex min-h-[48px] shrink-0 items-center rounded-xl bg-[#15201A] px-4 text-base font-bold text-white"
                  >
                    📞 โทร
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[15px] text-[#45504A]">{none}</p>
      )}
      {all_.length > list.length && (
        <button onClick={() => setMore(true)} className="min-h-[46px] w-full rounded-xl bg-white text-[15px] font-bold text-[#154D33]">
          ดูอีก {all_.length - list.length} ราย ▾
        </button>
      )}
      <button onClick={onAll} className="min-h-[46px] w-full rounded-xl border border-[#C9D1CB] bg-white text-[15px] font-bold">
        {list.length ? all : add}
      </button>
    </div>
  );
}

function Electricians({ services, onAll }) {
  const t = useT();
  return (
    <ProsPick
      services={services}
      cats={["electrician"]}
      title={t("myhome.electric.private", "ช่างไฟเอกชนที่เพื่อนบ้านแนะนำ")}
      none={t("myhome.electric.private_none", "ยังไม่มีในระบบ · ถ้ารู้จักช่างไฟดีๆ แนะนำให้เพื่อนบ้านได้")}
      all={t("myhome.electric.private_all", "ดูช่างไฟทั้งหมด / แนะนำเพิ่ม")}
      add={t("myhome.electric.private_add", "แนะนำช่างไฟ")}
      onAll={onAll}
    />
  );
}

// ---------- "เร็วๆ นี้": what is about to happen to this house (backend myhome.py soon(); tools/site.py remind) ----------
function Soon({ items, onSeen }) {
  const t = useT();
  const [seen, setSeen] = useState(() => load("soonSeen", []));
  const shown = (items || []).filter((x) => !seen.includes(x.id));
  if (!shown.length) return null;
  const ok = (id) => {
    const next = [...seen.slice(-40), id];
    setSeen(next);
    save("soonSeen", next);
    onSeen && onSeen();
  };
  return (
    <div className="mt-2 space-y-2" role="status">
      <p className="text-sm font-bold text-[#7A4104]">{t("myhome.soon.title", "เร็วๆ นี้ที่บ้านคุณ")}</p>
      {shown.map((x) => (
        <div key={x.id} className="flex items-center gap-3 rounded-2xl border-2 border-[#E0A100] bg-[#FFF8E1] p-3">
          <span className="text-2xl" aria-hidden="true">
            {x.icon}
          </span>
          <div className="min-w-0 flex-1">
            <span className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-sm font-bold ${x.when === "วันนี้" ? "bg-[#B42318] text-white" : "bg-[#15201A] text-white"}`}>{x.when}</span>
            <span className="text-base font-bold leading-snug">{x.text}</span>
            <MediaStrip media={x.media || []} size={64} />
            <button onClick={() => ok(x.id)} className="mt-0.5 block min-h-[36px] text-sm font-bold text-[#45504A] underline">
              รับทราบแล้ว ซ่อน
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- how the team reaches this house (team only, never on the page) ----------
const CONTACT_WHY = {
  electric: "ทีมอาสาจะโทรหรือส่ง LINE บอกก่อนช่างเข้าบ้านคุณ",
  news: "ข่าวด่วนของหมู่บ้าน เช่น น้ำมา ไฟดับ รถขยะเข้า ส่งตรงถึงคุณ",
};
function Need({ need }) {
  return need ? <span className="ml-1 rounded bg-[#FDE8E6] px-1.5 text-xs font-bold text-[#B42318]">จำเป็น</span> : <span className="ml-1 text-xs font-normal text-[#45504A]">ไม่บังคับ</span>;
}
function ContactForm({ contact, setContact, onSave }) {
  const t = useT();
  const [more, setMore] = useState(!!(contact.email || contact.ig));
  const f = (k) => ({ value: contact[k] || "", onChange: (e) => setContact({ ...contact, [k]: e.target.value }) });
  const ok = (contact.name || "").trim() && ((contact.phone || "").trim() || (contact.line_id || "").trim());
  const box = "min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base";
  return (
    <form onSubmit={onSave} className="space-y-3 rounded-2xl border-2 border-[#1E6B47] bg-white p-3">
      <p className="text-[15px] font-bold text-[#154D33]">{t(`myhome.contact.why_${contact.from || "news"}`, CONTACT_WHY[contact.from] || CONTACT_WHY.news)}</p>
      <label className="block">
        <span className="text-[15px] font-bold">
          ชื่อเรียก
          <Need need />
        </span>
        <input {...f("name")} placeholder="ชื่อเล่นก็ได้ เช่น ป้าน้อย" className={box} autoComplete="name" />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-[15px] font-bold">
          ติดต่อทางไหน
          <span className="ml-1 rounded bg-[#FDE8E6] px-1.5 text-xs font-bold text-[#B42318]">ใส่อย่างน้อย 1 ช่อง</span>
        </legend>
        <input {...f("phone")} placeholder="เบอร์โทร เช่น 081 234 5678" inputMode="tel" autoComplete="tel" className={box} aria-label="เบอร์โทร" />
        <input {...f("line_id")} placeholder="หรือ LINE ID" className={box} aria-label="LINE ID" />
      </fieldset>
      {more ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-sm font-bold">
              อีเมล
              <Need />
            </span>
            <input {...f("email")} inputMode="email" autoComplete="email" className={box} />
          </label>
          <label className="block">
            <span className="text-sm font-bold">
              IG / Facebook
              <Need />
            </span>
            <input {...f("ig")} className={box} />
          </label>
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="min-h-[44px] text-[15px] font-bold text-[#45504A] underline">
          + เพิ่มอีเมล / IG / Facebook (ไม่บังคับ)
        </button>
      )}
      <fieldset>
        <legend className="text-[15px] font-bold">
          ในบ้านมี
          <span className="ml-1 text-xs font-normal text-[#45504A]">ไม่บังคับ · ทีมใช้ดูแลก่อนตอนเกิดเหตุ</span>
        </legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {[
            ["elder", "ผู้สูงอายุ"],
            ["bedridden", "ผู้ป่วยติดเตียง"],
            ["child", "เด็กเล็ก"],
            ["alone", "อยู่คนเดียว"],
            ["disabled", "ผู้พิการ"],
          ].map(([k, label]) => {
            const on = (contact.vulnerable || []).includes(k);
            return (
              <button
                type="button"
                key={k}
                aria-pressed={on}
                onClick={() => setContact({ ...contact, vulnerable: on ? contact.vulnerable.filter((x) => x !== k) : [...(contact.vulnerable || []), k] })}
                className={`min-h-[44px] rounded-full border-2 px-3 text-[15px] font-bold ${on ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
        <input type="checkbox" checked={contact.news !== false} onChange={(e) => setContact({ ...contact, news: e.target.checked })} className="h-5 w-5 accent-[#1E6B47]" />
        ส่งข่าวด่วนของหมู่บ้านให้ฉันด้วย
      </label>
      <p className="text-sm text-[#45504A]">🔒 ทีมอาสาเห็นเท่านั้น ไม่แสดงบนเว็บ</p>
      <div className="flex gap-2">
        <button disabled={!ok} className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-40">
          บันทึก
        </button>
        <button type="button" onClick={() => setContact(null)} className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold">
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

// ---------- settled things fold into one strip at the foot of the card; a tap opens one back where it was ----------
function Settled({ items, onOpen }) {
  if (!items.length) return null;
  return (
    <div className="border-t border-[#E6EBE7] py-3">
      <p className="text-sm font-bold text-[#45504A]">เรื่องที่ตอบแล้ว · แตะเพื่อดูหรือเปลี่ยน</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((x) => (
          <button
            key={x.key}
            onClick={() => onOpen(x.key)}
            className="flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border border-[#C9D1CB] bg-[#F2F4F1] px-3.5 text-[15px] active:bg-[#E4F0E9]"
          >
            <span className="font-bold text-[#1E6B47]" aria-hidden="true">
              ✓
            </span>
            <span aria-hidden="true">{x.icon}</span>
            <span className="truncate">
              {x.label}: <b>{x.answer}</b>
            </span>
            <span className="text-[#45504A]" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------- questions the team asks every house from the chat (backend myhome.py Question, tools/site.py ask) ----------
function QuestionRow({ q, info, services, onAnswered, onPros, onIssue, onAsk, setErr, onFold }) {
  const [again, setAgain] = useState(false);
  const t = useT();
  async function answer(a) {
    setErr("");
    try {
      onAnswered(await api("/myhome/answer", { method: "POST", body: JSON.stringify({ house: info.house, qid: q.id, answer: a }) }));
      setAgain(false);
    } catch (e) {
      setErr(e.message);
    }
  }
  const group = PRO_GROUPS.find((g) => g.key === q.group);
  const open = !q.answer || again;
  return (
    <Row id={`myhome-${q.id}`} icon={q.icon} title={q.q} hi={open} onFold={q.answer === "no" && !again ? onFold : null}>
      {open && <p className="-mt-1 text-sm text-[#7A4104]">{t("myhome.q.from", "คำถามจากทีมอาสา · กดตอบครั้งเดียว")}</p>}
      <MediaStrip media={q.media || []} />
      {q.answer === "no" && !again ? (
        <div className="flex items-center gap-2 rounded-2xl bg-[#E4F0E9] p-3">
          <p className="min-w-0 flex-1 text-[15px] font-bold text-[#154D33]">คุณตอบ: {q.no}</p>
          <button onClick={() => setAgain(true)} className="min-h-[44px] shrink-0 rounded-xl border border-[#C9D1CB] bg-white px-3 text-[15px] font-bold">
            เปลี่ยนคำตอบ
          </button>
        </div>
      ) : q.answer === "yes" && !again ? (
        <>
          {q.tip && <p className="whitespace-pre-line text-[15px] leading-relaxed">{q.tip}</p>}
          {info.soi && q.soi_yes > 0 && (
            <p className="text-sm text-[#45504A]">
              ใน ซ.{info.soi} ตอบว่า "{q.yes}" อีก {q.soi_yes} หลัง
            </p>
          )}
          {group && (
            <ProsPick
              services={services}
              cats={group.cats}
              title={`${group.label}ที่เพื่อนบ้านแนะนำ`}
              none="ยังไม่มีในระบบ · ถ้ารู้จักเจ้าไหนดีๆ แนะนำให้เพื่อนบ้านได้"
              all={`ดู${group.label}ทั้งหมด / แนะนำเพิ่ม`}
              add={`แนะนำ${group.label}`}
              onAll={() => onPros(group.key)}
            />
          )}
          {q.action === "issue" && (
            <button onClick={onIssue} className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white">
              ส่งเรื่องให้สำนักงานหมู่บ้าน (ถ่ายรูปได้)
            </button>
          )}
          {q.action === "ask" && (
            <button onClick={onAsk} className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white">
              🙏 ฝากเพื่อนบ้านใกล้ๆ ช่วย
            </button>
          )}
          <button onClick={() => answer("no")} className="min-h-[48px] w-full rounded-xl border-2 border-[#1E6B47] bg-white text-[15px] font-bold text-[#154D33]">
            ✓ {q.done}
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => answer("yes")} className="min-h-[52px] rounded-xl border-2 border-[#B45F06] bg-white px-2 text-base font-bold text-[#7A4104]">
            {q.yes}
          </button>
          <button onClick={() => answer("no")} className="min-h-[52px] rounded-xl border-2 border-[#1E6B47] bg-white px-2 text-base font-bold text-[#154D33]">
            {q.no}
          </button>
        </div>
      )}
    </Row>
  );
}

function ElectricRow({ info, services, onSaved, onElectricians, onContact, contactSlot, setErr, onFold, onSent }) {
  const e = info.electric;
  const [pick, setPick] = useState(false); // choosing again
  const sorted = e.want && e.want !== "free" && !pick;
  const deciding = !e.want || pick;
  const [safe, setSafe] = useState(false);
  const [ticks, setTicks] = useState(() => load(`safe:${info.house}`, []));
  async function send(want) {
    setErr("");
    try {
      onSaved(await api("/myhome/electric", { method: "POST", body: JSON.stringify({ house: info.house, want, slots: [] }) }));
      setPick(false);
      onSent && onSent(want);
      window.dispatchEvent(new Event("myhome:electric"));
    } catch (x) {
      setErr(x.message);
    }
  }
  const t = useT();
  const tick = (i) => {
    const next = ticks.includes(i) ? ticks.filter((x) => x !== i) : [...ticks, i];
    setTicks(next);
    save(`safe:${info.house}`, next);
  };

  if (e.status === "done")
    return (
      <Row id="myhome-electric" icon="⚡" title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")} onFold={onFold}>
        <p className="text-base font-bold text-[#1E6B47]">ช่างตรวจบ้านนี้แล้ว</p>
      </Row>
    );

  return (
    <Row id="myhome-electric" icon="⚡" title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")} onFold={sorted ? onFold : null}>
      {deciding && <p className={`text-base font-bold ${e.signed ? ELECTRIC[e.status]?.[1] || "" : ""}`}>{e.signed ? ELECTRIC[e.status]?.[0] || "ลงชื่อไว้แล้ว" : "บ้านนี้ยังไม่ได้ตรวจไฟ"}</p>}
      {deciding && (
        <p className="text-[15px] text-[#33403A]">{info.soi && e.soi_waiting > 0 ? `ใน ซ.${info.soi} ยังรอช่างอีก ${e.soi_waiting} หลัง` : `ทั้งหมู่บ้านยังรอช่างอีก ${e.village_waiting} หลัง`}</p>
      )}

      {e.want && !pick ? (
        <div className="rounded-2xl bg-[#E4F0E9] p-3">
          <p className="text-[15px] font-bold text-[#154D33]">คุณเลือก: {WANTS[e.want][0]}</p>
          {WANTS[e.want][1] && <p className="text-sm text-[#33403A]">{WANTS[e.want][1]}</p>}
          <div className="mt-2 flex gap-2">
            {e.want === "free" && !info.has_contact && !contactSlot && (
              <button onClick={onContact} className="min-h-[46px] flex-1 rounded-xl bg-[#1E6B47] px-2 text-[15px] font-bold text-white">
                {t("myhome.electric.leave_contact", "ฝากเบอร์ให้ทีมแจ้ง")}
              </button>
            )}
            <button onClick={() => setPick(true)} className="min-h-[46px] rounded-xl border border-[#C9D1CB] bg-white px-4 text-[15px] font-bold">
              เปลี่ยนคำตอบ
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[15px] font-bold">{t("myhome.electric.now", "ถ้าทีมช่างฟรีกลับมา ยังสนใจให้มาตรวจไหม")}</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => send("free")} className="min-h-[56px] rounded-xl border-2 border-[#1E6B47] bg-white px-2 text-base font-bold leading-tight text-[#154D33]">
              {t("myhome.electric.yes", "ยังสนใจ")}
            </button>
            <button onClick={() => send("fine")} className="min-h-[56px] rounded-xl border-2 border-[#C9D1CB] bg-white px-2 text-base font-bold leading-tight">
              {t("myhome.electric.no", "ไม่สนใจแล้ว")}
            </button>
          </div>
          {pick && (
            <button onClick={() => setPick(null)} className="min-h-[44px] w-full text-[15px] font-bold text-[#45504A] underline">
              ยกเลิก
            </button>
          )}
        </div>
      )}

      {contactSlot}

      {sorted && <Electricians services={services} onAll={onElectricians} />}

      {!sorted && (
        <>
          <button onClick={() => setSafe((v) => !v)} aria-expanded={safe} className="min-h-[48px] w-full rounded-xl bg-[#FFF6DA] px-3 text-left text-[15px] font-bold">
            {t("myhome.electric.safe", "ระหว่างรอ: เช็กความปลอดภัย · เบอร์ช่าง")} {ticks.length ? `(${ticks.length}/5)` : ""} <span aria-hidden="true">{safe ? "▴" : "▾"}</span>
          </button>
          {safe && (
            <ul className="space-y-1.5">
              {SAFE.map((line, i) => (
                <li key={i}>
                  <label className="flex min-h-[48px] items-start gap-3 rounded-xl border border-[#DCE2DD] bg-white p-3 text-[15px] leading-snug">
                    <input type="checkbox" checked={ticks.includes(i)} onChange={() => tick(i)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#1E6B47]" />
                    {line}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {safe && (
            <button onClick={onElectricians} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-[15px] font-bold">
              {t("myhome.electric.list", "ดูเบอร์ช่างไฟที่เพื่อนบ้านแนะนำ")}
            </button>
          )}
        </>
      )}
    </Row>
  );
}

// important = a check-in to answer, something today, a relief deadline · general = something new to read
export function homeBadgeOf(info) {
  if (!info) return null;
  const seen = load("soonSeen", []);
  const fresh = (info.soon || []).filter((x) => !seen.includes(x.id));
  const important = [];
  const general = [];
  if (info.checkin && !info.checkin.mine) important.push(`🆘 ${info.checkin.title} · ยังไม่ได้ตอบ`);
  for (const x of fresh) (x.when === "วันนี้" || x.id.startsWith("aid_") ? important : general).push(`${x.icon || "📅"} ${x.when}: ${x.text}`);
  for (const q of info.questions || []) if (!q.answer) general.push(`${q.icon || "❓"} คำถามจากทีม: ${q.q}`);
  if (info.handy_wanted > 0) general.push(`🤝 มีคนอยากให้ช่วยเรื่องที่คุณถนัด ${info.handy_wanted} เรื่อง`);
  const reasons = [...important, ...general];
  if (!reasons.length) return null;
  return { level: important.length ? "important" : "general", reasons, sig: reasons.join("|") };
}

// the rubbish days in the header: today's in big dark green with "วันนี้", tomorrow's marked too — stays even after รับทราบ
const THAI_DAYS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"]; // Date.getUTCDay() order
function WasteDays({ days }) {
  const bkk = new Date(Date.now() + 7 * 3600e3);
  const today = THAI_DAYS[bkk.getUTCDay()];
  const tomorrow = THAI_DAYS[(bkk.getUTCDay() + 1) % 7];
  const parts = (days || "")
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.map((d, i) => (
    <span key={d}>
      {i > 0 && " · "}
      {d === today ? (
        <span className="rounded-md bg-[#E4F0E9] px-1.5 text-lg font-extrabold text-[#154D33]">
          {d} <span className="text-xs font-bold">วันนี้</span>
        </span>
      ) : d === tomorrow ? (
        <b className="text-[#1E6B47]">
          {d} <span className="text-xs">พรุ่งนี้</span>
        </b>
      ) : (
        <b>{d}</b>
      )}
    </span>
  ));
}

// ---------- 🤝 อาสาข้างบ้าน: what this house can do for the neighbours (backend nearby.py SKILLS) ----------
const SKILL_LIST = [
  ["fix", "🔧", "ซ่อมเล็กๆ ในบ้าน"],
  ["elec", "💡", "ไฟฟ้าเบื้องต้น"],
  ["plumb", "🚰", "ประปาเบื้องต้น"],
  ["strong", "💪", "ยกของหนัก"],
  ["tech", "📱", "มือถือ / แอป"],
  ["drive", "🚗", "ขับรถพาไป"],
  ["errand", "🛒", "ซื้อของ / ธุระ"],
];
function HandyRow({ house, handy, onSaved, onClose, setErr }) {
  const [f, setF] = useState(() => ({
    name: handy?.name || load("myName", ""),
    phone: load("myReach", ""),
    skills: handy?.skills || [],
    note: handy?.note || "",
    on: handy ? handy.on !== false : true,
  }));
  const toggle = (k) => setF({ ...f, skills: f.skills.includes(k) ? f.skills.filter((x) => x !== k) : [...f.skills, k] });
  async function save_() {
    setErr("");
    try {
      const r = await api("/myhome/handy", { method: "POST", body: JSON.stringify({ house, ...f }) });
      save("myName", f.name);
      if (f.phone) save("myReach", f.phone);
      onSaved(r);
    } catch (e) {
      setErr(e.message);
    }
  }
  const box = "min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base";
  return (
    <div id="myhome-handy" className="space-y-3 border-t border-[#E6EBE7] py-3">
      <div>
        <p className="text-base font-bold">🤝 อาสาข้างบ้าน · คุณช่วยเพื่อนบ้านเรื่องไหนได้</p>
        <p className="text-sm text-[#45504A]">
          บ้านที่มีแต่ผู้สูงอายุหรือผู้หญิง ซ่อมของเองไม่ได้ จะขอให้ช่วยได้ คำขอที่ตรงกับที่คุณถนัดจะขึ้นในบ้านฉันของคุณ ช่วยได้ก็กดรับ ไม่ว่างก็ข้ามได้ ไม่มีบังคับ
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {SKILL_LIST.map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => toggle(k)}
            aria-pressed={f.skills.includes(k)}
            className={`min-h-[52px] rounded-xl border-2 px-2 text-left text-[15px] font-bold leading-tight ${f.skills.includes(k) ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
          >
            <span aria-hidden="true">{icon} </span>
            {label}
          </button>
        ))}
      </div>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ชื่อเรียก (เพื่อนบ้านเห็น)" className={box} />
      <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="เบอร์ / LINE (คนขอจะเห็นเมื่อคุณกดรับช่วยเท่านั้น)" inputMode="tel" className={box} />
      <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="ว่างช่วงไหน เช่น เย็นๆ / เสาร์อาทิตย์ (ไม่บังคับ)" className={box} />
      {handy && (
        <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
          <input type="checkbox" checked={!f.on} onChange={(e) => setF({ ...f, on: !e.target.checked })} className="h-5 w-5 accent-[#1E6B47]" />
          พักไว้ก่อน (ไม่ต้องเห็นคำขอช่วงนี้)
        </label>
      )}
      <div className="flex gap-2">
        <button onClick={save_} disabled={!f.name.trim() || !f.skills.length} className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-40">
          บันทึก
        </button>
        <button onClick={onClose} className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold">
          ปิด
        </button>
      </div>
    </div>
  );
}

export default function MyHome({ water, services, look, onIssue, onIssues, onElectricians, onPros, onBadge, needs = [], onNeeds, onAskHelp }) {
  // the ขอแรง card can be hidden; it comes back only when a new ask appears
  const [needsHidden, setNeedsHidden] = useState(() => load("needsHidden", []));
  // a ขอแรง ask this house's อาสาข้างบ้าน profile can do (job type → skill)
  const JOB_SKILL = { clean: "strong", move: "strong", trash: "strong", fix: "fix", check: "elec", ride: "drive", errand: "errand" };
  const fits = (j) => (handy?.on && (handy.skills || []).includes(JOB_SKILL[j.type]) ? 1 : 0);
  const hideNeeds = () => {
    const ids = needs.map((j) => j.id);
    setNeedsHidden(ids);
    save("needsHidden", ids);
  };
  const fromSurvey = load("survey:electric", null)?.house || "";
  const [house, setHouse] = useState(() => takeFamilyParam() || load("myHouse", "") || fromSurvey);
  const [houses, setHouses] = useState(() => load("myHouses", []));
  const [outageOpen, setOutageOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState([]); // settled extras opened again (plan / aid)
  const reload = () => setReloadN((n) => n + 1);
  const [typing, setTyping] = useState(!house);
  const [input, setInput] = useState(house || "");
  const [info, setInfo] = useState(null);
  const [reloadN, setReloadN] = useState(0);
  const [handy, setHandy] = useState(null); // this house's อาสาข้างบ้าน profile
  const [handyOpen, setHandyOpen] = useState(false);
  useEffect(() => {
    if (!house) return;
    api(`/handy?house=${encodeURIComponent(house)}`)
      .then((r) => setHandy(r.me))
      .catch(() => {});
  }, [house]);
  const [seenN, setSeenN] = useState(0); // "รับทราบ" pressed: the tab badge looks again
  // the tab button's badge (homeBadgeOf below)
  useEffect(() => {
    if (onBadge) onBadge(homeBadgeOf(info));
  }, [info, onBadge, seenN]);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState(null);
  const [contact, setContact] = useState(null);
  const [nearForm, setNearForm] = useState(null); // the รอบบ้าน ask / alert being written
  const nearRef = useRef(null);
  const errRef = useRef(null);
  const contactRef = useRef(null);
  useEffect(() => {
    if (err) errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [err]);
  const [opened, setOpened] = useState([]); // settled sections opened again by a tap (or just answered)
  const openIt = (k) => setOpened((o) => (o.includes(k) ? o : [...o, k]));
  const foldIt = (k) => setOpened((o) => o.filter((x) => x !== k));
  const [pinning, setPinning] = useState(null); // {pos, soi, touched} while the map is open

  useEffect(() => {
    if (!house) return;
    api(`/myhome?house=${encodeURIComponent(house)}`)
      .then((d) => {
        setInfo(d);
        save("myHouse", d.house);
        setHouses((list) => {
          if (list.some((x) => x.house === d.house)) return list;
          const next = [...list.filter((x) => x.label !== "บ้านฉัน"), { house: d.house, label: "บ้านฉัน" }];
          save("myHouses", next);
          return next;
        });
        if (d.soi) save("mySoi", d.soi);
      })
      .catch((e) => {
        setErr(e.message);
        setInput(house);
        setTyping(true);
        // back to the last house that worked (myHouse is saved only after a good answer)
        const good = load("myHouse", "");
        setHouse(good !== house ? good : "");
      });
  }, [house, reloadN]);
  useEffect(() => {
    // the sign-up box on this page signed a house: show it here (and adopt the house if this phone had none)
    const onChange = () => {
      const h = load("myHouse", "");
      if (h && h !== house) {
        setHouse(h);
        setTyping(false);
      } else setReloadN((n) => n + 1);
    };
    window.addEventListener(MYHOME_CHANGED, onChange);
    return () => window.removeEventListener(MYHOME_CHANGED, onChange);
  }, [house]);

  async function tap(w) {
    setErr("");
    try {
      await api("/water", {
        method: "POST",
        body: JSON.stringify({ lat: info.lat, lng: info.lng, level: w.level, where: w.where, name: `บ้าน ${info.house}`, note: info.soi ? `ซ.${info.soi}` : "" }),
      });
      setSent(w.label);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function savePin() {
    setErr("");
    try {
      const d = await api("/myhome/pin", { method: "POST", body: JSON.stringify({ house: info.house, lat: pinning.pos.lat, lng: pinning.pos.lng, soi: pinning.soi || "" }) });
      setInfo(d);
      if (d.soi) save("mySoi", d.soi);
      setPinning(null);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function sendContact(e) {
    e.preventDefault();
    setErr("");
    try {
      const { from, ...body } = contact;
      await api("/myhome/contact", { method: "POST", body: JSON.stringify({ ...body, house: info.house }) });
      save(`myContact:${info.house}`, body);
      if (body.name) save("myName", body.name.trim());
      if (body.phone || body.line_id) save("myReach", (body.phone || body.line_id).trim());
      setContact(null);
      setInfo((i) => ({ ...i, has_contact: true }));
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const t = useT();
  const frame = look?.frame;
  const savedContact = info ? load(`myContact:${info.house}`, null) : null;
  const [pinLaterAt, setPinLaterAt] = useState(0);
  const pinLater = Date.now() - Math.max(pinLaterAt, info ? load(`pinLater:${info.house}`, 0) : 0) < 7 * 864e5;
  const startNear = (kind) => {
    setNearForm({ kind, topic: "", text: "", name: load("myName", ""), phone: kind === "ask" ? load("myReach", "") : "", to_office: true });
    setTimeout(() => nearRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const el = info?.electric;
  const elSettled = !!el && (el.status === "done" || (el.want && el.want !== "free"));
  const elWant = { fine: "ไม่สนใจแล้ว", hired: "จ้างช่างเองแล้ว", group: "รวมกลุ่มจ้างช่าง" };
  const settled = !info
    ? []
    : [
        ...(info.questions || [])
          .filter((q) => q.answer === "no" && !opened.includes(q.id))
          .map((q) => ({ key: q.id, icon: q.icon, label: q.short || (q.q.length > 22 ? q.q.slice(0, 20) + "…" : q.q), answer: q.no })),
        ...(elSettled && !opened.includes("electric") ? [{ key: "electric", icon: "⚡", label: "ตรวจไฟ", answer: el.status === "done" ? "ช่างตรวจแล้ว" : elWant[el.want] || "ตอบแล้ว" }] : []),
      ];
  const plan = info?.plan;
  const planDone = !!plan && !Object.values(plan).includes("todo");
  const planSettled = planDone && !plusOpen.includes("plan");
  if (info && planSettled) settled.push({ key: "plan", icon: "🔧", label: "แผนซ่อม", answer: Object.keys(plan).length ? `ครบ ${Object.keys(plan).length} อย่าง 🎉` : "ไม่ต้องซ่อม" });
  for (const a of info?.aid || [])
    if (a.mine === "received") settled.push({ key: `aid_${a.id}`, icon: "💰", label: a.title.length > 18 ? a.title.slice(0, 16) + "…" : a.title, answer: "ได้เงินแล้ว" });
  const isFolded = (k) => settled.some((x) => x.key === k);
  if (typing || !house)
    return (
      <section className="mb-3 overflow-hidden rounded-[20px] border-2 border-[#1E6B47] bg-white" style={frame}>
        <div className="bg-[#E4F0E9] px-4 pb-3 pt-4">
          <h2 className="font-display text-2xl font-bold">🏠 บ้านฉัน</h2>
          <p className="text-base text-[#154D33]">{t("myhome.intro", "ใส่บ้านเลขที่ครั้งเดียว แล้วรู้เรื่องของบ้านคุณทันที")}</p>
        </div>
        <div className="px-4 pb-4 pt-3">
          <ul className="space-y-1 text-base">
            {[
              ["💰", "เงินเยียวยาน้ำท่วมที่บ้านคุณขอได้"],
              ["🚛", "วันรถขยะซอยคุณ"],
              ["⚡", "ไฟดับ น้ำไม่ไหลแถวบ้าน"],
              ["💧", "น้ำหน้าบ้านตอนนี้"],
              ["🔧", "ช่างที่เพื่อนบ้านแนะนำ"],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-center gap-1.5">
                <span aria-hidden="true">{icon}</span>
                {text}
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const h = cleanHouse(input.trim());
              if (!/^\d{1,3}\/\d{1,5}/.test(h)) return setErr("ใส่บ้านเลขที่ เช่น 4/917 หรือพิมพ์แค่ 917");
              setErr("");
              setInfo(null);
              setHouse(h);
              setTyping(false);
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">บ้านเลขที่</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                inputMode="text"
                autoComplete="off"
                placeholder="เช่น 917"
                className="min-h-[56px] w-full rounded-xl border-2 border-[#A9B4AD] px-3.5 text-xl focus:border-[#1E6B47] focus:outline-none"
              />
            </label>
            <button className="min-h-[56px] shrink-0 rounded-xl bg-[#1E6B47] px-5 text-lg font-bold text-white">ดูบ้านฉัน ›</button>
          </form>
          {err && (
            <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-red-700">
              {err}
            </p>
          )}
          <p className="mt-2 text-sm text-[#45504A]">🔒 ไม่ต้องสมัคร ไม่ต้องใส่ชื่อ · มือถือเครื่องนี้จำไว้ให้</p>
          {house && (
            <button type="button" onClick={() => setTyping(false)} className="mt-1 min-h-[40px] text-[15px] font-bold text-[#45504A] underline">
              ยกเลิก กลับไปบ้าน {house}
            </button>
          )}
        </div>
      </section>
    );

  return (
    <section className="mb-3 rounded-[20px] border border-[#DCE2DD] bg-white px-4 pt-4" style={frame}>
      <div className="flex items-center gap-3">
        <h2 className="font-display min-w-0 flex-1 text-xl font-bold">
          {houses.find((x) => x.house === (info?.house || house))?.label || "บ้านฉัน"} {info?.house || house}
        </h2>
        {info?.precision === "house" && !pinning && (
          <button onClick={() => setPinning({ pos: null, soi: info.soi || "" })} className="min-h-[44px] shrink-0 text-[15px] font-bold text-[#45504A] underline">
            ย้ายหมุด
          </button>
        )}
        <button
          onClick={() => {
            setInput(house);
            setTyping(true);
          }}
          className="min-h-[44px] shrink-0 text-[15px] font-bold text-[#45504A] underline"
        >
          เปลี่ยนบ้าน
        </button>
      </div>
      {houses.length > 1 && (
        <div className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="บ้านที่ติดตาม">
          {houses.map((x) => (
            <button
              key={x.house}
              onClick={() => {
                if (x.house === house) return;
                setInfo(null);
                setHouse(x.house);
              }}
              aria-pressed={x.house === house}
              className={`min-h-[40px] shrink-0 rounded-full px-3 text-[15px] ${x.house === house ? "bg-[#15201A] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
            >
              {x.label} {x.house}
            </button>
          ))}
        </div>
      )}
      {info && (
        <p className="text-[15px] text-[#33403A]">
          {info.soi ? `ซ.${info.soi}` : "ยังไม่รู้ซอย"}
          {info.waste && (
            <>
              {" · 🚛 รถขยะ "}
              <WasteDays days={info.waste.days} />
            </>
          )}
        </p>
      )}
      {err && (
        <p ref={errRef} role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-red-700">
          {err}
        </p>
      )}
      {!info ? (
        <p className="py-3 text-[15px] text-[#45504A]">กำลังโหลด…</p>
      ) : (
        <>
          <CheckinCard info={info} onSaved={setInfo} onContact={() => setContact({ name: load("myName", ""), from: "news" })} setErr={setErr} />
          <Soon items={info.soon} onSeen={() => setSeenN((n) => n + 1)} />
          {needs.some((j) => !needsHidden.includes(j.id)) && (
            // the ขอแรง board, seen from home: who still needs hands (no one is pushed, the card just shows)
            <div className="mt-2 flex items-start gap-3 rounded-2xl border-2 border-[#E0A100] bg-[#FFF8E1] p-3">
              <span className="text-2xl" aria-hidden="true">
                🙋
              </span>
              <div className="min-w-0 flex-1">
                <button onClick={onNeeds} className="block w-full text-left">
                  <b className="block text-base leading-snug">เพื่อนบ้านขอแรงอยู่ {needs.length} เรื่อง</b>
                  {[...needs]
                    .sort((x, y) => fits(y) - fits(x))
                    .slice(0, 2)
                    .map((j) => (
                      <span key={j.id} className="mt-0.5 block text-[15px] leading-snug text-[#33403A]">
                        {j.name}
                        {j.soi ? ` (ซ.${j.soi})` : ""}: {j.detail.length > 60 ? `${j.detail.slice(0, 60)}…` : j.detail}
                        {fits(j) ? <b className="ml-1 rounded-full bg-[#1E6B47] px-2 text-sm text-white">🤝 ตรงกับที่คุณถนัด</b> : null}
                      </span>
                    ))}
                  <span className="mt-1 block text-[15px] font-bold text-[#7A4104]">ช่วยได้? ดูและติดต่อ ›</span>
                </button>
                <button onClick={hideNeeds} className="mt-0.5 block min-h-[36px] text-sm font-bold text-[#45504A] underline">
                  รับทราบแล้ว ซ่อน
                </button>
              </div>
            </div>
          )}
          <div className="mt-3">
            <AidRow info={info} onChanged={reload} setErr={setErr} />
          </div>

          {pinning ? (
            <Row title="ปักหมุดบ้านฉัน">
              <p className="text-[15px]">กด "ใช้ตำแหน่งปัจจุบัน" ตอนอยู่ที่บ้าน หรือเลื่อนแผนที่ให้หมุดอยู่บนหลังคาบ้านคุณ</p>
              <LocationPicker
                value={info.precision === "house" ? { lat: info.lat, lng: info.lng } : null}
                onChange={(pos) => setPinning((p) => ({ ...p, pos }))}
                onTouched={() => setPinning((p) => ({ ...p, touched: true }))}
              />
              <label className="block">
                <span className="text-sm font-bold">อยู่ซอยไหน (ไม่ใส่ก็ได้ ระบบหาให้)</span>
                <input
                  value={pinning.soi || ""}
                  onChange={(e) => setPinning((p) => ({ ...p, soi: e.target.value }))}
                  placeholder="เช่น 34/6"
                  className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
                />
              </label>
              <div className="flex gap-2">
                <button onClick={savePin} disabled={!pinning.pos} className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50">
                  บ้านฉันอยู่ตรงนี้
                </button>
                <button onClick={() => setPinning(null)} className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold">
                  ยกเลิก
                </button>
              </div>
            </Row>
          ) : info.precision !== "house" && pinLater ? (
            <button onClick={() => setPinning({ pos: null, soi: "" })} className="mt-1 min-h-[40px] text-[15px] font-bold text-[#7A4104] underline">
              📍 ปักหมุดบ้าน ให้ระบบรู้ตำแหน่งแม่นขึ้น
            </button>
          ) : info.precision !== "house" ? (
            <div className="mb-3 rounded-2xl bg-[#FFF6DA] p-3">
              <p className="text-[15px]">{info.soi ? `ระบบเดาว่าอยู่ ซ.${info.soi} จากบ้านเลขที่` : "ระบบยังไม่รู้ว่าบ้านนี้อยู่ซอยไหน"} · บ้านแบ่งแปลงใหม่เลขที่มักไม่ตรงซอย</p>
              <button onClick={() => setPinning({ pos: null, soi: "" })} className="mt-2 min-h-[50px] w-full rounded-xl bg-[#15201A] text-base font-bold text-white">
                {t("myhome.pin.button", "ปักหมุดบ้านฉัน (ใช้ GPS ได้)")}
              </button>
              <button
                onClick={() => {
                  save(`pinLater:${info.house}`, Date.now());
                  setPinLaterAt(Date.now());
                }}
                className="mt-1 min-h-[40px] w-full text-[15px] font-bold text-[#45504A] underline"
              >
                ไว้ทีหลัง
              </button>
            </div>
          ) : null}

          {(info.questions || [])
            .filter((q) => !isFolded(q.id))
            .map((q) => (
              <QuestionRow
                key={q.id}
                onFold={() => foldIt(q.id)}
                q={q}
                info={info}
                services={services}
                onAnswered={(d) => {
                  setInfo(d);
                  // a fresh "no" folds right away; a "yes" stays open with its way out
                  const a = (d.questions || []).find((x) => x.id === q.id)?.answer;
                  if (a === "no") foldIt(q.id);
                  else openIt(q.id);
                }}
                onPros={onPros}
                onIssue={onIssue}
                onAsk={() => {
                  setNearForm({ kind: "ask", topic: "other", text: q.q, name: load("myName", ""), phone: load("myReach", ""), to_office: false });
                  setTimeout(() => nearRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                }}
                setErr={setErr}
              />
            ))}

          {!isFolded("electric") && (
            <ElectricRow
              onFold={() => foldIt("electric")}
              onSent={(w) => (w === "free" ? foldIt("electric") : openIt("electric"))}
              info={info}
              services={services}
              onSaved={setInfo}
              onElectricians={onElectricians}
              onContact={() => setContact({ name: load("myName", ""), from: "electric" })}
              contactSlot={contact?.from === "electric" ? <ContactForm contact={contact} setContact={setContact} onSave={sendContact} /> : null}
              setErr={setErr}
            />
          )}

          <WaterRow
            info={info}
            water={water}
            sent={sent}
            onTap={tap}
            onAsk={
              nearForm
                ? null
                : () => {
                    setNearForm({ kind: "ask", topic: "water", text: "", name: load("myName", ""), phone: load("myReach", ""), to_office: false });
                    setTimeout(() => nearRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  }
            }
          />

          <div id="myhome-outage">
            <OutageRow info={info} forced={outageOpen} onFold={() => setOutageOpen(false)} onChanged={reload} setErr={setErr} />
          </div>
          {!planSettled && <PlanRow info={info} services={services} onPros={onPros} onSaved={setInfo} onFold={() => setPlusOpen((o) => o.filter((x) => x !== "plan"))} setErr={setErr} />}
          <ReviewPrompt services={services} />

          <div ref={nearRef}>
            <Nearby info={info} form={nearForm} setForm={setNearForm} setErr={setErr} handy={handy} onPros={onPros} />
          </div>

          {info.issues_open > 0 && (
            <Row icon="🛠️" title={t("myhome.office.open", "ในซอยมีเรื่องรอสำนักงานแก้")}>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[15px]">
                  {info.soi ? `ซ.${info.soi} · ` : ""}
                  {info.issues_open} เรื่อง
                </p>
                <button onClick={onIssues} className="min-h-[46px] shrink-0 rounded-xl border border-[#C9D1CB] bg-white px-4 text-[15px] font-bold">
                  ดูรายการ
                </button>
              </div>
            </Row>
          )}

          <div ref={contactRef} />
          {contact && contact.from !== "electric" && (
            <Row icon="📨" title={t("myhome.contact.title", "ช่องทางติดต่อบ้านนี้")}>
              <ContactForm contact={contact} setContact={setContact} onSave={sendContact} />
            </Row>
          )}

          {/* things you may want to do some day: one grid instead of a section each */}
          <div className="border-t border-[#E6EBE7] py-3">
            <p className="text-base font-bold text-[#15201A]">{t("myhome.tools.title", "ทำอะไรได้อีก")}</p>
            <button
              onClick={() => setHandyOpen((o) => !o)}
              className={`mt-2 flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-3 py-2 text-left ${handy?.on ? "border-2 border-[#1E6B47] bg-[#E4F0E9]" : "bg-[#15201A] text-white"}`}
            >
              <span className="text-2xl" aria-hidden="true">
                🤝
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-base leading-tight">{handy?.on ? `คุณเป็นอาสาข้างบ้าน ✓` : t("myhome.handy.cta", "ทำเป็น ช่วยเพื่อนบ้านได้? เป็นอาสาข้างบ้าน")}</b>
                <span className={`block text-sm ${handy?.on ? "text-[#33403A]" : "text-[#C5D1CA]"}`}>
                  {handy?.on
                    ? `${SKILL_LIST.filter(([k]) => handy.skills.includes(k))
                        .map(([, , l]) => l)
                        .join(" · ")}${handy.thanks ? ` · ช่วยแล้ว ${handy.thanks} ครั้ง 🙏` : ""}`
                    : "ซ่อมเล็กๆ ยกของ ช่วยใช้มือถือ พาไปหาหมอ · ตามที่สะดวก"}
                </span>
              </span>
              <span aria-hidden="true">{handyOpen ? "▴" : "›"}</span>
            </button>
            {handyOpen && (
              <HandyRow
                house={info.house}
                handy={handy}
                setErr={setErr}
                onClose={() => setHandyOpen(false)}
                onSaved={(r) => {
                  setHandy(r);
                  setHandyOpen(false);
                  reload();
                }}
              />
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                ["🙋", t("myhome.tools.help", "ขอแรงเพื่อนบ้าน"), t("myhome.tools.help_sub", "ซ่อมเล็กๆ ยกของ ติดรถ ฝากซื้อ"), onAskHelp],
                ["👀", t("myhome.tools.ask", "ฝากดูบ้าน"), t("myhome.tools.ask_sub2", "น้ำหน้าบ้าน รับของ ดูประตู"), () => startNear("ask")],
                ["⚠️", t("myhome.tools.alert", "เตือนเพื่อนบ้าน"), t("myhome.tools.alert_sub", "ฝาท่อแตก ของหาย"), () => startNear("alert")],
                ["🛠️", t("myhome.tools.office", "แจ้งสำนักงาน"), t("myhome.tools.office_sub", "ไฟถนน ขยะ ถ่ายรูปได้"), onIssue],
                [
                  "⚡",
                  t("myhome.tools.outage", "ไฟดับ น้ำไม่ไหล"),
                  t("myhome.tools.outage_sub", "แจ้ง · ดูว่าแถวบ้านเป็นไหม"),
                  () => {
                    setOutageOpen(true);
                    setTimeout(() => document.getElementById("myhome-outage")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                  },
                ],
                ["👨‍👩‍👧", t("myhome.tools.family", "ส่งให้ลูกหลาน"), t("myhome.tools.family_sub", "ดูบ้านนี้จากที่ไหนก็ได้"), () => shareFamily(info.house)],
                info.has_contact
                  ? [
                      "📨",
                      t("myhome.tools.contact_saved", "เบอร์ติดต่อ ✓"),
                      savedContact ? `${savedContact.name || ""} · แก้ไข` : "แก้ไขได้",
                      () => setContact({ ...(savedContact || {}), from: "news" }),
                    ]
                  : ["📨", t("myhome.tools.contact", "ฝากเบอร์ทีม"), t("myhome.tools.contact_sub", "รับข่าวด่วน นัดช่าง"), () => setContact({ name: load("myName", ""), from: "news" })],
              ].map(([icon, label, sub, go]) => (
                <button key={label} onClick={go} className="flex min-h-[72px] flex-col items-start justify-center rounded-2xl border border-[#C9D1CB] bg-white px-3 py-2 text-left active:bg-[#F2F4F1]">
                  <span className="whitespace-nowrap text-[15px] font-bold leading-tight">
                    <span aria-hidden="true">{icon} </span>
                    {label}
                  </span>
                  <span className="mt-0.5 text-sm leading-snug text-[#45504A]">{sub}</span>
                </button>
              ))}
            </div>
          </div>

          <InstallCard />

          <Settled
            items={settled}
            onOpen={(k) => {
              if (k === "plan") setPlusOpen((o) => [...o, "plan"]);
              openIt(k);
              // a payout marked received is fixed in the 💰 box itself ("ยังไม่ได้รับ? แก้")
              const target = k.startsWith("aid_") ? document.getElementById("myhome-aid-got") : document.getElementById(`myhome-${k}`);
              setTimeout(() => {
                target?.scrollIntoView({ behavior: "smooth", block: "center" });
                if (k.startsWith("aid_") && target) {
                  target.classList.add("ring-4", "ring-[#E0A100]");
                  setTimeout(() => target.classList.remove("ring-4", "ring-[#E0A100]"), 2500);
                }
              }, 50);
            }}
          />
        </>
      )}
    </section>
  );
}
