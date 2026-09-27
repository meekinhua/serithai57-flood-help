import { useState } from "react";
import { KINDS, STATUS, categoryOf, osmLink, paymentBadge, timeAgo } from "../config";
import { api, load, save } from "../api";

export function PostSummary({ post, onOpen }) {
  const [emoji, catLabel] = categoryOf(post);
  const k = KINDS[post.kind];
  return (
    <button
      onClick={() => onOpen(post.id)}
      className={`w-full rounded-xl border bg-white p-3 text-left shadow-sm active:bg-neutral-50 ${
        post.urgent && post.status === "open" ? "border-red-500 ring-2 ring-red-200" : "border-neutral-200"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl" style={{ background: k.pin, border: "2px solid #000" }}>
          {emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            {post.urgent && post.status === "open" && <span className="rounded bg-red-600 px-1.5 font-bold text-white">ด่วน</span>}
            <span className="font-semibold" style={{ color: k.color }}>{catLabel}</span>
            <span className={`rounded px-1.5 ${STATUS[post.status].cls}`}>{STATUS[post.status][post.kind]}</span>
            {paymentBadge(post) && <span className="rounded border border-black px-1.5 font-semibold">{paymentBadge(post)}</span>}
          </div>
          <p className="mt-0.5 line-clamp-2 break-words">{post.detail}</p>
          <p className="mt-0.5 text-sm text-neutral-500">
            {timeAgo(post.created_at)}
            {post.place && ` · ${post.place}`}
            {post.people != null && ` · ${post.people} คน`}
          </p>
        </div>
      </div>
    </button>
  );
}

export function PostDetail({ post, onChanged, onDeleted, onShowOnMap }) {
  const [emoji, catLabel] = categoryOf(post);
  const k = KINDS[post.kind];
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const editKey = load("editKeys", {})[post.id];

  async function setStatus(status) {
    if (!name.trim()) return setError("กรุณาใส่ชื่อของคุณก่อน เพื่อให้คนอื่นรู้ว่าใครรับเรื่อง");
    setBusy(true);
    setError("");
    try {
      save("contact", { ...load("contact", {}), name: name.trim() });
      onChanged(await api(`/posts/${post.id}/status`, { method: "POST", body: JSON.stringify({ status, name: name.trim(), note: note.trim() }) }));
      setNote("");
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

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-neutral-700">
        {post.place && (<><dt className="text-neutral-500">ที่อยู่</dt><dd className="break-words">{post.place}</dd></>)}
        {post.people != null && (<><dt className="text-neutral-500">จำนวน</dt><dd>{post.people} คน</dd></>)}
        <dt className="text-neutral-500">ผู้แจ้ง</dt>
        <dd className="break-words">{post.name}</dd>
        <dt className="text-neutral-500">แจ้งเมื่อ</dt>
        <dd>{timeAgo(post.created_at)}</dd>
      </dl>

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2">
        {post.phone && (
          <a href={`tel:${post.phone.replace(/[^\d+]/g, "")}`} className={`${btn} flex items-center justify-center bg-black text-white`}>
            📞 โทร {post.phone}
          </a>
        )}
        <button onClick={() => onShowOnMap(post)} className={`${btn} border border-neutral-300 bg-white`}>🗺️ ดูบนแผนที่</button>
        <a href={osmLink(post.lat, post.lng)} target="_blank" rel="noreferrer" className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
          🧭 เปิดใน OpenStreetMap
        </a>
        <a href={`geo:${post.lat},${post.lng}?q=${post.lat},${post.lng}`} className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
          📱 เปิดแอปแผนที่
        </a>
      </div>

      <section className="rounded-xl bg-neutral-50 p-3">
        <h3 className="mb-2 font-semibold">อัปเดตสถานะ</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="ชื่อของคุณ *" className="min-h-[44px] rounded-lg border border-neutral-300 px-3" />
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="หมายเหตุ (ไม่บังคับ)" className="min-h-[44px] rounded-lg border border-neutral-300 px-3" />
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

      {editKey && (
        <button onClick={remove} className="min-h-[44px] text-red-700 underline">
          ลบโพสต์ของฉัน
        </button>
      )}
    </div>
  );
}
