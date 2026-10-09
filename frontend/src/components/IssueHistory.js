// 🕘 จุดปัญหาย้อนหลัง (9 Oct 2026): every report, open and cleared, newest first, grouped by day.
// Tap one → its card (photos, who said what, the buttons).
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ISSUE_TYPES, timeAgo } from "../config";
import { mediaUrl } from "../media";

const TH_MONTH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const k = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const y = new Date(Date.now() - 864e5);
  if (k(d) === k(today)) return "วันนี้";
  if (k(d) === k(y)) return "เมื่อวาน";
  return `${d.getDate()} ${TH_MONTH[d.getMonth()]}`;
}
const FILTERS = [
  ["all", "ทั้งหมด"],
  ["open", "ยังไม่แก้"],
  ["fixed", "เคลียร์แล้ว"],
];

export default function IssueHistory({ onOpen }) {
  const [items, setItems] = useState(null);
  const [f, setF] = useState("all");
  const [type, setType] = useState("");
  useEffect(() => {
    api("/issues?include_fixed=true")
      .then((r) => setItems([...r].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))))
      .catch(() => setItems([]));
  }, []);
  const shown = useMemo(() => (items || []).filter((x) => (f === "all" || (f === "fixed" ? x.status === "fixed" : x.status !== "fixed")) && (!type || x.type === type)), [items, f, type]);
  if (!items) return <p className="py-6 text-center text-[#45504A]">กำลังโหลด…</p>;
  const fixedN = items.filter((x) => x.status === "fixed").length;
  const types = [...new Set(items.map((x) => x.type))];
  let last = "";
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-[#45504A]">
        แจ้งมาทั้งหมด <b className="text-[#15201A]">{items.length}</b> จุด · เคลียร์แล้ว <b className="text-[#1E6B47]">{fixedN}</b> · ยังไม่แก้{" "}
        <b className="text-[#B42318]">{items.length - fixedN}</b>
      </p>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#E6EBE7] p-1">
        {FILTERS.map(([k, t]) => (
          <button key={k} onClick={() => setF(k)} aria-pressed={f === k} className={`min-h-[42px] rounded-lg text-[15px] ${f === k ? "bg-white font-bold shadow-sm" : "text-[#45504A]"}`}>
            {t}
          </button>
        ))}
      </div>
      {types.length > 1 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {["", ...types].map((k) => (
            <button
              key={k || "all"}
              onClick={() => setType(k)}
              className={`min-h-[38px] shrink-0 whitespace-nowrap rounded-full px-3 text-sm ${type === k ? "bg-[#15201A] font-bold text-white" : "border border-[#D5DBD6] bg-white"}`}
            >
              {k ? `${ISSUE_TYPES[k]?.[0] || "📍"} ${ISSUE_TYPES[k]?.[1] || k}` : "ทุกเรื่อง"}
            </button>
          ))}
        </div>
      )}
      {!shown.length && <p className="py-4 text-center text-[#45504A]">ไม่มีรายการ</p>}
      <ul className="space-y-1.5">
        {shown.map((x) => {
          const day = dayLabel(x.created_at);
          const head = day !== last;
          last = day;
          const [emoji, text] = ISSUE_TYPES[x.type] || ["📍", x.type];
          const done = x.status === "fixed";
          const fixedBy = done ? [...(x.history || [])].reverse().find((h) => /แก้แล้ว/.test(h.text)) : null;
          return (
            <li key={x.id}>
              {head && <p className="mb-1 mt-3 text-[13px] font-bold text-[#5A665F]">{day}</p>}
              <button onClick={() => onOpen(x)} className={`card flex w-full items-center gap-3 p-2.5 text-left ${done ? "opacity-80" : ""}`}>
                {x.media?.[0] ? (
                  <img src={mediaUrl(x.media[0].id, "thumb")} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                ) : (
                  <span className={`ic ${done ? "ic-green" : x.type === "trash" ? "ic-amber" : "ic-red"}`} aria-hidden="true">
                    {emoji}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">
                    {text}
                    {x.soi ? ` · ซ.${x.soi}` : ""}
                  </span>
                  {x.detail && <span className="block truncate text-sm text-[#45504A]">{x.detail}</span>}
                  <span className="block text-xs text-[#45504A]">
                    แจ้ง {timeAgo(x.created_at)}
                    {done && ` · เคลียร์ ${timeAgo(fixedBy?.at || x.updated_at)}${fixedBy?.by && fixedBy.by !== "ไม่ระบุชื่อ" ? ` โดย ${fixedBy.by}` : ""}`}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${done ? "bg-[#E4F0E9] text-[#154D33]" : x.status === "reported" ? "bg-[#FFF1C9] text-[#7A4104]" : "bg-[#FDE8E6] text-[#B42318]"}`}
                >
                  {done ? "✓ เคลียร์แล้ว" : x.status === "reported" ? "แจ้งเขตแล้ว" : "ยังไม่แก้"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
