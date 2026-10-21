import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { notify } from "../notify";

// 🖥️ สั่ง serithai57 (20 Oct 2026): the admin types an instruction (or taps อัปเดตแหล่งข้อมูล) on the phone; it waits
// in a queue until a Claude Desktop scheduled task on the admin's computer (every 15 min) picks it up via tools/cmd_queue.py. Each command is
// signed in the browser with a PIN that only that computer knows (sha256(pin|kind|text|nonce)) — the server never sees
// the PIN, so a leaked admin link alone can't make the computer do anything. Answers come back here.

const ss = {
  get: (k) => {
    try {
      return sessionStorage.getItem(k) || "";
    } catch {
      return "";
    }
  },
  set: (k, v) => {
    try {
      v ? sessionStorage.setItem(k, v) : sessionStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};
const rid = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
async function sha256(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
const STATUS = {
  queued: ["⏳ รอคิว (≤15 นาที)", "bg-[#FFF8EC] text-[#7A4300]"],
  running: ["⚙️ กำลังทำ", "bg-[#E8F0FB] text-[#1F4F8A]"],
  done: ["✅ เสร็จ", "bg-[#E7F4EC] text-[#17603E]"],
  failed: ["❌ ไม่สำเร็จ", "bg-[#FDECEC] text-[#B42318]"],
};

function Answer({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 700;
  return (
    <div className="rounded-lg bg-white p-2">
      <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">
        {long && !open ? text.slice(0, 700) + "…" : text}
      </p>
      {long && (
        <button
          onClick={() => setOpen(!open)}
          className="min-h-[36px] text-sm font-semibold text-[#1F4F8A] underline"
        >
          {open ? "ย่อ" : "อ่านทั้งหมด"}
        </button>
      )}
    </div>
  );
}

export default function CommandBox() {
  const [st, setSt] = useState(null);
  const [text, setText] = useState("");
  const [thread, setThread] = useState(() => ss.get("cmdThread") || rid());
  const [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api("/admin/commands")
        .then(setSt)
        .catch(() => {}),
    [],
  );
  const active = (st?.items || []).some(
    (x) => x.status === "queued" || x.status === "running",
  );
  useEffect(() => {
    load();
    const t = setInterval(load, active ? 5000 : 30000);
    return () => clearInterval(t);
  }, [load, active]);
  useEffect(() => ss.set("cmdThread", thread), [thread]);

  async function send(kind) {
    const body = kind === "ask" ? text.trim() : "";
    if (kind === "ask" && !body) return;
    let pin = ss.get("cmdPin");
    if (!pin) {
      pin = (window.prompt("PIN ของคอมแอด") || "").trim();
      if (!pin) return;
    }
    setBusy(true);
    try {
      const nonce = rid();
      const sig = await sha256(`${pin}|${kind}|${body}|${nonce}`);
      await api("/admin/commands", {
        method: "POST",
        body: JSON.stringify({
          kind,
          text: body,
          thread: kind === "ask" ? thread : "",
          nonce,
          sig,
        }),
      });
      ss.set("cmdPin", pin); // this tab only
      if (kind === "ask") setText("");
      notify(
        st?.online
          ? "ส่งให้คอมแล้ว"
          : "เข้าคิวแล้ว · คอมแอดยังออฟไลน์ จะทำตอนเปิด",
      );
      load();
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }

  const items = st?.items || [];
  const badPin = (items[0]?.result || "").includes("PIN ไม่ตรง");
  useEffect(() => {
    if (badPin) ss.set("cmdPin", ""); // ask again next time
  }, [badPin]);
  const mine = items
    .filter((x) => x.thread === thread || x.kind === "update")
    .slice(0, 8);
  const lastUpdate = items.find((x) => x.kind === "update");
  return (
    <section className="space-y-3 rounded-2xl border-2 border-[#15201A] bg-[#F7F8F6] p-3">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-lg font-bold">🖥️ สั่ง serithai57</h3>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ${st?.online ? "bg-[#E7F4EC] text-[#17603E]" : "bg-[#EEF0EE] text-[#45504A]"}`}
        >
          {st?.online
            ? "● คอมแอดพร้อม · เช็กทุก 15 นาที"
            : "○ คอมแอดยังไม่เช็กคำสั่ง"}
        </span>
      </div>
      <button
        disabled={busy}
        onClick={() => send("update")}
        className="flex min-h-[56px] w-full flex-col items-center justify-center rounded-xl bg-[#1E6B47] py-1.5 text-[16px] font-bold text-white disabled:opacity-50"
      >
        🔄 อัปเดตแหล่งข้อมูลทั้งหมด
        <span className="text-xs font-semibold text-white/80">
          FB · LINE OA · กลุ่ม LINE · เว็บ
        </span>
      </button>
      {lastUpdate && (
        <p className="-mt-1 px-1 text-xs text-[#45504A]">
          ล่าสุด: {STATUS[lastUpdate.status]?.[0]} ·{" "}
          {new Date(lastUpdate.created_at).toLocaleString("th-TH")}
        </p>
      )}
      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="สั่งได้เหมือนคุยในแชท เช่น “สรุป inbox วันนี้” · “ร่างโพสต์เรื่องรถขยะ” · “ปิดประกาศลูกแมว”"
          className="w-full rounded-xl border-2 border-[#C9D1CB] bg-white p-2.5 text-[15px] leading-snug"
          aria-label="คำสั่งถึง serithai57"
        />
        <div className="flex gap-2">
          <button
            disabled={busy || !text.trim()}
            onClick={() => send("ask")}
            className="min-h-[48px] flex-1 rounded-xl bg-[#15201A] font-bold text-white disabled:opacity-40"
          >
            ส่งคำสั่ง
          </button>
          <button
            onClick={() => {
              setThread(rid());
              notify("เริ่มเรื่องใหม่");
            }}
            className="min-h-[48px] rounded-xl border-2 border-[#C9D1CB] bg-white px-3 text-sm font-semibold"
          >
            เรื่องใหม่
          </button>
        </div>
        <p className="px-1 text-xs text-[#45504A]">
          งานที่ส่งออกไปข้างนอก (โพสต์ ส่งข้อความ deploy ลบ) Claude
          จะเตรียมไว้แล้วถามก่อน — พิมพ์ “ยืนยัน” ในเรื่องเดิมถึงจะทำ
        </p>
      </div>
      {mine.length > 0 && (
        <div className="space-y-2">
          {mine.map((x) => {
            const [label, cls] = STATUS[x.status] || [x.status, ""];
            return (
              <div
                key={x.id}
                className="space-y-1.5 rounded-xl border border-[#DCE2DD] bg-[#FBFCFB] p-2.5"
              >
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-[15px] font-semibold">
                    {x.kind === "update"
                      ? "🔄 อัปเดตแหล่งข้อมูล"
                      : `🗣️ ${x.text}`}
                  </p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${cls}`}
                  >
                    {label}
                  </span>
                </div>
                <Answer text={x.result} />
                <p className="text-xs text-[#45504A]">
                  {new Date(x.created_at).toLocaleString("th-TH")}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
