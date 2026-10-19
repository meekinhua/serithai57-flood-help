import { useEffect, useState } from "react";
import { api } from "../api";
import { notify } from "../notify";

// 🧠 สรุปรายวัน (20 Oct 2026): a Claude Desktop scheduled task on the admin's computer reads the FB page, LINE OA,
// the village LINE export and the site's new posts twice a day, and sends this digest (backend/digest.py,
// docs/digest_brain.md). The admin skims it on the phone: what to answer first (with a drafted reply to copy),
// what people talk about, who is looking for what, praise, risks, content ideas — and ticks things off.

const SRC = {
  fb_inbox: ["📩", "inbox เพจ"],
  fb_comment: ["💬", "คอมเมนต์ FB"],
  line_oa: ["🟢", "LINE OA"],
  line_group: ["👥", "กลุ่ม LINE"],
  site: ["🌐", "เว็บ"],
};
const LEVEL = {
  high: "bg-[#FDECEC] border-[#E5484D]",
  mid: "bg-[#FFF8EC] border-[#F2B872]",
  low: "bg-white border-[#DCE2DD]",
};
const PERIOD = {
  morning: "🌅 เช้า",
  midday: "☀️ เที่ยง",
  evening: "🌙 เย็น",
  manual: "✍️ สั่งเอง",
};
const TREND = { up: "↑", down: "↓", same: "→" };

function copy(text) {
  navigator.clipboard?.writeText(text).then(
    () => notify("คัดลอกแล้ว"),
    () => window.prompt("คัดลอกข้อความนี้", text),
  );
}

const CH = {
  fb_inbox: "📩 inbox เพจ",
  fb_comment: "💬 ตอบใต้คอมเมนต์ FB (สาธารณะ)",
  line: "🟢 LINE OA",
};

