import { useCallback, useEffect, useState } from "react";
import { api, load, save } from "../api";
import { useT } from "./Texts";
import MediaPicker, { mediaState } from "./MediaPicker";
import { MediaStrip } from "./MediaGallery";

// รอบบ้าน: small asks and warnings between houses close enough to help (backend/nearby.py)
export const NEAR_TOPICS = {
  ask: [
    ["water", "💧", "ดูน้ำหน้าบ้านให้หน่อย"],
    ["photo", "📷", "ถ่ายรูปหน้าบ้านให้ดู"],
    ["parcel", "📦", "ช่วยรับพัสดุ / ของ"],
    ["pet", "🐾", "ให้อาหารสัตว์เลี้ยง"],
    ["check", "🔒", "ดูประตู ปิดน้ำ ปิดไฟให้"],
    ["carry", "💪", "ช่วยยกของ / ขนของ"],
    ["other", "✏️", "เรื่องอื่น"],
  ],
  alert: [
    ["manhole", "🕳️", "ฝาท่อแตก / หลุมบนถนน", true],
    ["wire", "⚡", "สายไฟห้อย / เสาเอียง", true],
    ["tree", "🌳", "ต้นไม้ล้ม / กิ่งขวางทาง", true],
    ["flood", "🌊", "น้ำขังลึก รถผ่านลำบาก"],
    ["lost", "🔎", "ของหาย / สัตว์เลี้ยงหาย"],
    ["animal", "🐍", "งู / สัตว์อันตราย"],
    ["other", "✏️", "เรื่องอื่น"],
  ],
};
const iconOf = (d) => (NEAR_TOPICS[d.kind].find((t) => t[0] === d.topic) || [])[1] || "•";
const keys = () => load("nearbyKeys", {});

