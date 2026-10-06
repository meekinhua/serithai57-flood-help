import { useEffect, useMemo, useRef, useState } from "react";
import { api, load, save } from "../api";
import LocationPicker from "./LocationPicker";
import Nearby from "./Nearby";
import { useT } from "./Texts";
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

function Row({ icon, title, children }) {
  return (
    <div className="border-t border-[#E6EBE7] py-3">
      <p className="text-base font-bold text-[#15201A]">
        {icon && <span aria-hidden="true">{icon} </span>}
        {title}
      </p>
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

function ElectricRow({ info, onSaved, onElectricians, onContact, setErr }) {
  const e = info.electric;
  const [pick, setPick] = useState(false); // choosing again
  const sorted = e.want && e.want !== "free" && !pick;
  const [safe, setSafe] = useState(false);
  const [ticks, setTicks] = useState(() => load(`safe:${info.house}`, []));
  async function send(want) {
    setErr("");
    try {
      onSaved(await api("/myhome/electric", { method: "POST", body: JSON.stringify({ house: info.house, want, slots: [] }) }));
      setPick(false);
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
      <Row icon="⚡" title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")}>
        <p className="text-base font-bold text-[#1E6B47]">ช่างตรวจบ้านนี้แล้ว</p>
      </Row>
    );

  return (
    <Row icon="⚡" title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")}>
      <p className={`text-base font-bold ${e.signed ? ELECTRIC[e.status]?.[1] || "" : ""}`}>{e.signed ? ELECTRIC[e.status]?.[0] || "ลงชื่อไว้แล้ว" : "บ้านนี้ยังไม่ได้ตรวจไฟ"}</p>
      <p className="text-[15px] text-[#33403A]">
        {info.soi && e.soi_waiting > 0 ? `ใน ซ.${info.soi} ยังรอช่างอีก ${e.soi_waiting} หลัง` : `ทั้งหมู่บ้านยังรอช่างอีก ${e.village_waiting} หลัง`}
      </p>

      {e.want && !pick ? (
        <div className="rounded-2xl bg-[#E4F0E9] p-3">
          <p className="text-[15px] font-bold text-[#154D33]">คุณเลือก: {WANTS[e.want][0]}</p>
          {WANTS[e.want][1] && <p className="text-sm text-[#33403A]">{WANTS[e.want][1]}</p>}
          <div className="mt-2 flex gap-2">
            {(e.want === "free" || e.want === "group") && !info.has_contact && (
              <button onClick={onContact} className="min-h-[46px] flex-1 rounded-xl bg-[#1E6B47] px-2 text-[15px] font-bold text-white">
                {t("myhome.electric.leave_contact", "ฝากเบอร์/LINE ให้ทีมแจ้ง")}
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

      {!sorted && (
        <>
          <button onClick={() => setSafe((v) => !v)} aria-expanded={safe} className="min-h-[48px] w-full rounded-xl bg-[#FFF6DA] px-3 text-left text-[15px] font-bold">
            {t("myhome.electric.safe", "ระหว่างรอ: เช็กเองแบบปลอดภัย 5 ข้อ")} {ticks.length ? `(${ticks.length}/5)` : ""}
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
          <button onClick={onElectricians} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-[15px] font-bold">
            {t("myhome.electric.list", "ดูเบอร์ช่างไฟที่เพื่อนบ้านแนะนำ")}
          </button>
        </>
      )}
    </Row>
  );
}

export default function MyHome({ water, look, onIssue, onIssues, onElectricians }) {
  const fromSurvey = load("survey:electric", null)?.house || "";
  const [house, setHouse] = useState(() => load("myHouse", "") || fromSurvey);
  const [typing, setTyping] = useState(!house);
  const [input, setInput] = useState(house || "4/");
  const [info, setInfo] = useState(null);
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
  const [pinning, setPinning] = useState(null); // {pos, soi, touched} while the map is open

  useEffect(() => {
    if (!house) return;
    api(`/myhome?house=${encodeURIComponent(house)}`)
      .then((d) => {
        setInfo(d);
        save("myHouse", d.house);
        if (d.soi) save("mySoi", d.soi);
      })
      .catch((e) => setErr(e.message));
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
      await api("/myhome/contact", { method: "POST", body: JSON.stringify({ ...contact, house: info.house }) });
      setContact(null);
      setInfo((i) => ({ ...i, has_contact: true }));
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const t = useT();
  const frame = look?.frame;
  if (typing || !house)
    return (
      <section className="mb-3 rounded-[20px] border border-[#DCE2DD] bg-white p-4" style={frame}>
        <h2 className="font-display text-xl font-bold">บ้านฉัน</h2>
        <p className="text-[15px] text-[#45504A]">{t("myhome.intro", "ใส่บ้านเลขที่ครั้งเดียว ดูวันรถขยะ ผลตรวจไฟ และแจ้งน้ำหน้าบ้านได้ทันที")}</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErr("");
            setInfo(null);
            setHouse(input.trim());
            setTyping(false);
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="sr-only">บ้านเลขที่</span>
            <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="text" placeholder="4/917" className="min-h-[52px] w-full rounded-xl border border-[#A9B4AD] px-3.5 text-lg" />
          </label>
          <button className="min-h-[52px] shrink-0 rounded-xl bg-[#1E6B47] px-5 text-lg font-bold text-white">ดู</button>
        </form>
        <p className="mt-2 text-sm text-[#45504A]">ไม่ต้องสมัคร ไม่ต้องใส่ชื่อ · จำไว้ในมือถือเครื่องนี้</p>
      </section>
    );

  return (
    <section className="mb-3 rounded-[20px] border border-[#DCE2DD] bg-white px-4 pt-4" style={frame}>
      <div className="flex items-center gap-3">
        <h2 className="font-display min-w-0 flex-1 text-xl font-bold">บ้านฉัน {info?.house || house}</h2>
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
      {info && (
        <p className="text-[15px] text-[#33403A]">
          {info.soi ? `ซ.${info.soi}` : "ยังไม่รู้ซอย"}
          {info.waste && (
            <>
              {" · 🚛 รถขยะ "}
              <b>{info.waste.days}</b>
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
          ) : info.precision !== "house" ? (
            <div className="mb-3 rounded-2xl bg-[#FFF6DA] p-3">
              <p className="text-[15px]">{info.soi ? `ระบบเดาว่าอยู่ ซ.${info.soi} จากบ้านเลขที่` : "ระบบยังไม่รู้ว่าบ้านนี้อยู่ซอยไหน"} · บ้านแบ่งแปลงใหม่เลขที่มักไม่ตรงซอย</p>
              <button onClick={() => setPinning({ pos: null, soi: "" })} className="mt-2 min-h-[50px] w-full rounded-xl bg-[#15201A] text-base font-bold text-white">
                {t("myhome.pin.button", "ปักหมุดบ้านฉัน (ใช้ GPS ได้)")}
              </button>
            </div>
          ) : null}

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

          <div ref={nearRef}>
            <Nearby info={info} form={nearForm} setForm={setNearForm} setErr={setErr} />
          </div>

          <ElectricRow
            info={info}
            onSaved={setInfo}
            onElectricians={onElectricians}
            onContact={() => {
              setContact({});
              setTimeout(() => contactRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
            setErr={setErr}
          />

          <Row icon="🛠️" title={t("myhome.office.title", "ส่งเรื่องให้สำนักงานหมู่บ้านแก้") + (info.soi ? ` · ซ.${info.soi}` : "")}>
            <p className="text-[15px]">{info.issues_open ? `ในซอยนี้มีเรื่องรอแก้ ${info.issues_open} เรื่อง` : "ในซอยนี้ยังไม่มีเรื่องค้าง"}</p>
            <div className="flex gap-2">
              <button onClick={onIssue} className="min-h-[50px] flex-1 rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white">
                {t("myhome.office.send", "ส่งเรื่อง ฝาท่อ ไฟถนน ขยะ (ถ่ายรูปได้)")}
              </button>
              {info.issues_open > 0 && (
                <button onClick={onIssues} className="min-h-[50px] shrink-0 rounded-xl border border-[#C9D1CB] px-3 text-[15px] font-bold">
                  ดูรายการ
                </button>
              )}
            </div>
          </Row>

          <div ref={contactRef} />
          <Row icon="📨" title={t("myhome.contact.title", "รับข่าวหมู่บ้าน (ไม่บังคับ)")}>
            {info.has_contact && !contact ? (
              <p className="text-[15px] text-[#1E6B47]">บันทึกช่องทางรับข่าวไว้แล้ว</p>
            ) : contact ? (
              <form onSubmit={sendContact} className="space-y-2">
                {[
                  ["line_id", "LINE ID"],
                  ["phone", "เบอร์โทร"],
                  ["email", "อีเมล"],
                  ["ig", "IG / Facebook"],
                ].map(([k, t]) => (
                  <label key={k} className="block">
                    <span className="text-sm font-bold">{t}</span>
                    <input
                      value={contact[k] || ""}
                      onChange={(e) => setContact({ ...contact, [k]: e.target.value })}
                      className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
                    />
                  </label>
                ))}
                <p className="text-sm text-[#45504A]">ใส่ช่องเดียวก็ได้ · ทีมอาสาเห็นเท่านั้น ไม่แสดงบนเว็บ</p>
                <div className="flex gap-2">
                  <button className="min-h-[50px] flex-1 rounded-xl bg-[#1E6B47] font-bold text-white">บันทึก</button>
                  <button type="button" onClick={() => setContact(null)} className="min-h-[50px] rounded-xl border border-[#C9D1CB] px-4 font-bold">
                    ยกเลิก
                  </button>
                </div>
              </form>
            ) : (
              <button onClick={() => setContact({})} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-[15px] font-bold">
                {t("myhome.contact.button", "ฝาก LINE / อีเมล ไว้รับข่าวด่วน")}
              </button>
            )}
          </Row>
        </>
      )}
    </section>
  );
}
