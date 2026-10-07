import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { CATEGORIES, categoryOf, osmLink, timeAgo } from "../config";
import { createBaseMap } from "./MapView";
import { drawStaff } from "./staffMarkers";
import { drawZones } from "./ZonesPage";
import QRCode from "qrcode";
import { DutyBar, TripPanel, useStaffLocation } from "./Trips";
import { BrowserHowTo, InAppGate, detectInApp, openExternally } from "./OpenInBrowser";
import Guide, { STAFF_SLIDES } from "./Guide";

const IN_APP = detectInApp();

// Field-staff console: split the work by soi, claim a house (nobody else can take it), finish it,
// import the LINE OpenChat, and build the village address book as you go.

const PRECISION = {
  house: { text: "📍 ตำแหน่งบ้าน", cls: "bg-emerald-100 text-emerald-800" },
  soi: { text: "≈ ต้นซอย", cls: "bg-sky-100 text-sky-800" },
  estimated_soi: { text: "≈ ซอยโดยประมาณ", cls: "bg-yellow-100 text-yellow-900" },
  unconfirmed: { text: "? หมุดยังไม่ยืนยัน", cls: "bg-yellow-100 text-yellow-900" },
  unknown: { text: "❓ ไม่ทราบตำแหน่ง", cls: "bg-red-100 text-red-800" },
};
const precisionOf = (t) => PRECISION[t.precision] || PRECISION.unconfirmed;
const soiKey = (s) => (s ? Number(String(s).split("/")[0]) + (String(s).includes("/") ? 0.5 : 0) : 9999);
const googleSearch = (house) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${house} ซอยเสรีไทย 57 คลองกุ่ม บึงกุ่ม กรุงเทพ`)}`;
const waitedH = (t) => (Date.now() - new Date(t.created_at).getTime()) / 3.6e6;

const btn = "min-h-[44px] rounded-lg px-3 font-semibold disabled:opacity-50";
const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 text-base";

