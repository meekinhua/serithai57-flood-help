import { useCallback, useEffect, useState } from "react";
import { api, load, save } from "../api";
import { timeAgo } from "../config";
import { mediaUrl } from "../media";
import { openMedia } from "./MediaGallery";
import MediaPicker, { mediaState } from "./MediaPicker";
import { input } from "./RepairBoards";

// 💬 ถาม-ตอบ: neighbours help each other with what to do after the flood. People sign with their house
// number (4/917) or, from outside the village, with a name. Keys must match FORUM_CATEGORIES in backend/forum.py
export const FORUM_CATEGORIES = {
  car: ["🚗", "รถจมน้ำ / ซ่อมรถ"],
  house: ["🏠", "ล้างบ้าน / ซ่อมบ้าน"],
  furniture: ["🛋️", "เฟอร์นิเจอร์ / ของพัง"],
  electric: ["⚡", "ไฟฟ้า ประปา แอร์"],
  water: ["🌊", "น้ำ / การระบายน้ำ"],
  waste: ["♻️", "ขยะ"],
  health: ["🩺", "สุขภาพ"],
  money: ["📝", "เยียวยา / ประกัน"],
  general: ["💬", "ทั่วไป"],
};
const EXAMPLES = ["รถจมน้ำถึงเบาะ ซ่อมที่ไหนดี เคลมประกันยังไง", "พื้นปาร์เก้บวม รื้อหรือรอแห้ง", "โซฟา ฟูก ที่จมน้ำ ทิ้งที่ไหน", "แอร์คอยล์ร้อนจมน้ำ ต้องเปลี่ยนไหม"];
const label = "mb-1 block font-medium";

export function AuthorBadge({ a }) {
  if (!a) return null;
  return a.outsider ? (
    <span className="font-semibold">
      👤 {a.name} <span className="rounded bg-neutral-200 px-1 text-xs font-normal">คนนอก</span>
    </span>
  ) : (
    <span className="font-semibold">
      🏠 {a.house}
      {a.name && <span className="font-normal"> · {a.name}</span>}
    </span>
  );
}

// Who am I: house number (or outsider + name), remembered on this phone
function useIdentity() {
  const [me, setMe] = useState(() => {
    const m = load("forumMe", { house: "", name: load("contact", {}).name || "", outsider: false });
    return m.house || m.outsider ? m : { ...m, house: load("myHouse", "") || "" };
  });
  const set = (patch) =>
    setMe((m) => {
      const next = { ...m, ...patch };
      save("forumMe", next);
      return next;
    });
  return [me, set];
}

// 9 Oct: "917" → "4/917" (the number pad has no "/"); Thai digits too
export function whoAmI(me) {
  const h = (me.house || "").replace(/[๐-๙]/g, (d) => "๐๑๒๓๔๕๖๗๘๙".indexOf(d)).replace(/\s/g, "");
  return { ...me, house: me.outsider || !/^\d+[ก-ฮA-Za-z]?$/.test(h) ? h : `4/${h}` };
}
// the checks the phone's own form check would do, in Thai and on screen (some in-app browsers show nothing)
function checkMe(me) {
  const h = whoAmI(me).house;
  if (me.outsider) return me.name.trim() ? "" : "คนนอกหมู่บ้าน ใส่ชื่อเล่นด้วย";
  return /^4\/\d{1,5}/.test(h) ? "" : "ใส่บ้านเลขที่ เช่น 917 หรือ 4/917";
}

