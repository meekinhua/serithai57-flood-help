import { useEffect, useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { PRO_GROUPS } from "./Community";
import { useT } from "./Texts";
import { MediaStrip } from "./MediaGallery";

// บ้านฉัน, the parts that make a household keep the page (7 Oct 2026; backend homeplus.py)

function Box({ icon, title, sub, tone = "plain", children, right }) {
  const frame = { plain: "border-t border-[#E6EBE7]", red: "-mx-4 border-y-2 border-[#B42318] bg-[#FDE8E6] px-4", amber: "-mx-4 bg-[#FFF8E1] px-4" }[tone];
  return (
    <div className={`py-3 ${frame}`}>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-base font-bold text-[#15201A]">
          {icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </p>
        {right}
      </div>
      {sub && <p className="text-sm text-[#45504A]">{sub}</p>}
      <div className="mt-2 space-y-2">{children}</div>
    </div>
  );
}
const btn = "min-h-[50px] rounded-xl px-3 text-[15px] font-bold";

// ---------- 🆘 check-in: the team asks every house when something happens ----------
export function CheckinCard({ info, onSaved, onContact, setErr }) {
  const c = info.checkin;
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState("");
  const [again, setAgain] = useState(false);
  if (!c) return null;
  async function send(status) {
    setErr("");
    try {
      await api("/myhome/checkin", { method: "POST", body: JSON.stringify({ house: info.house, status, note }) });
      onSaved({ ...info, checkin: { ...c, mine: { status, note } } });
      setHelp(false);
      setAgain(false);
    } catch (e) {
      setErr(e.message);
    }
  }
  const mine = !again && c.mine;
  if (mine?.status === "ok")
    return (
      <p className="mt-2 flex items-center gap-2 rounded-xl bg-[#E4F0E9] px-3 py-2 text-[15px] text-[#154D33]">
        <span className="min-w-0 flex-1">
          ✅ <b>{c.title}</b> · ตอบแล้วว่าปลอดภัย
        </span>
        <button onClick={() => setAgain(true)} className="min-h-[40px] shrink-0 font-bold underline">
          เปลี่ยน
        </button>
      </p>
    );
  return (
    <Box icon="🆘" title={c.title} sub={mine ? null : "บ้านคุณเป็นยังไงบ้าง กดตอบให้ทีมอาสารู้"} tone="red">
      {mine?.status === "help" ? (
        <div className="space-y-2">
          <p className="text-[15px] font-bold text-[#B42318]">ส่งแล้ว ทีมอาสาจะติดต่อกลับเร็วที่สุด</p>
          {!info.has_contact && (
            <button onClick={onContact} className={`${btn} w-full bg-[#B42318] text-white`}>
              ฝากเบอร์ให้ทีมโทรกลับ
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <a href="tel:1669" className={`${btn} flex items-center justify-center bg-white text-[#B42318]`}>
              📞 1669 เจ็บป่วย
            </a>
            <a href="tel:199" className={`${btn} flex items-center justify-center bg-white text-[#B42318]`}>
              📞 199 ไฟไหม้ ภัย
            </a>
          </div>
          <button onClick={() => setAgain(true)} className="min-h-[40px] text-[15px] font-bold underline">
            ตอนนี้ปลอดภัยแล้ว
          </button>
        </div>
      ) : help ? (
        <div className="space-y-2">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={200}
            placeholder="ต้องการอะไร เช่น น้ำเข้าบ้าน ต้องย้ายคนแก่ ขาดยา (ไม่ใส่ก็ได้)"
            className="w-full rounded-xl border border-[#A9B4AD] bg-white p-3 text-base"
          />
          <button onClick={() => send("help")} className={`${btn} w-full bg-[#B42318] text-white`}>
            ส่งให้ทีมอาสา
          </button>
          <button onClick={() => setHelp(false)} className="min-h-[40px] w-full text-[15px] font-bold underline">
            ยกเลิก
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => send("ok")} className={`${btn} min-h-[60px] border-2 border-[#1E6B47] bg-white text-[17px] text-[#154D33]`}>
            ✅ ปลอดภัยดี
          </button>
          <button onClick={() => setHelp(true)} className={`${btn} min-h-[60px] bg-[#B42318] text-[17px] text-white`}>
            🆘 ต้องการความช่วยเหลือ
          </button>
        </div>
      )}
    </Box>
  );
}

// ---------- ⚡🚰 power / water outages around the house ----------
const OUT = {
  power: { icon: "⚡", name: "ไฟฟ้า", out: "ไฟดับ", back: "ไฟมาแล้ว", tel: "1130", org: "การไฟฟ้านครหลวง" },
  water: { icon: "🚰", name: "น้ำประปา", out: "น้ำไม่ไหล", back: "น้ำไหลแล้ว", tel: "1125", org: "การประปานครหลวง" },
};
export function OutageRow({ info, forced, onFold, onChanged, setErr }) {
  const o = info.outage;
  if (!o) return null;
  const busy = o.power.out || o.water.out || o.power.mine === "out" || o.water.mine === "out";
  if (!busy && !forced) return null;
  async function send(kind, state) {
    setErr("");
    try {
      await api("/myhome/outage", { method: "POST", body: JSON.stringify({ house: info.house, kind, state }) });
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <Box
      icon="⚡"
      title="ไฟ · น้ำประปา แถวบ้าน"
      tone={busy ? "amber" : "plain"}
      right={
        !busy && onFold ? (
          <button onClick={onFold} className="-my-2 min-h-[44px] shrink-0 px-1 text-[15px] font-bold text-[#45504A]">
            หุบ ▴
          </button>
        ) : null
      }
    >
      {Object.entries(OUT).map(([k, x]) => {
        const s = o[k];
        return (
          <div key={k} className="rounded-xl bg-white p-3">
            <p className="text-[15px]">
              {x.icon}{" "}
              {s.out ? (
                <b className="text-[#B42318]">
                  {x.out} {info.soi ? `ซ.${info.soi} ` : ""}แจ้ง {s.out} หลัง · ล่าสุด {timeAgo(s.last)}
                </b>
              ) : (
                <span>{x.name}แถวบ้าน ไม่มีใครแจ้งว่ามีปัญหา</span>
              )}
            </p>
            <div className="mt-2 flex gap-2">
              {s.mine === "out" ? (
                <button onClick={() => send(k, "back")} className={`${btn} flex-1 border-2 border-[#1E6B47] bg-white text-[#154D33]`}>
                  ✓ {x.back}
                </button>
              ) : (
                <button onClick={() => send(k, "out")} className={`${btn} flex-1 border-2 border-[#B45F06] bg-white text-[#7A4104]`}>
                  บ้านฉัน{x.out}
                </button>
              )}
              <a href={`tel:${x.tel}`} aria-label={`โทร ${x.org} ${x.tel}`} className={`${btn} flex shrink-0 items-center bg-[#15201A] text-white`}>
                📞 {x.tel}
              </a>
            </div>
          </div>
        );
      })}
      <p className="text-sm text-[#45504A]">แจ้งกันเองในหมู่บ้าน · โทรแจ้งการไฟฟ้า 1130 / การประปา 1125 ด้วย</p>
    </Box>
  );
}

// ---------- 💰 flood relief this house can claim ----------
// step-by-step animated guides (public/), per aid item
const GUIDES = { bkk_claim: "/claim-guide.html" };
export function AidRow({ info, onChanged, setErr }) {
  const [open, setOpen] = useState(null); // the information-only items fold behind one line
  const [how, setHow] = useState([]); // claim cards whose "วิธียื่น" is open
  // the ones to claim first; information (loans, social security, insurance) after
  const got = (info.aid || []).filter((a) => a.mine === "received");
  const all = (info.aid || []).filter((a) => a.mine !== "received");
  const claim = all.filter((a) => a.track !== false);
  const facts = all.filter((a) => a.track === false);
  if (!all.length && !got.length) return null;
  async function mark(aid, status) {
    setErr("");
    try {
      await api("/myhome/aid", { method: "POST", body: JSON.stringify({ house: info.house, aid, status }) });
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }
  // whole days left, counted in Bangkok dates (the same as the "เร็วๆ นี้" reminder)
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const days = (d) => Math.round((Date.parse(d) - Date.parse(today)) / 864e5);
  const thaiDate = (d) => new Date(`${d}T12:00:00+07:00`).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
  const card = (a) => {
    const left = a.deadline ? days(a.deadline) : null;
    const info_ = a.track === false;
    const shown = info_ || how.includes(a.id); // a claim card shows the money and the date; how to claim folds
    return (
      <div
        key={a.id}
        className={`rounded-2xl border p-3 ${info_ ? "border-[#DCE2DD] bg-[#F7F8F6]" : a.mine === "applied" ? "border-[#1E6B47] border-l-[6px] bg-[#EEF7F1]" : "border-[#E0A100] border-l-[6px] bg-white shadow-sm"}`}
      >
        <div className="flex items-start gap-2">
          <b className={`min-w-0 flex-1 leading-snug ${info_ ? "text-base" : "text-[15px] text-[#45504A]"}`}>{a.title}</b>
          {left != null && left >= 0 && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-sm font-bold ${left <= 3 ? "bg-[#B42318] text-white" : "bg-[#FDE8E6] text-[#B42318]"}`}>
              {left === 0 ? "หมดเขตวันนี้" : `อีก ${left} วัน`}
            </span>
          )}
        </div>
        {a.amount && <p className={`mt-0.5 font-bold leading-snug text-[#154D33] ${info_ ? "text-lg" : "text-xl"}`}>{a.amount.split("\n")[0]}</p>}
        {a.deadline && <p className="text-[15px] font-bold text-[#B42318]">ยื่นภายใน {thaiDate(a.deadline)}</p>}
        {GUIDES[a.id] && (
          <a href={GUIDES[a.id]} className="mt-1.5 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-[#1E6B47] px-3 text-[15px] font-bold text-white">
            ▶ ดูวิธียื่นทีละขั้น (มีเสียงอธิบาย)
          </a>
        )}
        {shown && (
          <>
            <MediaStrip media={a.media || []} />
            {a.amount?.includes("\n") && <p className="whitespace-pre-line text-sm text-[#33403A]">{a.amount.split("\n").slice(1).join("\n")}</p>}
            {a.who && <p className="text-sm text-[#45504A]">{a.who}</p>}
            {a.docs && (
              <p className="mt-1 whitespace-pre-line text-[15px] leading-relaxed">
                <b>{info_ ? "เงื่อนไข:" : "ต้องใช้:"}</b> {a.docs}
              </p>
            )}
            {a.where && (
              <p className="whitespace-pre-line text-[15px] leading-relaxed">
                <b>{info_ ? "ติดต่อ:" : "ยื่นที่:"}</b> {a.where}
              </p>
            )}
            {a.link && (
              <a href={a.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-[44px] items-center text-[15px] font-bold text-[#1F5FA8] underline">
                {/claim\.bangkok|thainatcat/.test(a.link) ? "เข้าเว็บยื่นเรื่อง ›" : "ดูรายละเอียด ›"}
              </a>
            )}
          </>
        )}
        {!info_ && (
          <div className="mt-2 flex gap-2">
            <button onClick={() => setHow((h) => (h.includes(a.id) ? h.filter((x) => x !== a.id) : [...h, a.id]))} aria-expanded={shown} className={`${btn} shrink-0 bg-[#F2F4F1]`}>
              วิธียื่น {shown ? "▴" : "▾"}
            </button>
            {a.mine === "applied" ? (
              <>
                <div className="flex min-h-[48px] flex-1 flex-col justify-center">
                  <p className="text-[15px] font-bold leading-tight text-[#154D33]">✓ บันทึกว่ายื่นแล้ว รอเงิน</p>
                  <button onClick={() => mark(a.id, "none")} className="self-start text-sm text-[#45504A] underline">
                    กดผิด? ยกเลิก
                  </button>
                </div>
                <button
                  onClick={() => window.confirm(`บันทึกว่า "ได้รับเงินแล้ว" จริงไหม?\n${a.title}\n\n(เป็นแค่บันทึกกันลืมของบ้านคุณ แก้ทีหลังได้)`) && mark(a.id, "received")}
                  className={`${btn} bg-[#1E6B47] text-white`}
                >
                  ได้เงินแล้ว
                </button>
              </>
            ) : (
              <button onClick={() => mark(a.id, "applied")} className={`${btn} flex-1 border-2 border-[#1E6B47] bg-white text-[#154D33]`}>
                ✓ ยื่นแล้ว
              </button>
            )}
          </div>
        )}
      </div>
    );
  };
  return (
    <div id="myhome-aid" className="-mx-4 border-y-2 border-[#E0A100] bg-gradient-to-b from-[#FFF1C2] to-[#FFFBEA] px-4 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#E0A100] text-2xl shadow-sm" aria-hidden="true">
          💰
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-tight text-[#15201A]">เงินเยียวยาน้ำท่วม ที่บ้านคุณขอได้</p>
          {(() => {
            const todo = claim.filter((a) => a.mine !== "applied");
            const next = todo.filter((a) => a.deadline && days(a.deadline) >= 0).sort((x, y) => x.deadline.localeCompare(y.deadline))[0];
            return (
              <p className="mt-0.5 text-[15px] font-bold text-[#7A4104]">
                {todo.length ? `ยังไม่ได้ยื่น ${todo.length} รายการ` : "ยื่นครบแล้ว ✓"}
                {next && <span className="text-[#B42318]"> · ใกล้หมดเขต {thaiDate(next.deadline)}</span>}
              </p>
            );
          })()}
        </div>
      </div>
      <p className="mt-1 text-sm text-[#45504A]">ทีมอาสารวบรวมจากประกาศของหน่วยงาน · ต้องยื่นกับหน่วยงานเองตามลิงก์ในแต่ละข้อ</p>
      <p className="mt-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm leading-snug text-[#33403A]">
        📝 ปุ่ม <b>“ยื่นแล้ว”</b> และ <b>“ได้เงินแล้ว”</b> เป็นแค่<b>บันทึกกันลืม</b>ของบ้านคุณ <b>ไม่ใช่การยื่นเรื่อง</b> และไม่ใช่ระบบของหน่วยงาน · กดผิดแก้ได้เสมอ
      </p>
      <div className="mt-3 space-y-2">
        {claim.map(card)}
        {facts.length > 0 &&
          (open ? (
            <>
              <p className="pt-1 text-[15px] font-bold">ความช่วยเหลืออื่นที่ควรรู้</p>
              {facts.map(card)}
            </>
          ) : (
            <button onClick={() => setOpen(true)} className="min-h-[48px] w-full rounded-xl bg-white/70 px-3 text-left text-[15px] font-bold">
              + ความช่วยเหลืออื่น: {facts.map((a) => a.short || a.title.split(" ")[0]).join(" · ")} ▾
            </button>
          ))}
        {got.length > 0 && (
          <div className="rounded-xl bg-white/70 px-3 py-2">
            <p className="text-sm font-bold text-[#154D33]">✓ บันทึกว่าได้รับเงินแล้ว</p>
            {got.map((a) => (
              <div key={a.id} className="flex min-h-[44px] items-center gap-2">
                <span className="min-w-0 flex-1 text-[15px] leading-snug">{a.title}</span>
                <button onClick={() => mark(a.id, "applied")} className="shrink-0 text-sm font-bold text-[#45504A] underline">
                  ยังไม่ได้รับ? แก้
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- 🔧 the house's repair plan, each item tied to the tradesmen on the board ----------
export const PLAN = [
  ["electric", "ไฟ ปลั๊ก เบรกเกอร์", "electric"],
  ["ac", "แอร์", "fix"],
  ["water", "ปั๊มน้ำ ประปา", "plumb"],
  ["appliance", "ตู้เย็น เครื่องซักผ้า", "fix"],
  ["clean", "ล้างบ้าน ฆ่าเชื้อ", "clean"],
  ["walls", "ผนัง เชื้อรา ทาสี", "build"],
  ["doors", "ประตู หน้าต่าง พื้น", "build"],
  ["junk", "ขนขยะ เฟอร์นิเจอร์พัง", "junk"],
  ["vehicle", "รถ มอเตอร์ไซค์", "car"],
];
export function PlanRow({ info, services, onPros, onSaved, onFold, setErr }) {
  const t = useT();
  const plan = info.plan;
  const [edit, setEdit] = useState(null);
  const count = (g) => {
    const cats = PRO_GROUPS.find((x) => x.key === g)?.cats || [];
    return (services || []).filter((s) => cats.includes(s.category)).length;
  };
  async function store(items) {
    setErr("");
    try {
      const r = await api("/myhome/plan", { method: "POST", body: JSON.stringify({ house: info.house, items }) });
      onSaved({ ...info, plan: r.items });
      setEdit(null);
    } catch (e) {
      setErr(e.message);
    }
  }
  const title = t("myhome.plan.title", "แผนซ่อมบ้านฉัน");
  if (!edit && !plan)
    return (
      <Box icon="🔧" title={t("myhome.plan.ask", "บ้านยังต้องซ่อมอะไรไหม")} sub={t("myhome.plan.ask_sub", "ทำรายการไว้ แล้วเราหาช่างที่เพื่อนบ้านแนะนำให้ทีละอย่าง")}>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setEdit({})} className={`${btn} border-2 border-[#B45F06] bg-white text-[#7A4104]`}>
            ยังต้องซ่อม
          </button>
          <button onClick={() => store({})} className={`${btn} border-2 border-[#1E6B47] bg-white text-[#154D33]`}>
            ไม่ต้องแล้ว
          </button>
        </div>
      </Box>
    );
  if (edit) {
    const pick = edit || {};
    return (
      <Box icon="🔧" title={title} sub={t("myhome.plan.sub", "เลือกสิ่งที่ยังต้องซ่อม ได้หลายอย่าง")}>
        <div className="grid grid-cols-2 gap-2">
          {PLAN.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setEdit({ ...pick, [k]: pick[k] ? undefined : "todo" })}
              aria-pressed={!!pick[k]}
              className={`min-h-[52px] rounded-xl border-2 px-2 text-left text-[15px] font-bold leading-tight ${pick[k] ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
            >
              {pick[k] === "done" ? "✓ " : ""}
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => store(Object.fromEntries(Object.entries(pick).filter(([, v]) => v)))}
          disabled={!Object.values(pick).some(Boolean)}
          className={`${btn} w-full bg-[#1E6B47] text-white disabled:opacity-40`}
        >
          บันทึก แล้วดูช่าง
        </button>
        <button onClick={() => setEdit(null)} className="min-h-[40px] w-full text-[15px] font-bold text-[#45504A] underline">
          ยกเลิก
        </button>
      </Box>
    );
  }
  const keys = PLAN.filter(([k]) => plan[k]);
  const done = keys.filter(([k]) => plan[k] === "done");
  const todo = keys.filter(([k]) => plan[k] === "todo");
  return (
    <Box
      icon="🔧"
      title={title}
      right={
        !todo.length && onFold ? (
          <button onClick={onFold} className="-my-2 min-h-[44px] shrink-0 px-1 text-[15px] font-bold text-[#45504A]">
            หุบ ▴
          </button>
        ) : null
      }
    >
      <div>
        <div className="flex items-baseline justify-between text-[15px]">
          <b>{todo.length ? `ซ่อมเสร็จ ${done.length} จาก ${keys.length}` : "ซ่อมครบทุกอย่างแล้ว 🎉"}</b>
          <button onClick={() => setEdit({ ...plan })} className="min-h-[40px] text-[15px] font-bold text-[#45504A] underline">
            แก้รายการ
          </button>
        </div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#E6EBE7]">
          <div className="h-full rounded-full bg-[#1E6B47]" style={{ width: `${keys.length ? (done.length / keys.length) * 100 : 100}%` }} />
        </div>
      </div>
      {todo.map(([k, label, g]) => (
        <div key={k} className="flex items-center gap-2 rounded-xl border border-[#DCE2DD] bg-white p-2 pl-3">
          <span className="min-w-0 flex-1 text-[15px] font-bold">{label}</span>
          <button onClick={() => onPros(g)} className="min-h-[44px] shrink-0 rounded-lg bg-[#15201A] px-3 text-sm font-bold text-white">
            หาช่าง{count(g) ? ` (${count(g)})` : ""}
          </button>
          <button
            onClick={() => store({ ...plan, [k]: "done" })}
            aria-label={`${label} เสร็จแล้ว`}
            className="min-h-[44px] shrink-0 rounded-lg border-2 border-[#1E6B47] px-3 text-sm font-bold text-[#154D33]"
          >
            ✓ เสร็จ
          </button>
        </div>
      ))}
      {done.length > 0 && <p className="text-sm text-[#45504A]">เสร็จแล้ว: {done.map(([, l]) => l).join(" · ")}</p>}
    </Box>
  );
}

// ---------- 📞 "how was the tradesman you called?" (the board's ratings come from here) ----------
export function ReviewPrompt({ services }) {
  const [asked, setAsked] = useState(() => load("callsAsked", []));
  const [thanks, setThanks] = useState("");
  const now = Date.now();
  const call = load("calls", [])
    .filter((c) => now - c.at > 3 * 3600e3 && now - c.at < 14 * 864e5 && !asked.includes(c.id) && (services || []).some((s) => s.id === c.id))
    .pop();
  if (thanks) return <p className="mt-2 rounded-xl bg-[#E4F0E9] p-3 text-[15px] font-bold text-[#154D33]">{thanks}</p>;
  if (!call) return null;
  const done = () => {
    const a = [...asked, call.id];
    setAsked(a);
    save("callsAsked", a);
  };
  async function good() {
    try {
      await api(`/services/${call.id}/review`, { method: "POST", body: JSON.stringify({ name: load("myName", "") || "เพื่อนบ้าน", good: true, text: "" }) });
      setThanks(`ขอบคุณ! เพื่อนบ้านจะเห็นว่า ${call.name} มีคนแนะนำ`);
    } catch {}
    done();
  }
  return (
    <Box icon="📞" title={`คุณโทรหา ${call.name} เมื่อ${timeAgo(new Date(call.at))}`} sub="ใช้บริการแล้วเป็นยังไง บอกต่อให้เพื่อนบ้านเลือกง่ายขึ้น">
      <div className="grid grid-cols-2 gap-2">
        <button onClick={good} className={`${btn} bg-[#1E6B47] text-white`}>
          👍 ดี แนะนำต่อ
        </button>
        <button onClick={done} className={`${btn} border border-[#C9D1CB] bg-white`}>
          ไม่ได้ใช้ / ยังไม่รู้
        </button>
      </div>
    </Box>
  );
}

// ---------- 👨‍👩‍👧 family: a link that opens this house's บ้านฉัน on the children's phones ----------
export function familyLink(house) {
  return `${window.location.origin}/?h=${encodeURIComponent(house)}&n=${encodeURIComponent("บ้านพ่อแม่")}`;
}
export async function shareFamily(house) {
  const url = familyLink(house);
  const text = `ดู "บ้านฉัน" บ้าน ${house} ได้ที่ลิงก์นี้ · วันรถขยะ น้ำหน้าบ้าน ไฟดับ ช่างที่เพื่อนบ้านแนะนำ และฝากเพื่อนบ้านใกล้ๆ ช่วยดูบ้านแทนได้`;
  if (navigator.share) {
    try {
      await navigator.share({ title: `บ้านฉัน ${house}`, text, url });
      return;
    } catch {}
  }
  window.open(`https://line.me/R/share?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank");
}
// ?h=4/203&n=บ้านแม่ in the address: keep that house on this phone (next to its own) and show it
export function takeFamilyParam() {
  const p = new URLSearchParams(window.location.search);
  const h = (p.get("h") || "").trim();
  if (!h) return null;
  const label = (p.get("n") || "บ้านครอบครัว").slice(0, 20);
  const own = load("myHouse", "");
  let list = load("myHouses", []).filter((x) => x.house !== h);
  if (own && own !== h && !list.some((x) => x.house === own)) list = [{ house: own, label: "บ้านฉัน" }, ...list];
  save("myHouses", [...list, { house: h, label }]);
  save("myHouse", h); // the house the link opened is the one shown (also when the page asks twice)
  p.delete("h");
  p.delete("n");
  const q = p.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (q ? `?${q}` : "") + window.location.hash);
  return h;
}

// ---------- 📲 keep it on the home screen ----------
let deferred = null;
if (typeof window !== "undefined")
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
  });
export function InstallCard() {
  const [later, setLater] = useState(() => Date.now() - load("installLater", 0) < 14 * 864e5);
  const [how, setHow] = useState(false);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => force((n) => n + 1), 1500); // the browser's own prompt arrives a little after load
    return () => clearTimeout(t);
  }, []);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
  if (standalone || later) return null;
  const ua = navigator.userAgent;
  const inLine = /Line\//i.test(ua);
  const ios = /iPhone|iPad|iPod/i.test(ua);
  async function add() {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
      return force((n) => n + 1);
    }
    setHow(true);
  }
  const close = () => {
    save("installLater", Date.now());
    setLater(true);
  };
  if (!how)
    return (
      <div className="flex items-center gap-2 border-t border-[#E6EBE7] py-3">
        <button onClick={add} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#15201A] px-3 text-left text-white">
          <span className="text-xl" aria-hidden="true">
            📲
          </span>
          <span className="min-w-0">
            <b className="block text-[15px] leading-tight">เก็บไว้หน้าจอมือถือ</b>
            <span className="block text-xs text-[#C5D1CA]">เปิดจากไอคอนได้เลย</span>
          </span>
        </button>
        <button onClick={close} aria-label="ไว้ทีหลัง" className="min-h-[52px] shrink-0 rounded-xl px-3 text-[15px] font-bold text-[#45504A]">
          ไว้ทีหลัง
        </button>
      </div>
    );
  return (
    <Box icon="📲" title="เก็บบ้านฉันไว้หน้าจอมือถือ">
      <ol className="list-decimal space-y-1 rounded-xl bg-[#F2F4F1] p-3 pl-8 text-[15px] leading-relaxed">
        {inLine ? (
          <>
            <li>กดปุ่ม ⋯ (หรือ ⋮) มุมขวาบนของ LINE</li>
            <li>เลือก "เปิดในเบราว์เซอร์" (Safari / Chrome)</li>
            <li>แล้วกดปุ่มนี้อีกครั้งในเบราว์เซอร์</li>
          </>
        ) : ios ? (
          <>
            <li>กดปุ่มแชร์ (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ด้านล่างจอ</li>
            <li>เลื่อนหา "เพิ่มไปยังหน้าจอโฮม"</li>
            <li>กด "เพิ่ม" มุมขวาบน</li>
          </>
        ) : (
          <>
            <li>กดปุ่ม ⋮ มุมขวาบนของ Chrome</li>
            <li>เลือก "เพิ่มลงในหน้าจอหลัก" หรือ "ติดตั้งแอป"</li>
            <li>กด "เพิ่ม"</li>
          </>
        )}
      </ol>
      <button onClick={close} className="min-h-[40px] w-full text-[15px] font-bold text-[#45504A] underline">
        ทำแล้ว / ไว้ทีหลัง
      </button>
    </Box>
  );
}
