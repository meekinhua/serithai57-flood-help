import { useEffect, useMemo, useState } from "react";
import { api, load, save } from "../api";

// บ้านฉัน (7 Oct 2026): a house number typed once (or taken from the electricians' sign-up on this phone) and
// the page shows what concerns that house: the regular rubbish round of its soi, its electrical check, the
// water in front of it right now (one tap), open problems in its soi to report to the office. No login.

const WATER_TAPS = [
  { label: "แห้ง", level: 0, where: "street", cls: "border-[#1E6B47] text-[#1E6B47]" },
  { label: "น้ำขังถนน", level: 1, where: "street", cls: "border-[#B45F06] text-[#7A4104]" },
  { label: "น้ำเข้าบ้าน", level: 2, where: "house", cls: "border-[#B42318] text-[#B42318]" },
];
const ELECTRIC = {
  done: ["ช่างตรวจแล้ว", "text-[#1E6B47]"],
  absent: ["ช่างมาแล้ว แต่ไม่มีคนอยู่", "text-[#B45F06]"],
  again: ["ช่างนัดกลับมาอีก", "text-[#B45F06]"],
  claimed: ["ช่างรับงานแล้ว", "text-[#1F5FA8]"],
  todo: ["ลงชื่อไว้ ยังไม่ได้ตรวจ · รอสรุปกับทีมช่าง", "text-[#45504A]"],
};

function Row({ title, children }) {
  return (
    <div className="border-t border-[#E6EBE7] py-3">
      <p className="text-sm font-bold text-[#45504A]">{title}</p>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
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

  const lastHour = useMemo(() => {
    const t = Date.now();
    const recent = (water || []).filter((w) => t - new Date(w.created_at).getTime() < 3600e3);
    return { n: recent.length, dry: recent.filter((w) => w.level === 0).length, wet: recent.filter((w) => w.level > 0).length };
  }, [water]);

  async function tap(w) {
    setErr("");
    try {
      await api("/water", { method: "POST", body: JSON.stringify({ lat: info.lat, lng: info.lng, level: w.level, where: w.where, name: `บ้าน ${info.house}`, note: info.soi ? `ซ.${info.soi}` : "" }) });
      setSent(w.label);
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

  const frame = look?.frame;
  if (typing || !house)
    return (
      <section className="mb-3 rounded-[20px] border border-[#DCE2DD] bg-white p-4" style={frame}>
        <h2 className="font-display text-xl font-bold">บ้านฉัน</h2>
        <p className="text-[15px] text-[#45504A]">ใส่บ้านเลขที่ครั้งเดียว ดูวันรถขยะ ผลตรวจไฟ และแจ้งน้ำหน้าบ้านได้ทันที</p>
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
      <div className="flex items-baseline gap-2">
        <h2 className="font-display min-w-0 flex-1 text-xl font-bold">
          บ้านฉัน {info?.house || house}
          {info?.soi && <span className="text-base font-semibold text-[#45504A]"> · ซ.{info.soi}</span>}
        </h2>
        <button
          onClick={() => {
            setInput(house);
            setTyping(true);
          }}
          className="min-h-[44px] shrink-0 px-2 text-[15px] font-bold text-[#45504A] underline"
        >
          เปลี่ยน
        </button>
      </div>
      {err && <p className="mt-2 rounded-xl bg-red-50 p-3 text-red-700">{err}</p>}
      {!info ? (
        <p className="py-3 text-[15px] text-[#45504A]">กำลังโหลด…</p>
      ) : (
        <>
          <Row title="น้ำหน้าบ้านตอนนี้">
            {sent ? (
              <p className="text-base font-bold text-[#1E6B47]">ขอบคุณที่แจ้ง ({sent}) เพื่อนบ้านเห็นแล้ว</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {WATER_TAPS.map((w) => (
                  <button key={w.label} onClick={() => tap(w)} className={`min-h-[52px] rounded-xl border-2 bg-white px-1 text-[15px] font-bold leading-tight ${w.cls}`}>
                    {w.label}
                  </button>
                ))}
              </div>
            )}
            <p className="text-sm text-[#45504A]">{lastHour.n ? `1 ชม.ที่ผ่านมา ${lastHour.n} บ้านแจ้ง · แห้ง ${lastHour.dry} · มีน้ำ ${lastHour.wet}` : "ชั่วโมงนี้ยังไม่มีใครแจ้ง · แจ้งเป็นคนแรกได้เลย"}</p>
          </Row>

          {info.waste && (
            <Row title="รถเก็บขยะรอบปกติ">
              <p className="text-base">
                ซอย{info.waste.parity === "even" ? "คู่" : "คี่"} · <b>{info.waste.days}</b>
              </p>
            </Row>
          )}

          <Row title="ตรวจไฟฟ้าหลังน้ำท่วม">
            {info.electric.signed ? (
              <p className={`text-base font-bold ${ELECTRIC[info.electric.status]?.[1] || ""}`}>{ELECTRIC[info.electric.status]?.[0] || "ลงชื่อไว้แล้ว"}</p>
            ) : (
              <p className="text-base">บ้านนี้ไม่ได้ลงชื่อขอช่างไฟ</p>
            )}
            {info.electric.status !== "done" && (
              <button onClick={onElectricians} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-[15px] font-bold">
                ดูเบอร์ช่างไฟที่เพื่อนบ้านแนะนำ
              </button>
            )}
          </Row>

          <Row title={info.soi ? `ปัญหาในซอย ${info.soi}` : "ปัญหาในซอย"}>
            <p className="text-base">{info.issues_open ? `มีเรื่องที่แจ้งไว้ ยังไม่เสร็จ ${info.issues_open} เรื่อง` : "ยังไม่มีเรื่องค้าง"}</p>
            <div className="flex gap-2">
              <button onClick={onIssue} className="min-h-[50px] flex-1 rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white">
                แจ้งปัญหา (ฝาท่อ ไฟถนน ขยะ)
              </button>
              {info.issues_open > 0 && (
                <button onClick={onIssues} className="min-h-[50px] shrink-0 rounded-xl border border-[#C9D1CB] px-3 text-[15px] font-bold">
                  ดู
                </button>
              )}
            </div>
          </Row>

          <Row title="รับข่าวหมู่บ้าน (ไม่บังคับ)">
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
                    <input value={contact[k] || ""} onChange={(e) => setContact({ ...contact, [k]: e.target.value })} className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base" />
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
                ฝาก LINE / อีเมล ไว้รับข่าวด่วน
              </button>
            )}
          </Row>
        </>
      )}
    </section>
  );
}
