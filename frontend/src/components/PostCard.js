import { useState } from "react";
import { CATEGORIES, KINDS, STATUS, categoryOf, osmLink, paymentBadge, timeAgo } from "../config";
import { api, load, save } from "../api";
import MediaGallery, { MediaThumb } from "./MediaGallery";

// Hours an open request has had no "helping"/"done" update -- surfaced so nobody is forgotten.
export function waitingHours(post) {
  if (post.kind !== "need" || post.status !== "open") return 0;
  return (Date.now() - new Date(post.updated_at || post.created_at).getTime()) / 3.6e6;
}

export function PostSummary({ post, onOpen, fresh = false }) {
  const [emoji, catLabel] = categoryOf(post);
  const k = KINDS[post.kind];
  const waited = waitingHours(post);
  return (
    <button
      onClick={() => onOpen(post.id)}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm transition-transform duration-100 active:scale-[0.99] active:bg-neutral-50 ${fresh ? "anim-fresh " : ""}${
        post.urgent && post.status === "open" ? "border-red-500 ring-2 ring-red-200" : "border-neutral-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: k.pin, border: "2px solid #000" }}>
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {post.pinned && <span className="rounded bg-black px-1.5 font-bold text-white">📌 ปักหมุด</span>}
            {post.urgent && post.status === "open" && <span className="rounded bg-red-600 px-1.5 font-bold text-white">ด่วน</span>}
            <span className="font-semibold" style={{ color: k.color }}>{catLabel}</span>
            <span className={`rounded px-1.5 ${STATUS[post.status].cls}`}>{STATUS[post.status][post.kind]}</span>
            {waited >= 3 && <span className="rounded bg-yellow-300 px-1.5 font-bold text-black">⏳ รอมา {Math.floor(waited)} ชม.</span>}
            {post.general && <span className="rounded bg-neutral-100 px-1.5">🏘️ ทั้งหมู่บ้าน</span>}
            {paymentBadge(post) && <span className="rounded border border-black px-1.5 font-semibold">{paymentBadge(post)}</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words">{post.detail}</p>
          <p className="mt-0.5 text-sm text-neutral-500">
            {timeAgo(post.created_at)}
            {post.place && ` · ${post.place}`}
            {post.people != null && ` · ${post.people} คน`}
          </p>
        </div>
        <MediaThumb media={post.media} />
      </div>
    </button>
  );
}

export function PostDetail({ post, admin, onChanged, onDeleted, onShowOnMap }) {
  const [emoji, catLabel] = categoryOf(post);
  const k = KINDS[post.kind];
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editKey = load("editKeys", {})[post.id];
  const [phone, setPhone] = useState(null);
  const [fix, setFix] = useState({ kind: post.kind, category: post.category, urgent: Boolean(post.urgent) });

  // Numbers are fetched per post (not in the public list), so they can't be harvested in bulk.
  async function revealPhone() {
    try {
      setPhone((await api(`/posts/${post.id}/contact`)).phone || "");
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendNote() {
    if (!note.trim()) return setError("พิมพ์ข้อความที่จะอัปเดตก่อน เช่น ติดต่อไม่ได้ / ได้ของแล้วบางส่วน");
    await setStatus(post.status);
  }

  async function adminRefile() {
    try {
      onChanged(await api(`/admin/posts/${post.id}`, { method: "PATCH", body: JSON.stringify(fix) }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function setStatus(status) {
    if (!name.trim()) return setError("กรุณาใส่ชื่อของคุณก่อน เพื่อให้คนอื่นรู้ว่าใครรับเรื่อง");
    setBusy(true);
    setError("");
    try {
      save("contact", { ...load("contact", {}), name: name.trim() });
      onChanged(await api(`/posts/${post.id}/status`, { method: "POST", body: JSON.stringify({ status, name: name.trim(), note: note.trim() }) }));
      setNote("");
      // Remember what I took on, so the app can ask later whether it's done.
      const mine = load("myHelping", {});
      if (status === "helping") mine[post.id] = Date.now();
      else if (status !== post.status) delete mine[post.id];
      save("myHelping", mine);
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm("ลบโพสต์นี้?")) return;
    try {
      await api(`/posts/${post.id}`, { method: "DELETE", headers: { "X-Edit-Key": editKey } });
      const keys = load("editKeys", {});
      delete keys[post.id];
      save("editKeys", keys);
      onDeleted(post.id);
    } catch (err) {
      setError(err.message);
    }
  }

  async function adminPin() {
    try {
      onChanged(await api(`/admin/posts/${post.id}/pin`, { method: "POST", body: JSON.stringify({ pinned: !post.pinned }) }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function adminDelete() {
    if (!window.confirm("ลบรายการนี้ (สิทธิ์ผู้ดูแล)? ลบแล้วกู้คืนไม่ได้")) return;
    try {
      await api(`/admin/posts/${post.id}`, { method: "DELETE" });
      onDeleted(post.id);
    } catch (err) {
      setError(err.message);
    }
  }

  const btn = "min-h-[48px] rounded-xl px-4 font-semibold disabled:opacity-60";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="text-4xl">{emoji}</span>
        <div className="min-w-0">
          <p className="font-semibold" style={{ color: k.color }}>
            {k.emoji} {k.label} · {catLabel}
          </p>
          <div className="mt-1 flex flex-wrap gap-1.5 text-sm">
            {post.pinned && <span className="rounded bg-black px-1.5 font-bold text-white">📌 ปักหมุด</span>}
            {post.urgent && <span className="rounded bg-red-600 px-1.5 font-bold text-white">ด่วนมาก</span>}
            <span className={`rounded px-1.5 ${STATUS[post.status].cls}`}>{STATUS[post.status][post.kind]}</span>
            {paymentBadge(post) && <span className="rounded border border-black px-1.5 font-semibold">{paymentBadge(post)}</span>}
          </div>
        </div>
      </div>

      {post.payment === "paid" && (
        <p className="rounded-xl border-2 border-black p-3 text-sm">
          💰 รายการนี้มีค่าใช้จ่าย ระบบไม่ได้รับหรือถือเงิน ผู้ขอและผู้ช่วยตกลงกันเองโดยตรง
          <br />
          <b>ระวังมิจฉาชีพ:</b> อย่าโอนเงินก่อนได้รับความช่วยเหลือ
        </p>
      )}

      <p className="whitespace-pre-wrap break-words text-lg">{post.detail}</p>

      <MediaGallery media={post.media} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-700">
        {post.place && (<><dt className="text-neutral-500">ที่อยู่</dt><dd className="break-words">{post.place}</dd></>)}
        {post.people != null && (<><dt className="text-neutral-500">จำนวน</dt><dd>{post.people} คน</dd></>)}
        <dt className="text-neutral-500">ผู้แจ้ง</dt>
        <dd className="break-words">{post.name}</dd>
        <dt className="text-neutral-500">แจ้งเมื่อ</dt>
        <dd>{timeAgo(post.created_at)}</dd>
      </dl>

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {post.has_phone &&
          (phone ? (
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={`${btn} flex items-center justify-center bg-black text-white`}>
              📞 โทร {phone}
            </a>
          ) : (
            <button onClick={revealPhone} className={`${btn} bg-black text-white`}>
              📞 แสดงเบอร์โทร
            </button>
          ))}
        {post.general ? (
          <p className="rounded-xl bg-neutral-100 p-3 text-sm text-neutral-600">🏘️ ข่าวทั้งหมู่บ้าน ไม่ได้ระบุจุด</p>
        ) : (
          <>
            <button onClick={() => onShowOnMap(post)} className={`${btn} border border-neutral-300 bg-white`}>🗺️ ดูบนแผนที่</button>
            <a href={osmLink(post.lat, post.lng)} target="_blank" rel="noreferrer" className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
              🧭 เปิดใน OpenStreetMap
            </a>
            <a href={`geo:${post.lat},${post.lng}?q=${post.lat},${post.lng}`} className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
              📱 เปิดแอปแผนที่
            </a>
          </>
        )}
      </div>

      <section className="rounded-xl bg-neutral-50 p-3">
        <h3 className="mb-2 font-semibold">อัปเดตสถานะ</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="ชื่อของคุณ *" className="min-h-[44px] rounded-lg border border-neutral-300 px-3" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="ข้อความ เช่น ติดต่อไม่ได้ / ได้ของแล้ว" className="min-h-[44px] rounded-lg border border-neutral-300 px-3" />
        </div>
        <div className="mt-2 grid gap-2 min-[400px]:grid-cols-2">
          {post.status !== "helping" && (
            <button disabled={busy} onClick={() => setStatus("helping")} className={`${btn} bg-black text-white`}>
              🙋 {post.kind === "need" ? "ฉันจะไปช่วย" : "กำลังดำเนินการ"}
            </button>
          )}
          {post.status !== "done" && (
            <button disabled={busy} onClick={() => setStatus("done")} className={`${btn} border-2 border-black bg-white`}>
              ✅ {post.kind === "need" ? "ช่วยเสร็จ / ปลอดภัยแล้ว" : "ปิดรายการ"}
            </button>
          )}
          {post.status !== "open" && (
            <button disabled={busy} onClick={() => setStatus("open")} className={`${btn} border border-neutral-300 bg-white`}>
              ↩️ {post.kind === "need" ? "ยังต้องการความช่วยเหลือ" : "เปิดอีกครั้ง"}
            </button>
          )}
          <button disabled={busy} onClick={sendNote} className={`${btn} border border-neutral-300 bg-white`}>
            💬 ส่งข้อความอัปเดต (ไม่เปลี่ยนสถานะ)
          </button>
        </div>
        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-red-700">{error}</p>}
      </section>

      <section>
        <h3 className="mb-1 font-semibold">ประวัติ</h3>
        <ol className="space-y-1 text-sm text-neutral-700">
          {[...post.history].reverse().map((h, i) => (
            <li key={i} className="break-words">
              <span className="text-neutral-500">{timeAgo(h.at)}</span> · <b>{h.name}</b> → {STATUS[h.status][post.kind]}
              {h.note && ` — ${h.note}`}
            </li>
          ))}
        </ol>
      </section>

      {admin && (
        <section className="rounded-xl border-2 border-dashed border-black p-3">
          <h3 className="mb-2 font-semibold">🛡️ ผู้ดูแล</h3>
          <div className="grid gap-2 min-[400px]:grid-cols-2">
            <button onClick={adminPin} className={`${btn} border-2 border-black bg-white`}>
              {post.pinned ? "📌 เลิกปักหมุด" : "📌 ปักหมุดไว้บนสุด"}
            </button>
            <button onClick={adminDelete} className={`${btn} bg-red-600 text-white`}>
              🗑 ลบรายการ
            </button>
          </div>
          <div className="mt-3 space-y-2">
            <p className="text-sm font-semibold">แก้ประเภท (กรณีลงผิด เช่น ผู้ป่วยติดเตียงลงเป็น “แจ้งข้อมูล”)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                value={fix.kind}
                onChange={(e) => setFix({ kind: e.target.value, category: "other", urgent: e.target.value === "need" && fix.urgent })}
                className="min-h-[44px] rounded-lg border border-neutral-300 px-2"
              >
                {Object.entries(KINDS).map(([key, kk]) => (
                  <option key={key} value={key}>
                    {kk.emoji} {kk.label}
                  </option>
                ))}
              </select>
              <select value={fix.category} onChange={(e) => setFix({ ...fix, category: e.target.value })} className="min-h-[44px] rounded-lg border border-neutral-300 px-2">
                {Object.entries(CATEGORIES[fix.kind]).map(([key, [em, text]]) => (
                  <option key={key} value={key}>
                    {em} {text}
                  </option>
                ))}
              </select>
            </div>
            {fix.kind === "need" && (
              <label className="flex min-h-[44px] items-center gap-2">
                <input type="checkbox" checked={fix.urgent} onChange={(e) => setFix({ ...fix, urgent: e.target.checked })} className="h-5 w-5" />
                ด่วนมาก
              </label>
            )}
            <button onClick={adminRefile} className={`${btn} w-full border-2 border-black bg-white`}>
              บันทึกประเภทใหม่
            </button>
          </div>
        </section>
      )}

      {editKey && (
        <button onClick={remove} className="min-h-[44px] text-red-700 underline">
          ลบโพสต์ของฉัน
        </button>
      )}
    </div>
  );
}
