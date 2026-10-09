// 🔔 บ้านฉัน: turn on the phone's own notifications for this house (rubbish day, หาย·เจอ, team notices).
import { useEffect, useState } from "react";
import { load, save } from "../api";
import { notify } from "../notify";
import { TOPICS, defaultTopics, disablePush, enablePush, pushStatus, testPush, updatePush } from "../push";

function Topics({ topics, setTopics }) {
  return (
    <div className="space-y-1.5">
      {TOPICS.map(([k, icon, name, sub]) => {
        const on = topics.includes(k);
        return (
          <button
            key={k}
            onClick={() => setTopics(on ? topics.filter((x) => x !== k) : [...topics, k])}
            aria-pressed={on}
            className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border px-3 text-left ${on ? "border-[#1E6B47] bg-[#E4F0E9]" : "border-[#D5DBD6] bg-white"}`}
          >
            <span className="text-lg" aria-hidden="true">
              {on ? "☑" : "☐"}
            </span>
            <span className="min-w-0 flex-1 leading-snug">
              <b className="block text-[15px]">
                {icon} {name}
              </b>
              <span className="block text-sm text-[#45504A]">{sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function PushCard({ house }) {
  const [st, setSt] = useState(null);
  const [topics, setTopics] = useState(defaultTopics);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [later, setLater] = useState(() => Date.now() - load("pushLater", 0) < 7 * 864e5);
  useEffect(() => {
    pushStatus().then(setSt);
    const show = () => {
      setLater(false);
      setOpen(true);
    };
    window.addEventListener("push:open", show);
    return () => window.removeEventListener("push:open", show);
  }, []);
  // the phone moved to another house: the notifications follow
  useEffect(() => {
    if (st === "on" && house && load("pushHouse", "") !== house) updatePush(house, defaultTopics()).catch(() => {});
  }, [st, house]);
  if (!st || st === "unsupported" || st === "ios-install") return null; // InstallApp teaches the iPhone home-screen step

  async function turnOn() {
    if (!topics.length) return notify("☝️ เลือกอย่างน้อย 1 เรื่อง");
    setBusy(true);
    try {
      await enablePush(house, topics);
      setSt("on");
      setOpen(false);
      notify("🔔 เปิดแจ้งเตือนแล้ว");
      testPush().catch(() => {});
    } catch (e) {
      if (e.message === "denied") setSt("denied");
      else if (e.message !== "dismissed") notify(`เปิดไม่ได้: ${e.message}`);
    }
    setBusy(false);
  }
  async function saveTopics() {
    setBusy(true);
    try {
      if (!topics.length) {
        await disablePush();
        setSt("off");
        notify("ปิดแจ้งเตือนแล้ว");
      } else {
        await updatePush(house, topics);
        notify("บันทึกแล้ว");
      }
      setOpen(false);
    } catch (e) {
      notify(`บันทึกไม่ได้: ${e.message}`);
    }
    setBusy(false);
  }

  if (st === "on")
    return (
      <div id="myhome-push" className="card mt-2 p-2 pr-3">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-[44px] w-full items-center gap-2.5 text-left">
          <span className="ic ic-sm ic-green" aria-hidden="true">
            🔔
          </span>
          <span className="min-w-0 flex-1 truncate text-[15px]">
            <b>แจ้งเตือนเปิดอยู่</b> ·{" "}
            {TOPICS.filter((t) => topics.includes(t[0]))
              .map((t) => t[2])
              .join(" · ")}
          </span>
          <span className="shrink-0 text-sm font-bold text-[#1E6B47]">{open ? "หุบ ▴" : "ตั้งค่า"}</span>
        </button>
        {open && (
          <div className="anim-in mt-2 space-y-2 px-1 pb-1">
            <Topics topics={topics} setTopics={setTopics} />
            <button onClick={saveTopics} disabled={busy} className="min-h-[50px] w-full rounded-xl bg-[#1E6B47] text-base font-bold text-white disabled:opacity-50">
              บันทึก
            </button>
            <div className="flex justify-between">
              <button
                onClick={() =>
                  testPush()
                    .then(() => notify("ส่งแล้ว · ดูที่แถบแจ้งเตือนของมือถือ"))
                    .catch((e) => notify(e.message))
                }
                className="min-h-[44px] text-sm font-bold text-[#1E6B47] underline"
              >
                ลองส่งแจ้งเตือน
              </button>
              <button
                onClick={async () => {
                  await disablePush();
                  setSt("off");
                  notify("ปิดแจ้งเตือนแล้ว");
                }}
                className="min-h-[44px] text-sm text-[#45504A] underline"
              >
                ปิดแจ้งเตือนทั้งหมด
              </button>
            </div>
          </div>
        )}
      </div>
    );

  if (later && st !== "denied")
    return (
      <button id="myhome-push" onClick={() => setLater(false)} className="card mt-2 flex min-h-[52px] w-full items-center gap-2.5 p-2 pr-3 text-left text-[15px]">
        <span className="ic ic-sm ic-green" aria-hidden="true">
          🔔
        </span>
        <span className="min-w-0 flex-1 truncate">
          <b>แจ้งเตือนเข้ามือถือ</b> · ปิดอยู่
        </span>
        <span className="shrink-0 font-bold text-[#1E6B47]">เปิด ▾</span>
      </button>
    );
  const rest = () => {
    save("pushLater", Date.now());
    setLater(true);
  };

  if (st === "ios-install")
    return (
      <div className="card mt-2 p-3">
        <div className="flex items-center gap-2.5">
          <span className="ic ic-sm ic-green" aria-hidden="true">
            🔔
          </span>
          <b className="min-w-0 flex-1 text-base leading-snug">iPhone รับแจ้งเตือนได้ ต้องเพิ่มลงหน้าจอโฮมก่อน</b>
        </div>
        <ol className="mt-2 list-decimal space-y-1 pl-6 text-[15px]">
          <li>
            กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ด้านล่างของ Safari
          </li>
          <li>
            เลือก <b>เพิ่มไปยังหน้าจอโฮม</b>
          </li>
          <li>เปิดจากไอคอนเสรีไทย 57 แล้วกดเปิดแจ้งเตือนตรงนี้</li>
        </ol>
        <button onClick={rest} className="mt-1 min-h-[44px] text-sm text-[#45504A] underline">
          ไว้ทีหลัง
        </button>
      </div>
    );

  if (st === "denied")
    return (
      <div id="myhome-push" className="card mt-2 flex items-center gap-2.5 p-2 pr-3 text-sm">
        <span className="ic ic-sm bg-[#F2F4F1]" aria-hidden="true">
          🔕
        </span>
        <span className="min-w-0 flex-1 leading-snug">เบราว์เซอร์บล็อกแจ้งเตือนเว็บนี้ไว้ · เปิดได้ที่ 🔒 ข้างช่องที่อยู่เว็บ → การแจ้งเตือน → อนุญาต</span>
        <button onClick={rest} className="min-h-[44px] shrink-0 text-[#45504A] underline">
          ปิด
        </button>
      </div>
    );

  return (
    <div id="myhome-push" className="card mt-2 p-3">
      <div className="flex items-center gap-2.5">
        <span className="ic ic-green" aria-hidden="true">
          🔔
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-base leading-snug">ให้มือถือเตือนเรื่องบ้าน {house}</b>
          <span className="block text-sm text-[#45504A]">รถขยะพรุ่งนี้ · ของหาย·เจอ หมาแมว กระเป๋าตัง มือถือ · ประกาศสำคัญ</span>
        </div>
      </div>
      {open && (
        <div className="anim-in mt-2">
          <Topics topics={topics} setTopics={setTopics} />
        </div>
      )}
      <button onClick={turnOn} disabled={busy} className="mt-2.5 min-h-[54px] w-full rounded-xl bg-[#1E6B47] text-lg font-bold text-white disabled:opacity-50">
        {busy ? "…" : "🔔 เปิดแจ้งเตือน"}
      </button>
      <div className="flex justify-between">
        <button onClick={() => setOpen((v) => !v)} className="min-h-[44px] text-sm font-bold text-[#1E6B47] underline">
          {open ? "หุบ" : "เลือกเรื่องที่จะเตือน"}
        </button>
        <button onClick={rest} className="min-h-[44px] text-sm text-[#45504A] underline">
          ไว้ทีหลัง
        </button>
      </div>
    </div>
  );
}
