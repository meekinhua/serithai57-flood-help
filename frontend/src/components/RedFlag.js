import { useState } from "react";
import { api, load } from "../api";
import { notify } from "../notify";

// 28 Oct: 🚩 neighbours warn each other about a ช่าง / บริการ or a ตลาด post (backend redflag.py).
// 1–2 flags → an amber box on the card · 3+ (or the admin says so) → the card folds into a red box, opened only on a tap.
export const FLAG_REASONS = [
  ["scam", "หลอกเอาเงิน / มิจฉาชีพ"],
  ["bad_work", "งานไม่เรียบร้อย / ไม่แก้ปัญหา"],
  ["overcharge", "คิดเงินเกิน / เปลี่ยนของไม่ตรงที่บอก"],
  ["no_contact", "ติดต่อไม่ได้หลังรับเงิน"],
  ["unsafe", "พฤติกรรมไม่ปลอดภัย"],
  ["other", "อื่นๆ"],
];

export const flagLevel = (x) => x?.redflag?.level || "none";
export const isFlagHidden = (x) => flagLevel(x) === "hidden";

const day = (iso) =>
  new Date(iso).toLocaleDateString("th-TH", { day: "numeric", month: "short" });

function why(rf) {
  if (rf.admin === "hide") return "แอดตรวจแล้ว ซ่อนไว้เพราะเสี่ยง";
  return `เพื่อนบ้านแจ้งเตือน ${rf.count} ครั้ง`;
}

