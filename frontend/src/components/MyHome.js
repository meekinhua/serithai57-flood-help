import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, load, save } from "../api";
import LocationPicker from "./LocationPicker";
import Nearby from "./Nearby";
import { useT } from "./Texts";
import { MYHOME_CHANGED, cleanHouse } from "./SurveyBox";
import { PRO_GROUPS, goodOf, rememberCall } from "./Community";
import PetsRow from "./Pets";
import { flashTo, notify } from "../notify";
import { seenVisits } from "../visits";
import PushCard from "./PushCard";
import NeighborFill from "./NeighborFill";
import FloodTuck, { useFloodTools } from "./FloodTuck";
import { mediaUrl } from "../media";
import { MediaStrip, MediaThumb } from "./MediaGallery";
import {
  AidRow,
  CheckinCard,
  OutageRow,
  ReviewPrompt,
  shareFamily,
  takeFamilyParam,
} from "./HomePlus";
import InstallApp, { isStandalone, nudgeInstall } from "./InstallApp";
import { isIOS, pushSupported } from "../push";
import { waterOf } from "../config";

// บ้านฉัน (7 Oct 2026): a house number typed once (or taken from the electricians' sign-up on this phone) and
// the page shows what concerns that house: the regular rubbish round of its soi, its electrical check, the
// water in front of it right now (one tap), open problems in its soi to report to the office. No login.

const WATER_TAPS = [
  {
    key: "dry",
    label: "แห้ง",
    level: 0,
    where: "street",
    cls: "border-[#1E6B47] text-[#1E6B47]",
  },
  {
    key: "street",
    label: "น้ำขังถนน",
    level: 1,
    where: "street",
    cls: "border-[#B45F06] text-[#7A4104]",
  },
  {
    key: "house",
    label: "น้ำเข้าบ้าน",
    level: 2,
    where: "house",
    cls: "border-[#B42318] text-[#B42318]",
  },
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
  const m = Math.max(
    1,
    Math.round((Date.now() - new Date(t).getTime()) / 60000),
  );
  return m < 60 ? `${m} นาทีที่แล้ว` : `${Math.round(m / 60)} ชม.ที่แล้ว`;
}

function WaterRow({ info, water, onAsk, sent, onTap }) {
  const exact = info.precision === "house";
  const radius = exact ? 150 : 300;
  const near = useMemo(() => {
    const t = Date.now();
    return (water || [])
      .filter(
        (w) =>
          w.lat &&
          w.lng &&
          t - new Date(w.created_at).getTime() < NEAR_H * 3600e3 &&
          w.name !== `บ้าน ${info.house}`,
      )
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
        <div
          className="flex items-center gap-3 rounded-2xl p-3"
          style={{
            background: `${lv.color}1A`,
            border: `2px solid ${lv.color}`,
          }}
        >
          <span
            className="h-4 w-4 shrink-0 rounded-full"
            style={{ background: lv.color }}
          />
          <div className="min-w-0">
            <p className="text-lg font-bold leading-tight">
              {last.level === 0
                ? "แห้ง ไม่ท่วม"
                : last.where === "house"
                  ? "มีน้ำเข้าบ้านแถวนี้"
                  : `น้ำ${lv.label} (${lv.cm})`}
            </p>
            <p className="text-sm text-[#33403A]">
              เพื่อนบ้านแจ้ง {ago(last.created_at)} · ห่าง ~
              {Math.max(10, Math.round(last.m / 10) * 10)} ม.
              {near.length > 1
                ? ` · ${NEAR_H} ชม.นี้ ${near.length} ครั้ง (มีน้ำ ${wet})`
                : ""}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[15px] text-[#33403A]">
          {t(
            "myhome.water.none",
            "{h} ชม.ที่ผ่านมา ยังไม่มีใครแจ้งแถวบ้านคุณ",
            { h: NEAR_H },
          )}
        </p>
      )}
      {!exact && (
        <p className="text-sm text-[#7A4104]">
          {t(
            "myhome.water.rough",
            "ดูจากทั้งแถวซอย · ปักหมุดบ้านแล้วจะแม่นขึ้น",
          )}
        </p>
      )}
      {sent ? (
        <p className="text-[15px] font-bold text-[#1E6B47]">
          {t(
            "myhome.water.thanks",
            "ขอบคุณที่แจ้ง ({what}) เพื่อนบ้านเห็นแล้ว",
            { what: sent },
          )}
        </p>
      ) : (
        <>
          <p className="pt-1 text-[15px] font-bold">
            {t(
              "myhome.water.ask",
              "อยู่บ้าน? กดบอกเพื่อนบ้านว่าตอนนี้เป็นแบบไหน",
            )}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {WATER_TAPS.map((w) => (
              <button
                key={w.label}
                onClick={() => onTap(w)}
                className={`min-h-[52px] rounded-xl border-2 bg-white px-1 text-[15px] font-bold leading-tight ${w.cls}`}
              >
                {t(`myhome.water.${w.key}`, w.label)}
              </button>
            ))}
          </div>
        </>
      )}
      {onAsk && (
        <button
          onClick={onAsk}
          className="min-h-[48px] w-full rounded-xl bg-[#F2F4F1] px-3 text-[15px] font-bold text-[#154D33]"
        >
          {t(
            "myhome.water.away",
            "ไม่อยู่บ้าน? ฝากเพื่อนบ้านใกล้ๆ ช่วยดูให้ ›",
          )}
        </button>
      )}
    </Row>
  );
}

function Row({ icon, title, children, hi, onFold, id, card }) {
  return (
    <div
      id={id}
      className={
        card
          ? `card mt-2 p-3 ${card === "hero" ? "card-hero" : ""}`
          : `border-t border-[#E6EBE7] py-3 ${hi ? "-mx-4 bg-[#FFF8E1] px-4" : ""}`
      }
    >
      <div className={`flex gap-2 ${card ? "items-center" : "items-start"}`}>
        {card && icon && (
          <span className="ic ic-sm ic-green" aria-hidden="true">
            {icon}
          </span>
        )}
        <p className="min-w-0 flex-1 text-base font-bold leading-snug text-[#15201A]">
          {!card && icon && <span aria-hidden="true">{icon} </span>}
          {title}
        </p>
        {onFold && (
          <button
            onClick={onFold}
            className="-my-2 min-h-[44px] shrink-0 px-1 text-[15px] font-bold text-[#45504A]"
          >
            หุบ ▴
          </button>
        )}
      </div>
      <div className="mt-1 space-y-2">{children}</div>
    </div>
  );
}