// ---------------- join / login ----------------
function Join({ onJoined }) {
  // ?invite= (survives LINE's "open in external browser") or the older #invite=
  const readToken = () => new URLSearchParams(window.location.search).get("invite") || new URLSearchParams(window.location.hash.slice(1)).get("invite");
  const [token, setToken] = useState(readToken);
  useEffect(() => {
    // tapping an invite link while /staff is already open only changes the hash
    const onHash = () => setToken(readToken());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const [name, setName] = useState(() => load("contact", {}).name || "");
  const [team, setTeam] = useState(() => load("staffTeam", ""));
  const [error, setError] = useState("");
  if (!token) {
    return (
      <div className="mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow">
        <h2 className="text-xl font-bold">👷 สำหรับเจ้าหน้าที่ / อาสา</h2>
        <p>
          ขอ <b>ลิงก์เชิญ</b> จากผู้ดูแล แล้วเปิดลิงก์นั้นบนมือถือ ใส่ชื่อ ก็ใช้งานได้ทันที
        </p>
        <a href="/admin" className="block text-center underline">
          ผู้ดูแลเข้าสู่ระบบที่นี่
        </a>
      </div>
    );
  }
  async function join(e) {
    e.preventDefault();
    try {
      const who = await api("/auth/staff-join", { method: "POST", body: JSON.stringify({ token, name: name.trim(), team: team.trim() }) });
      save("contact", { ...load("contact", {}), name: name.trim() });
      save("staffTeam", team.trim());
      window.history.replaceState(null, "", "/staff");
      onJoined(who);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <form onSubmit={join} className="mx-auto max-w-sm space-y-3 rounded-2xl bg-white p-5 shadow">
      <h2 className="text-xl font-bold">👷 เข้าร่วมทีมเจ้าหน้าที่</h2>
      <label className="block font-medium" htmlFor="staff-name">
        ชื่อที่ทีมจะเห็น
      </label>
      <input id="staff-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={input} placeholder="เช่น ต้น" />
      <label className="block font-medium" htmlFor="staff-team">
        มาจากหน่วยไหน <span className="font-normal text-neutral-500">(ไม่ใส่ก็ได้)</span>
      </label>
      <input id="staff-team" maxLength={40} value={team} onChange={(e) => setTeam(e.target.value)} className={input} placeholder="เช่น มูลนิธิ… / เขตบึงกุ่ม / อาสาในหมู่บ้าน" />
      <p className="text-sm text-neutral-600">กดเริ่มแล้ว มือถือจะถามขอตำแหน่ง ให้กด “อนุญาต” ชาวบ้านจะเห็นว่ามีเจ้าหน้าที่อยู่ใกล้ (หยุดแชร์ได้ตลอด)</p>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button type="submit" className={`${btn} w-full bg-black text-white`}>
        เริ่มทำงาน
      </button>
    </form>
  );
}

// ---------------- one task ----------------
// ✏️ quick edit: what they need, how many, urgent, details — big buttons, no typing needed for most
function TaskEditForm({ t, onSaved, onCancel }) {
  const [category, setCategory] = useState(t.category);
  const [people, setPeople] = useState(t.people || 0);
  const [urgent, setUrgent] = useState(!!t.urgent);
  const [detail, setDetail] = useState(t.detail || "");
  const [error, setError] = useState("");
  async function save() {
    try {
      onSaved(await api(`/staff/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ category, people, urgent, detail }) }));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="mt-2 space-y-3 rounded-xl bg-neutral-50 p-3">
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(CATEGORIES.need).map(([k, [e, label]]) => (
          <button
            key={k}
            type="button"
            onClick={() => setCategory(k)}
            aria-pressed={category === k}
            className={`min-h-[40px] rounded-full px-3 text-sm ${category === k ? "bg-black font-semibold text-white" : "border border-neutral-300 bg-white"}`}
          >
            {e} {label.split(" /")[0]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">จำนวน (ที่/คน)</span>
        <button type="button" onClick={() => setPeople((n) => Math.max(0, n - 1))} className={`${btn} min-w-[44px] border border-neutral-300 bg-white`} aria-label="ลด">
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={500}
          value={people}
          onChange={(e) => setPeople(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
          className="min-h-[44px] w-20 rounded-lg border border-neutral-300 text-center text-lg"
        />
        <button type="button" onClick={() => setPeople((n) => Math.min(500, n + 1))} className={`${btn} min-w-[44px] border border-neutral-300 bg-white`} aria-label="เพิ่ม">
          +
        </button>
      </div>
      <button
        type="button"
        onClick={() => setUrgent((u) => !u)}
        aria-pressed={urgent}
        className={`${btn} w-full ${urgent ? "bg-red-600 text-white" : "border-2 border-red-600 bg-white text-red-700"}`}
      >
        {urgent ? "🚨 ด่วน (แตะเพื่อยกเลิก)" : "ตั้งเป็นงานด่วน"}
      </button>
      <textarea value={detail} onChange={(e) => setDetail(e.target.value)} maxLength={1000} rows={3} className={`${input} py-2`} placeholder="รายละเอียด" />
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={save} className={`${btn} bg-black text-white`}>
          💾 บันทึก
        </button>
        <button type="button" onClick={onCancel} className={`${btn} border border-neutral-300 bg-white`}>
          ยกเลิก
        </button>
      </div>
    </div>
  );
}

function TaskCard({ t, user, onUpdate, onLocate }) {
  const [emoji, cat] = categoryOf(t);
  const [note, setNote] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const mine = t.assignee?.id === user.id;
  const taken = t.assignee && !mine;
  const pr = precisionOf(t);
  const hours = waitedH(t);

  async function act(path, body) {
    setError("");
    try {
      onUpdate(await api(`/staff/tasks/${t.id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined }));
    } catch (err) {
      setError(err.message);
      if (err.message.includes("รับงานนี้ไปแล้ว")) onUpdate(null); // refresh the board
    }
  }

  return (
    <li className={`rounded-xl border-2 bg-white p-3 ${mine ? "border-blue-600" : t.urgent ? "border-red-500" : "border-neutral-200"} ${taken ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <b className="text-lg">{t.house || "ไม่ระบุเลขที่"}</b>
        {t.urgent && <span className="rounded bg-red-600 px-1.5 font-bold text-white">ด่วน</span>}
        <span className={`rounded px-1.5 ${pr.cls}`}>{pr.text}</span>
        {t.source === "line" && <span className="rounded bg-neutral-100 px-1.5">จาก LINE</span>}
        {t.status === "open" && hours >= 3 && <span className="rounded bg-yellow-300 px-1.5 font-bold">⏳ {Math.floor(hours)} ชม.</span>}
      </div>
      <p className="mt-1">
        {emoji} <b>{cat}</b>
        {t.people ? ` · ${t.people} ที่/คน` : ""}
      </p>
      <p className="mt-0.5 break-words text-sm text-neutral-700">{t.detail}</p>
      {t.place && <p className="text-sm text-neutral-500">📫 {t.place}</p>}
      {t.assignee && (
        <p className={`mt-1 text-sm font-semibold ${mine ? "text-blue-700" : "text-neutral-600"}`}>
          👷 {mine ? "งานของคุณ" : `${t.assignee.name} รับแล้ว`} · {timeAgo(t.assigned_at)}
        </p>
      )}
      {t.status === "done" && <p className="mt-1 text-sm font-semibold text-emerald-700">✅ เสร็จแล้ว {t.done_by ? `โดย ${t.done_by.name}` : ""}</p>}

      <div className="mt-2 grid grid-cols-2 gap-2">
        {t.status !== "done" && !t.assignee && (
          <button onClick={() => act("claim")} className={`${btn} col-span-2 bg-black text-white`}>
            🙋 รับงานนี้
          </button>
        )}
        {!taken && t.status !== "done" && !finishing && !editing && (
          <>
            <button onClick={() => setFinishing(true)} className={`${btn} bg-emerald-600 text-white`}>
              {mine ? "✅ เสร็จแล้ว" : "✅ เคลียร์ (ช่วยแล้ว)"}
            </button>
            <button onClick={() => setEditing(true)} className={`${btn} border-2 border-black bg-white`}>
              ✏️ แก้ไข
            </button>
          </>
        )}
        {mine && t.status !== "done" && !finishing && !editing && (
          <button onClick={() => act("release")} className={`${btn} col-span-2 border border-neutral-300 bg-white text-sm`}>
            ↩️ ปล่อยงาน (ให้คนอื่นรับ)
          </button>
        )}
        {t.phone && (
          <a href={`tel:${t.phone.replace(/[^\d+]/g, "")}`} className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
            📞 โทร
          </a>
        )}
        {t.precision !== "unknown" && (
          <a href={osmLink(t.lat, t.lng)} target="_blank" rel="noreferrer" className={`${btn} flex items-center justify-center border border-neutral-300 bg-white`}>
            🧭 นำทาง
          </a>
        )}
        {t.house && t.precision !== "house" && (
          <button onClick={() => onLocate(t.house, t.soi)} className={`${btn} col-span-2 border border-dashed border-neutral-400 bg-white text-sm`}>
            📍 ถึงบ้านแล้ว? ตั้งตำแหน่งบ้าน {t.house}
          </button>
        )}
      </div>
      {editing && (
        <TaskEditForm
          t={t}
          onSaved={(x) => {
            setEditing(false);
            onUpdate(x);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {finishing && (
        <div className="mt-2 space-y-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className={input} placeholder="บันทึก เช่น ส่งข้าว 5 กล่อง น้ำ 1 แพ็ค" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => act("done", { note: note.trim() })} className={`${btn} bg-emerald-600 text-white`}>
              ยืนยันเสร็จ
            </button>
            <button onClick={() => setFinishing(false)} className={`${btn} border border-neutral-300 bg-white`}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}

// ---------------- tasks board ----------------
function Tasks({ user, tasks, reload, setTasks, onLocate }) {
  const [view, setView] = useState("free");
  const [soi, setSoi] = useState("all");
  const [zone, setZoneState] = useState(() => load("myZone", "all")); // the zone this team looks after
  const setZone = (z) => {
    save("myZone", z);
    setZoneState(z);
    setSoi("all");
  };
  const [msg, setMsg] = useState("");

  const counts = useMemo(
    () => ({
      free: tasks.filter((t) => t.status !== "done" && !t.assignee).length,
      mine: tasks.filter((t) => t.status !== "done" && t.assignee?.id === user.id).length,
      all: tasks.filter((t) => t.status !== "done").length,
      urgent: tasks.filter((t) => t.status !== "done" && t.urgent).length,
    }),
    [tasks, user.id],
  );
  const shown = tasks.filter((t) => {
    if (view === "free" && (t.status === "done" || t.assignee)) return false;
    if (view === "mine" && (t.status === "done" || t.assignee?.id !== user.id)) return false;
    if (view === "all" && t.status === "done") return false;
    if (view === "urgent" && (t.status === "done" || !t.urgent)) return false;
    if (view === "done" && t.status !== "done") return false;
    if (zone !== "all" && t.zone !== zone) return false;
    return soi === "all" || (t.soi || "none") === soi;
  });
  const zones = useMemo(() => {
    const c = {};
    for (const t of tasks) if (t.status !== "done" && t.zone) c[t.zone] = (c[t.zone] || 0) + 1;
    return Object.entries(c).sort();
  }, [tasks]);
  const groups = useMemo(() => {
    const g = {};
    for (const t of shown) (g[t.soi || "none"] ||= []).push(t);
    return Object.entries(g).sort((a, b) => soiKey(a[0] === "none" ? null : a[0]) - soiKey(b[0] === "none" ? null : b[0]));
  }, [shown]);
  const sois = useMemo(() => [...new Set(tasks.map((t) => t.soi || "none"))].sort((a, b) => soiKey(a === "none" ? null : a) - soiKey(b === "none" ? null : b)), [tasks]);

  const update = (t) => (t ? setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x))) : reload());

  async function claimSoi(s) {
    const r = await api(`/staff/tasks/claim-soi/${encodeURIComponent(s)}`, { method: "POST" });
    setMsg(`รับงานซอย ${s} แล้ว ${r.claimed} หลัง`);
    reload();
  }

  async function copyMine() {
    const mine = tasks.filter((t) => t.status !== "done" && t.assignee?.id === user.id).sort((a, b) => soiKey(a.soi) - soiKey(b.soi));
    const text = [
      `งานของ ${user.name} (${mine.length} หลัง)`,
      ...mine.map((t) => `- ${t.soi ? `ซ.${t.soi} ` : ""}${t.house || ""} ${categoryOf(t)[1]}${t.people ? ` ${t.people} ที่` : ""}${t.phone ? ` ☎ ${t.phone}` : ""}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setMsg("คัดลอกรายการงานของคุณแล้ว");
    } catch {
      setMsg(text);
    }
  }

  const tabs = [
    ["free", "🆓 ยังไม่มีคนรับ", counts.free],
    ["mine", "👷 งานของฉัน", counts.mine],
    ["urgent", "🚨 ด่วน", counts.urgent],
    ["all", "ทั้งหมด", counts.all],
    ["done", "✅ เสร็จแล้ว", null],
  ];

  return (
    <div className="space-y-3">
      <div className="-mx-3 overflow-x-auto px-3">
        <div className="flex w-max gap-2">
          {tabs.map(([k, text, n]) => (
            <button key={k} onClick={() => setView(k)} aria-pressed={view === k} className={`${btn} whitespace-nowrap ${view === k ? "bg-black text-white" : "border border-neutral-300 bg-white"}`}>
              {text} {n != null && <span className="ml-1 rounded-full bg-white/20 px-1.5">{n}</span>}
            </button>
          ))}
        </div>
      </div>
      <div className="-mx-3 overflow-x-auto px-3">
        <div className="flex w-max items-center gap-1.5">
          <span className="text-sm font-semibold">โซน</span>
          {[["all", null], ...zones].map(([z, n]) => (
            <button
              key={z}
              onClick={() => setZone(z)}
              aria-pressed={zone === z}
              className={`min-h-[40px] min-w-[40px] rounded-full px-3 text-sm font-bold ${zone === z ? "bg-black text-white" : "border border-neutral-300 bg-white"}`}
            >
              {z === "all" ? "ทุกโซน" : z}
              {n != null && <span className="ml-1 text-xs font-normal opacity-70">{n}</span>}
            </button>
          ))}
          <a href="/zones" className="ml-1 text-sm underline">
            🗺️ แผนที่โซน
          </a>
          <a href="/ops" className="ml-1 text-sm underline">
            🤝 ประสานงาน
          </a>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <select value={soi} onChange={(e) => setSoi(e.target.value)} className={`${input} w-auto`}>
          <option value="all">ทุกซอย</option>
          {sois.map((s) => (
            <option key={s} value={s}>
              {s === "none" ? "ไม่ทราบซอย" : `ซอย ${s}`}
            </option>
          ))}
        </select>
        {view === "mine" && counts.mine > 0 && (
          <button onClick={copyMine} className={`${btn} border-2 border-black bg-white`}>
            📋 คัดลอกงานของฉัน
          </button>
        )}
      </div>
      {msg && <p className="rounded-lg bg-emerald-50 p-2 text-sm whitespace-pre-wrap">{msg}</p>}
      {groups.map(([s, items]) => {
        const free = items.filter((t) => !t.assignee && t.status !== "done").length;
        return (
          <section key={s}>
            <div className="sticky top-[60px] z-10 flex items-center justify-between gap-2 bg-neutral-100 py-1">
              <h3 className="font-bold">
                {s === "none" ? "❓ ไม่ทราบซอย" : `🛣️ ซอย ${s}`} <span className="font-normal text-neutral-600">· {items.length} หลัง</span>
              </h3>
              {s !== "none" && free > 1 && view !== "done" && (
                <button onClick={() => claimSoi(s)} className={`${btn} bg-blue-600 text-sm text-white`}>
                  รับทั้งซอย ({free})
                </button>
              )}
            </div>
            <ul className="mt-1 space-y-2">
              {items.map((t) => (
                <TaskCard key={t.id} t={t} user={user} onUpdate={update} onLocate={onLocate} />
              ))}
            </ul>
          </section>
        );
      })}
      {shown.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-neutral-500">ไม่มีงานในมุมมองนี้</p>}
    </div>
  );
}

// ---------------- map of all tasks ----------------
function TaskMap({ user, tasks, sois, onUpdate, onLocate }) {
  const el = useRef(null);
  const cardRef = useRef(null);
  const [sel, setSel] = useState(null); // tapped task id → its card under the map
  const selected = tasks.find((t) => t.id === sel && t.status !== "done");
  const layer = useRef(null);
  const staffLayer = useRef(null);
  const [team, setTeam] = useState([]);
  // teammates (boats, trucks, people on duty) on the same map, refreshed like the public page
  useEffect(() => {
    const load = () =>
      document.visibilityState === "visible" &&
      api("/trips")
        .then(setTeam)
        .catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const map = createBaseMap(el.current, { zoom: 16 });
    const soiLayer = L.layerGroup().addTo(map);
    for (const [name, s] of Object.entries(sois)) {
      for (const line of s.lines) L.polyline(line, { color: "#64748b", weight: 3, opacity: 0.5, interactive: false }).addTo(soiLayer);
      L.marker(s.center, {
        interactive: false,
        icon: L.divIcon({ className: "", html: `<span style="font:600 10px sans-serif;background:#fff;border:1px solid #94a3b8;border-radius:4px;padding:0 3px;white-space:nowrap">ซ.${name}</span>` }),
      }).addTo(soiLayer);
    }
    layer.current = L.layerGroup().addTo(map);
    map.createPane("staff").style.zIndex = 650;
    // zones A, B, C… and truck drop points underneath the jobs
    api("/zones")
      .then((z) => map._loaded && drawZones(map, { ...z, soiLines: {} }, { houses: false }))
      .catch(() => {});
    staffLayer.current = L.layerGroup().addTo(map);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
    };
  }, [sois]);
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    // several houses of one soi share the soi point: fan them out a little so each is tappable
    const seen = {};
    for (const t of tasks.filter((x) => x.status !== "done")) {
      const k = `${t.lat.toFixed(5)},${t.lng.toFixed(5)}`;
      const n = (seen[k] = (seen[k] || 0) + 1) - 1;
      const [lat, lng] = t.precision === "house" ? [t.lat, t.lng] : [t.lat + Math.sin(n * 2.4) * 0.00006 * Math.sqrt(n), t.lng + Math.cos(n * 2.4) * 0.00006 * Math.sqrt(n)];
      const color = t.assignee?.id === user.id ? "#2563eb" : t.assignee ? "#737373" : t.urgent ? "#dc2626" : "#f97316";
      const picked = t.id === sel;
      L.circleMarker([lat, lng], {
        radius: picked ? 14 : 10, // big enough to tap with a wet finger
        color: picked ? "#000" : t.precision === "house" ? "#fff" : color,
        weight: picked ? 4 : 2,
        dashArray: picked || t.precision === "house" ? null : "3 3",
        fillColor: color,
        fillOpacity: t.precision === "house" || picked ? 0.95 : 0.55,
      })
        .bindTooltip(`${t.house || "?"}${t.urgent ? " 🚨" : ""}`, { direction: "top", offset: [0, -8] })
        .on("click", () => {
          setSel(t.id);
          setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
        })
        .addTo(layer.current);
    }
  }, [tasks, user.id, sel]);
  useEffect(() => {
    if (staffLayer.current) drawStaff(staffLayer.current, team, "staff");
  }, [team, sois]);
  return (
    <div>
      <div ref={el} className="h-[58vh] w-full overflow-hidden rounded-xl border border-neutral-300" />
      <div ref={cardRef} className="mt-2">
        {selected ? (
          <ul>
            <TaskCard key={selected.id} t={selected} user={user} onUpdate={onUpdate} onLocate={onLocate} />
          </ul>
        ) : (
          <p className="rounded-xl bg-white p-3 text-center font-semibold shadow">👆 แตะจุดบนแผนที่ เพื่อ รับงาน · เคลียร์ · แก้ไข</p>
        )}
      </div>
      <p className="mt-2 text-xs text-neutral-600">
        🔴 ด่วนยังไม่มีคนรับ · 🟠 ยังไม่มีคนรับ · 🔵 งานของคุณ · ⚫ คนอื่นรับแล้ว · วงประ = ตำแหน่งโดยประมาณ (ต้นซอย) · เส้นเทา = ซอยจาก OpenStreetMap · วงใหญ่ = ทีม (🔵 กำลังออกงาน 🟢 ออนไลน์ ⚪
        ไม่มีสัญญาณเกิน 3 นาที)
      </p>
    </div>
  );
}

// ---------------- LINE import ----------------
function Import({ onDone }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function readFile(e) {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  }
  async function run() {
    setBusy(true);
    setError("");
    try {
      const p = await api("/staff/import/preview", { method: "POST", body: JSON.stringify({ text }) });
      setPreview(p);
      setPicked(Object.fromEntries(p.rows.filter((r) => !r.received && !r.recently_done).map((r) => [r.house, true])));
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  async function commit() {
    setBusy(true);
    try {
      const rows = preview.rows
        .filter((r) => picked[r.house])
        .map((r) => ({ house: r.house, soi: r.soi, soi_from_text: r.soi_from_text, text: r.text, phone: r.phone || "", portions: r.portions, force: !!r.recently_done }));
      const res = await api("/staff/import/commit", { method: "POST", body: JSON.stringify({ rows }) });
      onDone(`สร้างงานใหม่ ${res.created} หลัง · รวมเข้ากับงานเดิม ${res.merged_into_existing} หลัง${res.skipped_recently_done ? ` · ข้ามบ้านที่เพิ่งช่วยเสร็จ ${res.skipped_recently_done}` : ""}`);
      setPreview(null);
      setText("");
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }
  const n = Object.values(picked).filter(Boolean).length;
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-white p-3 text-sm">
        <b>วิธีเอาแชตออกจาก LINE:</b> LINE บนคอม → เปิดห้อง → ⋮ → <b>บันทึกแชท</b> → ได้ไฟล์ .txt แล้วเลือกไฟล์ด้านล่าง (หรือก๊อปข้อความจากแชตมาวาง)
        <br />
        ระบบตัดรายการที่ก๊อปซ้ำ, ข้ามโพสต์ขายของ/พรีออเดอร์ และไม่นับเลขที่บ้านที่อยู่ในชื่อผู้โพสต์
      </div>
      <input type="file" accept=".txt,text/plain" onChange={readFile} className="block w-full text-sm" />
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className={`${input} py-2`} placeholder="หรือวางข้อความจากแชตที่นี่" />
      <button disabled={!text.trim() || busy} onClick={run} className={`${btn} w-full bg-black text-white`}>
        {busy ? "กำลังอ่าน…" : "อ่านแชต"}
      </button>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {preview && (
        <div className="space-y-2">
          <p className="rounded-lg bg-yellow-100 p-3 text-sm">
            อ่าน {preview.messages} ข้อความ · ข้ามโพสต์ขายของ {preview.skipped_sales} · เลขที่บ้านถูกพูดถึง {preview.mentions} ครั้ง → <b>{preview.houses} หลังจริง</b>
            <br />
            ใหม่ {preview.new} · มีงานอยู่แล้ว {preview.already_open} · เพิ่งช่วยเสร็จ (ไม่เลือกไว้) {preview.recently_done}
          </p>
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
            {preview.rows.map((r) => (
              <li key={r.house} className={`flex items-start gap-2 rounded-lg bg-white p-2 text-sm ${r.vulnerable ? "border-l-4 border-red-500" : ""}`}>
                <input type="checkbox" className="mt-1 h-5 w-5" checked={!!picked[r.house]} onChange={(e) => setPicked({ ...picked, [r.house]: e.target.checked })} />
                <div className="min-w-0 flex-1">
                  <b>{r.house}</b> {r.soi ? `ซ.${r.soi}` : ""} <span className={`rounded px-1 ${precisionOf(r).cls}`}>{precisionOf(r).text}</span>
                  {r.existing_post && <span className="ml-1 rounded bg-neutral-200 px-1">มีงานอยู่แล้ว → รวม</span>}
                  {r.received && <span className="ml-1 rounded bg-emerald-100 px-1">แจ้งว่าได้รับแล้ว</span>}
                  {r.recently_done && <span className="ml-1 rounded bg-emerald-100 px-1">✅ เพิ่งช่วยเสร็จ{r.done_by ? ` (${r.done_by})` : ""} — ติ๊กถ้าขอใหม่จริง</span>}
                  <p className="break-words text-neutral-600">{r.text}</p>
                </div>
              </li>
            ))}
          </ul>
          <button disabled={!n || busy} onClick={commit} className={`${btn} w-full bg-black text-white`}>
            สร้างงาน {n} หลัง
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------- address book: tap a building = this house ----------------
function Addresses({ sois, initial, onSaved }) {
  const [house, setHouse] = useState(initial?.house || "");
  const [soi, setSoi] = useState(initial?.soi || "");
  const [picked, setPicked] = useState(null); // {lat,lng,bid}
  const [info, setInfo] = useState(null);
  const [msg, setMsg] = useState("");
  const el = useRef(null);
  const mapRef = useRef(null);
  const bLayer = useRef(null);
  const pickRef = useRef(null);

  const loadBuildings = useCallback(async () => {
    const b = await api("/staff/buildings");
    const layer = bLayer.current;
    layer.clearLayers();
    for (const [lat, lng, bid, taken] of b.buildings) {
      const m = L.circleMarker([lat, lng], { radius: 5, color: taken ? "#047857" : "#475569", weight: 1, fillColor: taken ? "#10b981" : "#cbd5e1", fillOpacity: 0.9 });
      if (taken) m.bindTooltip(taken, { permanent: false });
      m.on("click", () => {
        setPicked({ lat, lng, bid, taken });
        if (pickRef.current) pickRef.current.setLatLng([lat, lng]);
        else pickRef.current = L.marker([lat, lng]).addTo(mapRef.current);
      });
      m.addTo(layer);
    }
  }, []);

  useEffect(() => {
    const map = createBaseMap(el.current, { zoom: 18, center: initial?.soi && sois[initial.soi] ? sois[initial.soi].center : undefined });
    const soiLayer = L.layerGroup().addTo(map);
    for (const [name, s] of Object.entries(sois)) {
      for (const line of s.lines) L.polyline(line, { color: "#64748b", weight: 3, opacity: 0.45, interactive: false }).addTo(soiLayer);
      L.marker(s.center, {
        interactive: false,
        icon: L.divIcon({ className: "", html: `<span style="font:600 10px sans-serif;background:#fff;border:1px solid #94a3b8;border-radius:4px;padding:0 3px">ซ.${name}</span>` }),
      }).addTo(soiLayer);
    }
    bLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    map.on("click", (e) => {
      // not every house has an OSM building: allow a free pin too
      setPicked({ lat: e.latlng.lat, lng: e.latlng.lng, bid: null });
      if (pickRef.current) pickRef.current.setLatLng(e.latlng);
      else pickRef.current = L.marker(e.latlng).addTo(map);
    });
    loadBuildings();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      pickRef.current = null;
    };
  }, [sois, loadBuildings, initial]);

  async function lookup(e) {
    e?.preventDefault();
    const num = house.replace(/\s/g, "").match(/^(?:4\/)?(\d{1,4})$/)?.[1];
    if (!num) return setMsg("พิมพ์เลขที่แบบ 4/123");
    const [a] = await api(`/staff/addresses?q=${encodeURIComponent(`4/${num}`)}`);
    setInfo(a || null);
    if (a?.soi) setSoi(a.soi);
    const target = a?.lat ? [a.lat, a.lng] : a?.soi && sois[a.soi] ? sois[a.soi].center : null;
    if (target) mapRef.current.setView(target, 19);
  }

  async function saveIt() {
    const num = house.replace(/\s/g, "").match(/^(?:4\/)?(\d{1,4})$/)?.[1];
    if (!num || !picked) return setMsg("ใส่เลขที่ แล้วแตะอาคาร/จุดบนแผนที่ก่อน");
    try {
      await api(`/staff/addresses/${num}`, { method: "PUT", body: JSON.stringify({ lat: picked.lat, lng: picked.lng, soi: soi || null, building_id: picked.bid }) });
      setMsg(`บันทึก 4/${num} แล้ว — งานของบ้านนี้ย้ายมาที่จุดนี้ด้วย`);
      setPicked(null);
      loadBuildings();
      onSaved?.();
    } catch (err) {
      setMsg(err.message);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={lookup} className="grid grid-cols-[1fr_auto] gap-2">
        <input value={house} onChange={(e) => setHouse(e.target.value)} className={input} placeholder="เลขที่บ้าน เช่น 4/123" inputMode="text" />
        <button className={`${btn} bg-black text-white`}>หา</button>
      </form>
      {info && (
        <p className="rounded-lg bg-white p-2 text-sm">
          {info.house}: {info.lat ? "มีตำแหน่งแล้ว" : "ยังไม่มีตำแหน่งบ้าน"} {info.soi ? `· ซอย ${info.soi}` : ""} {info.source ? `· แหล่ง: ${info.source}` : ""}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <select value={soi} onChange={(e) => setSoi(e.target.value)} className={`${input} w-auto`}>
          <option value="">ซอย (ถ้ารู้)</option>
          {Object.keys(sois).map((s) => (
            <option key={s} value={s}>
              ซอย {s}
            </option>
          ))}
        </select>
        {house && (
          <a href={googleSearch(house.includes("/") ? house : `4/${house}`)} target="_blank" rel="noreferrer" className={`${btn} flex items-center border border-neutral-300 bg-white text-sm`}>
            🔎 ดูใน Google Maps (เปิดดูเอง)
          </a>
        )}
      </div>
      <div ref={el} className="h-[55vh] w-full overflow-hidden rounded-xl border border-neutral-300" />
      <p className="text-xs text-neutral-600">
        แตะ <b>จุดอาคาร</b> (เทา = ยังไม่มีเลขที่, เขียว = มีแล้ว) หรือแตะตรงไหนก็ได้ แล้วกดบันทึก · อาคารจาก OpenStreetMap
      </p>
      {picked?.taken && <p className="rounded-lg bg-yellow-100 p-2 text-sm">อาคารนี้ตั้งเป็น {picked.taken} ไว้แล้ว</p>}
      <button onClick={saveIt} disabled={!picked} className={`${btn} w-full bg-black text-white`}>
        💾 บันทึก: จุดนี้คือบ้าน {house || "…"}
      </button>
      {msg && <p className="rounded-lg bg-emerald-50 p-2 text-sm">{msg}</p>}
    </div>
  );
}

// ---------------- lookup by house number (announcements) ----------------
function Lookup() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  async function run(e) {
    e.preventDefault();
    setRes(await api("/staff/houses/lookup", { method: "POST", body: JSON.stringify({ query: q }) }));
  }
  const bySoi = useMemo(() => {
    const g = {};
    for (const r of res?.rows || []) (g[r.soi || "ไม่ทราบ"] ||= []).push(r);
    return Object.entries(g).sort((a, b) => soiKey(a[0] === "ไม่ทราบ" ? null : a[0]) - soiKey(b[0] === "ไม่ทราบ" ? null : b[0]));
  }, [res]);
  return (
    <div className="space-y-3">
      <p className="rounded-xl bg-white p-3 text-sm">สำหรับประกาศที่ระบุเลขที่บ้าน เช่น “บ้านเลขที่ 4/100–4/250 รับถุงยังชีพที่สโมสร” — ดูว่าอยู่ซอยไหน และบ้านไหนมีคำขอค้างอยู่</p>
      <form onSubmit={run} className="grid grid-cols-[1fr_auto] gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} className={input} placeholder="เช่น 4/100-4/250, 4/1782" />
        <button className={`${btn} bg-black text-white`}>ค้น</button>
      </form>
      {res && (
        <>
          {res.ranges.map((r) => (
            <p key={r.range} className="rounded-lg bg-yellow-100 p-3">
              <b>{r.range}</b> น่าจะอยู่ใน {r.sois.length ? r.sois.map((s) => `ซอย ${s}`).join(", ") : "ยังไม่มีข้อมูลซอยของช่วงนี้"}
            </p>
          ))}
          {bySoi.map(([s, rows]) => (
            <section key={s} className="rounded-xl bg-white p-3">
              <h3 className="font-bold">{s === "ไม่ทราบ" ? "❓ ไม่ทราบซอย" : `ซอย ${s}`}</h3>
              <ul className="text-sm">
                {rows.map((r) => (
                  <li key={r.house}>
                    {r.house} · {precisionOf(r).text}
                    {r.open_post && <b className="ml-1 text-red-700">· มีคำขอค้าง</b>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!res.rows.length && <p className="text-sm text-neutral-600">ยังไม่รู้จักบ้านในช่วงนี้ (สมุดที่อยู่จะเต็มขึ้นเรื่อย ๆ จากการใช้งาน)</p>}
        </>
      )}
    </div>
  );
}

// ---------------- invite teammates: one link / QR anyone on the team can pass on ----------------
// Admins: the secret team link for /hq and /team (no accounts). Rotate it if it leaks.
// Which zones work as one block (one drop point, one team card, one case list). Changes apply at once,
// no deploy: the server regroups /api/zones. Letters, sois and cases stay as they are.
function ZoneGroups() {
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(false);
  const [msg, setMsg] = useState("");
  const fmt = (groups) =>
    groups
      .filter((g) => g.length > 1)
      .map((g) => g.join("+"))
      .join(" ");
  useEffect(() => {
    api("/admin/zone-groups")
      .then((r) => {
        setText(fmt(r.groups));
        setCustom(r.custom);
      })
      .catch((e) => setMsg(e.message));
  }, []);
  async function save() {
    const groups = text
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((g) => g.split("+").filter(Boolean));
    if (
      !window.confirm(`ตั้งโซนรวมเป็น: ${fmt(groups) || "(ทุกโซนแยกกัน)"} ?
หน้า /hq /team /zones จะเปลี่ยนทันที`)
    )
      return;
    try {
      const r = await api("/admin/zone-groups", { method: "PUT", body: JSON.stringify({ groups }) });
      setText(fmt(r.groups));
      setCustom(true);
      setMsg("✅ บันทึกแล้ว");
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function reset() {
    if (!window.confirm("กลับไปใช้การรวมโซนตามไฟล์ตั้งต้น?")) return;
    try {
      await api("/admin/zone-groups", { method: "DELETE" });
      const r = await api("/admin/zone-groups");
      setText(fmt(r.groups));
      setCustom(false);
      setMsg("✅ กลับเป็นค่าตั้งต้นแล้ว");
    } catch (e) {
      setMsg(e.message);
    }
  }
  return (
    <div className="mt-4 space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="text-lg font-bold">🗺️ รวมโซน (ทีมเดียว จุดลงของเดียว)</p>
      <p className="text-sm text-neutral-700">
        พิมพ์โซนที่รวมกัน เว้นวรรคระหว่างกลุ่ม เช่น <b>A+B G+H</b> · โซนที่ไม่ได้พิมพ์ = แยกเดี่ยว · จุดลงของใช้ของโซนแรกในกลุ่ม
      </p>
      <input value={text} onChange={(e) => setText(e.target.value)} className="min-h-[44px] w-full rounded-lg border-2 border-black px-3 font-mono text-lg" placeholder="A+B G+H" />
      <button onClick={save} className="min-h-[44px] w-full rounded-lg bg-black text-sm font-bold text-white">
        💾 บันทึกการรวมโซน
      </button>
      {custom && (
        <button onClick={reset} className="min-h-[40px] w-full rounded-lg border border-black text-sm">
          ↩️ กลับเป็นค่าตั้งต้น
        </button>
      )}
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}

function TeamLinks() {
  const [key, setKey] = useState("");
  const [qr, setQr] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(null);
  const show = (k) => {
    setKey(k);
    QRCode.toDataURL(`${window.location.origin}/team#k=${k}`, { margin: 1, width: 240 }).then(setQr);
  };
  useEffect(() => {
    api("/admin/team-key")
      .then((r) => {
        show(r.key);
        setOpen(r.open);
      })
      .catch((e) => setMsg(e.message));
  }, []);
  async function rotate() {
    if (!window.confirm("เปลี่ยนลิงก์ทีม? ลิงก์เดิมจะใช้ไม่ได้ทันที ต้องส่งลิงก์ใหม่ให้ทีมทุกคน")) return;
    try {
      show((await api("/admin/team-key/rotate", { method: "POST" })).key);
      setMsg("✅ เปลี่ยนแล้ว ส่งลิงก์ใหม่ให้ทีม");
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function toggle() {
    const next = !open;
    if (!window.confirm(next ? "เปิดให้ทุกคนที่รู้ URL เข้า /hq และ /team ได้เลย (ไม่ต้องใช้ลิงก์ลับ) — รายชื่อ/เบอร์อาสาจะเปิดด้วย ยืนยัน?" : "ล็อก /hq และ /team ให้เข้าได้เฉพาะลิงก์ทีม?")) return;
    try {
      setOpen((await api("/admin/team-access", { method: "POST", body: JSON.stringify({ open: next }) })).open);
    } catch (e) {
      setMsg(e.message);
    }
  }
  const copy = (text) =>
    navigator.clipboard?.writeText(text).then(
      () => setMsg("✅ คัดลอกแล้ว"),
      () => window.prompt("คัดลอก", text),
    );
  if (!key) return msg ? <p className="text-sm text-red-700">{msg}</p> : null;
  const hq = `${window.location.origin}/hq#k=${key}`;
  const team = `${window.location.origin}/team#k=${key}`;
  return (
    <div className="mt-4 space-y-2 rounded-xl border-2 border-black bg-white p-3">
      <p className="text-lg font-bold">🔑 ลิงก์ทีม (ไม่ต้องล็อกอิน)</p>
      {open != null && (
        <div className={`rounded-lg p-2 text-sm ${open ? "bg-yellow-100" : "bg-green-100"}`}>
          <p className="font-semibold">{open ? "🔓 ตอนนี้: เปิด — ใครรู้ URL /hq, /team ก็เข้าได้" : "🔒 ตอนนี้: ล็อก — เข้าได้เฉพาะลิงก์ทีมด้านล่าง"}</p>
          <button onClick={toggle} className="mt-1 min-h-[40px] w-full rounded-lg border border-black bg-white font-semibold">
            {open ? "🔒 ล็อก (ใช้ลิงก์ทีมเท่านั้น)" : "🔓 เปิดให้เข้าได้เลย"}
          </button>
        </div>
      )}
      <p className="text-sm text-neutral-700">ส่งในกลุ่มไลน์ทีมเท่านั้น อย่าโพสต์ในกลุ่มหมู่บ้าน · เปิดครั้งเดียว เครื่องจะจำไว้</p>
      <button onClick={() => copy(hq)} className="min-h-[44px] w-full rounded-lg bg-black text-sm font-bold text-white">
        🧭 คัดลอกลิงก์ศูนย์ทีมงาน (/hq)
      </button>
      <button onClick={() => copy(team)} className="min-h-[44px] w-full rounded-lg border-2 border-black text-sm font-bold">
        🚶 คัดลอกลิงก์ทีมแจก (/team)
      </button>
      {qr && <img src={qr} alt="QR ลิงก์ทีมแจก" className="mx-auto h-48 w-48" />}
      <button onClick={rotate} className="min-h-[40px] w-full rounded-lg border border-red-600 text-sm text-red-700">
        🔄 เปลี่ยนลิงก์ทีม (ถ้าลิงก์หลุด)
      </button>
      {msg && <p className="text-sm">{msg}</p>}
    </div>
  );
}

function InviteShare() {
  const [inv, setInv] = useState(null);
  const [qr, setQr] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/staff/invite")
      .then(async (i) => {
        const url = `${window.location.origin}/staff?invite=${i.token}`;
        setInv({ ...i, url });
        setQr(await QRCode.toDataURL(url, { margin: 1, width: 280 }));
      })
      .catch((e) => setMsg(e.message));
  }, []);
  if (msg) return <p className="rounded-xl bg-white p-4">{msg}</p>;
  if (!inv) return <p className="p-6 text-center text-neutral-500">กำลังโหลด…</p>;
  const text = `ชวนมาช่วยงานน้ำท่วม หมู่บ้านสหกรณ์เคหะสถาน 4 (เสรีไทย 57)
กดลิงก์ ใส่ชื่อ ก็ใช้ได้เลย ไม่ต้องสมัคร:
${inv.url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setMsg("");
      alert("คัดลอกแล้ว เอาไปวางในแชตได้เลย");
    } catch {
      prompt("คัดลอกข้อความนี้", text);
    }
  };
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 text-center shadow">
      <h2 className="text-xl font-bold">👥 ชวนคนมาช่วย</h2>
      <p className="text-sm">
        ให้อีกคน <b>สแกน QR</b> ด้วยกล้องมือถือ หรือส่งลิงก์ทาง LINE · เปิดแล้วใส่ชื่อ ใช้งานได้ทันที
      </p>
      {qr && <img src={qr} alt="QR เข้าร่วมทีม" className="mx-auto w-64 max-w-full rounded-lg border" />}
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={`https://line.me/R/share?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer" className={`${btn} flex items-center justify-center bg-[#06C755] text-white`}>
          ส่งทาง LINE
        </a>
        <button onClick={copy} className={`${btn} border-2 border-black bg-white`}>
          คัดลอกลิงก์ + ข้อความ
        </button>
      </div>
      <details className="rounded-xl bg-neutral-50 p-3 text-left">
        <summary className="min-h-[40px] cursor-pointer font-semibold">📖 สอนเปิดในเบราว์เซอร์ (เผื่อ LINE / Messenger ในมือถือบางรุ่นเปิดจอค้างไม่ได้)</summary>
        <div className="mt-2">
          <BrowserHowTo />
        </div>
      </details>
      <p className="text-xs text-neutral-500">
        ลิงก์ใช้ได้ถึง {new Date(inv.expires_at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })} · ผู้ดูแลยกเลิกได้ทุกเมื่อ · อย่าโพสต์ในที่สาธารณะ
      </p>
    </div>
  );
}

// Signed in inside LINE/Messenger: offer to move the session to Chrome/Safari
function MoveToBrowser({ live }) {
  const [url, setUrl] = useState("");
  const [err, setErr] = useState("");
  async function move() {
    try {
      const { token } = await api("/staff/handoff", { method: "POST" });
      const target = `${window.location.origin}/staff?login=${token}`;
      if (!openExternally(target, IN_APP)) setUrl(target); // iPhone Messenger: they have to do it
    } catch (e) {
      setErr(e.message);
    }
  }
  if (url)
    return (
      <div className="mb-3">
        <InAppGate env={IN_APP} url={url} onContinue={() => setUrl("")} />
      </div>
    );
  return (
    <section className="mb-3 rounded-xl border-2 border-yellow-400 bg-yellow-50 p-3">
      <p className="text-sm">
        ⚠️{" "}
        {live.awake === "denied" ? (
          <>
            แอปแชตนี้<b>สั่งให้จอเปิดค้างไม่ได้</b> จอดับเมื่อไหร่ GPS หยุด
          </>
        ) : (
          <>
            แอปแชตนี้<b>ไม่ให้ใช้ GPS</b>
          </>
        )}{" "}
        — ใช้ Safari/Chrome แทนดีกว่า
      </p>
      <button onClick={move} className={`${btn} mt-2 w-full bg-blue-600 text-white`}>
        🌐 ย้ายไป{IN_APP.os === "ios" ? " Safari" : " Chrome"} (ไม่ต้องใส่ชื่อใหม่)
      </button>
      {err && <p className="mt-1 text-sm text-red-700">{err}</p>}
    </section>
  );
}

// ---------------- shell ----------------
// LINE import runs centrally; the tab is only for admins / the import account.
const IMPORT_TAB = ["import", "📥 นำเข้า LINE"];
const TABS = [
  ["map", "🗺️ แผนที่"],
  ["tasks", "📋 รายการงาน"],
  ["trip", "🚤 ออกงาน"],
  ["addresses", "🏠 ที่อยู่"],
  ["lookup", "🔎 ค้นเลขที่"],
  ["invite", "👥 ชวนทีม"],
];

export default function StaffApp() {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);
  const [tab, setTab] = useState(() => (window.location.hash === "#share" ? "invite" : "map")); // map first: see where the work is
  const [trip, setTrip] = useState(undefined); // undefined = loading, null = not on a trip
  const live = useStaffLocation(user, !!trip);
  const [tasks, setTasks] = useState([]);
  const [sois, setSois] = useState(null);
  const [locateTarget, setLocateTarget] = useState(null);
  const [toast, setToast] = useState("");
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (user && !load("staffGuideSeen", false)) setShowGuide(true); // first time on the staff console
  }, [user]);

  useEffect(() => {
    const login = new URLSearchParams(window.location.search).get("login");
    if (login) {
      // moved here from a chat app's browser: take over that session
      window.history.replaceState(null, "", "/staff");
      api("/auth/staff-handoff", { method: "POST", body: JSON.stringify({ token: login }) })
        .then(setUser)
        .catch((e) => setToast(e.message))
        .finally(() => setChecked(true));
    } else
      api("/auth/me")
        .then(setUser)
        .catch(() => {})
        .finally(() => setChecked(true));
    api("/sois").then((d) => setSois(d.sois));
  }, []);
  const reload = useCallback(
    () =>
      api("/staff/tasks?include_done=true")
        .then(setTasks)
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    if (user)
      api("/staff/trips/mine")
        .then((t) => setTrip(t || null))
        .catch(() => setTrip(null));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    reload();
    const t = setInterval(reload, 15000); // see teammates' claims quickly
    return () => clearInterval(t);
  }, [user, reload]);

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="sticky top-0 z-[900] bg-black text-white">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-3 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold">👷 เจ้าหน้าที่ · เสรีไทย 57</h1>
            {user && (
              <p className="truncate text-xs text-neutral-400">
                {user.name} · งานค้าง {tasks.filter((t) => t.status !== "done").length} · ยังไม่มีคนรับ {tasks.filter((t) => t.status !== "done" && !t.assignee).length}
              </p>
            )}
          </div>
          {user && (
            <button onClick={() => setShowGuide(true)} aria-label="เปิดวิธีใช้งานเจ้าหน้าที่" className="min-h-[44px] min-w-[44px] rounded-lg bg-white/10 px-3 font-bold">
              ❓
            </button>
          )}
          <a href="/" className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 text-sm">
            หน้าหลัก
          </a>
        </div>
        {user && (
          <div className="mx-auto max-w-3xl overflow-x-auto px-2 pb-2">
            <div className="flex w-max gap-1">
              {(user?.role === "admin" || user?.importer ? [...TABS, IMPORT_TAB] : TABS).map(([k, text]) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  aria-pressed={tab === k}
                  className={`min-h-[40px] whitespace-nowrap rounded-lg px-3 text-sm font-semibold ${tab === k ? "bg-white text-black" : "bg-white/10"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-3xl px-3 pb-10 pt-3">
        {!checked ? (
          <p className="p-6 text-center text-neutral-500">กำลังตรวจสอบ…</p>
        ) : !user ? (
          <Join onJoined={setUser} />
        ) : !sois ? (
          <p className="p-6 text-center text-neutral-500">กำลังโหลด…</p>
        ) : (
          <>
            {toast && <p className="mb-3 rounded-lg bg-emerald-100 p-3 font-semibold">{toast}</p>}
            {IN_APP.app && (live.awake === "denied" || ["denied", "error"].includes(live.gps.state)) && <MoveToBrowser live={live} />}
            {tab !== "invite" && <DutyBar live={live} onTrip={!!trip} />}
            {tab === "tasks" && (
              <Tasks
                user={user}
                tasks={tasks}
                setTasks={setTasks}
                reload={reload}
                onLocate={(house, soi) => {
                  setLocateTarget({ house, soi });
                  setTab("addresses");
                }}
              />
            )}
            {tab === "map" && (
              <TaskMap
                user={user}
                tasks={tasks}
                sois={sois}
                onUpdate={(t) => (t ? setTasks((prev) => prev.map((x) => (x.id === t.id ? t : x))) : reload())}
                onLocate={(house, soi) => {
                  setLocateTarget({ house, soi });
                  setTab("addresses");
                }}
              />
            )}
            {tab === "trip" && <TripPanel user={user} live={live} trip={trip} setTrip={setTrip} />}
            {tab === "invite" && (
              <>
                <InviteShare />
                {user?.role === "admin" && <TeamLinks />}
                {user?.role === "admin" && <ZoneGroups />}
              </>
            )}
            {tab === "import" && (
              <Import
                onDone={(m) => {
                  setToast(m);
                  reload();
                  setTab("tasks");
                }}
              />
            )}
            {tab === "addresses" && <Addresses sois={sois} initial={locateTarget} onSaved={reload} />}
            {tab === "lookup" && <Lookup />}
          </>
        )}
      </main>
      {showGuide && (
        <Guide
          slides={STAFF_SLIDES}
          heading="วิธีใช้งานเจ้าหน้าที่"
          onClose={() => {
            setShowGuide(false);
            save("staffGuideSeen", true);
          }}
        />
      )}
    </div>
  );
}