// ✉️ ร่างคำตอบ: Claude drafts, the admin edits and taps ส่ง — the server sends (FB page token / LINE bot).
// LINE "ฝากตอบ" waits for the person's next message and rides on the bot's reply (free); "ส่งทันที" is a push (quota).
function Outbox() {
  const [box, setBox] = useState(null);
  const [text, setText] = useState({});
  const [busy, setBusy] = useState("");
  const load = () =>
    api("/admin/replies")
      .then(setBox)
      .catch(() => setBox({ items: [] }));
  useEffect(() => {
    load();
  }, []);
  if (!box || !box.items.length) return null;
  const q = box.line_quota || {};
  async function send(d, mode) {
    const body = (text[d.id] ?? d.text ?? d.draft).trim();
    if (!body) return;
    const where =
      d.channel === "line"
        ? mode === "later"
          ? "ฝากไว้ส่งตอนเขาทักมา"
          : "ส่งทาง LINE ทันที (ใช้โควตา push)"
        : CH[d.channel];
    if (!window.confirm(`${where}\nถึง ${d.who || "-"}\n\n${body}`)) return;
    setBusy(d.id);
    try {
      const r = await api(`/admin/replies/${d.id}/send`, {
        method: "POST",
        body: JSON.stringify({ text: body, mode }),
      });
      notify(r.message || "ส่งแล้ว");
      load();
    } catch (e) {
      notify(e.message);
      load();
    } finally {
      setBusy("");
    }
  }
  async function skip(d) {
    setBusy(d.id);
    try {
      await api(`/admin/replies/${d.id}/skip`, { method: "POST" });
      load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy("");
    }
  }
  const open = box.items.filter((d) => d.status !== "queued");
  const queued = box.items.filter((d) => d.status === "queued");
  return (
    <Section title="✉️ ร่างคำตอบ รอแอดกดส่ง" n={open.length}>
      {!box.fb_ready && box.items.some((d) => d.channel !== "line") && (
        <p className="rounded-lg bg-[#FFF8EC] p-2 text-sm">
          ยังส่ง FB จากหน้านี้ไม่ได้ — รัน tools/fb_setup.py ก่อน
          (ระหว่างนี้คัดลอกไปตอบเอง)
        </p>
      )}
      {open.map((d) => (
        <div
          key={d.id}
          className={`space-y-2 rounded-xl border-2 p-3 ${d.status === "failed" ? "border-[#E5484D] bg-[#FDECEC]" : "border-[#1F4F8A] bg-[#F3F7FC]"}`}
        >
          <p className="text-sm font-semibold text-[#45504A]">
            {CH[d.channel]}
            {d.who && ` · ${d.who}`}
            {d.soi && ` · ซ.${d.soi}`}
          </p>
          {d.question && (
            <p className="border-l-4 border-[#C9D1CB] pl-2 text-sm text-[#45504A]">
              “{d.question}”
            </p>
          )}
          <textarea
            value={text[d.id] ?? d.text ?? d.draft}
            onChange={(e) => setText((t) => ({ ...t, [d.id]: e.target.value }))}
            rows={Math.min(
              8,
              Math.max(3, Math.ceil((text[d.id] ?? d.draft).length / 38)),
            )}
            className="w-full rounded-lg border-2 border-[#C9D1CB] bg-white p-2 text-[15px] leading-snug"
            aria-label={`คำตอบถึง ${d.who || ""}`}
          />
          {d.status === "failed" && (
            <p className="text-sm font-semibold text-[#B42318]">
              ส่งไม่สำเร็จ: {d.result}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {d.channel === "line" ? (
              <>
                <button
                  disabled={busy === d.id}
                  onClick={() => send(d, "later")}
                  className="min-h-[44px] rounded-lg bg-[#1E6B47] px-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  ✉️ ฝากตอบ (ฟรี)
                </button>
                <button
                  disabled={busy === d.id}
                  onClick={() => send(d, "now")}
                  className="min-h-[44px] rounded-lg border-2 border-[#1E6B47] bg-white px-3 text-sm font-bold text-[#1E6B47] disabled:opacity-50"
                >
                  ส่งทันที
                </button>
              </>
            ) : (
              <button
                disabled={busy === d.id || !box.fb_ready}
                onClick={() => send(d, "now")}
                className="min-h-[44px] rounded-lg bg-[#1F4F8A] px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                ✉️ ส่ง
              </button>
            )}
            <button
              onClick={() => copy(text[d.id] ?? d.draft)}
              className="min-h-[44px] rounded-lg border-2 border-[#C9D1CB] bg-white px-3 text-sm font-semibold"
            >
              📋
            </button>
            <button
              disabled={busy === d.id}
              onClick={() => skip(d)}
              className="min-h-[44px] px-2 text-sm font-semibold text-[#45504A] underline"
            >
              ข้าม
            </button>
            {d.link && (
              <a
                href={d.link}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-semibold text-[#1F4F8A] underline"
              >
                ต้นทาง ›
              </a>
            )}
          </div>
          {d.channel === "line" && (
            <p className="text-xs text-[#45504A]">
              ฝากตอบ = ส่งพร้อมคำตอบของบอทตอนเขาทักมาครั้งหน้า (ไม่เสียโควตา) ·
              ส่งทันที = push
              {q.limit != null &&
                ` · ใช้ไปแล้ว ${q.used ?? "?"}/${q.limit} เดือนนี้`}
            </p>
          )}
        </div>
      ))}
      {queued.length > 0 && (
        <div className="card space-y-1 p-3">
          <p className="text-sm font-bold">
            ⏳ ฝากตอบไว้ รอเขาทักมา ({queued.length})
          </p>
          {queued.map((d) => (
            <p key={d.id} className="text-sm text-[#45504A]">
              · {d.who || "-"}: {(d.text || d.draft).slice(0, 70)}
            </p>
          ))}
        </div>
      )}
    </Section>
  );
}

function Section({ title, children, n }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-lg font-bold">
        {title}
        {n != null && (
          <span className="ml-1 text-base font-semibold text-[#45504A]">
            ({n})
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

export default function DigestAdmin() {
  const [list, setList] = useState(null);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/admin/digests?days=14")
      .then(setList)
      .catch((e) => setErr(e.message));
  }, []);
  if (err)
    return <p className="rounded-lg bg-red-50 p-3 text-red-700">{err}</p>;
  if (!list) return <p className="p-3 text-[#45504A]">กำลังโหลด…</p>;
  if (!list.length)
    return (
      <div className="card space-y-2 p-4">
        <p className="font-bold">ยังไม่มีสรุป</p>
        <p className="text-sm text-[#45504A]">
          สรุปมาจาก Claude Desktop บนคอมแอด (scheduled task เช้า–เย็น) · ดู
          docs/digest_brain.md
        </p>
      </div>
    );
  const d = list[at];
  const x = d.data || {};
  const done = new Set(d.done || []);
  async function tick(key, on) {
    try {
      await api(`/admin/digest/${d.date}/${d.period}/done`, {
        method: "POST",
        body: JSON.stringify({ key, done: on }),
      });
      setList((p) =>
        p.map((y, i) =>
          i === at
            ? {
                ...y,
                done: on
                  ? [...(y.done || []), key]
                  : (y.done || []).filter((k) => k !== key),
              }
            : y,
        ),
      );
    } catch (e) {
      notify(e.message);
    }
  }
  const Tick = ({ k }) =>
    k ? (
      <label className="flex min-h-[40px] items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          className="h-5 w-5"
          checked={done.has(k)}
          onChange={(e) => tick(k, e.target.checked)}
        />{" "}
        ทำแล้ว
      </label>
    ) : null;
  const urgent = x.urgent || [];
  const left = urgent.filter((u) => !done.has(u.key)).length;
  return (
    <div className="space-y-5">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex w-max gap-1.5">
          {list.map((y, i) => (
            <button
              key={`${y.date}-${y.period}`}
              onClick={() => setAt(i)}
              aria-pressed={i === at}
              className={`min-h-[40px] whitespace-nowrap rounded-full px-3 text-sm font-semibold ${i === at ? "bg-[#15201A] text-white" : "border border-[#C9D1CB] bg-white"}`}
            >
              {y.date.slice(8)}/{y.date.slice(5, 7)}{" "}
              {PERIOD[y.period] || y.period}
            </button>
          ))}
        </div>
      </div>

      <Outbox />

      <div className="card space-y-2 p-4">
        <p className="text-sm text-[#45504A]">
          🧠 Claude สรุป · {x.window || d.date}
        </p>
        <p className="text-[17px] font-bold leading-snug">{x.headline}</p>
        {left > 0 && (
          <p className="text-sm font-semibold text-[#B42318]">
            ⚡ เหลือต้องตอบ/ทำ {left} เรื่อง
          </p>
        )}
        {(x.stats || []).length > 0 && (
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {x.stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-[#F2F4F1] p-2 text-center"
              >
                <b className="block text-xl">{s.value}</b>
                <span className="block text-xs leading-tight text-[#45504A]">
                  {s.label}
                </span>
                {s.delta && (
                  <span className="text-xs font-semibold text-[#1E6B47]">
                    {s.delta}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {urgent.length > 0 && (
        <Section title="⚡ ต้องตอบ / ทำก่อน" n={urgent.length}>
          {urgent.map((u, i) => {
            const [e, s] = SRC[u.source] || ["•", u.source || ""];
            const isDone = done.has(u.key);
            return (
              <div
                key={u.key || i}
                className={`space-y-1.5 rounded-xl border-2 p-3 ${LEVEL[u.level] || LEVEL.low} ${isDone ? "opacity-50" : ""}`}
              >
                <p className="text-sm font-semibold text-[#45504A]">
                  {e} {s}
                  {u.who && ` · ${u.who}`}
                  {u.soi && ` · ซ.${u.soi}`}
                </p>
                <p className="text-[16px] font-bold leading-snug">
                  {u.summary}
                </p>
                {u.quote && (
                  <p className="border-l-4 border-[#C9D1CB] pl-2 text-sm text-[#45504A]">
                    “{u.quote}”
                  </p>
                )}
                {u.action && <p className="text-sm">👉 {u.action}</p>}
                {u.reply && u.send && !isDone && (
                  <p className="text-sm font-semibold text-[#1F4F8A]">
                    ✉️ ร่างคำตอบอยู่ในกล่องด้านบน แก้แล้วกดส่งได้เลย
                  </p>
                )}
                {u.reply && !u.send && (
                  <div className="rounded-lg bg-white/80 p-2">
                    <p className="whitespace-pre-wrap text-sm">{u.reply}</p>
                    <button
                      onClick={() => copy(u.reply)}
                      className="mt-1 min-h-[40px] rounded-lg border-2 border-[#15201A] px-3 text-sm font-bold"
                    >
                      📋 คัดลอกคำตอบ
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  {u.link && (
                    <a
                      href={u.link}
                      target="_blank"
                      rel="noreferrer"
                      className="min-h-[40px] text-sm font-semibold text-[#1F4F8A] underline"
                    >
                      เปิดต้นทาง ›
                    </a>
                  )}
                  <Tick k={u.key} />
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {(x.requests || []).length > 0 && (
        <Section title="📢 มีคนกำลังหา" n={x.requests.length}>
          {x.requests.map((r, i) => (
            <div
              key={r.key || i}
              className={`card space-y-1 p-3 ${done.has(r.key) ? "opacity-50" : ""}`}
            >
              <p className="font-bold">{r.what}</p>
              <p className="text-sm text-[#45504A]">
                {[
                  r.who,
                  r.soi && `ซ.${r.soi}`,
                  r.category,
                  r.posted ? "✅ อยู่ในระบบแล้ว" : "ยังไม่ได้ลงระบบ",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {r.link && (
                  <a
                    href={r.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-semibold text-[#1F4F8A] underline"
                  >
                    เปิด ›
                  </a>
                )}
                <Tick k={r.key} />
              </div>
            </div>
          ))}
        </Section>
      )}

      {(x.topics || []).length > 0 && (
        <Section title="📈 คุยเรื่องอะไรกัน">
          <div className="card divide-y divide-[#EEF1EE] p-0">
            {x.topics.map((t, i) => (
              <div key={i} className="space-y-1 p-3">
                <p className="flex items-center gap-2">
                  <b className="min-w-0 flex-1">{t.name}</b>
                  <span className="text-sm font-semibold">
                    {t.count} {TREND[t.trend] || ""}
                  </span>
                </p>
                {t.note && <p className="text-sm text-[#45504A]">{t.note}</p>}
                {(t.examples || []).slice(0, 3).map((ex, j) => (
                  <p key={j} className="text-sm text-[#45504A]">
                    · “{ex}”
                  </p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(x.market || []).length > 0 && (
        <Section title="🛍️ ตลาด / ร้าน" n={x.market.length}>
          {x.market.map((m, i) => (
            <p key={i} className="card p-3 text-[15px]">
              <b>{m.title}</b>
              {m.note && <span className="text-[#45504A]"> · {m.note}</span>}
              {m.link && (
                <a
                  href={m.link}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-sm text-[#1F4F8A] underline"
                >
                  เปิด
                </a>
              )}
            </p>
          ))}
        </Section>
      )}

      {(x.risks || []).length > 0 && (
        <Section title="⚠️ ต้องระวัง">
          {x.risks.map((r, i) => (
            <div
              key={r.key || i}
              className="rounded-xl border-2 border-[#F2B872] bg-[#FFF8EC] p-3"
            >
              <p className="font-bold">{r.summary}</p>
              {r.why && <p className="text-sm text-[#5C3B00]">{r.why}</p>}
            </div>
          ))}
        </Section>
      )}

      {(x.praise || []).length > 0 && (
        <Section title="💚 คำชม / ขอบคุณ" n={x.praise.length}>
          <div className="card space-y-1 p-3">
            {x.praise.map((p, i) => (
              <p key={i} className="text-sm">
                · {p}
              </p>
            ))}
          </div>
        </Section>
      )}

      {(x.ideas || []).length > 0 && (
        <Section title="💡 ไอเดียโพสต์ / ทำต่อ">
          {x.ideas.map((idea, i) => (
            <div
              key={idea.key || i}
              className={`card space-y-1 p-3 ${done.has(idea.key) ? "opacity-50" : ""}`}
            >
              <p className="font-bold">{idea.title}</p>
              {idea.why && <p className="text-sm text-[#45504A]">{idea.why}</p>}
              {idea.format && (
                <p className="text-sm text-[#1E6B47]">รูปแบบ: {idea.format}</p>
              )}
              <Tick k={idea.key} />
            </div>
          ))}
        </Section>
      )}

      {x.notes && (
        <p className="whitespace-pre-wrap rounded-xl bg-[#F2F4F1] p-3 text-sm text-[#45504A]">
          {x.notes}
        </p>
      )}
      <p className="px-1 text-xs text-[#45504A]">
        ส่งมาเมื่อ {new Date(d.at).toLocaleString("th-TH")} ·
        เบอร์โทรถูกปิดอัตโนมัติ · Claude ร่างคำตอบให้เท่านั้น ส่งเมื่อแอดกดส่ง
      </p>
    </div>
  );
}