function Reasons({ rf, admin, onDrop }) {
  const [all, setAll] = useState(false);
  const items = [...(rf.items || [])].reverse();
  const shown = all ? items : items.slice(0, 2);
  return (
    <>
      {rf.note && (
        <p className="text-[15px] font-semibold">📌 แอด: {rf.note}</p>
      )}
      {shown.length > 0 && (
        <ul className="space-y-1.5">
          {shown.map((f) => (
            <li
              key={f.id}
              className="rounded-lg bg-white/70 p-2 text-[15px] leading-snug"
            >
              <b>{f.label}</b>
              {f.detail && <span className="block">{f.detail}</span>}
              <span className="block text-sm opacity-75">
                {f.name} · {day(f.at)}
                {admin && (
                  <button
                    onClick={() => onDrop(f.id)}
                    className="ml-2 font-semibold underline"
                  >
                    ลบรายงานนี้
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {items.length > 2 && !all && (
        <button
          onClick={() => setAll(true)}
          className="min-h-[36px] text-sm font-semibold underline"
        >
          ดูอีก {items.length - 2} รายงาน
        </button>
      )}
    </>
  );
}

// the card itself, or — when hidden — a folded red box with the reasons and a "ดูอยู่ดี" button
export function RedFlagFold({ item, kind, admin, onChanged, children }) {
  const [open, setOpen] = useState(false);
  const rf = item.redflag;
  if (!rf || rf.level !== "hidden" || open) return children;
  return (
    <li className="card space-y-2 border-2 border-[#B42318] bg-[#FDECEA] p-3 text-[#7A1A12]">
      <p className="text-lg font-bold leading-snug">
        🚩 {why(rf)}
        <span className="block text-sm font-semibold">
          {item.title || item.name || "รายการนี้"} · ซ่อนไว้ก่อน
        </span>
      </p>
      <Reasons
        rf={rf}
        admin={admin}
        onDrop={(id) => dropFlag(kind, item, id, onChanged)}
      />
      <button
        onClick={() => setOpen(true)}
        className="min-h-[44px] w-full rounded-xl border border-[#B42318] bg-white text-[15px] font-semibold"
      >
        เข้าใจความเสี่ยงแล้ว ขอดูข้อมูล
      </button>
      {admin && <AdminFlag kind={kind} item={item} onChanged={onChanged} />}
    </li>
  );
}

async function dropFlag(kind, item, id, onChanged) {
  try {
    const r = await api(`/admin/flags/${kind}/${item.id}/${id}`, {
      method: "DELETE",
    });
    onChanged({ ...item, redflag: r.redflag });
  } catch (e) {
    notify(e.message);
  }
}

function AdminFlag({ kind, item, onChanged }) {
  const rf = item.redflag || {};
  const [note, setNote] = useState(rf.note || "");
  async function set(state) {
    try {
      const r = await api(`/admin/flags/${kind}/${item.id}`, {
        method: "PUT",
        body: JSON.stringify({ state, note }),
      });
      onChanged({ ...item, redflag: r.redflag });
      notify(
        {
          hide: "ซ่อนแล้ว",
          warn: "ขึ้นเตือนแล้ว",
          clear: "ล้างแล้ว (ไม่นับรายงาน)",
          auto: "ให้ระบบนับเอง",
        }[state],
      );
    } catch (e) {
      notify(e.message);
    }
  }
  return (
    <div className="space-y-1.5 rounded-xl border border-dashed border-[#7A1A12] bg-white p-2 text-[#15201A]">
      <p className="text-sm font-bold">
        แอด · ตอนนี้ {rf.admin && rf.admin !== "auto" ? rf.admin : "ระบบนับเอง"}
      </p>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="หมายเหตุให้เพื่อนบ้านเห็น (ไม่บังคับ)"
        className="min-h-[40px] w-full rounded-lg border border-[#C9D1CB] px-2 text-[15px]"
      />
      <div className="grid grid-cols-4 gap-1.5 text-sm font-bold">
        {[
          ["hide", "🚩 ซ่อน"],
          ["warn", "⚠️ เตือน"],
          ["clear", "✓ ล้าง"],
          ["auto", "นับเอง"],
        ].map(([k, t]) => (
          <button
            key={k}
            onClick={() => set(k)}
            className={`min-h-[40px] rounded-lg border ${rf.admin === k ? "bg-[#15201A] text-white" : "border-[#C9D1CB]"}`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

// inside a card: the amber/red box when flagged, the "แจ้งเตือน" form, and the admin's buttons
export function RedFlagPanel({ item, kind, admin, onChanged }) {
  const [form, setForm] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const rf = item.redflag;
  const lv = rf?.level || "none";
  async function send() {
    if (!reason) return notify("เลือกว่าเกิดอะไรขึ้นก่อนนะครับ");
    setBusy(true);
    try {
      const r = await api(`/flags/${kind}/${item.id}`, {
        method: "POST",
        body: JSON.stringify({
          reason,
          detail,
          name: load("contact", {}).name || "",
        }),
      });
      onChanged({ ...item, redflag: r.redflag });
      setForm(false);
      notify("ขอบคุณที่ช่วยเตือนเพื่อนบ้าน 🙏 แอดจะตรวจดูต่อ");
    } catch (e) {
      notify(e.message);
    }
    setBusy(false);
  }
  return (
    <div className="space-y-2">
      {lv !== "none" && (
        <div
          className={`space-y-1.5 rounded-xl p-2.5 ${lv === "hidden" ? "bg-[#FDECEA] text-[#7A1A12]" : "bg-[#FFF4D6] text-[#6B4200]"}`}
        >
          <p className="font-bold">
            {lv === "hidden" ? "🚩" : "⚠️"} {why(rf)}
            {lv === "warn" && rf.admin !== "warn" && rf.count < rf.hide_at && (
              <span className="block text-sm font-semibold">
                ครบ {rf.hide_at} รายงานระบบจะซ่อนไว้ · ใช้บริการควรระวัง
              </span>
            )}
          </p>
          <Reasons
            rf={rf}
            admin={admin}
            onDrop={(id) => dropFlag(kind, item, id, onChanged)}
          />
        </div>
      )}
      {form ? (
        <div className="space-y-2 rounded-xl border border-[#E4B3AD] bg-[#FFF8F7] p-2.5">
          <p className="font-bold">🚩 เตือนเพื่อนบ้านเรื่องอะไร</p>
          <div className="flex flex-wrap gap-1.5">
            {FLAG_REASONS.map(([k, t]) => (
              <button
                key={k}
                onClick={() => setReason(k)}
                aria-pressed={reason === k}
                className={`min-h-[40px] rounded-full px-3 text-[15px] ${reason === k ? "bg-[#B42318] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            maxLength={400}
            rows={3}
            placeholder="เล่าสั้นๆ ว่าเกิดอะไรขึ้น (ไม่ต้องใส่บ้านเลขที่)"
            className="w-full rounded-lg border border-[#C9D1CB] p-2 text-base"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setForm(false)}
              className="min-h-[44px] rounded-xl border border-[#C9D1CB] font-semibold"
            >
              ยกเลิก
            </button>
            <button
              onClick={send}
              disabled={busy}
              className="min-h-[44px] rounded-xl bg-[#B42318] font-bold text-white disabled:opacity-60"
            >
              ส่งคำเตือน
            </button>
          </div>
          <p className="text-sm text-[#45504A]">
            ชื่อและเครื่องของคุณไม่แสดงให้ใครเห็น · 1 เครื่องแจ้งได้ 1 ครั้ง
          </p>
        </div>
      ) : (
        <button
          onClick={() => setForm(true)}
          className="min-h-[36px] text-sm font-semibold text-[#8F2A1C] underline"
        >
          🚩 เคยเจอปัญหากับรายการนี้? แจ้งเตือนเพื่อนบ้าน
        </button>
      )}
      {admin && <AdminFlag kind={kind} item={item} onChanged={onChanged} />}
    </div>
  );
}