function ago(t) {
  const m = Math.max(1, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  return m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.round(m / 60)} ชม.ที่แล้ว` : `${Math.round(m / 1440)} วันที่แล้ว`;
}

function Item({ d, onChange, setErr }) {
  const t = useT();
  const key = keys()[d.id];
  const [helping, setHelping] = useState(null); // {name, phone} while filling, then {contact}
  const [owner, setOwner] = useState(null);
  const [voted, setVoted] = useState(() => load(`nearVote:${d.id}`, false));

  useEffect(() => {
    if (key)
      api(`/nearby/${d.id}/owner`, { headers: { "X-Edit-Key": key } })
        .then(setOwner)
        .catch(() => {});
  }, [d.id, key]);

  async function offer() {
    setErr("");
    try {
      save("myName", helping.name);
      const c = await api(`/nearby/${d.id}/help`, { method: "POST", body: JSON.stringify({ name: helping.name, phone: helping.phone || "" }) });
      setHelping({ contact: c });
      onChange();
    } catch (e) {
      setErr(e.message);
    }
  }
  async function vote(still) {
    setErr("");
    try {
      await api(`/nearby/${d.id}/alert`, { method: "POST", body: JSON.stringify({ still }) });
      if (still) {
        save(`nearVote:${d.id}`, true);
        setVoted(true);
      }
      onChange();
    } catch (e) {
      setErr(e.message);
    }
  }
  async function close() {
    setErr("");
    try {
      await api(`/nearby/${d.id}/done`, { method: "POST", headers: { "X-Edit-Key": key } });
      const k = keys();
      delete k[d.id];
      save("nearbyKeys", k);
      onChange();
    } catch (e) {
      setErr(e.message);
    }
  }

  const ask = d.kind === "ask";
  return (
    <li className={`rounded-2xl border-2 p-3 ${ask ? "border-[#1E6B47] bg-white" : "border-[#E0A100] bg-[#FFF8E1]"}`}>
      <p className="text-base font-bold leading-snug">
        <span aria-hidden="true">{iconOf(d)} </span>
        {ask ? `บ้าน ${d.house} ฝาก: ` : "ระวัง: "}
        {d.label}
      </p>
      {d.text && <p className="text-[15px]">{d.text}</p>}
      <MediaStrip media={d.media || []} />
      <p className="text-sm text-[#45504A]">
        {key ? "เรื่องของคุณ" : d.m != null ? `ห่างบ้านคุณ ~${Math.max(10, Math.round(d.m / 10) * 10)} ม.` : ""}
        {!ask && !key ? ` · แถวบ้าน ${d.house}` : ""} · {ago(d.created_at)}
        {ask && d.helpers.length > 0 ? ` · มีคนรับช่วยแล้ว ${d.helpers.length} คน` : ""}
        {!ask && d.still > 1 ? ` · ยืนยันว่ายังอยู่ ${d.still} คน` : ""}
        {d.issue_id ? " · ส่งเข้ารายการปัญหาในซอยแล้ว" : ""}
      </p>

      {key ? (
        <div className="mt-2 space-y-2">
          {ask &&
            (owner?.helpers?.length ? (
              <ul className="space-y-1">
                {owner.helpers.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-xl bg-[#E4F0E9] px-3 py-2 text-[15px]">
                    <b className="min-w-0 flex-1">{h.name} รับช่วย</b>
                    {h.phone && (
                      <a href={`tel:${h.phone.replace(/[^\d+]/g, "")}`} className="font-bold text-[#1E6B47] underline">
                        {h.phone}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[15px] text-[#45504A]">ยังไม่มีใครรับ · คนที่รับจะโทรหาคุณ</p>
            ))}
          <button onClick={close} className="min-h-[46px] w-full rounded-xl border border-[#C9D1CB] bg-white text-[15px] font-bold">
            {ask ? "เรียบร้อยแล้ว ปิดเรื่อง" : "ไม่มีแล้ว ปิดเรื่อง"}
          </button>
        </div>
      ) : ask ? (
        helping?.contact ? (
          <div className="mt-2 rounded-xl bg-[#E4F0E9] p-3">
            <p className="text-[15px] font-bold">ขอบคุณ! ติดต่อเจ้าของบ้าน {helping.contact.house}</p>
            <a href={`tel:${helping.contact.phone.replace(/[^\d+]/g, "")}`} className="mt-1 flex min-h-[48px] items-center justify-center rounded-xl bg-[#1E6B47] text-base font-bold text-white">
              โทร {helping.contact.phone}
            </a>
          </div>
        ) : helping ? (
          <div className="mt-2 space-y-2">
            <input
              value={helping.name}
              onChange={(e) => setHelping({ ...helping, name: e.target.value })}
              placeholder="ชื่อเล่นคุณ"
              className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
            />
            <input
              value={helping.phone}
              onChange={(e) => setHelping({ ...helping, phone: e.target.value })}
              placeholder="เบอร์คุณ (ไม่ใส่ก็ได้ เจ้าของบ้านเห็นคนเดียว)"
              className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
            />
            <div className="flex gap-2">
              <button onClick={offer} disabled={!helping.name.trim()} className="min-h-[48px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50">
                รับช่วย แล้วดูเบอร์เจ้าของบ้าน
              </button>
              <button onClick={() => setHelping(null)} className="min-h-[48px] rounded-xl border border-[#C9D1CB] px-3 font-bold">
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setHelping({ name: load("myName", ""), phone: "" })} className="mt-2 min-h-[48px] w-full rounded-xl bg-[#1E6B47] text-base font-bold text-white">
            {t("nearby.help", "ฉันช่วยได้")}
          </button>
        )
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={() => vote(true)} disabled={voted} className="min-h-[46px] rounded-xl border border-[#C9D1CB] bg-white text-[15px] font-bold disabled:opacity-60">
            {voted ? "ยืนยันแล้ว ✓" : "เห็นด้วย ยังอยู่"}
          </button>
          <button onClick={() => vote(false)} className="min-h-[46px] rounded-xl border border-[#C9D1CB] bg-white text-[15px] font-bold">
            ไม่มีแล้ว
          </button>
        </div>
      )}
    </li>
  );
}

function NewForm({ form, setForm, house, onPosted, setErr }) {
  const topics = NEAR_TOPICS[form.kind];
  const topic = topics.find((t) => t[0] === form.topic);
  const ask = form.kind === "ask";
  const t = useT();
  const [files, setFiles] = useState([]);
  async function post() {
    setErr("");
    if (mediaState(files).busy) return setErr("รอรูปอัปโหลดเสร็จก่อน");
    try {
      save("myName", form.name || "");
      if (ask) save("myReach", form.phone || "");
      const d = await api("/nearby", { method: "POST", body: JSON.stringify({ ...form, house, media_ids: mediaState(files).ids }) });
      save("nearbyKeys", { ...keys(), [d.id]: d.edit_key });
      onPosted(d);
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="space-y-2 rounded-2xl bg-[#F2F4F1] p-3">
      <p className="text-base font-bold">{ask ? t("nearby.form.ask", "ฝากเพื่อนบ้านใกล้ๆ เรื่องอะไร") : t("nearby.form.alert", "เตือนเพื่อนบ้านเรื่องอะไร")}</p>
      <div className="grid grid-cols-2 gap-2">
        {topics.map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setForm({ ...form, topic: k, to_office: true })}
            aria-pressed={form.topic === k}
            className={`min-h-[52px] rounded-xl border-2 px-2 text-left text-[15px] font-bold leading-tight ${form.topic === k ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
          >
            <span aria-hidden="true">{icon} </span>
            {t(`nearby.${form.kind}.${k}`, label)}
          </button>
        ))}
      </div>
      {form.topic && (
        <>
          <textarea
            value={form.text}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
            maxLength={200}
            rows={2}
            placeholder={ask ? "รายละเอียด เช่น ไม่อยู่บ้านถึงวันอาทิตย์ กุญแจอยู่ที่…" : "อยู่ตรงไหน เช่น หน้าบ้าน 4/120 ฝั่งซ้าย"}
            className="w-full rounded-xl border border-[#A9B4AD] p-3 text-base"
          />
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="ชื่อเล่นคุณ"
            className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
          />
          {ask && (
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="เบอร์ หรือ LINE ID (คนที่กดรับช่วยถึงจะเห็น)"
              className="min-h-[48px] w-full rounded-xl border border-[#A9B4AD] px-3 text-base"
            />
          )}
          {!ask && topic?.[3] && (
            <label className="flex min-h-[48px] items-center gap-3 rounded-xl bg-white px-3 text-[15px]">
              <input type="checkbox" checked={!!form.to_office} onChange={(e) => setForm({ ...form, to_office: e.target.checked })} className="h-5 w-5 accent-[#1E6B47]" />
              ส่งเข้ารายการปัญหาในซอย ให้สำนักงานหมู่บ้านเห็นด้วย
            </label>
          )}
          <MediaPicker items={files} setItems={setFiles} max={2} />
          <p className="text-sm text-[#45504A]">{ask ? "เห็นเฉพาะบ้านในระยะ ~250 ม. · ปิดเองใน 1 วัน" : "เห็นเฉพาะบ้านในระยะ ~400 ม."}</p>
        </>
      )}
      <div className="flex gap-2">
        <button onClick={post} disabled={!form.topic} className="min-h-[52px] flex-1 rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50">
          {ask ? t("nearby.form.post_ask", "ฝากเพื่อนบ้าน") : t("nearby.form.post_alert", "เตือนเพื่อนบ้าน")}
        </button>
        <button onClick={() => setForm(null)} className="min-h-[52px] rounded-xl border border-[#C9D1CB] bg-white px-4 font-bold">
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

