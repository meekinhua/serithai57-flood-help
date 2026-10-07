import { useEffect, useState } from "react";
import { api, load, save } from "../api";
import { mediaUrl } from "../media";
import MediaPicker, { mediaState } from "./MediaPicker";
import { shareLost } from "./LostFound";
import { seenVisits } from "../visits";

// ---------- 🐾 สัตว์เลี้ยงบ้านฉัน: photos and markings kept ahead of time; the day one goes missing, one tap posts it ----------
const KINDS = [
  ["dog", "🐕", "หมา"],
  ["cat", "🐈", "แมว"],
  ["pet", "🐾", "อื่นๆ"],
];
const box = "min-h-[50px] w-full rounded-xl border border-[#A9B4AD] bg-white px-3 text-base";
const btn = "min-h-[50px] rounded-xl px-3 text-[15px] font-bold";

function Face({ p, size = "h-16 w-16" }) {
  const photo = p.media?.[0];
  return photo ? (
    <img src={mediaUrl(photo.id, "thumb")} alt={p.name} className={`${size} shrink-0 rounded-2xl object-cover`} />
  ) : (
    <span className={`${size} flex shrink-0 items-center justify-center rounded-2xl bg-[#F2F4F1] text-3xl`} aria-hidden="true">
      {(KINDS.find((k) => k[0] === p.kind) || KINDS[2])[1]}
    </span>
  );
}

