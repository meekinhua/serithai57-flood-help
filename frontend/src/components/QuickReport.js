// 📍 แจ้งจุดปัญหา in 3 taps (9 Oct 2026): what (garbage pile / broken drain cover / danger spot) → photo → where
// (GPS where you stand, or just the soi) → send. The full form (9 kinds, map pin) stays one link away.
import { useEffect, useState } from "react";
import { api, load, save } from "../api";
import { ISSUE_TYPES } from "../config";
import MediaPicker, { mediaState } from "./MediaPicker";
import LocationPicker from "./LocationPicker";

export const QUICK = [
  ["trash", "กองขยะตกค้าง", "ฟูก ตู้ ถุงดำ กองริมถนน"],
  ["cover", "ฝาท่อแตก", "ฝาแตก ฝาเปิด ตกลงไปได้"],
  ["danger", "จุดอันตราย", "สายไฟห้อย รถจอดขวาง ของมีคม"],
];
const HINT = {
  trash: "เช่น ฟูก+ตู้พัง กองปากซอย ล้นถนน",
  cover: "เช่น ฝาท่อแตก หน้าบ้านเลขที่… ตรงทางเข้าซอย",
  danger: "เช่น รถเสียจอดหัวยื่นกลางถนน กลางคืนมองไม่เห็น",
};
// 9 Oct: people reported "can't hear the loudspeaker" as a map problem — it belongs to บ้านฉัน's question
// (one answer per house → the เสียงตามสาย layer of the map). Words like these get pointed there.
export const SPEAKER_RE = /เสียงตาม|ได้ยิน|ลำโพง|หอกระจาย/; // loose: "ไมไ่ด้ยิน" (a typo) came in too
export const goSpeaker = () => window.dispatchEvent(new Event("speaker:go")); // RepairApp → บ้านฉัน, question open

export function SpeakerHint() {
  return (
    <div className="rounded-xl border-2 border-[#D9A21B] bg-[#FFF6DD] p-3">
      <p className="text-[15px] font-bold">📢 เรื่องเสียงตามสาย ไม่ต้องแจ้งเป็นจุดปัญหานะครับ</p>
      <p className="text-sm text-[#45504A]">ตอบในบ้านฉันว่าบ้านคุณ “ได้ยิน” หรือ “ไม่ได้ยิน” · ระบบรวมเป็นแผนที่จุดบอดเสียงให้คหบาลซ่อม</p>
      <button type="button" onClick={goSpeaker} className="mt-2 min-h-[48px] w-full rounded-xl bg-[#15201A] text-base font-bold text-white">
        ไปตอบในบ้านฉัน ›
      </button>
    </div>
  );
}

const IN_VILLAGE = (p) => p.lat > 13.7 && p.lat < 13.9 && p.lng > 100.6 && p.lng < 100.8;

