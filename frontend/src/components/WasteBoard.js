import { useEffect, useState } from "react";
import { MediaStrip } from "./MediaGallery";
import { api } from "../api";
import { timeAgo } from "../config";
import { input } from "./RepairBoards";

// ♻️ ขยะ: the district truck rounds (when someone finds them) and how to sort flood waste.
// Everything lives in the database: an admin edits it right here, no redeploy.
export default function WasteBoard({ admin, onReportTrash }) {
  const [waste, setWaste] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api("/waste")
      .then(setWaste)
      .catch((e) => setErr(e.message));
  }, []);
  if (!waste) return <p className="rounded-xl bg-white p-4 text-center text-neutral-500">{err || "กำลังโหลด…"}</p>;
  if (edit)
    return (
      <WasteEditor
        value={edit}
        onCancel={() => setEdit(null)}
        onSaved={(w) => {
          setWaste(w);
          setEdit(null);
        }}
      />
    );

  return (
    <div className="space-y-3">
      {admin && (
        <button
          onClick={() => setEdit(JSON.parse(JSON.stringify({ notice: waste.notice, schedule: waste.schedule, guide: waste.guide, contacts: waste.contacts || [] })))}
          className="min-h-[48px] w-full rounded-xl border-2 border-dashed border-black bg-yellow-50 font-bold"
        >
          ✏️ แก้ไขตารางรถ / วิธีแยกขยะ (ผู้ดูแล)
        </button>
      )}
      {waste.notice && <p className="rounded-xl border-2 border-black bg-yellow-50 p-3 font-semibold">📢 {waste.notice}</p>}
      <MediaStrip media={waste.media || []} size={96} />

      <section className="rounded-xl bg-white p-3">
        <h3 className="mb-2 text-lg font-bold">🚛 ตารางรถเก็บขยะ</h3>
        {waste.schedule.length ? (
          <ul className="divide-y divide-neutral-200">
            {waste.schedule.map((r, i) => (
              <li key={i} className="grid gap-x-3 py-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <b className="tabular-nums">🗓️ {r.when}</b>
                <span className="min-w-0">
                  {[r.area && `📍 ${r.area}`, r.kind && `🗑️ ${r.kind}`].filter(Boolean).join(" · ")}
                  {r.note && <span className="block text-sm text-neutral-600">{r.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-neutral-600">ยังไม่มีตาราง · ได้ข้อมูลแล้วจะขึ้นตรงนี้</p>
        )}
        <button onClick={onReportTrash} className="mt-2 min-h-[44px] w-full rounded-lg bg-[#1E6B47] px-3 font-semibold text-white">
          🗑️ กองขยะค้างนาน? แจ้งในปัญหาซอย
        </button>
      </section>

      <h3 className="pt-1 text-lg font-bold">♻️ แยกขยะยังไงดี</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {waste.guide.map((g, i) => (
          <section key={i} className="rounded-xl bg-white p-3">
            <h4 className="mb-1 font-bold">{g.title}</h4>
            <ul className="list-disc space-y-1 pl-5">
              {g.items.map((t, j) => (
                <li key={j} className="break-words">
                  {t}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {waste.contacts?.length > 0 && (
        <section className="rounded-xl bg-white p-3">
          <h3 className="mb-2 font-bold">☎️ ติดต่อเรื่องขยะ</h3>
          <ul className="space-y-2">
            {waste.contacts.map((c, i) => (
              <li key={i}>
                {c.phone ? (
                  <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} className="flex min-h-[48px] flex-wrap items-center gap-x-3 rounded-lg border border-neutral-200 px-3">
                    <b className="tabular-nums text-red-700">📞 {c.phone}</b> {c.label}
                  </a>
                ) : (
                  <p className="px-3">{c.label}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {waste.updated_at && (
        <p className="text-xs text-neutral-500">
          อัปเดต {timeAgo(waste.updated_at)}
          {waste.by && ` · ${waste.by}`}
        </p>
      )}
    </div>
  );
}

function WasteEditor({ value, onCancel, onSaved }) {
  // guide items are edited as one textarea per section, one line per item
  const [w, setW] = useState(() => ({ ...value, guide: value.guide.map((g) => ({ ...g, text: g.items.join("\n") })) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch) => setW((x) => ({ ...x, ...patch }));
  const setRow = (key, i, patch) => set({ [key]: w[key].map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const dropRow = (key, i) => set({ [key]: w[key].filter((_, j) => j !== i) });
  const move = (key, i, d) => {
    const a = [...w[key]];
    if (i + d < 0 || i + d >= a.length) return;
    [a[i], a[i + d]] = [a[i + d], a[i]];
    set({ [key]: a });
  };

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const body = {
        ...w,
        schedule: w.schedule.filter((r) => r.when.trim()),
        guide: w.guide.filter((g) => g.title.trim()).map((g) => ({ title: g.title, items: g.text.split("\n").filter((t) => t.trim()) })),
        contacts: w.contacts.filter((c) => c.label.trim()),
      };
      onSaved(await api("/admin/waste", { method: "PUT", body: JSON.stringify(body) }));
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  const small = "min-h-[40px] rounded-lg border border-neutral-400 px-2 text-sm";
  return (
    <div className="space-y-4 rounded-xl border-4 border-black bg-white p-3">
      <p className="text-lg font-bold">✏️ แก้ไขหน้าขยะ · กดบันทึกแล้วทุกคนเห็นทันที</p>
      <div>
        <label className="mb-1 block font-medium" htmlFor="waste-notice">
          ประกาศบนสุด
        </label>
        <textarea id="waste-notice" rows={2} maxLength={300} value={w.notice} onChange={(e) => set({ notice: e.target.value })} className={input} />
      </div>

      <section className="space-y-2">
        <h3 className="font-bold">🚛 ตารางรถ ({w.schedule.length})</h3>
        {w.schedule.map((r, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-neutral-50 p-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                aria-label="วัน เวลา"
                maxLength={60}
                value={r.when}
                onChange={(e) => setRow("schedule", i, { when: e.target.value })}
                className={input}
                placeholder="วัน เวลา เช่น ทุกวันอังคาร 8:00"
              />
              <input aria-label="พื้นที่" maxLength={80} value={r.area} onChange={(e) => setRow("schedule", i, { area: e.target.value })} className={input} placeholder="พื้นที่ เช่น ซอย 1–35" />
              <input aria-label="ประเภทขยะ" maxLength={60} value={r.kind} onChange={(e) => setRow("schedule", i, { kind: e.target.value })} className={input} placeholder="ประเภท เช่น ขยะชิ้นใหญ่" />
              <input aria-label="หมายเหตุ" maxLength={160} value={r.note} onChange={(e) => setRow("schedule", i, { note: e.target.value })} className={input} placeholder="หมายเหตุ" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => move("schedule", i, -1)} className={small}>
                ▲
              </button>
              <button onClick={() => move("schedule", i, 1)} className={small}>
                ▼
              </button>
              <button onClick={() => dropRow("schedule", i)} className={`${small} ml-auto text-red-700`}>
                ลบแถว
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={() => set({ schedule: [...w.schedule, { when: "", area: "", kind: "", note: "" }] })}
          className="min-h-[44px] w-full rounded-lg border-2 border-dashed border-black font-semibold"
        >
          ➕ เพิ่มรอบรถ
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="font-bold">♻️ วิธีแยกขยะ (1 บรรทัด = 1 ข้อ)</h3>
        {w.guide.map((g, i) => (
          <div key={i} className="space-y-2 rounded-lg bg-neutral-50 p-2">
            <input aria-label="หัวข้อ" maxLength={60} value={g.title} onChange={(e) => setRow("guide", i, { title: e.target.value })} className={`${input} font-bold`} />
            <textarea aria-label="รายการ" rows={Math.max(2, g.text.split("\n").length)} value={g.text} onChange={(e) => setRow("guide", i, { text: e.target.value })} className={input} />
            <div className="flex gap-2">
              <button onClick={() => move("guide", i, -1)} className={small}>
                ▲
              </button>
              <button onClick={() => move("guide", i, 1)} className={small}>
                ▼
              </button>
              <button onClick={() => dropRow("guide", i)} className={`${small} ml-auto text-red-700`}>
                ลบหัวข้อ
              </button>
            </div>
          </div>
        ))}
        <button onClick={() => set({ guide: [...w.guide, { title: "", items: [], text: "" }] })} className="min-h-[44px] w-full rounded-lg border-2 border-dashed border-black font-semibold">
          ➕ เพิ่มหัวข้อ
        </button>
      </section>

      <section className="space-y-2">
        <h3 className="font-bold">☎️ เบอร์ติดต่อ</h3>
        {w.contacts.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input
              aria-label="ชื่อ"
              maxLength={80}
              value={c.label}
              onChange={(e) => setRow("contacts", i, { label: e.target.value })}
              className={input}
              placeholder="เช่น เขตบึงกุ่ม ฝ่ายรักษาความสะอาด"
            />
            <input aria-label="เบอร์" maxLength={40} value={c.phone} onChange={(e) => setRow("contacts", i, { phone: e.target.value })} className={`${input} max-w-[9rem]`} placeholder="เบอร์" />
            <button onClick={() => dropRow("contacts", i)} className={`${small} text-red-700`} aria-label="ลบ">
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => set({ contacts: [...w.contacts, { label: "", phone: "" }] })} className="min-h-[44px] w-full rounded-lg border-2 border-dashed border-black font-semibold">
          ➕ เพิ่มเบอร์
        </button>
      </section>

      {err && <p className="rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      <div className="sticky bottom-2 grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="min-h-[52px] rounded-xl border-2 border-black bg-white font-semibold">
          ยกเลิก
        </button>
        <button onClick={save} disabled={busy} className="min-h-[52px] rounded-xl bg-[#1E6B47] font-bold text-white disabled:opacity-60">
          {busy ? "กำลังบันทึก…" : "💾 บันทึก"}
        </button>
      </div>
    </div>
  );
}