function PetForm({ house, pet, onSaved, onClose, onDelete, setErr }) {
  const [f, setF] = useState({ name: pet?.name || "", kind: pet?.kind || "dog", desc: pet?.desc || "" });
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const attached = mediaState(media);
  async function submit() {
    setErr("");
    setBusy(true);
    try {
      // new photos replace the old ones; no new photos keeps what is there
      const ids = attached.ids.length ? attached.ids : (pet?.media || []).map((m) => m.id);
      const r = await api("/myhome/pets", { method: "PUT", body: JSON.stringify({ house, pet: { id: pet?.id, ...f, media_ids: ids } }) });
      onSaved(r.pets);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-2xl bg-[#F7F8F6] p-3">
      <div className="grid grid-cols-3 gap-2">
        {KINDS.map(([k, icon, label]) => (
          <button
            key={k}
            onClick={() => setF({ ...f, kind: k })}
            aria-pressed={f.kind === k}
            className={`min-h-[48px] rounded-xl border-2 text-[15px] font-bold ${f.kind === k ? "border-[#1E6B47] bg-[#1E6B47] text-white" : "border-[#C9D1CB] bg-white"}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={40} placeholder="ชื่อน้อง เช่น โบ้" className={box} />
      <input value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} maxLength={200} placeholder="จุดสังเกต เช่น พันธุ์ไทย สีน้ำตาล ปลอกคอแดง หางขาด" className={box} />
      <div>
        <p className="mb-1 text-[15px] font-bold">รูปน้อง (ชัดๆ เห็นหน้าและลำตัว){pet?.media?.length ? " · ไม่เลือกใหม่ = ใช้รูปเดิม" : ""}</p>
        <MediaPicker items={media} setItems={setMedia} max={3} allowVideo={false} />
      </div>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || attached.busy || !f.name.trim()} className={`${btn} flex-1 bg-[#1E6B47] text-white disabled:opacity-40`}>
          {attached.busy ? "รอรูปอัปโหลด…" : "บันทึก"}
        </button>
        <button onClick={onClose} className={`${btn} border border-[#C9D1CB] bg-white`}>
          ปิด
        </button>
      </div>
      {pet && (
        <button onClick={onDelete} className="min-h-[40px] text-sm text-[#B42318] underline">
          ลบ {pet.name} ออกจากบ้านฉัน
        </button>
      )}
    </div>
  );
}

function LostNow({ house, pet, onPosted, onClose, setErr }) {
  const [f, setF] = useState({ name: load("myName", ""), phone: load("myReach", ""), when_seen: "" });
  const [busy, setBusy] = useState(false);
  async function post() {
    setErr("");
    setBusy(true);
    try {
      const x = await api(`/myhome/pets/${pet.id}/lost`, { method: "POST", body: JSON.stringify({ house, ...f }) });
      save("lostKeys", { ...load("lostKeys", {}), [x.id]: x.edit_key });
      save("myName", f.name);
      save("myReach", f.phone);
      onPosted(x);
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 rounded-2xl border-2 border-[#B42318] bg-[#FDE8E6] p-3">
      <p className="text-base font-bold text-[#7A1A12]">🚨 แจ้งว่า{pet.name}หาย · รูปและจุดสังเกตใส่ให้แล้ว</p>
      <input value={f.when_seen} onChange={(e) => setF({ ...f, when_seen: e.target.value })} maxLength={60} placeholder="หายตั้งแต่เมื่อไหร่ เช่น เมื่อเช้า 7 โมง" className={box} />
      <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} placeholder="ชื่อเจ้าของ (คนเจอจะเรียก)" className={box} />
      <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} inputMode="tel" placeholder="เบอร์โทร (แสดงเมื่อมีคนกดติดต่อ)" className={box} />
      <div className="flex gap-2">
        <button onClick={post} disabled={busy || !f.name.trim() || f.phone.trim().length < 3} className={`${btn} flex-1 bg-[#B42318] text-white disabled:opacity-40`}>
          {busy ? "กำลังประกาศ…" : "📢 ประกาศทั้งหมู่บ้านเลย"}
        </button>
        <button onClick={onClose} className={`${btn} border border-[#C9D1CB] bg-white`}>
          ยกเลิก
        </button>
      </div>
      <p className="text-sm text-[#45504A]">ขึ้นหน้าแรกของทุกคนทันที · เจอแล้วกด “เจอแล้ว” ที่นี่</p>
    </div>
  );
}

export default function PetsRow({ house, setErr, onLostPosted, onOpenLost }) {
  const [pets, setPets] = useState(null);
  const [edit, setEdit] = useState(null); // "new" | pet id
  const [losing, setLosing] = useState(null);
  const [posted, setPosted] = useState(null);
  const [no, setNo] = useState(() => load("petsNo", false) || seenVisits("pets:invite") > 3); // asked 3 visits, then just a link
  const reload = () =>
    api(`/myhome/pets?house=${encodeURIComponent(house)}`)
      .then((r) => setPets(r.pets))
      .catch(() => setPets([]));
  useEffect(() => {
    setPets(null);
    reload();
  }, [house]); // eslint-disable-line react-hooks/exhaustive-deps
  if (pets === null) return null;

  if (!pets.length && edit !== "new") {
    if (no)
      return (
        <button
          onClick={() => {
            setNo(false);
            save("petsNo", false);
          }}
          className="block min-h-[40px] border-t border-[#E6EBE7] pt-1 text-sm text-[#45504A] underline"
        >
          🐾 เลี้ยงหมาแมว? ลงรูปน้องไว้
        </button>
      );
    return (
      <div id="myhome-pets" className="border-t border-[#E6EBE7] py-3">
        <div className="flex items-start gap-3 rounded-2xl bg-[#FFF8E1] p-3">
          <span className="text-3xl" aria-hidden="true">
            🐶
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold leading-snug">เลี้ยงหมาแมว? ลงรูปน้องไว้ก่อน</p>
            <p className="text-[15px] leading-snug text-[#33403A]">ถ้าวันไหนน้องหาย กดปุ่มเดียว ประกาศพร้อมรูปขึ้นหน้าแรกของทั้งหมู่บ้านทันที ไม่ต้องรีบหารูป</p>
            <div className="mt-2 flex gap-2">
              <button onClick={() => setEdit("new")} className={`${btn} flex-1 bg-[#1E6B47] text-white`}>
                + ลงน้องของฉัน
              </button>
              <button
                onClick={() => {
                  setNo(true);
                  save("petsNo", true);
                }}
                className={`${btn} text-[#45504A] underline`}
              >
                ไม่ได้เลี้ยง
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="myhome-pets" className="space-y-2 border-t border-[#E6EBE7] py-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-base font-bold">🐾 สัตว์เลี้ยงบ้านฉัน</p>
        {pets.length > 0 && pets.length < 6 && edit !== "new" && (
          <button onClick={() => setEdit("new")} className="min-h-[40px] text-[15px] font-bold text-[#1E6B47] underline">
            + เพิ่ม
          </button>
        )}
      </div>
      {edit === "new" && (
        <PetForm
          house={house}
          setErr={setErr}
          onClose={() => setEdit(null)}
          onSaved={(p) => {
            setPets(p);
            setEdit(null);
          }}
        />
      )}
      {posted && (
        // the poster sees what everybody now sees, and passes it on
        <div className="space-y-2 rounded-2xl bg-[#E4F0E9] p-3">
          <p className="text-base font-bold">✅ ประกาศแล้ว · ขึ้นหน้าแรกของทุกคนในหมู่บ้าน</p>
          <button onClick={() => shareLost(posted)} className={`${btn} w-full bg-[#06C755] text-white`}>
            📤 ส่งต่อในกลุ่ม LINE (ยิ่งแชร์ ยิ่งเจอเร็ว)
          </button>
          <button onClick={() => onOpenLost(posted.id)} className="min-h-[40px] text-[15px] font-bold underline">
            ดูประกาศ ›
          </button>
        </div>
      )}
      {pets.map((p) =>
        edit === p.id ? (
          <PetForm
            key={p.id}
            house={house}
            pet={p}
            setErr={setErr}
            onClose={() => setEdit(null)}
            onSaved={(list) => {
              setPets(list);
              setEdit(null);
            }}
            onDelete={async () => {
              if (!window.confirm(`ลบ ${p.name}?`)) return;
              try {
                await api(`/myhome/pets/${p.id}?house=${encodeURIComponent(house)}`, { method: "DELETE" });
                setEdit(null);
                reload();
              } catch (e) {
                setErr(e.message);
              }
            }}
          />
        ) : (
          <div key={p.id} className={`rounded-2xl p-2.5 ${p.lost_id ? "border-2 border-[#B42318] bg-[#FDE8E6]" : "bg-[#F7F8F6]"}`}>
            <div className="flex items-center gap-3">
              <Face p={p} />
              <div className="min-w-0 flex-1">
                <b className="block text-[17px] leading-tight">{p.name}</b>
                {p.lost_id ? (
                  <span className="text-[15px] font-bold text-[#B42318]">🔎 กำลังตามหา · อยู่หน้าแรกของทุกคน</span>
                ) : (
                  <span className="line-clamp-2 text-sm text-[#45504A]">{p.desc || "แตะแก้ไขเพื่อใส่จุดสังเกต"}</span>
                )}
              </div>
              {!p.lost_id && (
                <button onClick={() => setEdit(p.id)} className="min-h-[40px] shrink-0 px-1 text-sm text-[#45504A] underline">
                  แก้ไข
                </button>
              )}
            </div>
            {losing === p.id ? (
              <div className="mt-2">
                <LostNow
                  house={house}
                  pet={p}
                  setErr={setErr}
                  onClose={() => setLosing(null)}
                  onPosted={(x) => {
                    setLosing(null);
                    setPosted({ ...x, soi: x.soi });
                    reload();
                    onLostPosted && onLostPosted(x);
                  }}
                />
              </div>
            ) : p.lost_id ? (
              <div className="mt-2 flex gap-2">
                <button onClick={() => shareLost({ id: p.lost_id, title: `${p.name} หาย${p.desc ? ` · ${p.desc}` : ""}` })} className={`${btn} flex-1 bg-[#06C755] text-white`}>
                  📤 ส่งต่อใน LINE
                </button>
                <button
                  onClick={async () => {
                    try {
                      await api(`/myhome/pets/${p.id}/found?house=${encodeURIComponent(house)}`, { method: "POST" });
                      setPosted(null);
                      reload();
                    } catch (e) {
                      setErr(e.message);
                    }
                  }}
                  className={`${btn} bg-[#1E6B47] text-white`}
                >
                  🎉 เจอแล้ว
                </button>
              </div>
            ) : (
              <button onClick={() => setLosing(p.id)} className="mt-2 min-h-[46px] w-full rounded-xl border-2 border-[#B42318] bg-white text-[15px] font-bold text-[#B42318]">
                🚨 {p.name}หาย! แจ้งทั้งหมู่บ้าน
              </button>
            )}
          </div>
        ),
      )}
    </div>
  );
}
