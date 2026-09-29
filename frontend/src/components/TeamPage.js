import { useEffect, useMemo, useRef, useState } from "react";
import { api, load, save } from "../api";
import { CATEGORIES, timeAgo } from "../config";
import { HAZ } from "./OpsPage";
import { placeOf, zoneGroups } from "./ZonesPage";

// /team#k=…&zone=F — for a distribution team: leave it open on a phone and see which houses in your zone
// asked for help, go, and tap "received". No account: the team link carries the key.

const NEED = CATEGORIES.need;
const QUICK_CATS = ["food", "medicine", "vulnerable", "medical", "evacuate", "other"];
const soiKey = (s) => {
  const [a, b] = String(s || "999").split("/");
  return (parseInt(a, 10) || 999) * 100 + (parseInt(b, 10) || 0);
};
const houseNum = (h) => parseInt(String(h || "").split("/")[1], 10) || 0;
const navUrl = (c) => `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
const zoneFromHash = () => (window.location.hash.match(/zone=([A-Z?])/i) || [])[1]?.toUpperCase();

// team pages hold phone numbers: keep them out of search engines
export function noIndex() {
  if (document.querySelector('meta[name="robots"]')) return;
  const m = document.createElement("meta");
  m.name = "robots";
  m.content = "noindex, nofollow";
  document.head.appendChild(m);
}

export function NoKey() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="max-w-sm rounded-xl bg-white p-5 text-center shadow">
        <p className="text-4xl">🔑</p>
        <p className="mt-2 text-lg font-bold">หน้านี้สำหรับทีมงาน</p>
        <p className="mt-1 text-neutral-700">เปิดจาก “ลิงก์ทีม” ที่ผู้ประสานงานส่งให้ในกลุ่มไลน์ทีม (เปิดครั้งเดียว เครื่องนี้จะจำไว้)</p>
        <a href="/" className="mt-4 inline-block rounded-lg bg-black px-4 py-3 font-semibold text-white">
          หน้าหลัก
        </a>
      </div>
    </div>
  );
}

function useWakeLock() {
  const [on, setOn] = useState(false);
  const lock = useRef(null);
  useEffect(() => {
    if (!on || !navigator.wakeLock) return;
    let dead = false;
    const get = () =>
      navigator.wakeLock
        .request("screen")
        .then((l) => {
          if (dead) l.release();
          else lock.current = l;
        })
        .catch(() => setOn(false));
    get();
    const again = () => document.visibilityState === "visible" && get(); // the lock drops when the tab is hidden
    document.addEventListener("visibilitychange", again);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", again);
      lock.current?.release();
    };
  }, [on]);
  return [on, setOn, !!navigator.wakeLock];
}

function AddCase({ zone, name, onDone }) {
  const [house, setHouse] = useState("");
  const [soi, setSoi] = useState("");
  const [cat, setCat] = useState("food");
  const [people, setPeople] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [detail, setDetail] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 px-3";
  async function submit() {
    const num = house.replace(/^4\//, "").trim();
    if (!/^\d{1,4}$/.test(num)) return setMsg("ใส่บ้านเลขที่ เช่น 775 (= 4/775)");
    if (!name.trim()) return setMsg("✍️ ใส่ชื่อ/ทีมด้านบนก่อน");
    if (zone && !soi) return setMsg("👆 เลือกซอยด้วย (เคสจะได้เข้าโซนถูก)");
    try {
      const c = await api("/team/cases", {
        method: "POST",
        body: JSON.stringify({ house: `4/${num}`, soi, category: cat, people: people ? Number(people) : null, urgent, detail: detail.trim(), phone: phone.trim(), name: name.trim() }),
      });
      onDone(`✅ เพิ่ม ${c.house} แล้ว${c.zone ? (zone && c.zone !== zone.id ? ` (อยู่โซน ${c.zone})` : "") : " — ยังไม่รู้ซอย อยู่ในรายการ “ไม่รู้โซน”"}`);
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <div className="space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="font-bold">➕ บ้านที่เจอระหว่างเดินแจก</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1 rounded-lg border border-neutral-300 px-2">
          <span className="text-neutral-500">4/</span>
          <input value={house} onChange={(e) => setHouse(e.target.value)} inputMode="numeric" maxLength={6} className="min-h-[42px] w-full outline-none" placeholder="บ้านเลขที่" />
        </label>
        <select value={soi} onChange={(e) => setSoi(e.target.value)} className={input}>
          <option value="">{zone ? "เลือกซอย" : "ซอย (ไม่รู้ก็ได้)"}</option>
          {(zone?.sois || []).map((s) => (
            <option key={s} value={s}>
              ซอย {s}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {QUICK_CATS.map((k) => (
          <button key={k} type="button" onClick={() => setCat(k)} aria-pressed={cat === k} className={`min-h-[40px] rounded-full px-3 text-sm ${cat === k ? "bg-black text-white" : "border border-neutral-300 bg-white"}`}>
            {NEED[k][0]} {NEED[k][1].split(" / ")[0]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input value={people} onChange={(e) => setPeople(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={input} placeholder="กี่คน / กี่ชุด" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} className={input} placeholder="📞 เบอร์บ้านนั้น" />
      </div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={500} className={input} placeholder="ต้องการอะไร เช่น ข้าว 3 กล่อง มีผู้ป่วยติดเตียง" />
      <button type="button" onClick={() => setUrgent(!urgent)} aria-pressed={urgent} className={`min-h-[40px] w-full rounded-lg text-sm font-bold ${urgent ? "bg-red-600 text-white" : "border border-red-600 text-red-700"}`}>
        {urgent ? "🔴 ด่วน (คนแก่ / ป่วย / เด็กเล็ก)" : "แตะถ้าด่วน (คนแก่ / ป่วย / เด็กเล็ก)"}
      </button>
      {msg && <p className="rounded bg-yellow-50 p-2 text-sm">{msg}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={() => onDone(false)} className="min-h-[48px] rounded-lg border border-neutral-300">ยกเลิก</button>
        <button onClick={submit} className="col-span-2 min-h-[48px] rounded-lg bg-black font-bold text-white">เพิ่มเคส</button>
      </div>
    </div>
  );
}

function CaseCard({ c, name, onChanged, isNew }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const done = c.status === "done";
  const [emoji, label] = NEED[c.category] || NEED.other;
  async function set(status) {
    if (!name.trim()) return setErr("✍️ ใส่ชื่อ/ทีมด้านบนก่อน");
    if (status === "open" && !window.confirm(`ปล่อย ${c.house} คืน (ยังไม่มีใครไป)?`)) return;
    setBusy(true);
    setErr("");
    try {
      await api(`/team/cases/${c.id}/status`, { method: "POST", body: JSON.stringify({ status, name: name.trim() }) });
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className={`rounded-xl border-l-8 bg-white p-3 shadow ${done ? "border-green-500 opacity-60" : c.urgent ? "border-red-600" : c.status === "helping" ? "border-blue-500" : "border-neutral-300"}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-black leading-tight">
            {c.house || "ไม่มีเลขบ้าน"}
            {c.urgent && !done && <span className="ml-2 rounded bg-red-600 px-1.5 align-middle text-sm text-white">ด่วน</span>}
            {isNew && !done && <span className="ml-2 rounded bg-yellow-300 px-1.5 align-middle text-sm">🆕 ใหม่</span>}
          </p>
          <p className="text-sm text-neutral-600">
            {c.soi ? `ซอย ${c.soi}` : "ไม่รู้ซอย"}
            {c.precision === "estimated_soi" && " (ประมาณ)"} · {timeAgo(c.created_at)}
          </p>
        </div>
        <span className="shrink-0 text-right text-sm font-semibold">
          {emoji} {label.split(" / ")[0]}
          {c.people ? <span className="block text-xs font-normal text-neutral-600">{c.people} คน/ชุด</span> : null}
        </span>
      </div>
      <p className={`mt-1 text-[15px] ${open ? "" : "line-clamp-3"}`} onClick={() => setOpen(!open)}>
        {c.detail}
      </p>
      {c.last?.note && c.last.note !== "นำเข้าจาก LINE OpenChat" && (
        <p className="mt-1 text-xs text-neutral-500">
          ล่าสุด: {c.last.note} · {c.last.name} {c.last.at && `· ${timeAgo(c.last.at)}`}
        </p>
      )}
      {done ? (
        <p className="mt-2 font-semibold text-green-700">✅ เสร็จแล้ว {timeAgo(c.updated_at)}</p>
      ) : (
        <>
          {c.status === "helping" && c.assignee && <p className="mt-2 rounded bg-blue-50 px-2 py-1 text-sm font-semibold text-blue-800">🚶 {c.assignee.name} กำลังไป</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            {c.status === "helping" ? (
              <button disabled={busy} onClick={() => set("done")} className="min-h-[52px] rounded-lg bg-green-600 font-bold text-white disabled:opacity-50">
                ✅ ได้รับแล้ว
              </button>
            ) : (
              <button disabled={busy} onClick={() => set("helping")} className="min-h-[52px] rounded-lg bg-blue-600 font-bold text-white disabled:opacity-50">
                🚶 ฉันไปบ้านนี้
              </button>
            )}
            <a href={navUrl(c)} target="_blank" rel="noreferrer" className="flex min-h-[52px] items-center justify-center rounded-lg border-2 border-black font-semibold">
              🧭 นำทาง{c.precision !== "house" ? " (ประมาณ)" : ""}
            </a>
            {c.phone && (
              <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="flex min-h-[44px] items-center justify-center rounded-lg bg-green-100 font-semibold text-green-800">
                📞 {c.phone}
              </a>
            )}
            {c.status === "helping" ? (
              <button disabled={busy} onClick={() => set("open")} className="min-h-[44px] rounded-lg border border-neutral-300 text-sm">
                ↩️ ยังไม่ได้ไป
              </button>
            ) : (
              <button disabled={busy} onClick={() => set("done")} className="min-h-[44px] rounded-lg border border-green-600 text-sm font-semibold text-green-700">
                ✅ ได้รับแล้ว
              </button>
            )}
          </div>
        </>
      )}
      {err && <p className="mt-1 text-sm text-red-700">{err}</p>}
    </li>
  );
}