// ---------- a slide show card (ขอแรง, หาย·เจอ): one item at a time, folds to a line once every item has been shown ----------
function Slides({
  items,
  foldKey,
  icon,
  title,
  slide,
  onOpen,
  onAll,
  allLabel = "ดูทั้งหมด ›",
  tone = "amber",
  startFolded = false,
  mini,
}) {
  const key = items.map((x) => x.id.slice(0, 6)).join(",");
  const store = `slidesSeen:${foldKey}`;
  const [folded, setFolded] = useState(
    () => startFolded || load(store, "") === key,
  ); // folded by default, or this set was already shown in full
  const [manual, setManual] = useState(false); // opened by hand: stays open, no auto-fold
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const seen = useRef(new Set());
  useEffect(() => {
    setFolded(startFolded || load(store, "") === key);
    setI(0);
    seen.current = new Set();
  }, [key, store, startFolded]);
  const n = items.length;
  const x = items[Math.min(i, n - 1)];
  useEffect(() => {
    if (folded || !x) return;
    seen.current.add(x.id);
    if (paused) return;
    const t = setTimeout(() => {
      if (!manual && seen.current.size >= n) {
        save(store, key); // everything has been on screen once: step back to one line
        setFolded(true);
      } else setI((v) => (v + 1) % n);
    }, 4500);
    return () => clearTimeout(t);
  }, [i, folded, paused, manual, n, key, store, x]);
  useEffect(() => {
    if (!folded || !mini || n < 2 || paused) return;
    const t = setTimeout(() => setI((v) => (v + 1) % n), 3500);
    return () => clearTimeout(t);
  }, [folded, mini, n, i, paused]);
  if (!n) return null;
  const C = {
    red: { tile: "ic-red", ink: "text-[#B42318]", dot: "bg-[#B42318]" },
    green: { tile: "ic-green", ink: "text-[#1E6B47]", dot: "bg-[#1E6B47]" },
  }[tone] || {
    tile: "ic-amber",
    ink: "text-[#7A4104]",
    dot: "bg-[#7A4104]",
  };
  const fold = () => {
    save(store, key);
    setFolded(true);
    setManual(false);
  };
  const open = () => {
    setFolded(false);
    setManual(true);
    setI(0);
  };
  if (folded && mini)
    return (
      <div
        className="card anim-shrink mt-2 flex min-h-[64px] w-full items-center gap-2 overflow-hidden p-2 pr-3"
        onTouchStart={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <button
          key={x.id}
          onClick={() => onOpen(x.id)}
          className="slide-in-x flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {mini(x)}
        </button>
        <button
          onClick={open}
          className={`min-h-[48px] shrink-0 pl-1 text-[15px] font-bold ${C.ink}`}
          aria-label={`${title(n)} · เปิดดู`}
        >
          {n > 1 && (
            <span className="block text-xs font-normal text-[#45504A]">{`${Math.min(i, n - 1) + 1}/${n}`}</span>
          )}
          ดู ▾
        </button>
      </div>
    );
  if (folded)
    return (
      <button
        onClick={() => {
          setFolded(false);
          setManual(true);
          setI(0);
        }}
        className="card anim-shrink mt-2 flex min-h-[56px] w-full items-center gap-2.5 p-2 pr-3 text-left text-[15px]"
      >
        <span className={`ic ic-sm ${C.tile}`} aria-hidden="true">
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <b>{title(n)}</b> ·{" "}
          {(items[0].title || items[0].detail || "").slice(0, 36)}
        </span>
        <span className={`shrink-0 font-bold ${C.ink}`}>ดู ▾</span>
      </button>
    );
  return (
    <div
      className="card anim-in mt-2 p-3"
      onTouchStart={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="flex items-center gap-2">
        <span className={`ic ic-sm ${C.tile}`} aria-hidden="true">
          {icon}
        </span>
        <b className="min-w-0 flex-1 text-base leading-snug">{title(n)}</b>
        <button
          onClick={fold}
          className="min-h-[40px] shrink-0 text-sm font-bold text-[#45504A] underline"
        >
          ย่อ ▴
        </button>
      </div>
      <button
        key={x.id}
        onClick={() => onOpen(x.id)}
        className="anim-in mt-2 block min-h-[76px] w-full rounded-xl bg-[#F7F8F6] p-3 text-left"
      >
        {slide(x)}
      </button>
      <div className="mt-2 flex items-center gap-2">
        {n > 1 && (
          <button
            onClick={() => setI((v) => (v - 1 + n) % n)}
            aria-label="ก่อนหน้า"
            className="min-h-[40px] min-w-[40px] rounded-full bg-[#F2F4F1] text-lg"
          >
            ‹
          </button>
        )}
        <span className="flex flex-1 justify-center gap-1.5" aria-hidden="true">
          {items.map((y, k) => (
            <span
              key={y.id}
              className={`h-2 rounded-full transition-all ${k === i ? `w-5 ${C.dot}` : "w-2 bg-[#D5DBD6]"}`}
            />
          ))}
        </span>
        {n > 1 && (
          <button
            onClick={() => setI((v) => (v + 1) % n)}
            aria-label="ถัดไป"
            className="min-h-[40px] min-w-[40px] rounded-full bg-[#F2F4F1] text-lg"
          >
            ›
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between">
        <button
          onClick={() => onAll()}
          className={`min-h-[40px] text-[15px] font-bold ${C.ink}`}
        >
          {allLabel}
        </button>
        <button
          onClick={() => {
            fold();
            notify("ย่อไว้แล้ว · กด “ดู ▾” เพื่อเปิดอีกครั้ง");
          }}
          className="min-h-[40px] text-sm font-bold text-[#45504A] underline"
        >
          รับทราบแล้ว ย่อไว้
        </button>
      </div>
    </div>
  );
}

// ---------- "ซอยไม่ถูก? แก้" — type the soi number, no map needed ----------
function SoiEdit({ info, onSaved, onClose, setErr }) {
  const [v, setV] = useState(info.soi || "");
  const [busy, setBusy] = useState(false);
  async function go() {
    setErr("");
    setBusy(true);
    try {
      const r = await api("/myhome/soi", {
        method: "POST",
        body: JSON.stringify({ house: info.house, soi: v }),
      });
      save("mySoi", r.soi || v);
      onSaved(r);
      onClose();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  return (
    <div className="anim-in my-2 flex items-center gap-2 rounded-2xl bg-[#FFF6DA] p-2.5">
      <span className="shrink-0 text-[15px] font-bold">ซอย</span>
      <input
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        inputMode="decimal"
        placeholder="เช่น 14"
        className="min-h-[48px] w-24 rounded-xl border-2 border-[#1E6B47] px-3 text-xl font-bold"
      />
      <button
        onClick={go}
        disabled={busy || !v.trim()}
        className="min-h-[48px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-40"
      >
        {busy ? "…" : "บันทึก"}
      </button>
      <button
        onClick={onClose}
        className="min-h-[48px] px-1 text-sm text-[#45504A] underline"
      >
        ปิด
      </button>
    </div>
  );
}

// ---------- "บ้าน 4/305 อยู่ ซ.14 ใช่ไหม?" — asked once per house per phone; GPS recommended, never forced ----------
function SoiAsk({ info, onSaved, onPin, onClose, setErr }) {
  const [edit, setEdit] = useState(!info.soi);
  const [v, setV] = useState(info.soi || "");
  const [busy, setBusy] = useState(false);
  async function save_(soi) {
    setErr("");
    setBusy(true);
    try {
      const r = await api("/myhome/soi", {
        method: "POST",
        body: JSON.stringify({ house: info.house, soi }),
      });
      save("mySoi", r.soi || soi);
      onSaved(r);
      onClose(true);
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  // a portal: the page slides in (transform), which would trap a fixed overlay inside it
  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-[950] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={() => onClose(false)}
    >
      <div
        className="anim-sheet w-full max-w-md rounded-t-3xl bg-white p-4 pb-6 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="ยืนยันซอย"
      >
        <p className="text-sm font-bold text-[#7A4104]">
          ช่วยยืนยันหน่อย · ทำครั้งเดียว
        </p>
        <h3 className="font-display mt-0.5 text-2xl font-bold leading-tight">
          {info.soi && !edit
            ? `บ้าน ${info.house} อยู่ ซ.${info.soi} ใช่ไหม?`
            : `บ้าน ${info.house} อยู่ซอยไหน?`}
        </h3>
        <p className="mt-1 text-[15px] text-[#45504A]">
          ใช้กำหนดวันรถขยะ คิวช่าง และน้ำหน้าบ้านของคุณ ·
          บ้านแบ่งแปลงใหม่เลขที่มักไม่ตรงซอย
        </p>
        {!edit ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => save_(info.soi)}
              disabled={busy}
              className="min-h-[60px] rounded-2xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-50"
            >
              ✅ ใช่ ซ.{info.soi}
            </button>
            <button
              onClick={() => setEdit(true)}
              className="min-h-[60px] rounded-2xl border-2 border-[#15201A] text-lg font-bold"
            >
              ✎ ไม่ใช่
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-lg font-bold">ซอย</span>
            <input
              autoFocus
              value={v}
              onChange={(e) => setV(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && v.trim() && save_(v)}
              inputMode="decimal"
              placeholder="เช่น 14"
              className="min-h-[56px] w-28 rounded-2xl border-2 border-[#1E6B47] px-3 text-2xl font-bold"
            />
            <button
              onClick={() => save_(v)}
              disabled={busy || !v.trim()}
              className="min-h-[56px] flex-1 rounded-2xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-40"
            >
              บันทึก
            </button>
          </div>
        )}
        <button
          onClick={onPin}
          className="mt-3 flex min-h-[56px] w-full items-center gap-3 rounded-2xl bg-[#FFF6DA] px-3 text-left"
        >
          <span className="text-2xl" aria-hidden="true">
            📍
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-base leading-tight">
              ปักหมุดด้วย GPS · แนะนำ
            </b>
            <span className="block text-sm text-[#45504A]">
              ตอนอยู่ที่บ้าน กดครั้งเดียว ระบบรู้ทั้งซอยและหลังบ้าน แม่นที่สุด
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button
          onClick={() => onClose(false)}
          className="mt-2 min-h-[44px] w-full text-[15px] font-bold text-[#45504A] underline"
        >
          ไว้ทีหลัง
        </button>
      </div>
    </div>,
    document.body,
  );
}

// a phone (not a computer): where installing / phone notifications make sense
const isPhone = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
// open a card in บ้านฉัน (it may be folded) and bring it into view
function findCard(id, open) {
  open();
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) flashTo(el);
  }, 120);
}
function openPush() {
  // iPhone in Safari (not the installed icon): notifications need the icon first → the install card says so
  if (isIOS() && !isStandalone())
    return findCard("myhome-install", () =>
      nudgeInstall(
        "iPhone รับแจ้งเตือนได้ต่อเมื่อเปิดจากไอคอนที่ติดตั้งแล้ว · ติดตั้งก่อนนะ",
      ),
    );
  if (!pushSupported())
    return notify(
      "มือถือ/เบราว์เซอร์นี้รับแจ้งเตือนไม่ได้ · ลองเปิดใน Chrome หรือ Safari",
    );
  findCard("myhome-push", () => window.dispatchEvent(new Event("push:open")));
}

// ---------- 📢 เสียงตามสาย: can this house hear the village loudspeaker? (9 Oct) ----------
const SPK_NOTES = [
  "ไม่เคยได้ยินเลย",
  "ได้ยินแต่ฟังไม่รู้เรื่อง",
  "เสียงเบามาก",
  "ลำโพงใกล้บ้านเสีย",
];

function SpeakerRow({
  info,
  onSaved,
  setErr,
  open,
  onClose,
  onPin,
  hideNudge,
  draft = "",
}) {
  // asked at the top until answered; after that the status chip by the house number opens it again ("open")
  const sp = info.speaker || {};
  const [busy, setBusy] = useState(false);
  const [noting, setNoting] = useState(false); // after "ไม่ได้ยิน": a line in their own words (optional)
  const [note, setNote] = useState(draft || sp.note || "");
  useEffect(() => {
    if (draft) setNote(draft);
  }, [draft]);
  async function saveNote() {
    setErr("");
    setBusy(true);
    try {
      onSaved(
        await api("/myhome/answer", {
          method: "POST",
          body: JSON.stringify({
            house: info.house,
            qid: "speaker",
            answer: "yes",
            note,
          }),
        }),
      );
      setNoting(false);
      onClose();
      notify("บันทึกแล้ว · ทีมจะรวบรวมส่งคหบาลให้ซ่อมลำโพงซอยคุณ");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  const [nudgeVisits] = useState(() => seenVisits("speaker:pin")); // the pin nudge shows on 3 visits, then the house panel has it
  async function answer(a) {
    setErr("");
    setBusy(true);
    try {
      onSaved(
        await api("/myhome/answer", {
          method: "POST",
          body: JSON.stringify({
            house: info.house,
            qid: "speaker",
            answer: a,
            ...(a === "yes" && note.trim() ? { note } : {}),
          }),
        }),
      );
      if (a === "yes") return setNoting(true); // stays open: a line about it (optional)
      onClose();
      notify("บันทึกแล้ว · ขอบคุณครับ");
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  if (sp.answer && !open && !noting) {
    // can't hear and the house isn't pinned yet: one quiet nudge (the map needs the place)
    return sp.answer === "yes" &&
      info.precision !== "house" &&
      !hideNudge &&
      nudgeVisits <= 3 ? (
      <button
        onClick={onPin}
        className="anim-in mt-2 flex min-h-[44px] w-full items-center gap-2 rounded-xl bg-[#FFF6DA] px-3 text-left text-sm"
      >
        <span aria-hidden="true">📍</span>
        <span className="min-w-0 flex-1">
          <b>ปักหมุดบ้านด้วย GPS</b> ·
          แผนที่จะรู้ว่าจุดไหนไม่ได้ยินเสียงตามสายแม่นขึ้น
        </span>
        <span aria-hidden="true">›</span>
      </button>
    ) : null;
  }
  return (
    <div id="myhome-speaker" className="card anim-in mt-3 p-3">
      <p className="text-base font-bold">
        📢 เสียงตามสายของหมู่บ้าน ได้ยินที่บ้านไหม?
      </p>
      <p className="text-sm text-[#45504A]">
        ช่วยให้รู้ว่าซอยไหนลำโพงเสีย · ทีมรวบรวมส่งคหบาล
        {sp.all_no ? ` · แจ้งไม่ได้ยินแล้ว ${sp.all_no} หลัง` : ""}
        {sp.answer === "yes" && sp.soi_no > 0
          ? ` · ใน ซ.${info.soi} อีก ${sp.soi_no} หลัง`
          : ""}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={() => answer("yes")}
          disabled={busy}
          aria-pressed={sp.answer === "yes"}
          className={`min-h-[48px] rounded-xl border-2 border-[#B45F06] text-[15px] font-bold disabled:opacity-50 ${sp.answer === "yes" ? "bg-[#B45F06] text-white" : "bg-white text-[#7A4104]"}`}
        >
          🔇 ไม่ได้ยิน / ไม่ชัด
        </button>
        <button
          onClick={() => answer("no")}
          disabled={busy}
          aria-pressed={sp.answer === "no"}
          className={`min-h-[48px] rounded-xl border-2 border-[#1E6B47] text-[15px] font-bold disabled:opacity-50 ${sp.answer === "no" ? "bg-[#1E6B47] text-white" : "bg-white text-[#154D33]"}`}
        >
          🔊 ได้ยินชัด
        </button>
      </div>
      {sp.answer === "yes" && (noting || open) && (
        <div className="anim-in mt-3 space-y-2">
          <p className="text-[15px] font-bold">
            เล่าเพิ่มได้ (ไม่บังคับ) · ทีมส่งต่อให้คหบาล
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SPK_NOTES.map((t) => (
              <button
                key={t}
                onClick={() =>
                  setNote(
                    note.includes(t)
                      ? note
                      : note.trim()
                        ? `${note.trim()} · ${t}`
                        : t,
                  )
                }
                className="chip min-h-[40px] border border-[#D5DBD6] bg-white px-3 text-sm"
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="เช่น ไม่ได้ยินมาตั้งแต่ก่อนโควิด · ลำโพงหน้าซอยไม่ดัง"
            className="w-full rounded-xl border border-[#A9B4AD] p-3 text-base"
          />
          <button
            onClick={saveNote}
            disabled={busy}
            className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50"
          >
            บันทึก
          </button>
        </div>
      )}
      {sp.answer && (
        <button
          onClick={() => {
            setNoting(false);
            onClose();
          }}
          className="mt-1 min-h-[40px] text-sm text-[#45504A] underline"
        >
          ปิด
        </button>
      )}
    </div>
  );
}

// ---------- ⚡ this round of free electrical checks, confirmed from บ้านฉัน in one tap (the house is already known) ----------
function ElectricRound({ info, setErr, onActive, onEditSoi }) {
  const [s, setS] = useState(null);
  const [st, setSt] = useState(null);
  const [edit, setEdit] = useState(false);
  const saved = load(`myContact:${info.house}`, null);
  const [f, setF] = useState(() => ({
    teams: [],
    confirm: false,
    name: saved?.name || load("myName", ""),
    phone: saved?.phone || load("myReach", ""),
  }));
  const [busy, setBusy] = useState(false);
  const [miss, setMiss] = useState("");
  // the contact form stays open while typing (it used to vanish at the 9th digit); closed when both are already known
  const [askContact, setAskContact] = useState(
    () =>
      !(saved?.name || load("myName", "")) ||
      (saved?.phone || load("myReach", "")).replace(/[^\d]/g, "").length < 9,
  );
  useEffect(() => {
    api("/surveys")
      .then((l) => {
        const x = l.find(
          (y) => y.key === "electric" && y.round && (y.teams || []).length,
        );
        setS(x || null);
        onActive && onActive(!!x);
      })
      .catch(() => {});
    api(`/surveys/electric/check?house=${encodeURIComponent(info.house)}`)
      .then((r) => {
        setSt(r);
        if (r.teams?.length) setF((v) => ({ ...v, teams: r.teams }));
      })
      .catch(() => {});
  }, [info.house]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const done = st?.signed && st.round === s.round;
  const label = (k) => (s.teams.find((t) => t.key === k) || {}).label || k;
  const phoneOk = (f.phone || "").replace(/[^\d]/g, "").length >= 9;
  async function send() {
    setErr("");
    setBusy(true);
    try {
      await api("/surveys/electric", {
        method: "POST",
        body: JSON.stringify({
          house: info.house,
          soi: info.soi || "",
          name: f.name,
          phone: f.phone,
          picks: st?.picks || [],
          note: "",
          teams: f.teams,
          confirm: true,
        }),
      });
      save("myReach", f.phone);
      if (f.name) save("myName", f.name);
      save(`myContact:${info.house}`, {
        ...(load(`myContact:${info.house}`, null) || {}),
        name: f.name.trim(),
        phone: f.phone.trim(),
      });
      setAskContact(false);
      setSt({ ...(st || {}), signed: true, round: s.round, teams: f.teams });
      setEdit(false);
      window.dispatchEvent(new Event(MYHOME_CHANGED));
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  if (done && !edit)
    return (
      <Row
        id="myhome-electric-round"
        icon="⚡"
        title={`ตรวจไฟฟรี ${s.round_label}`}
        card
      >
        <div className="anim-in flex items-center gap-2 rounded-2xl bg-[#E4F0E9] p-3">
          <span className="text-2xl" aria-hidden="true">
            ✅
          </span>
          <p className="min-w-0 flex-1 text-[15px] leading-snug">
            <b>ยืนยันคิวแล้ว</b> · {(st.teams || []).map(label).join(" + ")}
            <span className="block text-sm text-[#33403A]">
              อยู่บ้านรอเปิดประตู {s.round_label} · ช่างมาถึงแล้วไม่อยู่จะข้ามไป
            </span>
          </p>
          <button
            onClick={() => setEdit(true)}
            className="min-h-[40px] shrink-0 text-sm font-bold text-[#45504A] underline"
          >
            เปลี่ยน
          </button>
        </div>
      </Row>
    );
  return (
    <Row
      id="myhome-electric-round"
      icon="⚡"
      title={`ตรวจไฟฟรี ${s.round_label} · บ้าน ${info.house} ยืนยันคิวเลย`}
      card="hero"
    >
      <div className="space-y-2">
        {s.teams.map((t) => {
          const on = f.teams.includes(t.key);
          return (
            <button
              key={t.key}
              onClick={() =>
                setF({
                  ...f,
                  teams: on
                    ? f.teams.filter((x) => x !== t.key)
                    : [...f.teams, t.key],
                })
              }
              aria-pressed={on}
              className={`flex min-h-[60px] w-full items-start gap-3 rounded-2xl border-2 p-3 text-left ${on ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
            >
              <span className="mt-0.5 text-lg" aria-hidden="true">
                {on ? "☑" : "☐"}
              </span>
              <span className="min-w-0">
                <b className="block text-base leading-tight">{t.label}</b>
                {t.desc && (
                  <span
                    className={`block text-sm leading-snug ${on ? "text-[#D4EADC]" : "text-[#45504A]"}`}
                  >
                    {t.desc}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <p className="text-sm text-[#45504A]">
          เลือกทีมเดียวหรือทั้งสองทีมก็ได้
        </p>
        {askContact ? (
          <div className="space-y-2 rounded-2xl bg-[#F7F8F6] p-3">
            <p className="text-[15px] font-bold">
              ผู้ติดต่อ (ช่างโทรหาก่อนเข้า)
            </p>
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              autoComplete="name"
              placeholder="ชื่อผู้ติดต่อ เช่น ป้าน้อย *"
              className="min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base"
            />
            <input
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: e.target.value })}
              inputMode="tel"
              autoComplete="tel"
              placeholder="เบอร์โทร เช่น 081 234 5678 *"
              className="min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base"
            />
          </div>
        ) : (
          <p className="text-[15px]">
            📞 ผู้ติดต่อ: <b>{f.name}</b> · {f.phone}{" "}
            <button
              onClick={() => setAskContact(true)}
              className="font-bold text-[#1E6B47] underline"
            >
              แก้
            </button>
          </p>
        )}
        <label
          className={`flex min-h-[52px] items-center gap-3 rounded-xl border-2 p-3 ${f.confirm ? "border-[#1E6B47] bg-[#E4F0E9]" : "border-[#E0A100] bg-white"}`}
        >
          <input
            type="checkbox"
            checked={f.confirm}
            onChange={(e) => setF({ ...f, confirm: e.target.checked })}
            className="h-5 w-5 accent-[#1E6B47]"
          />
          <b className="text-[15px] leading-snug">
            อยู่บ้านรอเปิดประตู {s.round_label}
          </b>
        </label>
        {miss && (
          <p className="anim-in rounded-xl bg-[#FDE8E6] p-2.5 text-[15px] font-bold text-[#B42318]">
            {miss}
          </p>
        )}
        <button
          onClick={() => {
            // say what is missing instead of a button that silently does nothing
            const m = !f.teams.length
              ? "☝️ เลือกทีมช่างก่อน (แตะกล่องทีมด้านบน)"
              : !(f.name || "").trim()
                ? "☝️ ใส่ชื่อผู้ติดต่อ"
                : !phoneOk
                  ? "☝️ ใส่เบอร์โทรให้ครบ (9–10 หลัก)"
                  : !f.confirm
                    ? "☝️ ติ๊ก “อยู่บ้านรอเปิดประตู” ก่อน"
                    : "";
            setMiss(m);
            if (!m) send();
          }}
          disabled={busy}
          className="min-h-[54px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-40"
        >
          {busy ? "กำลังส่ง…" : `✅ ยืนยันคิว บ้าน ${info.house}`}
        </button>
        {info && (
          <p className="text-sm text-[#45504A]">
            ซอย {info.soi || "?"}{" "}
            <button
              onClick={onEditSoi}
              className="font-bold text-[#1E6B47] underline"
            >
              ซอยไม่ถูก? แก้
            </button>
          </p>
        )}
      </div>
    </Row>
  );
}

// ---------- the electrical check: what now for the houses the Ministry team didn't reach ----------
// 7 Oct: only "still interested" (free) or "not any more" (fine); group / hired are older answers, still shown
const WANTS = {
  free: [
    "ยังสนใจ ให้ช่างฟรีมาตรวจ",
    "ถ้าทีมช่างกลับมา ทีมอาสาจะติดต่อก่อนเข้า",
  ],
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
    .filter(
      (x) =>
        cats.includes(x.category) &&
        x.available !== false &&
        x.redflag?.level !== "hidden",
    ) // 28 Oct: 🚩 folded ones only on the ช่าง page
    .sort(
      (a, b) =>
        goodOf(b) - goodOf(a) ||
        (a.reports || 0) - (b.reports || 0) ||
        b.verified - a.verified ||
        b.pinned - a.pinned,
    );
  const list = more ? all_ : all_.slice(0, 5);
  return (
    <div className="space-y-2 rounded-2xl bg-[#F2F4F1] p-3">
      <p className="text-[15px] font-bold">
        {title}{" "}
        {all_.length > 0 && (
          <span className="font-normal text-[#45504A]">
            · {all_.length} ราย
          </span>
        )}
      </p>
      {list.length ? (
        <ul className="space-y-2">
          {list.map((x) => {
            const digits = (x.phone || "").replace(/[^\d]/g, "");
            const good = goodOf(x);
            return (
              <li
                key={x.id}
                className="flex items-center gap-3 rounded-xl bg-white p-3"
              >
                <MediaThumb media={x.media || []} />
                <div className="min-w-0 flex-1">
                  <b className="block text-base leading-snug">{x.name}</b>
                  {x.detail && (
                    <p className="line-clamp-1 text-sm text-[#33403A]">
                      {x.detail}
                    </p>
                  )}
                  <p
                    className={`text-sm ${good ? "font-bold text-[#1E6B47]" : "text-[#45504A]"}`}
                  >
                    {good ? `👍 เพื่อนบ้านแนะนำ ${good} คน` : "ยังไม่มีคนแนะนำ"}
                    {x.reports > 0 ? (
                      <span className="font-normal text-[#B42318]">
                        {" "}
                        · โทรไม่ติด {x.reports}
                      </span>
                    ) : (
                      ""
                    )}
                  </p>
                  {digits.length < 9 && x.phone && (
                    <p className="text-[15px]">ติดต่อ: {x.phone}</p>
                  )}
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
        <button
          onClick={() => setMore(true)}
          className="min-h-[46px] w-full rounded-xl bg-white text-[15px] font-bold text-[#154D33]"
        >
          ดูอีก {all_.length - list.length} ราย ▾
        </button>
      )}
      <button
        onClick={onAll}
        className="min-h-[46px] w-full rounded-xl border border-[#C9D1CB] bg-white text-[15px] font-bold"
      >
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
      none={t(
        "myhome.electric.private_none",
        "ยังไม่มีในระบบ · ถ้ารู้จักช่างไฟดีๆ แนะนำให้เพื่อนบ้านได้",
      )}
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
    <div
      className="mt-2 space-y-2"
      role="status"
      aria-label={t("myhome.soon.title", "เร็วๆ นี้ที่บ้านคุณ")}
    >
      {shown.map((x) => (
        <div key={x.id} className="card flex items-center gap-3 p-3">
          <span className="ic ic-amber" aria-hidden="true">
            {x.icon}
          </span>
          <div className="min-w-0 flex-1">
            <span
              className={`mr-1.5 inline-block rounded-full px-2 py-0.5 text-sm font-bold ${x.when === "วันนี้" ? "bg-[#B42318] text-white" : "bg-[#15201A] text-white"}`}
            >
              {x.when}
            </span>
            <span className="text-base font-bold leading-snug">{x.text}</span>
            <MediaStrip media={x.media || []} size={64} />
            <button
              onClick={() => ok(x.id)}
              className="mt-0.5 block min-h-[36px] text-sm font-bold text-[#45504A] underline"
            >
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
  return need ? (
    <span className="ml-1 rounded bg-[#FDE8E6] px-1.5 text-xs font-bold text-[#B42318]">
      จำเป็น
    </span>
  ) : (
    <span className="ml-1 text-xs font-normal text-[#45504A]">ไม่บังคับ</span>
  );
}
function ContactForm({ contact, setContact, onSave }) {
  const t = useT();
  const [more, setMore] = useState(!!(contact.email || contact.ig));
  const f = (k) => ({
    value: contact[k] || "",
    onChange: (e) => setContact({ ...contact, [k]: e.target.value }),
  });
  const ok =
    (contact.name || "").trim() &&
    ((contact.phone || "").trim() || (contact.line_id || "").trim());
  const box =
    "min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base";
  return (
    <form
      onSubmit={onSave}
      className="space-y-3 rounded-2xl border-2 border-[#1E6B47] bg-white p-3"
    >
      <p className="text-[15px] font-bold text-[#154D33]">
        {t(
          `myhome.contact.why_${contact.from || "news"}`,
          CONTACT_WHY[contact.from] || CONTACT_WHY.news,
        )}
      </p>
      <label className="block">
        <span className="text-[15px] font-bold">
          ชื่อเรียก
          <Need need />
        </span>
        <input
          {...f("name")}
          placeholder="ชื่อเล่นก็ได้ เช่น ป้าน้อย"
          className={box}
          autoComplete="name"
        />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-[15px] font-bold">
          ติดต่อทางไหน
          <span className="ml-1 rounded bg-[#FDE8E6] px-1.5 text-xs font-bold text-[#B42318]">
            ใส่อย่างน้อย 1 ช่อง
          </span>
        </legend>
        <input
          {...f("phone")}
          placeholder="เบอร์โทร เช่น 081 234 5678"
          inputMode="tel"
          autoComplete="tel"
          className={box}
          aria-label="เบอร์โทร"
        />
        <input
          {...f("line_id")}
          placeholder="หรือ LINE ID"
          className={box}
          aria-label="LINE ID"
        />
      </fieldset>
      {more ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-sm font-bold">
              อีเมล
              <Need />
            </span>
            <input
              {...f("email")}
              inputMode="email"
              autoComplete="email"
              className={box}
            />
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
        <button
          type="button"
          onClick={() => setMore(true)}
          className="min-h-[44px] text-[15px] font-bold text-[#45504A] underline"
        >
          + เพิ่มอีเมล / IG / Facebook (ไม่บังคับ)
        </button>
      )}
      <fieldset>
        <legend className="text-[15px] font-bold">
          ในบ้านมี
          <span className="ml-1 text-xs font-normal text-[#45504A]">
            ไม่บังคับ · ทีมใช้ดูแลก่อนตอนเกิดเหตุ
          </span>
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
                onClick={() =>
                  setContact({
                    ...contact,
                    vulnerable: on
                      ? contact.vulnerable.filter((x) => x !== k)
                      : [...(contact.vulnerable || []), k],
                  })
                }
                className={`min-h-[44px] rounded-full border-2 px-3 text-[15px] font-bold ${on ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>
      <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={contact.news !== false}
          onChange={(e) => setContact({ ...contact, news: e.target.checked })}
          className="h-5 w-5 accent-[#1E6B47]"
        />
        ส่งข่าวด่วนของหมู่บ้านให้ฉันด้วย
      </label>
      <p className="text-sm text-[#45504A]">
        🔒 ทีมอาสาเห็นเท่านั้น ไม่แสดงบนเว็บ
      </p>
      <div className="flex gap-2">
        <button
          disabled={!ok}
          className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-40"
        >
          บันทึก
        </button>
        <button
          type="button"
          onClick={() => setContact(null)}
          className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}

// ---------- settled things fold into one strip at the foot of the card; a tap opens one back where it was ----------
function Settled({ items, onOpen }) {
  const prev = useRef(null);
  const ref = useRef(null);
  const keys = items.map((x) => x.key).join(",");
  const fresh =
    prev.current === null
      ? []
      : items.filter((x) => !prev.current.includes(x.key)).map((x) => x.key);
  useEffect(() => {
    if (prev.current !== null && fresh.length && ref.current) {
      ref.current.classList.remove("anim-fresh");
      void ref.current.offsetWidth;
      ref.current.classList.add("anim-fresh");
      notify("เก็บไว้ที่ “เรื่องที่ตอบแล้ว” ท้ายการ์ด · แตะเพื่อเปิดอีกครั้ง");
    }
    prev.current = items.map((x) => x.key);
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items.length) return null;
  return (
    <div ref={ref} className="rounded-xl border-t border-[#E6EBE7] py-3">
      <p className="text-sm font-bold text-[#45504A]">
        เรื่องที่ตอบแล้ว · แตะเพื่อดูหรือเปลี่ยน
      </p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {items.map((x) => (
          <button
            key={x.key}
            onClick={() => onOpen(x.key)}
            className={`${fresh.includes(x.key) ? "anim-pop " : ""}flex min-h-[44px] max-w-full items-center gap-1.5 rounded-full border border-[#C9D1CB] bg-[#F2F4F1] px-3.5 text-[15px] active:bg-[#E4F0E9]`}
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
function QuestionRow({
  q,
  info,
  services,
  onAnswered,
  onPros,
  onIssue,
  onAsk,
  setErr,
  onFold,
}) {
  const [again, setAgain] = useState(false);
  const t = useT();
  async function answer(a) {
    setErr("");
    try {
      onAnswered(
        await api("/myhome/answer", {
          method: "POST",
          body: JSON.stringify({ house: info.house, qid: q.id, answer: a }),
        }),
      );
      setAgain(false);
    } catch (e) {
      setErr(e.message);
    }
  }
  const group = PRO_GROUPS.find((g) => g.key === q.group);
  const open = !q.answer || again;
  return (
    <Row
      id={`myhome-${q.id}`}
      icon={q.icon}
      title={q.q}
      hi={open}
      onFold={q.answer === "no" && !again ? onFold : null}
    >
      {open && (
        <p className="-mt-1 text-sm text-[#7A4104]">
          {t("myhome.q.from", "คำถามจากทีมอาสา · กดตอบครั้งเดียว")}
        </p>
      )}
      <MediaStrip media={q.media || []} />
      {q.answer === "no" && !again ? (
        <div className="flex items-center gap-2 rounded-2xl bg-[#E4F0E9] p-3">
          <p className="min-w-0 flex-1 text-[15px] font-bold text-[#154D33]">
            คุณตอบ: {q.no}
          </p>
          <button
            onClick={() => setAgain(true)}
            className="min-h-[44px] shrink-0 rounded-xl border border-[#C9D1CB] bg-white px-3 text-[15px] font-bold"
          >
            เปลี่ยนคำตอบ
          </button>
        </div>
      ) : q.answer === "yes" && !again ? (
        <>
          {q.tip && (
            <p className="whitespace-pre-line text-[15px] leading-relaxed">
              {q.tip}
            </p>
          )}
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
            <button
              onClick={onIssue}
              className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white"
            >
              ส่งเรื่องให้สำนักงานหมู่บ้าน (ถ่ายรูปได้)
            </button>
          )}
          {q.action === "ask" && (
            <button
              onClick={onAsk}
              className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-[15px] font-bold text-white"
            >
              🙏 ฝากเพื่อนบ้านใกล้ๆ ช่วย
            </button>
          )}
          <button
            onClick={() => answer("no")}
            className="min-h-[48px] w-full rounded-xl border-2 border-[#1E6B47] bg-white text-[15px] font-bold text-[#154D33]"
          >
            ✓ {q.done}
          </button>
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => answer("yes")}
            className="min-h-[52px] rounded-xl border-2 border-[#B45F06] bg-white px-2 text-base font-bold text-[#7A4104]"
          >
            {q.yes}
          </button>
          <button
            onClick={() => answer("no")}
            className="min-h-[52px] rounded-xl border-2 border-[#1E6B47] bg-white px-2 text-base font-bold text-[#154D33]"
          >
            {q.no}
          </button>
        </div>
      )}
    </Row>
  );
}

function ElectricRow({
  info,
  services,
  onSaved,
  onElectricians,
  onContact,
  contactSlot,
  setErr,
  onFold,
  onSent,
}) {
  const e = info.electric;
  const [pick, setPick] = useState(false); // choosing again
  const sorted = e.want && e.want !== "free" && !pick;
  const deciding = !e.want || pick;
  const [safe, setSafe] = useState(false);
  const [ticks, setTicks] = useState(() => load(`safe:${info.house}`, []));
  async function send(want) {
    setErr("");
    try {
      onSaved(
        await api("/myhome/electric", {
          method: "POST",
          body: JSON.stringify({ house: info.house, want, slots: [] }),
        }),
      );
      setPick(false);
      onSent && onSent(want);
      window.dispatchEvent(new Event("myhome:electric"));
    } catch (x) {
      setErr(x.message);
    }
  }
  const t = useT();
  const tick = (i) => {
    const next = ticks.includes(i)
      ? ticks.filter((x) => x !== i)
      : [...ticks, i];
    setTicks(next);
    save(`safe:${info.house}`, next);
  };

  if (e.status === "done")
    return (
      <Row
        id="myhome-electric"
        icon="⚡"
        title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")}
        onFold={onFold}
      >
        <p className="text-base font-bold text-[#1E6B47]">
          ช่างตรวจบ้านนี้แล้ว
        </p>
      </Row>
    );

  return (
    <Row
      id="myhome-electric"
      icon="⚡"
      title={t("myhome.electric.title", "ตรวจไฟฟ้าหลังน้ำท่วม")}
      onFold={sorted ? onFold : null}
    >
      {deciding && (
        <p
          className={`text-base font-bold ${e.signed ? ELECTRIC[e.status]?.[1] || "" : ""}`}
        >
          {e.signed
            ? ELECTRIC[e.status]?.[0] || "ลงชื่อไว้แล้ว"
            : "บ้านนี้ยังไม่ได้ตรวจไฟ"}
        </p>
      )}
      {deciding && (
        <p className="text-[15px] text-[#33403A]">
          {info.soi && e.soi_waiting > 0
            ? `ใน ซ.${info.soi} ยังรอช่างอีก ${e.soi_waiting} หลัง`
            : `ทั้งหมู่บ้านยังรอช่างอีก ${e.village_waiting} หลัง`}
        </p>
      )}

      {e.want && !pick ? (
        <div className="rounded-2xl bg-[#E4F0E9] p-3">
          <p className="text-[15px] font-bold text-[#154D33]">
            คุณเลือก: {WANTS[e.want][0]}
          </p>
          {WANTS[e.want][1] && (
            <p className="text-sm text-[#33403A]">{WANTS[e.want][1]}</p>
          )}
          <div className="mt-2 flex gap-2">
            {e.want === "free" && !info.has_contact && !contactSlot && (
              <button
                onClick={onContact}
                className="min-h-[46px] flex-1 rounded-xl bg-[#1E6B47] px-2 text-[15px] font-bold text-white"
              >
                {t("myhome.electric.leave_contact", "ฝากเบอร์ให้ทีมแจ้ง")}
              </button>
            )}
            <button
              onClick={() => setPick(true)}
              className="min-h-[46px] rounded-xl border border-[#C9D1CB] bg-white px-4 text-[15px] font-bold"
            >
              เปลี่ยนคำตอบ
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[15px] font-bold">
            {t(
              "myhome.electric.now",
              "ถ้าทีมช่างฟรีกลับมา ยังสนใจให้มาตรวจไหม",
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => send("free")}
              className="min-h-[56px] rounded-xl border-2 border-[#1E6B47] bg-white px-2 text-base font-bold leading-tight text-[#154D33]"
            >
              {t("myhome.electric.yes", "ยังสนใจ")}
            </button>
            <button
              onClick={() => send("fine")}
              className="min-h-[56px] rounded-xl border-2 border-[#C9D1CB] bg-white px-2 text-base font-bold leading-tight"
            >
              {t("myhome.electric.no", "ไม่สนใจแล้ว")}
            </button>
          </div>
          {pick && (
            <button
              onClick={() => setPick(null)}
              className="min-h-[44px] w-full text-[15px] font-bold text-[#45504A] underline"
            >
              ยกเลิก
            </button>
          )}
        </div>
      )}

      {contactSlot}

      {sorted && <Electricians services={services} onAll={onElectricians} />}

      {!sorted && (
        <>
          <button
            onClick={() => setSafe((v) => !v)}
            aria-expanded={safe}
            className="min-h-[48px] w-full rounded-xl bg-[#FFF6DA] px-3 text-left text-[15px] font-bold"
          >
            {t(
              "myhome.electric.safe",
              "ระหว่างรอ: เช็กความปลอดภัย · เบอร์ช่าง",
            )}{" "}
            {ticks.length ? `(${ticks.length}/5)` : ""}{" "}
            <span aria-hidden="true">{safe ? "▴" : "▾"}</span>
          </button>
          {safe && (
            <ul className="space-y-1.5">
              {SAFE.map((line, i) => (
                <li key={i}>
                  <label className="flex min-h-[48px] items-start gap-3 rounded-xl border border-[#DCE2DD] bg-white p-3 text-[15px] leading-snug">
                    <input
                      type="checkbox"
                      checked={ticks.includes(i)}
                      onChange={() => tick(i)}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[#1E6B47]"
                    />
                    {line}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {safe && (
            <button
              onClick={onElectricians}
              className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] text-[15px] font-bold"
            >
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
  if (info.checkin && !info.checkin.mine)
    important.push(`🆘 ${info.checkin.title} · ยังไม่ได้ตอบ`);
  for (const x of fresh)
    (x.when === "วันนี้" || x.id.startsWith("aid_") ? important : general).push(
      `${x.icon || "📅"} ${x.when}: ${x.text}`,
    );
  for (const q of info.questions || [])
    if (!q.answer) general.push(`${q.icon || "❓"} คำถามจากทีม: ${q.q}`);
  if (info.handy_wanted > 0)
    general.push(
      `🤝 มีคนอยากให้ช่วยเรื่องที่คุณถนัด ${info.handy_wanted} เรื่อง`,
    );
  const reasons = [...important, ...general];
  if (!reasons.length) return null;
  return {
    level: important.length ? "important" : "general",
    reasons,
    sig: reasons.join("|"),
  };
}

// the rubbish days in the header: today's in big dark green with "วันนี้", tomorrow's marked too — stays even after รับทราบ
const THAI_DAYS = [
  "อาทิตย์",
  "จันทร์",
  "อังคาร",
  "พุธ",
  "พฤหัส",
  "ศุกร์",
  "เสาร์",
]; // Date.getUTCDay() order
// 18 Oct: trucks off the rounds while the flood rubbish is cleared (settings waste.irregular, until a date)
function WasteOff({ off, days }) {
  const [, m, d] = off.until.split("-").map(Number);
  const months = [
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ];
  return (
    <span className="block">
      <b className="text-[#8A4B00]">⚠️ ช่วงนี้ไม่ตรงวัน</b>
      <span className="block text-sm text-[#5C3B00]">
        {off.text} · คาดว่ากลับมาปกติราว {d} {months[m - 1]}
      </span>
      {days && (
        <span className="block text-sm text-[#45504A]">ตารางปกติ: {days}</span>
      )}
    </span>
  );
}

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
        <span className="whitespace-nowrap rounded-md bg-[#E4F0E9] px-1.5 text-lg font-extrabold text-[#154D33]">
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

// ---------- 🛍️ ตลาดเพื่อนบ้าน: one line with the newest photos → เพื่อนบ้าน › ตลาด ----------
function MarketRow({ items, onOpen }) {
  const pics = [...items]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .filter((x) => x.media?.[0])
    .slice(0, 3);
  return (
    <button
      onClick={onOpen}
      className="card mt-2 flex min-h-[60px] w-full items-center gap-2.5 p-2 pr-3 text-left text-[15px]"
    >
      <span className="ic ic-sm ic-amber" aria-hidden="true">
        🛍️
      </span>
      <span className="min-w-0 flex-1">
        <b>ตลาดเพื่อนบ้าน</b> · {items.length} รายการ
      </span>
      {pics.map((x) => (
        <img
          key={x.id}
          src={mediaUrl(x.media[0].id, "thumb")}
          alt=""
          loading="lazy"
          className="h-10 w-10 shrink-0 rounded-lg bg-[#F2F4F1] object-cover"
        />
      ))}
      <span className="shrink-0 font-bold text-[#7A4104]">ดู ›</span>
    </button>
  );
}

// ---------- 💬 the LINE OA @004forpb: opens the chat with "บ้าน 4/917" already typed (the bot links it). Once this phone has
// sent it, or came from a bot link with ?home=, the card just opens the chat — a ?home= link alone doesn't prove LINE knows the house ----------
function LineLinkCard({ house }) {
  const done = load("lineHouse", "") === house;
  const href = `https://line.me/R/oaMessage/@004forpb/?${encodeURIComponent(`บ้าน ${house}`)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => save("lineHouse", house)}
      className="card mt-2 flex min-h-[60px] items-center gap-3 px-4 py-2"
    >
      <span
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#06C755] text-xl text-white"
        aria-hidden="true"
      >
        💬
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-base leading-tight">
          {done ? "แชท LINE หมู่บ้าน @004forpb" : `ผูกบ้าน ${house} กับ LINE`}
        </b>
        <span className="block text-sm text-[#45504A]">
          {done
            ? "ถามวันรถขยะ แจ้งหาย ขายของ ได้ในแชท"
            : "กดแล้วกดส่งข้อความที่พิมพ์ไว้ให้ · LINE จะบอกวันรถขยะของซอยคุณ"}
        </span>
      </span>
      <span className="text-xl text-[#45504A]" aria-hidden="true">
        ›
      </span>
    </a>
  );
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
  const toggle = (k) =>
    setF({
      ...f,
      skills: f.skills.includes(k)
        ? f.skills.filter((x) => x !== k)
        : [...f.skills, k],
    });
  async function save_() {
    setErr("");
    try {
      const r = await api("/myhome/handy", {
        method: "POST",
        body: JSON.stringify({ house, ...f }),
      });
      save("myName", f.name);
      if (f.phone) save("myReach", f.phone);
      onSaved(r);
    } catch (e) {
      setErr(e.message);
    }
  }
  const box =
    "min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base";
  return (
    <div id="myhome-handy" className="space-y-3 border-t border-[#E6EBE7] py-3">
      <div>
        <p className="text-base font-bold">
          🤝 อาสาข้างบ้าน · คุณช่วยเพื่อนบ้านเรื่องไหนได้
        </p>
        <p className="text-sm text-[#45504A]">
          บ้านที่มีแต่ผู้สูงอายุหรือผู้หญิง ซ่อมของเองไม่ได้ จะขอให้ช่วยได้
          คำขอที่ตรงกับที่คุณถนัดจะขึ้นในบ้านฉันของคุณ ช่วยได้ก็กดรับ
          ไม่ว่างก็ข้ามได้ ไม่มีบังคับ
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
      <input
        value={f.name}
        onChange={(e) => setF({ ...f, name: e.target.value })}
        placeholder="ชื่อเรียก (เพื่อนบ้านเห็น)"
        className={box}
      />
      <input
        value={f.phone}
        onChange={(e) => setF({ ...f, phone: e.target.value })}
        placeholder="เบอร์ / LINE (คนขอจะเห็นเมื่อคุณกดรับช่วยเท่านั้น)"
        inputMode="tel"
        className={box}
      />
      <input
        value={f.note}
        onChange={(e) => setF({ ...f, note: e.target.value })}
        placeholder="ว่างช่วงไหน เช่น เย็นๆ / เสาร์อาทิตย์ (ไม่บังคับ)"
        className={box}
      />
      {handy && (
        <label className="flex min-h-[44px] items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={!f.on}
            onChange={(e) => setF({ ...f, on: !e.target.checked })}
            className="h-5 w-5 accent-[#1E6B47]"
          />
          พักไว้ก่อน (ไม่ต้องเห็นคำขอช่วงนี้)
        </label>
      )}
      <div className="flex gap-2">
        <button
          onClick={save_}
          disabled={!f.name.trim() || !f.skills.length}
          className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-40"
        >
          บันทึก
        </button>
        <button
          onClick={onClose}
          className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold"
        >
          ปิด
        </button>
      </div>
    </div>
  );
}

export default function MyHome({
  water,
  services,
  look,
  onIssue,
  onIssues,
  onWaste,
  onElectricians,
  onPros,
  onBadge,
  needs = [],
  lost = [],
  flood = true,
  floodAlarm = false,
  onNeeds,
  onAskHelp,
  onLost,
  onLostPosted,
  market = [],
  onMarket,
}) {
  // a ขอแรง ask this house's อาสาข้างบ้าน profile can do (job type → skill)
  const JOB_SKILL = {
    clean: "strong",
    move: "strong",
    trash: "strong",
    fix: "fix",
    check: "elec",
    ride: "drive",
    errand: "errand",
  };
  const fits = (j) =>
    handy?.on && (handy.skills || []).includes(JOB_SKILL[j.type]) ? 1 : 0;
  const fromSurvey = load("survey:electric", null)?.house || "";
  const [house, setHouse] = useState(
    () => takeFamilyParam() || load("myHouse", "") || fromSurvey,
  );
  const [houses, setHouses] = useState(() => load("myHouses", []));
  const [outageOpen, setOutageOpen] = useState(false);
  const reload = () => setReloadN((n) => n + 1);
  const [typing, setTyping] = useState(!house);
  const [, setFloodPref] = useFloodTools();
  const [infoOpen, setInfoOpen] = useState(false); // the house panel (soi, pin, rubbish days, เสียงตามสาย)
  const [spkOpen, setSpkOpen] = useState(false); // เสียงตามสาย: the chip by the house number opens the question again
  const [spkDraft, setSpkDraft] = useState(""); // words typed in a map report about the loudspeaker → the house's note
  useEffect(() => {
    // "ไม่ได้ยินเสียงตามสาย" from the report sheet / the map: open the question here and bring it into view
    const show = (e) =>
      findCard("myhome-speaker", () => {
        setSpkDraft(e.detail || "");
        setSpkOpen(true);
      });
    window.addEventListener("speaker:open", show);
    return () => window.removeEventListener("speaker:open", show);
  }, []);
  const [input, setInput] = useState(house || "");
  const [info, setInfo] = useState(null);
  const [reloadN, setReloadN] = useState(0);
  const [handy, setHandy] = useState(null); // this house's อาสาข้างบ้าน profile
  const [roundOn, setRoundOn] = useState(false);
  // 10 Oct: the electric check is over when the team switches the sign-up off (site.py survey off electric) → no electric rows at all
  const [elOn, setElOn] = useState(false);
  useEffect(() => {
    api("/surveys")
      .then((l) => setElOn(l.some((x) => x.key === "electric")))
      .catch(() => {});
  }, []);
  // หาย·เจอ in บ้านฉัน: only the newest few (2 weeks at most); the rest live on the หาย·เจอ page
  const lostNew = useMemo(
    () =>
      [...lost]
        .filter(
          (x) => Date.now() - new Date(x.created_at).getTime() < 14 * 864e5,
        )
        .sort((x, y) =>
          String(y.created_at).localeCompare(String(x.created_at)),
        )
        .slice(0, 5),
    [lost],
  );
  const [soiEdit, setSoiEdit] = useState(false); // the soi guessed from the house number can be fixed in one step
  const [soiAsked, setSoiAsked] = useState(() => load("soiAsked", [])); // houses this phone already asked about // a dated electrical round is open: it replaces the old follow-up row
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
    if (err)
      errRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [err]);
  const [opened, setOpened] = useState([]); // settled sections opened again by a tap (or just answered)
  const openIt = (k) => setOpened((o) => (o.includes(k) ? o : [...o, k]));
  const foldIt = (k) => setOpened((o) => o.filter((x) => x !== k));
  const [pinning, setPinning] = useState(null); // {pos, soi, touched} while the map is open
  // the soi follows the pin as it is dragged (unless the owner typed one)
  const pinKey = pinning?.pos ? `${pinning.pos.lat},${pinning.pos.lng}` : "";
  useEffect(() => {
    if (!pinKey || pinning?.soiTyped || !pinning?.touched) return; // only once the owner moved the pin (drag / GPS)
    const t = setTimeout(() => {
      const [lat, lng] = pinKey.split(",");
      api(`/myhome/soi-at?lat=${lat}&lng=${lng}`)
        .then(
          (r) =>
            r.soi &&
            setPinning((p) => (p && !p.soiTyped ? { ...p, soi: r.soi } : p)),
        )
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [pinKey, pinning?.touched]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!house) return;
    api(`/myhome?house=${encodeURIComponent(house)}`)
      .then((d) => {
        setInfo(d);
        save("myHouse", d.house);
        setHouses((list) => {
          if (list.some((x) => x.house === d.house)) return list;
          const next = [
            ...list.filter((x) => x.label !== "บ้านฉัน"),
            { house: d.house, label: "บ้านฉัน" },
          ];
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
        body: JSON.stringify({
          lat: info.lat,
          lng: info.lng,
          level: w.level,
          where: w.where,
          name: `บ้าน ${info.house}`,
          note: info.soi ? `ซ.${info.soi}` : "",
        }),
      });
      setSent(w.label);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function savePin() {
    setErr("");
    try {
      const d = await api("/myhome/pin", {
        method: "POST",
        body: JSON.stringify({
          house: info.house,
          lat: pinning.pos.lat,
          lng: pinning.pos.lng,
          soi: pinning.soi || "",
        }),
      });
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
      await api("/myhome/contact", {
        method: "POST",
        body: JSON.stringify({ ...body, house: info.house }),
      });
      save(`myContact:${info.house}`, body);
      if (body.name) save("myName", body.name.trim());
      if (body.phone || body.line_id)
        save("myReach", (body.phone || body.line_id).trim());
      setContact(null);
      setInfo((i) => ({ ...i, has_contact: true }));
    } catch (e2) {
      setErr(e2.message);
    }
  }

  const t = useT();
  const frame = look?.frame;
  const savedContact = info ? load(`myContact:${info.house}`, null) : null;
  const startNear = (kind) => {
    setNearForm({
      kind,
      topic: "",
      text: "",
      name: load("myName", ""),
      phone: kind === "ask" ? load("myReach", "") : "",
      to_office: true,
    });
    setTimeout(
      () =>
        nearRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  };
  const el = info?.electric;
  const elSettled =
    !!el && (el.status === "done" || (el.want && el.want !== "free"));
  const elWant = {
    fine: "ไม่สนใจแล้ว",
    hired: "จ้างช่างเองแล้ว",
    group: "รวมกลุ่มจ้างช่าง",
  };
  const settled = !info
    ? []
    : [
        ...(info.questions || [])
          .filter((q) => q.answer === "no" && !opened.includes(q.id))
          .map((q) => ({
            key: q.id,
            icon: q.icon,
            label: q.short || (q.q.length > 22 ? q.q.slice(0, 20) + "…" : q.q),
            answer: q.no,
          })),
        ...(elOn && elSettled && !opened.includes("electric")
          ? [
              {
                key: "electric",
                icon: "⚡",
                label: "ตรวจไฟ",
                answer:
                  el.status === "done"
                    ? "ช่างตรวจแล้ว"
                    : elWant[el.want] || "ตอบแล้ว",
              },
            ]
          : []),
      ];
  for (const a of info?.aid || [])
    if (a.mine === "received")
      settled.push({
        key: `aid_${a.id}`,
        icon: "💰",
        label: a.title.length > 18 ? a.title.slice(0, 16) + "…" : a.title,
        answer: "ได้เงินแล้ว",
      });
  const isFolded = (k) => settled.some((x) => x.key === k);
  if (typing || !house)
    return (
      <section
        className="mb-3 overflow-hidden rounded-[20px] border-2 border-[#1E6B47] bg-white"
        style={frame}
      >
        <div className="bg-[#E4F0E9] px-4 pb-3 pt-4">
          <h2 className="font-display text-2xl font-bold">🏠 บ้านฉัน</h2>
          <p className="text-base text-[#154D33]">
            {t(
              "myhome.intro",
              "ใส่บ้านเลขที่ครั้งเดียว แล้วรู้เรื่องของบ้านคุณทันที",
            )}
          </p>
        </div>
        <div className="px-4 pb-4 pt-3">
          <ul className="space-y-1 text-base">
            {[
              ["💰", "เงินเยียวยาน้ำท่วมที่บ้านคุณขอได้"],
              ["🚛", "วันรถขยะซอยคุณ"],
              ["⚡", "ไฟดับ น้ำไม่ไหลแถวบ้าน"],
              ["📍", "ปัญหาในซอยคุณ"],
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
              if (!/^\d{1,3}\/\d{1,5}/.test(h))
                return setErr("ใส่บ้านเลขที่ เช่น 4/917 หรือพิมพ์แค่ 917");
              setErr("");
              setTyping(false);
              if (h === house) return setReloadN((n) => n + 1); // same house again: keep what's on screen, just refresh
              setInfo(null);
              setHouse(h);
            }}
          >
            <label className="min-w-0 flex-1">
              <span className="sr-only">บ้านเลขที่</span>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                inputMode="text"
                autoComplete="off"
                id="myhome-house-input"
                placeholder="เช่น 917"
                className="min-h-[56px] w-full rounded-xl border-2 border-[#A9B4AD] px-3.5 text-xl focus:border-[#1E6B47] focus:outline-none"
              />
            </label>
            <button className="min-h-[56px] shrink-0 rounded-xl bg-[#1E6B47] px-5 text-lg font-bold text-white">
              ดูบ้านฉัน ›
            </button>
          </form>
          {err && (
            <p
              role="alert"
              className="mt-2 rounded-xl bg-red-50 p-3 text-red-700"
            >
              {err}
            </p>
          )}
          <p className="mt-2 text-sm text-[#45504A]">
            🔒 ไม่ต้องสมัคร ไม่ต้องใส่ชื่อ · มือถือเครื่องนี้จำไว้ให้
          </p>
          {house && (
            <button
              type="button"
              onClick={() => setTyping(false)}
              className="mt-1 min-h-[40px] text-[15px] font-bold text-[#45504A] underline"
            >
              ยกเลิก กลับไปบ้าน {house}
            </button>
          )}
        </div>
      </section>
    );

  return (
    <section
      className={
        info && !typing
          ? "mb-3 px-1"
          : "mb-3 rounded-[20px] border border-[#DCE2DD] bg-white px-4 pt-4"
      }
      style={frame}
    >
      <div className="flex items-end gap-3">
        <h2 className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold tracking-wide text-[#5A665F]">
            {houses.find((x) => x.house === (info?.house || house))?.label ||
              "บ้านฉัน"}
          </span>
          <span className="font-display block text-[30px] font-bold leading-tight">
            {info?.house || house}
          </span>
        </h2>
        <button
          onClick={() => {
            setInput(house);
            setTyping(true);
          }}
          className="min-h-[44px] shrink-0 text-[15px] font-bold text-[#1E6B47]"
        >
          เปลี่ยนบ้าน
        </button>
      </div>
      {houses.length > 1 && (
        <div
          className="-mx-4 mt-1 flex gap-2 overflow-x-auto px-4 pb-1"
          aria-label="บ้านที่ติดตาม"
        >
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
        <div
          className={`mt-1.5 rounded-2xl border-2 border-[#1E6B47] bg-[#EEF5F0] p-1.5 ${infoOpen ? "pb-2" : ""}`}
        >
          {/* 9 Oct: one quiet summary line; tap it for the house panel where everything is edited */}
          <button
            onClick={() => setInfoOpen((v) => !v)}
            aria-expanded={infoOpen}
            className="flex min-h-[44px] w-full items-center gap-1.5 rounded-xl pl-1.5 text-left text-[15px] text-[#33403A]"
          >
            <span className="min-w-0 flex-1 truncate">
              {info.soi ? `ซ.${info.soi}` : "ยังไม่รู้ซอย"}
              {info.waste && (
                <span>
                  {" "}
                  · 🚛{" "}
                  {info.waste.irregular
                    ? "ไม่ตรงวัน (ช่วงเคลียร์ขยะ)"
                    : info.waste.days}
                </span>
              )}
              {info.speaker?.answer && (
                <span>
                  {" "}
                  ·{" "}
                  {info.speaker.answer === "yes"
                    ? "🔇 ไม่ได้ยินเสียงตามสาย"
                    : "📢 ได้ยิน"}
                </span>
              )}
              {info.precision !== "house" && (
                <span className="text-[#7A4104]"> · ยังไม่ปักหมุด</span>
              )}
            </span>
            <span
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-bold ${infoOpen ? "bg-[#1E6B47] text-white" : "border border-[#1E6B47] bg-white text-[#1E6B47]"}`}
            >
              {infoOpen ? "ย่อ ▴" : "ข้อมูลบ้าน ▾"}
            </span>
          </button>
          {infoOpen && (
            <div className="anim-in mt-1 divide-y divide-[#EEF1EE] rounded-xl bg-white px-3 shadow-sm">
              {[
                [
                  "ซอย",
                  info.soi ? `ซ.${info.soi}` : "ยังไม่รู้ซอย",
                  "แก้",
                  () => setSoiEdit((v) => !v),
                ],
                [
                  "ตำแหน่งบ้าน",
                  info.precision === "house"
                    ? "📍 ปักหมุดแล้ว"
                    : "ยังไม่ปักหมุด · ใช้กลางซอย",
                  info.precision === "house" ? "ย้าย" : "ปักหมุด GPS",
                  () =>
                    setPinning({ pos: null, soi: info.soi || "", gps: true }),
                ],
                [
                  "เก็บขยะ",
                  info.waste ? (
                    info.waste.irregular ? (
                      <WasteOff
                        key="w"
                        off={info.waste.irregular}
                        days={info.waste.days}
                      />
                    ) : (
                      <WasteDays key="w" days={info.waste.days} />
                    )
                  ) : (
                    "ยังไม่รู้ (ใส่ซอยก่อน)"
                  ),
                  null,
                  null,
                ],
                [
                  "เสียงตามสาย",
                  info.speaker?.answer
                    ? info.speaker.answer === "yes"
                      ? "🔇 ไม่ได้ยิน / ไม่ชัด"
                      : "📢 ได้ยินชัด"
                    : "ยังไม่ได้ตอบ",
                  "แก้",
                  () => setSpkOpen(true),
                ],
              ].map(([label, value, act, go]) => (
                <div
                  key={label}
                  className="flex min-h-[52px] items-center gap-2 py-1.5"
                >
                  <span className="w-24 shrink-0 text-sm text-[#5A665F]">
                    {label}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug">
                    {value}
                  </span>
                  {act && (
                    <button
                      onClick={go}
                      className="min-h-[40px] shrink-0 rounded-lg border border-[#D5DBD6] px-3 text-sm font-bold text-[#1E6B47]"
                    >
                      {act}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {info && !pinning && (
        <NeighborFill
          info={info}
          onPin={() =>
            setPinning({ pos: null, soi: info.soi || "", gps: true })
          }
        />
      )}
      {info &&
        info.precision !== "house" &&
        !soiAsked.includes(info.house) &&
        !pinning && (
          <SoiAsk
            info={info}
            setErr={setErr}
            onSaved={(r) => {
              setInfo(r);
              notify(`บันทึกแล้ว · บ้าน ${r.house} อยู่ ซ.${r.soi}`);
            }}
            onClose={() => {
              const next = [...soiAsked.slice(-30), info.house];
              setSoiAsked(next);
              save("soiAsked", next);
            }}
            onPin={() => {
              const next = [...soiAsked.slice(-30), info.house];
              setSoiAsked(next);
              save("soiAsked", next);
              setPinning({ pos: null, soi: info.soi || "" });
              setTimeout(
                () =>
                  document
                    .getElementById("myhome-pin")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                120,
              );
            }}
          />
        )}
      {info && soiEdit && (
        <SoiEdit
          info={info}
          setErr={setErr}
          onClose={() => setSoiEdit(false)}
          onSaved={(r) => {
            setInfo(r);
            notify(
              `บันทึกแล้ว · บ้าน ${r.house} อยู่ ซ.${r.soi} (วันรถขยะและคิวช่างใช้ซอยนี้)`,
            );
          }}
        />
      )}
      {err && (
        <p
          ref={errRef}
          role="alert"
          className="mt-2 rounded-xl bg-red-50 p-3 text-red-700"
        >
          {err}
        </p>
      )}
      {!info ? (
        <p className="py-3 text-[15px] text-[#45504A]">กำลังโหลด…</p>
      ) : (
        <>
          <SpeakerRow
            info={info}
            onSaved={setInfo}
            setErr={setErr}
            hideNudge={infoOpen}
            open={spkOpen}
            draft={spkDraft}
            onClose={() => {
              setSpkOpen(false);
              setSpkDraft("");
            }}
            onPin={() =>
              setPinning({ pos: null, soi: info.soi || "", gps: true })
            }
          />
          <div className="grp">
            <p className="grp-label">วันนี้</p>
            <div className="grp-body">
              <CheckinCard
                info={info}
                onSaved={setInfo}
                onContact={() =>
                  setContact({ name: load("myName", ""), from: "news" })
                }
                setErr={setErr}
              />
              <Soon items={info.soon} onSeen={() => setSeenN((n) => n + 1)} />
              <ElectricRound
                info={info}
                setErr={setErr}
                onActive={setRoundOn}
                onEditSoi={() => {
                  setSoiEdit(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </div>
          </div>
          <div className="grp">
            <p className="grp-label">ในหมู่บ้านตอนนี้</p>
            <div className="grp-body">
              <Slides
                items={lostNew}
                allLabel={
                  lost.length > lostNew.length
                    ? `ดูทั้งหมด ${lost.length} เรื่อง ›`
                    : "ดูทั้งหมด ›"
                }
                foldKey="lost"
                mini={(x) => (
                  <>
                    {x.media?.[0] ? (
                      <img
                        src={mediaUrl(x.media[0].id, "thumb")}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-xl bg-[#FDE8E6] object-cover"
                      />
                    ) : (
                      <span className="ic ic-red h-12 w-12" aria-hidden="true">
                        {{
                          dog: "🐕",
                          cat: "🐈",
                          pet: "🐾",
                          document: "📄",
                          vehicle: "🛵",
                        }[x.category] || "🎒"}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`rounded px-1 text-[11px] font-bold text-white ${x.kind === "found" ? "bg-[#1E6B47]" : "bg-[#B42318]"}`}
                      >
                        {x.kind === "found" ? "🙌 มีคนเจอ" : "😢 หาย"}
                      </span>
                      {x.soi ? (
                        <span className="ml-1 text-xs text-[#45504A]">
                          ซ.{x.soi}
                        </span>
                      ) : null}
                      <span className="block truncate text-[15px] font-bold leading-snug">
                        {x.title}
                      </span>
                    </span>
                  </>
                )}
                icon="🐾"
                tone="red"
                title={(n) =>
                  lost.length > n
                    ? `หาย · เจอ ล่าสุด ${n} เรื่อง`
                    : `หาย · เจอ ${n} เรื่อง`
                }
                onOpen={(id) => onLost(id)}
                onAll={() => onLost()}
                slide={(x) => (
                  <span className="flex items-center gap-3">
                    {x.media?.[0] ? (
                      <img
                        src={mediaUrl(x.media[0].id, "thumb")}
                        alt=""
                        className="h-16 w-16 shrink-0 rounded-xl object-cover"
                      />
                    ) : (
                      <span
                        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[#F2F4F1] text-3xl"
                        aria-hidden="true"
                      >
                        {{
                          dog: "🐕",
                          cat: "🐈",
                          pet: "🐾",
                          document: "📄",
                          vehicle: "🛵",
                        }[x.category] || "🎒"}
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span
                        className={`rounded px-1.5 text-xs font-bold text-white ${x.kind === "found" ? "bg-[#1E6B47]" : "bg-[#B42318]"}`}
                      >
                        {x.kind === "found" ? "🙌 มีคนเจอ" : "😢 หาย"}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-[16px] font-bold leading-snug">
                        {x.title}
                      </span>
                      <span className="block text-sm text-[#45504A]">
                        {[x.soi && `ซ.${x.soi}`, "เห็นไหม? แตะดูเบอร์ ›"]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </span>
                )}
              />
              <Slides
                items={[...needs].sort((x, y) => fits(y) - fits(x))}
                foldKey="needs"
                startFolded
                tone="green"
                icon="🙋"
                title={(n) => `เพื่อนบ้านขอแรงอยู่ ${n} เรื่อง`}
                onOpen={(id) => onNeeds(id)}
                onAll={() => onNeeds()}
                slide={(j) => (
                  <>
                    <span className="block text-sm text-[#45504A]">
                      {j.name}
                      {j.soi ? ` · ซ.${j.soi}` : ""}
                      {fits(j) ? (
                        <b className="ml-1 rounded-full bg-[#1E6B47] px-2 text-xs text-white">
                          🤝 ตรงกับที่คุณถนัด
                        </b>
                      ) : null}
                    </span>
                    <span className="line-clamp-2 block text-[16px] font-bold leading-snug">
                      {j.detail}
                    </span>
                    <span className="mt-0.5 block text-sm font-bold text-[#1E6B47]">
                      ช่วยได้? ดูและติดต่อ ›
                    </span>
                  </>
                )}
              />
              {market.length > 0 && (
                <MarketRow items={market} onOpen={onMarket} />
              )}
            </div>
          </div>
          <div className="grp">
            <p className="grp-label">ของบ้านฉัน</p>
            <div className="grp-body">
              <div className="mt-2">
                <AidRow info={info} onChanged={reload} setErr={setErr} />
              </div>
              <InstallApp />
              <PushCard house={info.house} />
              <LineLinkCard house={info.house} />
              <div className="card stack mt-2 px-4">
                <PetsRow
                  house={info.house}
                  setErr={setErr}
                  onLostPosted={onLostPosted}
                  onOpenLost={onLost}
                />

                {
                  pinning
                    ? // full screen over everything: the map, GPS and "save" in one place — nothing to scroll for
                      createPortal(
                        <div
                          className="anim-fade fixed inset-0 z-[960] flex flex-col bg-white"
                          role="dialog"
                          aria-label="ปักหมุดบ้านฉัน"
                        >
                          <div className="flex items-center gap-2 border-b border-[#E6EBE7] px-4 py-2">
                            <b className="min-w-0 flex-1 text-lg">
                              📍 ปักหมุดบ้าน {info.house}
                            </b>
                            <button
                              onClick={() => setPinning(null)}
                              aria-label="ปิด"
                              className="min-h-[44px] min-w-[44px] text-2xl text-[#45504A]"
                            >
                              ✕
                            </button>
                          </div>
                          <div
                            id="myhome-pin"
                            className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
                          >
                            <p className="text-[15px]">
                              กด "ใช้ตำแหน่งปัจจุบัน" ตอนอยู่ที่บ้าน
                              หรือเลื่อนแผนที่ให้หมุดอยู่บนหลังคาบ้านคุณ
                            </p>
                            <LocationPicker
                              big
                              autoGps={!!pinning.gps}
                              value={
                                info.precision === "house"
                                  ? { lat: info.lat, lng: info.lng }
                                  : null
                              }
                              onChange={(pos) =>
                                setPinning((p) => ({ ...p, pos }))
                              }
                              onTouched={() =>
                                setPinning((p) => ({ ...p, touched: true }))
                              }
                            />
                            <label className="block">
                              <span className="text-sm font-bold">
                                {pinning.soiTyped
                                  ? "ซอย (คุณแก้เอง)"
                                  : pinning.soi
                                    ? `ซอยจากหมุด: ซ.${pinning.soi} · แก้ได้ถ้าไม่ตรง`
                                    : "ซอย (ลากหมุดแล้วระบบหาให้ · แก้ได้)"}
                              </span>
                              <input
                                value={pinning.soi || ""}
                                onChange={(e) =>
                                  setPinning((p) => ({
                                    ...p,
                                    soi: e.target.value,
                                    soiTyped: true,
                                  }))
                                }
                                placeholder="เช่น 34/6"
                                className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
                              />
                            </label>
                            <div className="flex gap-2">
                              <button
                                onClick={savePin}
                                disabled={!pinning.pos}
                                className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50"
                              >
                                บ้านฉันอยู่ตรงนี้
                              </button>
                              <button
                                onClick={() => setPinning(null)}
                                className="min-h-[52px] rounded-xl border border-[#C9D1CB] px-4 font-bold"
                              >
                                ยกเลิก
                              </button>
                            </div>
                          </div>
                        </div>,
                        document.body,
                      )
                    : null /* 8 Oct: the "ระบบเดาว่าอยู่ ซ.x" box is gone — the one-time "อยู่ ซ.x ใช่ไหม?" pop-up and "ซ.x ✎ · 📍GPS" at the top replace it */
                }

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
                        const a = (d.questions || []).find(
                          (x) => x.id === q.id,
                        )?.answer;
                        if (a === "no") foldIt(q.id);
                        else openIt(q.id);
                      }}
                      onPros={onPros}
                      onIssue={onIssue}
                      onAsk={() => {
                        setNearForm({
                          kind: "ask",
                          topic: "other",
                          text: q.q,
                          name: load("myName", ""),
                          phone: load("myReach", ""),
                          to_office: false,
                        });
                        setTimeout(
                          () =>
                            nearRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            }),
                          50,
                        );
                      }}
                      setErr={setErr}
                    />
                  ))}

                {elOn && !roundOn && !isFolded("electric") && (
                  <ElectricRow
                    onFold={() => foldIt("electric")}
                    onSent={(w) =>
                      w === "free" ? foldIt("electric") : openIt("electric")
                    }
                    info={info}
                    services={services}
                    onSaved={setInfo}
                    onElectricians={onElectricians}
                    onContact={() =>
                      setContact({ name: load("myName", ""), from: "electric" })
                    }
                    contactSlot={
                      contact?.from === "electric" ? (
                        <ContactForm
                          contact={contact}
                          setContact={setContact}
                          onSave={sendContact}
                        />
                      ) : null
                    }
                    setErr={setErr}
                  />
                )}

                {!flood && <FloodTuck on={false} setOn={setFloodPref} />}
                {flood && !floodAlarm && (
                  <FloodTuck on setOn={setFloodPref} className="mt-1" />
                )}
                {flood && (
                  <WaterRow
                    info={info}
                    water={water}
                    sent={sent}
                    onTap={tap}
                    onAsk={
                      nearForm
                        ? null
                        : () => {
                            setNearForm({
                              kind: "ask",
                              topic: "water",
                              text: "",
                              name: load("myName", ""),
                              phone: load("myReach", ""),
                              to_office: false,
                            });
                            setTimeout(
                              () =>
                                nearRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                }),
                              50,
                            );
                          }
                    }
                  />
                )}

                <div id="myhome-outage">
                  <OutageRow
                    info={info}
                    forced={outageOpen}
                    onFold={() => setOutageOpen(false)}
                    onChanged={reload}
                    setErr={setErr}
                  />
                </div>
                {/* 8 Oct: แผนซ่อมของฉัน removed from บ้านฉัน (cluttered); ช่าง·ร้าน covers finding tradesmen */}
                <ReviewPrompt services={services} />

                <div ref={nearRef}>
                  <Nearby
                    info={info}
                    form={nearForm}
                    setForm={setNearForm}
                    setErr={setErr}
                    handy={handy}
                    onPros={onPros}
                  />
                </div>

                {info.issues_open > 0 && (
                  <Row
                    icon="🛠️"
                    title={t(
                      "myhome.office.open",
                      "ในซอยมีเรื่องรอสำนักงานแก้",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-[15px]">
                        {info.soi ? `ซ.${info.soi} · ` : ""}
                        {info.issues_open} เรื่อง
                      </p>
                      <button
                        onClick={onIssues}
                        className="min-h-[46px] shrink-0 rounded-xl border border-[#C9D1CB] bg-white px-4 text-[15px] font-bold"
                      >
                        ดูรายการ
                      </button>
                    </div>
                  </Row>
                )}

                <div ref={contactRef} />
                {contact && contact.from !== "electric" && (
                  <Row
                    icon="📨"
                    title={t("myhome.contact.title", "ช่องทางติดต่อบ้านนี้")}
                  >
                    <ContactForm
                      contact={contact}
                      setContact={setContact}
                      onSave={sendContact}
                    />
                  </Row>
                )}
              </div>
            </div>
          </div>
          {/* things you may want to do some day: one grid instead of a section each */}
          <div className="pb-1">
            <p className="grp-label">
              {t("myhome.tools.title", "ทำอะไรได้อีก")}
            </p>
            <button
              onClick={() => setHandyOpen((o) => !o)}
              className={`card flex min-h-[64px] w-full items-center gap-3 px-3 py-2 text-left ${handy?.on ? "border-[#1E6B47] bg-[#E4F0E9]" : ""}`}
            >
              <span className="text-2xl" aria-hidden="true">
                🤝
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-base leading-tight">
                  {handy?.on
                    ? `คุณเป็นอาสาข้างบ้าน ✓`
                    : t(
                        "myhome.handy.cta",
                        "ทำเป็น ช่วยเพื่อนบ้านได้? เป็นอาสาข้างบ้าน",
                      )}
                </b>
                <span className="block text-sm text-[#45504A]">
                  {handy?.on
                    ? `${SKILL_LIST.filter(([k]) => handy.skills.includes(k))
                        .map(([, , l]) => l)
                        .join(
                          " · ",
                        )}${handy.thanks ? ` · ช่วยแล้ว ${handy.thanks} ครั้ง 🙏` : ""}`
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
                [
                  "🙋",
                  t("myhome.tools.help", "ขอแรงเพื่อนบ้าน"),
                  t("myhome.tools.help_sub", "ซ่อมเล็กๆ ยกของ ติดรถ ฝากซื้อ"),
                  onAskHelp,
                ],
                [
                  "👀",
                  t("myhome.tools.ask", "ฝากดูบ้าน"),
                  t("myhome.tools.ask_sub2", "น้ำหน้าบ้าน รับของ ดูประตู"),
                  () => startNear("ask"),
                ],
                [
                  "🐾",
                  t("myhome.tools.lost", "หาย · เจอ"),
                  t("myhome.tools.lost_sub", "หมาแมวหาย เจอของ ลงรูปไว้"),
                  onLost,
                ],
                [
                  "⚠️",
                  t("myhome.tools.alert", "เตือนเพื่อนบ้าน"),
                  t("myhome.tools.alert_sub2", "ฝาท่อแตก กิ่งไม้ สายไฟ"),
                  () => startNear("alert"),
                ],
                [
                  "📍",
                  t("myhome.tools.report", "แจ้งจุดปัญหา"),
                  t("myhome.tools.report_sub", "ขยะค้าง ฝาท่อแตก จุดอันตราย"),
                  onIssue,
                ],
                ...(onWaste
                  ? [
                      [
                        "♻️",
                        t("myhome.tools.waste", "ขยะ · รถเก็บ"),
                        t("myhome.tools.waste_sub", "รอบรถทุกซอย · วิธีแยกขยะ"),
                        onWaste,
                      ],
                    ]
                  : []),
                [
                  "⚡",
                  t("myhome.tools.outage", "ไฟดับ น้ำไม่ไหล"),
                  t("myhome.tools.outage_sub", "แจ้ง · ดูว่าแถวบ้านเป็นไหม"),
                  () => {
                    setOutageOpen(true);
                    setTimeout(
                      () =>
                        document
                          .getElementById("myhome-outage")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          }),
                      50,
                    );
                  },
                ],
                [
                  "👨‍👩‍👧",
                  t("myhome.tools.family", "ส่งให้ลูกหลาน"),
                  t("myhome.tools.family_sub", "ดูบ้านนี้จากที่ไหนก็ได้"),
                  () => shareFamily(info.house),
                ],
                ...(isStandalone() || !isPhone()
                  ? []
                  : [
                      [
                        "📲",
                        "ติดตั้งแอปไว้หน้าจอ",
                        "Android · iPhone · ทำครั้งเดียว",
                        () =>
                          findCard("myhome-install", () => nudgeInstall("")),
                      ],
                    ]),
                ...(isPhone()
                  ? [
                      [
                        "🔔",
                        "แจ้งเตือนเข้ามือถือ",
                        "รถขยะ ของหาย ประกาศ · เปิด/ตั้งค่า",
                        openPush,
                      ],
                    ]
                  : []),
                info.has_contact
                  ? [
                      "📨",
                      t("myhome.tools.contact_saved", "เบอร์ติดต่อ ✓"),
                      savedContact
                        ? `${savedContact.name || ""} · แก้ไข`
                        : "แก้ไขได้",
                      () =>
                        setContact({ ...(savedContact || {}), from: "news" }),
                    ]
                  : [
                      "📨",
                      t("myhome.tools.contact", "ฝากเบอร์ทีม"),
                      t("myhome.tools.contact_sub", "รับข่าวด่วน นัดช่าง"),
                      () =>
                        setContact({ name: load("myName", ""), from: "news" }),
                    ],
              ].map(([icon, label, sub, go]) => (
                <button
                  key={label}
                  onClick={go}
                  className="card flex min-h-[72px] flex-col items-start justify-center px-3 py-2 text-left active:bg-[#F2F4F1]"
                >
                  <span className="whitespace-nowrap text-[15px] font-bold leading-tight">
                    <span aria-hidden="true">{icon} </span>
                    {label}
                  </span>
                  <span className="mt-0.5 text-sm leading-snug text-[#45504A]">
                    {sub}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <Settled
            items={settled}
            onOpen={(k) => {
              openIt(k);
              // a payout marked received is fixed in the 💰 box itself ("ยังไม่ได้รับ? แก้")
              if (k.startsWith("aid_"))
                window.dispatchEvent(new Event("aid:open"));
              setTimeout(() => {
                const target = k.startsWith("aid_")
                  ? document.getElementById("myhome-aid-got")
                  : document.getElementById(`myhome-${k}`);
                target?.scrollIntoView({ behavior: "smooth", block: "center" });
                if (k.startsWith("aid_") && target) {
                  target.classList.add("ring-4", "ring-[#E0A100]");
                  setTimeout(
                    () => target.classList.remove("ring-4", "ring-[#E0A100]"),
                    2500,
                  );
                }
              }, 150);
            }}
          />
        </>
      )}
    </section>
  );
}