function IdentityFields({ me, set, idp }) {
  return (
    <fieldset className="space-y-2 rounded-xl bg-neutral-50 p-2">
      <legend className="sr-only">ลงชื่อ</legend>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-200 p-1">
        {[
          [false, "🏠 คนในหมู่บ้าน"],
          [true, "👤 คนนอก / ญาติ"],
        ].map(([v, t]) => (
          <button
            type="button"
            key={t}
            onClick={() => set({ outsider: v })}
            aria-pressed={me.outsider === v}
            className={`min-h-[40px] rounded-md text-sm font-semibold ${me.outsider === v ? "bg-white shadow" : "text-neutral-600"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {!me.outsider && (
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor={`${idp}-house`}>
              บ้านเลขที่ *
            </label>
            <input id={`${idp}-house`} inputMode="numeric" maxLength={20} value={me.house} onChange={(e) => set({ house: e.target.value })} className={input} placeholder="917 (ไม่ต้องพิมพ์ 4/)" />
          </div>
        )}
        <div className={me.outsider ? "col-span-2" : ""}>
          <label className="mb-1 block text-sm font-medium" htmlFor={`${idp}-name`}>
            ชื่อเล่น {me.outsider ? "*" : "(ไม่บังคับ)"}
          </label>
          <input id={`${idp}-name`} maxLength={40} value={me.name} onChange={(e) => set({ name: e.target.value })} className={input} />
        </div>
      </div>
    </fieldset>
  );
}

// openId / startCompose: the community feed and its "ask" door land straight on a topic or the form
export default function Forum({ admin, openId = null, startCompose = false, noCompose = false }) {
  const [topics, setTopics] = useState(null);
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(openId); // topic id
  const [compose, setCompose] = useState(startCompose);
  const [err, setErr] = useState("");
  const reload = useCallback(() => {
    const params = new URLSearchParams();
    if (cat !== "all") params.set("category", cat);
    if (q.trim()) params.set("q", q.trim());
    api(`/forum?${params}`)
      .then(setTopics)
      .catch((e) => setErr(e.message));
  }, [cat, q]);
  useEffect(() => {
    const t = setTimeout(reload, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [reload, q]);

  if (open)
    return (
      <TopicView
        id={open}
        admin={admin}
        onBack={() => {
          setOpen(null);
          reload();
        }}
      />
    );
  if (compose)
    return (
      <TopicForm
        onCancel={() => setCompose(false)}
        onDone={(t) => {
          setCompose(false);
          setOpen(t.id);
        }}
      />
    );

  return (
    <div className="space-y-3">
      <button onClick={() => setCompose(true)} className={noCompose ? "hidden" : "min-h-[56px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white"}>
        ✍️ ตั้งกระทู้ถาม / แชร์ความรู้
      </button>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ค้นหา เช่น ปาร์เก้, ประกันรถ, ตู้เย็น" className={input} aria-label="ค้นหากระทู้" />
      <div className="-mx-3 overflow-x-auto px-3 pb-1">
        <div className="flex w-max gap-2">
          {[["all", ["", "ทั้งหมด"]], ...Object.entries(FORUM_CATEGORIES)].map(([k, [emoji, text]]) => (
            <button
              key={k}
              onClick={() => setCat(k)}
              aria-pressed={cat === k}
              className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm ${cat === k ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}
            >
              {emoji} {text}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      {topics == null ? (
        <p className="rounded-xl bg-white p-4 text-center text-neutral-500">กำลังโหลด…</p>
      ) : topics.length ? (
        <ul className="space-y-2">
          {topics.map((t) => {
            const [emoji, catText] = FORUM_CATEGORIES[t.category] || ["💬", ""];
            return (
              <li key={t.id}>
                <button onClick={() => setOpen(t.id)} className="anim-row w-full rounded-xl border bg-white p-3 text-left shadow-sm active:bg-neutral-50">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs">
                    {t.pinned && <span className="rounded bg-black px-1.5 font-bold text-white">📌 ปักหมุด</span>}
                    {t.solved_reply && <span className="rounded bg-emerald-600 px-1.5 font-bold text-white">✅ ได้คำตอบแล้ว</span>}
                    <span className="text-neutral-600">
                      {emoji} {catText}
                    </span>
                  </span>
                  <span className="mt-0.5 block break-words text-lg font-bold leading-snug">{t.title}</span>
                  {t.body && <span className="line-clamp-2 block break-words text-sm text-neutral-700">{t.body}</span>}
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                    <AuthorBadge a={t.author} /> · 💬 {t.reply_count} คำตอบ · {timeAgo(t.last_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-xl bg-white p-4 text-center text-neutral-600">
          <p className="font-semibold">{q || cat !== "all" ? "ไม่พบกระทู้" : "ยังไม่มีกระทู้ เริ่มถามเป็นคนแรกได้เลย"}</p>
          <p className="mt-1 text-sm">เช่น {EXAMPLES.join(" · ")}</p>
        </div>
      )}
      <p className="text-xs text-neutral-500">พูดคุยกันด้วยความเคารพ · ไม่ต้องใส่เบอร์โทรในกระทู้ · ผู้ดูแลซ่อนข้อความที่ไม่เหมาะสมได้</p>
    </div>
  );
}

export function TopicForm({ onCancel, onDone }) {
  const [me, setMe] = useIdentity();
  const [form, setForm] = useState({ category: "", title: "", body: "" });
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const attached = mediaState(media);
  async function submit(e) {
    e.preventDefault();
    if (!form.category) return setErr("☝️ เลือกหมวดก่อน");
    if (form.title.trim().length < 4) return setErr("☝️ ใส่หัวข้อ / คำถาม (อย่างน้อย 4 ตัวอักษร)");
    const bad = checkMe(me);
    if (bad) return setErr(`☝️ ${bad}`);
    setBusy(true);
    setErr("");
    try {
      const t = await api("/forum", { method: "POST", body: JSON.stringify({ ...form, author: whoAmI(me), media_ids: attached.ids }) });
      save("forumKeys", { ...load("forumKeys", {}), [t.id]: t.edit_key });
      onDone(t);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }
  return (
    <form noValidate onSubmit={submit} className="space-y-4 rounded-xl bg-white p-3">
      <button type="button" onClick={onCancel} className="min-h-[44px] font-semibold underline">
        ‹ กลับ
      </button>
      <fieldset>
        <legend className={label}>หมวด *</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.entries(FORUM_CATEGORIES).map(([k, [emoji, text]]) => (
            <button
              type="button"
              key={k}
              onClick={() => setForm({ ...form, category: k })}
              aria-pressed={form.category === k}
              className={`flex min-h-[48px] items-center gap-2 rounded-lg border-2 px-2 text-left text-sm ${form.category === k ? "border-black bg-black text-white" : "border-neutral-200 bg-white"}`}
            >
              <span className="text-xl">{emoji}</span>
              <span className="leading-tight">{text}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label className={label} htmlFor="topic-title">
          หัวข้อ / คำถาม *
        </label>
        <input id="topic-title" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={input} placeholder={EXAMPLES[0]} />
      </div>
      <div>
        <label className={label} htmlFor="topic-body">
          รายละเอียด
        </label>
        <textarea
          id="topic-body"
          rows={5}
          maxLength={2000}
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          className={input}
          placeholder="เล่าสภาพ สิ่งที่ลองแล้ว อยากรู้อะไร · ถ้าเป็นความรู้ที่อยากแชร์ เขียนได้เลย"
        />
      </div>
      <div>
        <p className={label}>รูป (ไม่บังคับ)</p>
        <MediaPicker items={media} setItems={setMedia} max={3} allowVideo={false} />
      </div>
      <IdentityFields me={me} set={setMe} idp="topic" />
      {err && <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>}
      <button disabled={busy || attached.busy} className="min-h-[52px] w-full rounded-xl bg-[#1E6B47] text-lg font-semibold text-white disabled:opacity-60">
        {busy ? "กำลังส่ง…" : attached.busy ? "รอรูปอัปโหลด…" : "✍️ ตั้งกระทู้"}
      </button>
    </form>
  );
}

function Photos({ media }) {
  if (!media?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {media.map((m, i) => (
        <a key={m.id} href={mediaUrl(m.id)} onClick={(e) => { e.preventDefault(); openMedia(media, i); }}>
          <img src={mediaUrl(m.id, "thumb")} alt="" loading="lazy" className="h-24 w-24 rounded-lg object-cover" />
        </a>
      ))}
    </div>
  );
}

function TopicView({ id, admin, onBack }) {
  const [t, setT] = useState(null);
  const [err, setErr] = useState("");
  const [me, setMe] = useIdentity();
  const [text, setText] = useState("");
  const [media, setMedia] = useState([]);
  const [busy, setBusy] = useState(false);
  const [voted, setVoted] = useState(() => load("forumVotes", []));
  const topicKey = load("forumKeys", {})[id];
  const replyKeys = load("forumReplyKeys", {});
  const attached = mediaState(media);
  const reload = useCallback(
    () =>
      api(`/forum/${id}`)
        .then(setT)
        .catch((e) => setErr(e.message)),
    [id],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const run = async (fn) => {
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    }
  };
  async function reply(e) {
    e.preventDefault();
    const bad = !text.trim() ? "พิมพ์คำตอบก่อน" : checkMe(me);
    if (bad) return setErr(`☝️ ${bad}`);
    setBusy(true);
    await run(async () => {
      const r = await api(`/forum/${id}/replies`, { method: "POST", body: JSON.stringify({ body: text, author: whoAmI(me), media_ids: attached.ids }) });
      save("forumReplyKeys", { ...load("forumReplyKeys", {}), [r.id]: r.edit_key });
      setText("");
      setMedia([]);
      await reload();
    });
    setBusy(false);
  }
  if (!t) return <p className="rounded-xl bg-white p-4 text-center text-neutral-500">{err || "กำลังโหลด…"}</p>;
  const [emoji, catText] = FORUM_CATEGORIES[t.category] || ["💬", ""];
  const solved = t.replies.find((r) => r.id === t.solved_reply);
  const canSolve = !!topicKey || !!admin;

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="min-h-[44px] font-semibold underline">
        ‹ กระทู้ทั้งหมด
      </button>
      <article className="rounded-xl bg-white p-3">
        <p className="text-sm text-neutral-600">
          {emoji} {catText}
        </p>
        <h3 className="break-words text-xl font-bold leading-snug">{t.title}</h3>
        <p className="mt-1 text-sm text-neutral-500">
          <AuthorBadge a={t.author} /> · {timeAgo(t.created_at)}
        </p>
        {t.body && <p className="mt-2 whitespace-pre-wrap break-words">{t.body}</p>}
        <Photos media={t.media} />
        {(topicKey || admin) && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {admin && (
              <button
                onClick={() =>
                  run(async () => {
                    await api(`/admin/forum/${id}/pin`, { method: "PUT", body: JSON.stringify({ pinned: !t.pinned }) });
                    await reload();
                  })
                }
                className="min-h-[40px] underline"
              >
                {t.pinned ? "เลิกปักหมุด" : "📌 ปักหมุด"}
              </button>
            )}
            <button
              onClick={() =>
                window.confirm("ลบกระทู้นี้ทั้งกระทู้?") &&
                run(async () => {
                  await api(`/forum/${id}`, { method: "DELETE", headers: { "X-Edit-Key": topicKey || "" } });
                  onBack();
                })
              }
              className="min-h-[40px] text-red-700 underline"
            >
              ลบกระทู้
            </button>
          </div>
        )}
      </article>

      {solved && (
        <div className="rounded-xl border-2 border-emerald-600 bg-emerald-50 p-3">
          <p className="text-sm font-bold text-emerald-800">✅ คำตอบที่ช่วยได้</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{solved.body}</p>
          <p className="mt-1 text-xs text-neutral-600">
            <AuthorBadge a={solved.author} />
          </p>
        </div>
      )}

      <h4 className="font-bold">💬 {t.replies.length} คำตอบ</h4>
      <ul className="space-y-2">
        {t.replies.map((r) => (
          <li key={r.id} className={`rounded-xl bg-white p-3 ${r.id === t.solved_reply ? "ring-2 ring-emerald-600" : ""}`}>
            <p className="text-sm text-neutral-500">
              <AuthorBadge a={r.author} /> · {timeAgo(r.created_at)}
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{r.body}</p>
            <Photos media={r.media} />
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <button
                disabled={voted.includes(r.id)}
                onClick={() =>
                  run(async () => {
                    await api(`/forum/replies/${r.id}/vote`, { method: "POST" });
                    const next = [...voted, r.id];
                    setVoted(next);
                    save("forumVotes", next);
                    await reload();
                  })
                }
                className="min-h-[40px] rounded-lg border border-neutral-400 px-2 disabled:opacity-60"
              >
                👍 มีประโยชน์ {r.votes > 0 && r.votes}
              </button>
              {canSolve && (
                <button
                  onClick={() =>
                    run(async () =>
                      setT(await api(`/forum/${id}/solve`, { method: "POST", headers: { "X-Edit-Key": topicKey || "" }, body: JSON.stringify({ reply_id: r.id === t.solved_reply ? null : r.id }) })),
                    )
                  }
                  className="min-h-[40px] rounded-lg border border-emerald-700 px-2 text-emerald-800"
                >
                  {r.id === t.solved_reply ? "ยกเลิก ✅" : "✅ คำตอบนี้ช่วยได้"}
                </button>
              )}
              {(replyKeys[r.id] || admin) && (
                <button
                  onClick={() =>
                    window.confirm("ลบคำตอบนี้?") &&
                    run(async () => {
                      await api(`/forum/replies/${r.id}`, { method: "DELETE", headers: { "X-Edit-Key": replyKeys[r.id] || "" } });
                      await reload();
                    })
                  }
                  className="min-h-[40px] px-2 text-red-700 underline"
                >
                  ลบ
                </button>
              )}
            </div>
          </li>
        ))}
        {!t.replies.length && <li className="rounded-xl bg-white p-3 text-neutral-500">ยังไม่มีคำตอบ ใครเคยเจอแบบนี้ ช่วยแชร์หน่อย</li>}
      </ul>

      <form noValidate onSubmit={reply} className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
        <label className={label} htmlFor="reply-body">
          ตอบ / แชร์ประสบการณ์
        </label>
        <textarea id="reply-body" required rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className={input} />
        <MediaPicker items={media} setItems={setMedia} max={2} allowVideo={false} />
        <IdentityFields me={me} set={setMe} idp="reply" />
        <button disabled={busy || attached.busy || !text.trim()} className="min-h-[48px] w-full rounded-xl bg-[#1E6B47] font-bold text-white disabled:opacity-60">
          {busy ? "กำลังส่ง…" : "💬 ส่งคำตอบ"}
        </button>
      </form>
      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
    </div>
  );
}