export default function TeamPage() {
  const [locked, setLocked] = useState(false);
  const [zones, setZones] = useState(null);
  const [zone, setZoneState] = useState(() => zoneFromHash() || load("myZone", ""));
  const [cases, setCases] = useState(null);
  const [ops, setOps] = useState({ points: {}, hazards: [] });
  const [error, setError] = useState("");
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState("");
  const [updated, setUpdated] = useState(null);
  const [wake, setWake, canWake] = useWakeLock();
  const seen = useRef(null); // case ids already shown, to flag new ones
  const [fresh, setFresh] = useState(new Set());

  const setZone = (z) => {
    setZoneState(z);
    save("myZone", z);
    seen.current = null;
    window.history.replaceState(null, "", `/team${z ? `#zone=${z}` : ""}`);
  };

  const groups0 = useMemo(() => zoneGroups(zones), [zones]);
  const z = groups0.find((g) => g.ids.includes(zone)); // "G" (old choice) opens the F·G·H block
  const zq = z ? z.ids.join(",") : zone; // query: all zones of the block
  const reload = () =>
    Promise.all([api(`/team/cases${zq ? `?zone=${encodeURIComponent(zq)}` : ""}`), api("/ops")])
      .then(([c, o]) => {
        const ids = new Set(c.map((x) => x.id));
        if (seen.current) {
          const added = [...ids].filter((id) => !seen.current.has(id));
          if (added.length) {
            setFresh((f) => new Set([...f, ...added]));
            navigator.vibrate?.([200, 100, 200]);
          }
        }
        seen.current = ids;
        setCases(c);
        setOps(o);
        setUpdated(new Date());
        setError("");
      })
      .catch((e) => (e.message.startsWith("ลิงก์ทีม") ? setLocked(true) : setError(e.message)));

  useEffect(() => {
    noIndex();
    api("/zones")
      .then((d) => setZones(d.zones))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (zone && zone !== "?" && !zones) return; // wait for the zone list to know the whole block
    setCases(null);
    reload();
    const t = setInterval(() => document.visibilityState === "visible" && reload(), 30000);
    return () => clearInterval(t);
  }, [zq, zones]); // eslint-disable-line react-hooks/exhaustive-deps -- reload reads the current zone
  useEffect(() => {
    const open = (cases || []).filter((c) => c.status !== "done").length;
    document.title = `${open ? `(${open}) ` : ""}ทีมแจก${z ? ` โซน ${z.label}` : ""}`;
  }, [cases, z]);

  const point = z && ops.points?.[z.id];
  const liveHaz = (ops.hazards || []).filter((h) => !h.cleared_at);
  const groups = useMemo(() => {
    const list = (cases || []).filter((c) => showDone || c.status !== "done");
    const urgent = list.filter((c) => c.urgent && c.status !== "done").sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const rest = list.filter((c) => !(c.urgent && c.status !== "done"));
    const bySoi = {};
    for (const c of rest) (bySoi[c.soi || "?"] = bySoi[c.soi || "?"] || []).push(c);
    const sois = Object.keys(bySoi).sort((a, b) => soiKey(a) - soiKey(b));
    for (const s of sois) bySoi[s].sort((a, b) => (a.status === "done") - (b.status === "done") || houseNum(a.house) - houseNum(b.house));
    return { urgent, sois, bySoi };
  }, [cases, showDone]);
  const counts = useMemo(() => {
    const c = cases || [];
    return {
      open: c.filter((x) => x.status === "open").length,
      helping: c.filter((x) => x.status === "helping").length,
      done: c.filter((x) => x.status === "done").length,
      urgent: c.filter((x) => x.urgent && x.status !== "done").length,
    };
  }, [cases]);

  if (locked) return <NoKey />;

  return (
    <div className="min-h-screen bg-neutral-100 pb-10">
      <header className="px-3 py-3 text-white" style={{ background: z?.color || "#111" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-black">🚶 ทีมแจก{zone ? ` · โซน ${zone === "?" ? "ไม่รู้โซน" : z?.label || zone}` : ""}</h1>
            <p className="text-sm opacity-90">{updated ? `อัปเดต ${updated.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} · รีเฟรชเองทุก 30 วิ` : "กำลังโหลด…"}</p>
          </div>
          <a href="/hq" className="rounded-lg bg-white/20 px-3 py-2.5 text-sm font-semibold">🧭 ภาพรวม</a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-3 py-3">
        {error && <p className="rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
        {liveHaz.length > 0 && (
          <div className="rounded-xl bg-red-600 p-3 font-semibold text-white">
            <p className="font-black">⚠️ ระวัง!</p>
            {liveHaz.map((h) => (
              <p key={h.id}>
                {(HAZ[h.kind] || HAZ.other)[0]} {(HAZ[h.kind] || HAZ.other)[1]}
                {h.soi && ` ซ.${h.soi}`}
                {h.note && ` — ${h.note}`}
              </p>
            ))}
          </div>
        )}

        <section className="rounded-xl bg-white p-3 shadow">
          <p className="text-sm font-semibold">โซนที่ทีมคุณดูแล</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {groups0.map((x) => (
              <button
                key={x.id}
                onClick={() => setZone(x.id)}
                aria-pressed={z?.id === x.id}
                className="min-h-[44px] min-w-[44px] rounded-full px-2 text-lg font-black"
                style={z?.id === x.id ? { background: x.color, color: "#fff" } : { border: `2px solid ${x.color}`, color: x.color }}
              >
                {x.label}
              </button>
            ))}
            <button onClick={() => setZone("?")} aria-pressed={zone === "?"} className={`min-h-[44px] rounded-full px-3 text-sm ${zone === "?" ? "bg-black text-white" : "border border-neutral-400"}`}>
              ไม่รู้โซน
            </button>
            <button onClick={() => setZone("")} aria-pressed={!zone} className={`min-h-[44px] rounded-full px-3 text-sm ${!zone ? "bg-black text-white" : "border border-neutral-400"}`}>
              ทุกโซน
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => save("contact", { ...load("contact", {}), name: name.trim() })}
              maxLength={60}
              className={`min-h-[44px] rounded-lg border px-3 ${name.trim() ? "border-neutral-300" : "border-2 border-red-500"}`}
              placeholder="ชื่อ / ทีม (จำเป็น)"
            />
            {canWake && (
              <button onClick={() => setWake(!wake)} className={`min-h-[44px] rounded-lg text-sm font-semibold ${wake ? "bg-yellow-300" : "border border-neutral-300"}`}>
                {wake ? "🔆 จอเปิดค้างอยู่" : "🔅 เปิดจอค้างไว้"}
              </button>
            )}
          </div>
        </section>

        {z && (
          <section className="rounded-xl border-4 border-yellow-400 bg-yellow-50 p-3">
            <p className="font-bold">🚚 จุดลงของ: {point?.place || placeOf(z)}</p>
            {point?.person && (
              <p>
                👤 {point.person}{" "}
                {point.phone && (
                  <a href={`tel:${point.phone.replace(/[^0-9+]/g, "")}`} className="font-bold text-green-700 underline">
                    📞 {point.phone}
                  </a>
                )}
              </p>
            )}
            <p className="text-sm text-neutral-700">ซอย {z.sois.join(", ")}</p>
          </section>
        )}

        {cases && (
          <section className="grid grid-cols-4 gap-2 text-center">
            {[
              ["🆘", "ยังไม่มีคนไป", counts.open, "bg-white"],
              ["🔴", "ด่วน", counts.urgent, counts.urgent ? "bg-red-600 text-white" : "bg-white"],
              ["🚶", "กำลังไป", counts.helping, "bg-white"],
              ["✅", "เสร็จ 12 ชม.", counts.done, "bg-white"],
            ].map(([e, t, n, cls]) => (
              <div key={t} className={`rounded-xl p-2 shadow ${cls}`}>
                <p className="text-2xl font-black">{n}</p>
                <p className="text-xs">
                  {e} {t}
                </p>
              </div>
            ))}
          </section>
        )}

        {fresh.size > 0 && (
          <button onClick={() => setFresh(new Set())} className="w-full rounded-xl bg-yellow-300 p-3 font-bold shadow">
            🆕 มีเคสใหม่ {fresh.size} เคส (ติดป้าย “ใหม่”) · แตะเพื่อรับทราบ
          </button>
        )}

        <div className="flex gap-2">
          <button onClick={() => setAdding(!adding)} className="min-h-[48px] flex-1 rounded-xl bg-black font-bold text-white">
            ➕ เพิ่มบ้านที่เจอ
          </button>
          <button onClick={() => setShowDone(!showDone)} className="min-h-[48px] rounded-xl border border-neutral-400 bg-white px-3 text-sm">
            {showDone ? "ซ่อนที่เสร็จ" : "ดูที่เสร็จแล้ว"}
          </button>
        </div>
        {adding && (
          <AddCase
            zone={z}
            name={name}
            onDone={(done) => {
              setAdding(false);
              if (done) {
                setToast(done);
                setTimeout(() => setToast(""), 6000);
                reload();
              }
            }}
          />
        )}
        {toast && <p className="rounded-xl bg-green-100 p-3 font-semibold text-green-900">{toast}</p>}

        {!cases && !error && <p className="p-3 text-neutral-600">กำลังโหลด…</p>}
        {cases && groups.urgent.length === 0 && groups.sois.length === 0 && (
          <p className="rounded-xl bg-white p-4 text-center text-lg">🎉 ไม่มีเคสค้าง{zone ? `ในโซน ${zone}` : ""}</p>
        )}
        {groups.urgent.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-black text-red-700">🔴 ด่วนก่อน ({groups.urgent.length})</h2>
            <ul className="space-y-2">
              {groups.urgent.map((c) => (
                <CaseCard key={c.id} c={c} name={name} onChanged={reload} isNew={fresh.has(c.id)} />
              ))}
            </ul>
          </section>
        )}
        {groups.sois.map((s) => (
          <section key={s}>
            <h2 className="mb-1 mt-3 text-lg font-black">
              {s === "?" ? "ไม่รู้ซอย" : `ซอย ${s}`} <span className="text-sm font-normal text-neutral-500">({groups.bySoi[s].filter((c) => c.status !== "done").length} บ้าน)</span>
            </h2>
            <ul className="space-y-2">
              {groups.bySoi[s].map((c) => (
                <CaseCard key={c.id} c={c} name={name} onChanged={reload} isNew={fresh.has(c.id)} />
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