export default function QuickReport({ type: type0 = "", onDone, onMore }) {
  const [type, setType] = useState(type0);
  const [media, setMedia] = useState([]);
  const [loc, setLoc] = useState(null); // where the map's pin points
  const [touched, setTouched] = useState(false); // GPS answered or the pin was dragged: the pin counts
  const pos = touched ? loc : null;
  const [gps, setGps] = useState(""); // "" | "busy" | message
  const [map, setMap] = useState(0); // >0: the drag-the-pin map is open (the number re-centres it after GPS)
  const [soi, setSoi] = useState(load("mySoi", ""));
  const [soiTyped, setSoiTyped] = useState(false);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const attached = mediaState(media);

  function here() {
    if (!navigator.geolocation) return setGps("มือถือนี้ใช้ GPS ไม่ได้ · ใส่ซอยแทน");
    setGps("busy");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const at = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) };
        if (!IN_VILLAGE(at)) return setGps("ตำแหน่งอยู่นอกหมู่บ้าน · ใส่ซอยแทน");
        setLoc(at);
        setTouched(true);
        setGps("");
        setMap((n) => n + 1); // show it on the map: drag to fine-tune
      },
      () => setGps("เปิด GPS ไม่ได้ · ใส่ซอยแทนก็ได้"),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  // the soi follows the pin (unless typed by hand)
  const key = pos ? `${pos.lat},${pos.lng}` : "";
  useEffect(() => {
    if (!key || soiTyped) return;
    const t = setTimeout(() => {
      api(`/myhome/soi-at?lat=${pos.lat}&lng=${pos.lng}`)
        .then((r) => r.soi && setSoi(r.soi))
        .catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [key, soiTyped]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!pos && !soi.trim()) return setErr("☝️ กด “ใช้ตำแหน่งที่ยืนอยู่” หรือใส่ซอย");
    if (SPEAKER_RE.test(detail)) return setErr("📢 เรื่องเสียงตามสาย กด “ไปตอบในบ้านฉัน” ด้านบนแทนนะครับ");
    setBusy(true);
    setErr("");
    try {
      const x = await api("/issues", { method: "POST", body: JSON.stringify({ type, detail, soi, ...(pos || {}), name: load("myName", ""), media_ids: attached.ids }) });
      save("issueVotes", [...load("issueVotes", []), x.id]);
      if (soi) save("mySoi", load("mySoi", "") || soi);
      onDone(x);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  if (!type)
    return (
      <div className="space-y-2">
        <p className="text-[15px] text-[#45504A]">เลือกเรื่อง แล้วถ่ายรูป ส่งได้ใน 3 ขั้น · ขึ้นบนแผนที่หมู่บ้านให้ทุกคนเห็น</p>
        {QUICK.map(([k, name, sub]) => (
          <button key={k} onClick={() => setType(k)} className="card flex min-h-[72px] w-full items-center gap-3 p-3 text-left active:bg-[#F2F4F1]">
            <span className={`ic ${k === "trash" ? "ic-amber" : "ic-red"}`} aria-hidden="true">
              {ISSUE_TYPES[k][0]}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[17px] leading-tight">{name}</b>
              <span className="block text-sm text-[#45504A]">{sub}</span>
            </span>
            <span aria-hidden="true">›</span>
          </button>
        ))}
        <button onClick={goSpeaker} className="card flex min-h-[60px] w-full items-center gap-3 p-3 text-left active:bg-[#F2F4F1]">
          <span className="ic ic-sm" aria-hidden="true">
            📢
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[16px] leading-tight">ไม่ได้ยินเสียงตามสาย</b>
            <span className="block text-sm text-[#45504A]">ไม่ต้องปักหมุด · ตอบในบ้านฉันทีเดียว</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {onMore && (
          <button onClick={onMore} className="min-h-[44px] w-full text-[15px] font-bold text-[#1E6B47]">
            เรื่องอื่น (ไฟถนน ต้นไม้ล้ม ท่อตัน น้ำประปา) ›
          </button>
        )}
      </div>
    );

  const [, name] = QUICK.find((q) => q[0] === type) || [type, ISSUE_TYPES[type]?.[1] || ""];
  return (
    <div className="space-y-4">
      <button onClick={() => setType("")} className="flex min-h-[44px] items-center gap-2 text-[15px] font-bold">
        <span className="text-2xl" aria-hidden="true">
          {ISSUE_TYPES[type]?.[0]}
        </span>
        {name} <span className="font-normal text-[#1E6B47] underline">เปลี่ยน</span>
      </button>

      <div>
        <p className="mb-1 font-bold">1. ถ่ายรูป (แนะนำ)</p>
        <MediaPicker items={media} setItems={setMedia} max={2} allowVideo={false} />
      </div>

      <div>
        <p className="mb-1 font-bold">2. ตรงไหน</p>
        {!map ? (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={here} className="min-h-[56px] rounded-xl bg-[#15201A] px-2 text-[15px] font-bold text-white">
              {gps === "busy" ? "กำลังหาตำแหน่ง…" : "📍 ใช้ตำแหน่งที่ยืนอยู่"}
            </button>
            <button onClick={() => setMap(1)} className="min-h-[56px] rounded-xl border-2 border-[#15201A] bg-white px-2 text-[15px] font-bold">
              🗺️ ปักหมุดบนแผนที่
            </button>
          </div>
        ) : (
          <div className="anim-in">
            <LocationPicker key={map} value={loc} onChange={setLoc} onTouched={() => setTouched(true)} />
            <p className={`mt-1 text-sm font-bold ${pos ? "text-[#1E6B47]" : "text-[#7A4104]"}`}>
              {pos ? `✓ หมุดอยู่ตรงนี้${soi ? ` · ซ.${soi}` : ""} · ลากแผนที่ปรับได้` : "ลากแผนที่ให้หมุด 📍 ชี้ตรงจุดที่เห็น"}
            </p>
          </div>
        )}
        {gps && gps !== "busy" && <p className="mt-1 text-sm font-bold text-[#7A4104]">{gps}</p>}
        <label className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[15px]">หรือซอย</span>
          <input
            value={soi}
            onChange={(e) => {
              setSoi(e.target.value);
              setSoiTyped(true);
            }}
            inputMode="decimal"
            placeholder="เช่น 16"
            className="min-h-[48px] w-28 rounded-xl border border-[#A9B4AD] px-3 text-lg"
          />
        </label>
      </div>

      <div>
        <label className="mb-1 block font-bold" htmlFor="qr-detail">
          3. บอกเพิ่ม (ไม่บังคับ)
        </label>
        <textarea
          id="qr-detail"
          rows={2}
          maxLength={300}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder={HINT[type] || ""}
          className="w-full rounded-xl border border-[#A9B4AD] p-3 text-base"
        />
        {SPEAKER_RE.test(detail) && <SpeakerHint />}
      </div>

      {err && <p className="rounded-xl bg-[#FDE8E6] p-3 font-bold text-[#B42318]">{err}</p>}
      <button onClick={send} disabled={busy || attached.busy} className="min-h-[56px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : attached.busy ? "รอรูปอัปโหลด…" : "ส่งเลย · ขึ้นแผนที่หมู่บ้าน"}
      </button>
    </div>
  );
}