export default function Nearby({ info, form, setForm, setErr }) {
  const t = useT();
  const [items, setItems] = useState(null);
  const [posted, setPosted] = useState(null);
  const refresh = useCallback(() => {
    api(`/nearby?house=${encodeURIComponent(info.house)}`)
      .then(setItems)
      .catch(() => setItems([]));
  }, [info.house]);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 120000);
    return () => clearInterval(t);
  }, [refresh]);

  const share = posted
    ? `${posted.kind === "ask" ? `🙏 บ้าน ${posted.house} ขอ: ${posted.label}` : `⚠️ ระวัง: ${posted.label} แถวบ้าน ${posted.house}`}${posted.text ? ` · ${posted.text}` : ""}\nใครอยู่ใกล้ๆ กดดูได้ที่ ${window.location.origin}`
    : "";

  if (!form && !posted && !items?.length) return null;
  return (
    <div className="border-t border-[#E6EBE7] py-3">
      <p className="text-base font-bold text-[#15201A]">
        <span aria-hidden="true">🏘️ </span>
        {t("nearby.title", "รอบบ้านฉัน")}
      </p>
      <p className="text-sm text-[#45504A]">{t("nearby.sub", "เพื่อนบ้านระยะเดินถึง ฝากกันเรื่องเล็กๆ · เตือนกันให้ระวัง")}</p>
      <div className="mt-1 space-y-2">
        {items === null ? null : items.length ? (
          <ul className="space-y-2">
            {items.map((d) => (
              <Item key={d.id} d={d} onChange={refresh} setErr={setErr} />
            ))}
          </ul>
        ) : null}

        {posted && (
          <div className="rounded-2xl bg-[#E4F0E9] p-3">
            <p className="text-[15px] font-bold">ขึ้นให้เพื่อนบ้านใกล้ๆ เห็นแล้ว</p>
            <a
              href={`https://line.me/R/share?text=${encodeURIComponent(share)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex min-h-[48px] items-center justify-center rounded-xl bg-[#06C755] text-[15px] font-bold text-white"
            >
              {t("nearby.share", "แชร์เข้ากลุ่ม LINE ให้เห็นเร็วขึ้น")}
            </a>
          </div>
        )}

        {form ? (
          <NewForm
            form={form}
            setForm={setForm}
            house={info.house}
            setErr={setErr}
            onPosted={(d) => {
              setForm(null);
              setPosted(d);
              refresh();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
