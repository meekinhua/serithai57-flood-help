import { useCallback, useEffect, useState } from "react";
import { API, api } from "../api";
import { ANNOUNCEMENT_LEVELS, timeAgo } from "../config";
import Announcements from "./Announcements";

const input = "min-h-[44px] w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const btnPrimary = "min-h-[48px] rounded-xl bg-black px-5 font-semibold text-white active:bg-neutral-800 disabled:opacity-60";
const btnGhost = "min-h-[44px] rounded-lg border-2 border-black bg-white px-3 font-semibold active:bg-neutral-100 disabled:opacity-60";

const EXPIRY = [
  ["6", "6 ชั่วโมง"],
  ["24", "24 ชั่วโมง (แนะนำ)"],
  ["72", "3 วัน"],
  ["", "ไม่หมดอายุ (ต้องกดปิดเอง)"],
];

const ACTIONS = {
  create_announcement: "ประกาศใหม่",
  update_announcement: "แก้ประกาศ",
  delete_announcement: "ลบประกาศ",
  delete_post: "ลบรายการ",
  pin_post: "ปักหมุด",
  unpin_post: "เลิกปักหมุด",
  post_status: "เปลี่ยนสถานะ",
  delete_water: "ลบรายงานระดับน้ำ",
  create_admin: "เพิ่มผู้ดูแล",
  delete_admin: "ลบผู้ดูแล",
  change_password: "เปลี่ยนรหัสผ่าน",
};

export function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api("/auth/login", { method: "POST", body: JSON.stringify({ email: email.trim(), password }) }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow">
      <h2 className="text-xl font-bold">🛡️ เข้าสู่ระบบผู้ดูแล</h2>
      <p className="text-sm text-neutral-600">สำหรับกรรมการ / ผู้ดูแลหมู่บ้านเท่านั้น ชาวบ้านทั่วไปใช้งานได้โดยไม่ต้องเข้าสู่ระบบ</p>
      <div>
        <label className="mb-1 block font-medium" htmlFor="admin-email">อีเมล</label>
        <input id="admin-email" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
      </div>
      <div>
        <label className="mb-1 block font-medium" htmlFor="admin-password">รหัสผ่าน</label>
        <input id="admin-password" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
        {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}

function AnnouncementsAdmin({ admin, onPublicChange }) {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const [level, setLevel] = useState("warning");
  const [expires, setExpires] = useState("24"); // old "food at 9:00" notices were lingering for hours
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(() => api("/admin/announcements").then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function create(e) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/admin/announcements", { method: "POST", body: JSON.stringify({ text: text.trim(), level, expires_hours: expires ? Number(expires) : null }) });
      setText("");
      await reload();
      onPublicChange();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function update(id, changes) {
    try {
      await api(`/admin/announcements/${id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await reload();
      onPublicChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm("ลบประกาศนี้ถาวร?")) return;
    try {
      await api(`/admin/announcements/${id}`, { method: "DELETE" });
      await reload();
      onPublicChange();
    } catch (err) {
      setError(err.message);
    }
  }

  const expired = (a) => a.expires_at && new Date(a.expires_at) < new Date();

  return (
    <div className="space-y-6">
      <SiteMode />
      <HomeBlocks />
      <FundAdmin />
      <SurveysAdmin />
      <form onSubmit={create} className="space-y-3 rounded-2xl bg-white p-4 shadow">
        <h3 className="text-lg font-bold">📢 สร้างประกาศใหม่</h3>
        <textarea
          rows={3}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={input}
          placeholder="เช่น ศูนย์พักพิงเปิดแล้วที่สโมสรหมู่บ้าน มีอาหารและน้ำดื่ม / กฟน. จะตัดไฟซอย 3 เวลา 20:00"
        />
        <fieldset>
          <legend className="mb-1 font-medium">ระดับความสำคัญ</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {Object.entries(ANNOUNCEMENT_LEVELS).map(([key, lv]) => (
              <button
                type="button"
                key={key}
                onClick={() => setLevel(key)}
                aria-pressed={level === key}
                className={`min-h-[48px] rounded-lg border-4 px-3 font-semibold ${lv.cls} ${level === key ? "ring-4 ring-neutral-400" : "opacity-60"}`}
              >
                {lv.icon} {lv.label}
              </button>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="mb-1 block font-medium" htmlFor="expires">แสดงนาน</label>
          <select id="expires" value={expires} onChange={(e) => setExpires(e.target.value)} className={input}>
            {EXPIRY.map(([v, t]) => (
              <option key={v} value={v}>{t}</option>
            ))}
          </select>
        </div>
        {text.trim() && (
          <div>
            <p className="mb-1 text-sm text-neutral-500">ตัวอย่างที่ชาวบ้านจะเห็น:</p>
            <Announcements preview items={[{ id: "preview", text, level, created_by: admin.name }]} />
          </div>
        )}
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <button type="submit" disabled={busy || !text.trim()} className={`${btnPrimary} w-full sm:w-auto`}>
          {busy ? "กำลังประกาศ…" : "📢 ประกาศ"}
        </button>
      </form>

      <section>
        <h3 className="mb-2 text-lg font-bold">ประกาศทั้งหมด</h3>
        <ul className="space-y-2">
          {items.map((a) => {
            const lv = ANNOUNCEMENT_LEVELS[a.level];
            const live = a.active && !expired(a);
            return (
              <li key={a.id} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`rounded border px-1.5 ${lv.cls}`}>{lv.icon} {lv.label}</span>
                  <span className={`rounded px-1.5 ${live ? "bg-black text-white" : "border border-neutral-300 text-neutral-500"}`}>
                    {live ? "กำลังแสดง" : expired(a) ? "หมดอายุ" : "ปิดอยู่"}
                  </span>
                  <span className="text-neutral-500">{a.created_by} · {timeAgo(a.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{a.text}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.active ? (
                    <button onClick={() => update(a.id, { active: false })} className={btnGhost}>⏸ ปิดประกาศ</button>
                  ) : (
                    <button onClick={() => update(a.id, { active: true })} className={btnGhost}>▶️ เปิดอีกครั้ง</button>
                  )}
                  <button onClick={() => remove(a.id)} className="min-h-[44px] px-3 text-red-700 underline">ลบถาวร</button>
                </div>
              </li>
            );
          })}
          {items.length === 0 && <li className="rounded-xl bg-white p-4 text-neutral-500">ยังไม่มีประกาศ</li>}
        </ul>
      </section>
    </div>
  );
}

function AdminsAdmin({ admin }) {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => api("/admin/admins").then(setItems).catch((e) => setError(e.message)), []);
  useEffect(() => {
    reload();
  }, [reload]);

  async function add(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/admin/admins", { method: "POST", body: JSON.stringify(form) });
      setForm({ name: "", email: "", password: "" });
      await reload();
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function remove(a) {
    if (!window.confirm(`ลบผู้ดูแล ${a.name} (${a.email})?`)) return;
    try {
      await api(`/admin/admins/${a.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-6">
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 shadow-sm">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {a.name} {a.id === admin.id && <span className="text-sm text-neutral-500">(คุณ)</span>}
              </p>
              <p className="break-all text-sm text-neutral-600">{a.email}</p>
            </div>
            {a.id !== admin.id && (
              <button onClick={() => remove(a)} className="min-h-[44px] px-3 text-red-700 underline">ลบ</button>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="space-y-3 rounded-2xl bg-white p-4 shadow">
        <h3 className="text-lg font-bold">➕ เพิ่มผู้ดูแล</h3>
        <input required placeholder="ชื่อ" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} className={input} />
        <input required type="email" placeholder="อีเมล" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
        <input required type="text" minLength={8} placeholder="รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัว)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" className={input} />
        <p className="text-sm text-neutral-500">แจ้งรหัสผ่านให้ผู้ดูแลใหม่ทางช่องทางส่วนตัว และให้เปลี่ยนรหัสหลังเข้าใช้ครั้งแรก</p>
        {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className={btnPrimary}>เพิ่มผู้ดูแล</button>
      </form>
    </div>
  );
}

function AuditAdmin() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api("/admin/audit").then(setItems).catch(() => {});
  }, []);
  return (
    <ol className="space-y-1 rounded-2xl bg-white p-4 text-sm shadow">
      {items.map((a) => (
        <li key={a.id} className="break-words border-b border-neutral-100 py-1 last:border-0">
          <span className="text-neutral-500">{timeAgo(a.at)}</span> · <b>{a.admin_name}</b> · {ACTIONS[a.action] || a.action}
          {a.detail && <span className="text-neutral-600"> — {a.detail}</span>}
        </li>
      ))}
      {items.length === 0 && <li className="text-neutral-500">ยังไม่มีประวัติ</li>}
    </ol>
  );
}

function AccountAdmin() {
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      await api("/auth/password", { method: "POST", body: JSON.stringify(form) });
      setForm({ current_password: "", new_password: "" });
      setMsg("เปลี่ยนรหัสผ่านแล้ว");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-3 rounded-2xl bg-white p-4 shadow">
      <h3 className="text-lg font-bold">🔑 เปลี่ยนรหัสผ่าน</h3>
      <input required type="password" placeholder="รหัสผ่านปัจจุบัน" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} className={input} />
      <input required type="password" minLength={8} placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)" autoComplete="new-password" value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} className={input} />
      {msg && <p className="rounded-lg bg-neutral-100 p-3">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <button type="submit" className={btnPrimary}>บันทึก</button>
    </form>
  );
}

function StaffAdmin() {
  const [invites, setInvites] = useState([]);
  const [staff, setStaff] = useState([]);
  const [hours, setHours] = useState("72");
  const [msg, setMsg] = useState("");
  const reload = useCallback(async () => {
    setInvites(await api("/admin/staff-invites"));
    setStaff((await api("/admin/admins")).filter((a) => a.role === "staff"));
  }, []);
  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
  }, [reload]);
  const link = (t) => `${window.location.origin}/staff#invite=${t}`;
  async function create() {
    const inv = await api("/admin/staff-invites", { method: "POST", body: JSON.stringify({ expires_hours: Number(hours) }) });
    try {
      await navigator.clipboard.writeText(link(inv.token));
      setMsg("สร้างลิงก์เชิญแล้ว และคัดลอกให้แล้ว ส่งให้เจ้าหน้าที่ทางแชตส่วนตัว");
    } catch {
      setMsg(link(inv.token));
    }
    reload();
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-2xl bg-white p-4 shadow">
        <h3 className="text-lg font-bold">👷 เชิญเจ้าหน้าที่ / อาสา</h3>
        <p className="text-sm text-neutral-600">เจ้าหน้าที่เปิดลิงก์ ใส่ชื่อ แล้วใช้หน้า /staff ได้ทันที (รับงาน แบ่งซอย ออกงาน ตั้งตำแหน่งบ้าน · งานจาก LINE ส่วนกลางนำเข้าให้) — จัดการผู้ดูแล/ประกาศไม่ได้ · เจ้าหน้าที่ทุกคนส่งลิงก์ต่อ/โชว์ QR ได้เองที่แท็บ “👥 ชวนทีม” (ใช้ลิงก์ที่หมดอายุช้าสุด) ยกเลิกลิงก์ = หยุดรับคนใหม่ทันที</p>
        <a href="/staff#share" className="inline-block min-h-[44px] rounded-lg border-2 border-black px-3 py-2 font-semibold">📱 เปิด QR ชวนทีม</a>
        <div className="flex flex-wrap gap-2">
          <select value={hours} onChange={(e) => setHours(e.target.value)} className={input + " w-auto"}>
            <option value="24">ลิงก์ใช้ได้ 24 ชม.</option>
            <option value="72">ลิงก์ใช้ได้ 3 วัน</option>
            <option value="168">ลิงก์ใช้ได้ 7 วัน</option>
            <option value="720">ลิงก์ใช้ได้ 30 วัน</option>
          </select>
          <button onClick={create} className={btnPrimary}>สร้างลิงก์เชิญ</button>
        </div>
        {msg && <p className="break-all rounded-lg bg-neutral-100 p-3 text-sm">{msg}</p>}
      </div>
      <ul className="space-y-2">
        {invites.map((i) => (
          <li key={i.token} className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 text-sm shadow-sm">
            <span className="min-w-0 flex-1">
              {i.active && new Date(i.expires_at) > new Date() ? "🟢 ใช้ได้" : "⚪ ปิดแล้ว"} · เข้าร่วม {i.joined} คน · หมดอายุ {timeAgo(i.expires_at).replace("ที่แล้ว", "")}
            </span>
            {i.active && (
              <>
                <button onClick={() => navigator.clipboard?.writeText(link(i.token)).then(() => setMsg("คัดลอกลิงก์แล้ว"))} className={btnGhost}>คัดลอกลิงก์</button>
                <button onClick={() => api(`/admin/staff-invites/${i.token}`, { method: "DELETE" }).then(reload)} className="min-h-[44px] px-2 text-red-700 underline">ยกเลิกลิงก์</button>
              </>
            )}
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-white p-4 shadow">
        <h3 className="mb-2 font-bold">เจ้าหน้าที่ในระบบ ({staff.length})</h3>
        <ul className="space-y-1 text-sm">
          {staff.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span className="flex-1">👷 {s.name}</span>
              <button onClick={() => window.confirm(`ถอน ${s.name} ออกจากทีม?`) && api(`/admin/admins/${s.id}`, { method: "DELETE" }).then(reload)} className="min-h-[40px] px-2 text-red-700 underline">
                ถอนสิทธิ์
              </button>
            </li>
          ))}
          {staff.length === 0 && <li className="text-neutral-500">ยังไม่มี</li>}
        </ul>
      </section>
    </div>
  );
}

const TABS = [
  ["announcements", "📢 ประกาศ"],
  ["staff", "👷 เจ้าหน้าที่"],
  ["admins", "🛡️ ผู้ดูแล"],
  ["audit", "📜 ประวัติ"],
  ["account", "🔑 บัญชี"],
];

export default function AdminPanel({ admin, onPublicChange }) {
  const [tab, setTab] = useState("announcements");
  return (
    <div>
      <p className="mb-3 rounded-xl bg-white p-3 text-sm shadow-sm">
        การลบ / ปักหมุดรายการ และลบรายงานระดับน้ำ ทำได้ที่<a href="/" className="font-semibold underline">หน้าหลัก</a> (ปุ่มผู้ดูแลจะแสดงในหน้ารายละเอียดของแต่ละรายการ)
      </p>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1 sm:grid-cols-5" role="tablist">
        {TABS.map(([key, text]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-[44px] rounded-lg font-semibold ${tab === key ? "bg-white shadow" : "text-neutral-600"}`}>
            {text}
          </button>
        ))}
      </div>
      {tab === "announcements" && <AnnouncementsAdmin admin={admin} onPublicChange={onPublicChange} />}
      {tab === "staff" && <StaffAdmin />}
      {tab === "admins" && <AdminsAdmin admin={admin} />}
      {tab === "audit" && <AuditAdmin />}
      {tab === "account" && <AccountAdmin />}
    </div>
  );
}

// Home page mode: ซ่อมบ้าน (flood board archived, read-only) or back to the flood board if the water returns.
function SiteMode() {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/site")
      .then((r) => setMode(r.mode))
      .catch((e) => setError(e.message));
  }, []);
  async function change(next) {
    const text = next === "flood" ? "เปิดระบบน้ำท่วมกลับมาเป็นหน้าแรก? (ทุกคนแจ้งน้ำ/ขอความช่วยเหลือได้อีกครั้ง)" : "ปิดระบบน้ำท่วม เก็บเป็นคลัง แล้วใช้หน้าซ่อมบ้าน?";
    if (!window.confirm(text)) return;
    setBusy(true);
    setError("");
    try {
      setMode((await api("/admin/site", { method: "PUT", body: JSON.stringify({ mode: next }) })).mode);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }
  return (
    <section className="space-y-3 rounded-2xl border-4 border-black bg-white p-4 shadow">
      <h3 className="text-lg font-bold">🏠 โหมดหน้าแรก</h3>
      <p className="text-sm text-neutral-600">
        ตอนนี้: <b>{mode === "flood" ? "🌊 ระบบน้ำท่วม (เปิดรับแจ้ง)" : mode === "repair" ? "🧰 ซ่อมบ้าน · ระบบน้ำท่วมเป็นคลังดูอย่างเดียวที่ /flood" : "…"}</b>
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button disabled={busy || mode === "repair"} onClick={() => change("repair")} className={btnPrimary}>
          🧰 ใช้โหมดซ่อมบ้าน
        </button>
        <button disabled={busy || mode === "flood"} onClick={() => change("flood")} className={btnGhost}>
          🌊 น้ำมาอีก: เปิดระบบน้ำท่วม
        </button>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
    </section>
  );
}

// Highlight boxes on top of the ซ่อมบ้าน home page: on/off and wording, live for everyone on save.
function HomeBlocks() {
  const [h, setH] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/home")
      .then(setH)
      .catch((e) => setMsg(e.message));
  }, []);
  if (!h) return null;
  const setHub = (patch) => setH({ ...h, hub: { ...h.hub, ...patch } });
  async function save(next = h) {
    setBusy(true);
    setMsg("");
    try {
      setH(await api("/admin/home", { method: "PUT", body: JSON.stringify(next) }));
      setMsg("บันทึกแล้ว · ทุกคนเห็นภายในครึ่งนาที");
    } catch (e) {
      setMsg(e.message);
    }
    setBusy(false);
  }
  const toggle = (on) => (on ? "bg-emerald-600 text-white" : "bg-neutral-200 text-neutral-700");
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow">
      <h3 className="text-lg font-bold">🟨 กล่องไฮไลต์บนหน้าแรก (โหมดซ่อมบ้าน)</h3>
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 flex-1">🌧️ กล่องเฝ้าระวังน้ำ</b>
          <button disabled={busy} onClick={() => save({ ...h, watch_on: !h.watch_on })} className={`min-h-[44px] rounded-lg px-4 font-bold ${toggle(h.watch_on)}`}>
            {h.watch_on ? "แสดงอยู่ · กดเพื่อซ่อน" : "ซ่อนอยู่ · กดเพื่อแสดง"}
          </button>
        </div>
        <input maxLength={80} value={h.watch_title} onChange={(e) => setH({ ...h, watch_title: e.target.value })} className={input} placeholder="หัวข้อ (เว้นว่าง = 🌧️ ฝนตกอีกรอบ · เฝ้าระวังน้ำ)" aria-label="หัวข้อกล่องเฝ้าระวังน้ำ" />
        <p className="text-xs text-neutral-500">ป้ายระดับน้ำมุมขวาบน และแท็บ 💧 ระดับน้ำ ยังอยู่เสมอ</p>
      </div>
      <div className="space-y-2 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <b className="min-w-0 flex-1">📍 กล่องเหลือง (จุดแจกของ / ศูนย์อาสา)</b>
          <button disabled={busy} onClick={() => save({ ...h, hub: { ...h.hub, on: !h.hub.on } })} className={`min-h-[44px] rounded-lg px-4 font-bold ${toggle(h.hub.on)}`}>
            {h.hub.on ? "แสดงอยู่ · กดเพื่อซ่อน" : "ซ่อนอยู่ · กดเพื่อแสดง"}
          </button>
        </div>
        <input maxLength={80} value={h.hub.title} onChange={(e) => setHub({ title: e.target.value })} className={input} placeholder="ข้อความหลัก" aria-label="ข้อความหลักกล่องเหลือง" />
        <input maxLength={160} value={h.hub.sub} onChange={(e) => setHub({ sub: e.target.value })} className={input} placeholder="บรรทัดรอง" aria-label="บรรทัดรองกล่องเหลือง" />
        <input
          value={h.hub.lat != null ? `${h.hub.lat}, ${h.hub.lng}` : ""}
          onChange={(e) => {
            const m = e.target.value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
            setHub(m ? { lat: +m[1], lng: +m[2] } : { lat: null, lng: null });
          }}
          className={input}
          placeholder="พิกัดสำหรับปุ่มนำทาง เช่น 13.789872, 100.673517 (เว้นว่าง = ไม่มีปุ่ม)"
          aria-label="พิกัดกล่องเหลือง"
        />
      </div>
      <button disabled={busy} onClick={() => save()} className={btnPrimary}>💾 บันทึกข้อความ</button>
      {msg && <p className="text-sm">{msg}</p>}
    </section>
  );
}

// เงินสมทบ: the account shown on /fund, and the treasurer link (separate from the volunteer team link)
function FundAdmin() {
  const [acc, setAcc] = useState(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/fund")
      .then((f) => setAcc(f.account || { on: true, bank: "", number: "", name: "", note: "" }))
      .catch((e) => setMsg(e.message));
    api("/admin/fund/key")
      .then((r) => setKey(r.key))
      .catch(() => {});
  }, []);
  if (!acc) return null;
  const link = key ? `${window.location.origin}/fund#fk=${key}` : "";
  async function saveAcc() {
    setMsg("");
    try {
      setAcc(await api("/admin/fund/account", { method: "PUT", body: JSON.stringify(acc) }));
      setMsg("บันทึกบัญชีแล้ว");
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function rotate() {
    if (!window.confirm("เปลี่ยนลิงก์เหรัญญิก? ลิงก์เดิมจะใช้ไม่ได้ทันที")) return;
    setKey((await api("/admin/fund/key/rotate", { method: "POST" })).key);
  }
  const set = (p) => setAcc({ ...acc, ...p });
  return (
    <section className="space-y-3 rounded-2xl bg-white p-4 shadow">
      <h3 className="text-lg font-bold">💰 เงินสมทบทีมอาสา (/fund)</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <input value={acc.bank} maxLength={40} onChange={(e) => set({ bank: e.target.value })} className={input} placeholder="ธนาคาร เช่น กรุงไทย" aria-label="ธนาคาร" />
        <input value={acc.number} maxLength={30} onChange={(e) => set({ number: e.target.value })} className={input} placeholder="เลขบัญชี" aria-label="เลขบัญชี" />
        <input value={acc.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} className={input} placeholder="ชื่อบัญชี" aria-label="ชื่อบัญชี" />
        <label className="flex min-h-[44px] items-center gap-2">
          <input type="checkbox" checked={acc.on} onChange={(e) => set({ on: e.target.checked })} className="h-5 w-5" /> แสดงบัญชีบนหน้า /fund
        </label>
      </div>
      <input value={acc.note} maxLength={300} onChange={(e) => set({ note: e.target.value })} className={input} placeholder="หมายเหตุ เช่น สมทบค่าอาหาร น้ำ กระสอบทราย · ผู้ดูแลยอด: คุณเอ็ม" aria-label="หมายเหตุบัญชี" />
      <button onClick={saveAcc} className={btnPrimary}>💾 บันทึกบัญชี</button>
      <div className="rounded-xl bg-amber-50 p-3 text-sm">
        <p className="font-semibold">🔑 ลิงก์เหรัญญิก (ส่งให้คนดูแลยอดเท่านั้น · ตรวจยอด/บันทึกรายจ่ายได้)</p>
        <p className="mt-1 break-all font-mono text-xs">{link || "…"}</p>
        <div className="mt-2 flex gap-2">
          <button onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg("คัดลอกลิงก์แล้ว")).catch(() => {})} className={btnGhost}>คัดลอกลิงก์</button>
          <button onClick={rotate} className={btnGhost}>เปลี่ยนลิงก์</button>
        </div>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
    </section>
  );
}

// Sign-up lists for the team (e.g. electricians' house list): on/off, and who signed (CSV for the team)
function SurveysAdmin() {
  const [list, setList] = useState(null);
  const [rows, setRows] = useState({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    api("/admin/surveys")
      .then((r) => setList(r.surveys))
      .catch((e) => setMsg(e.message));
  }, []);
  if (!list) return msg ? <p className="text-red-700">{msg}</p> : null;
  async function toggle(i) {
    const next = list.map((s, j) => (j === i ? { ...s, on: !s.on } : s));
    try {
      setList((await api("/admin/surveys", { method: "PUT", body: JSON.stringify({ surveys: next }) })).surveys);
    } catch (e) {
      setMsg(e.message);
    }
  }
  async function show(key) {
    setRows({ ...rows, [key]: await api(`/admin/surveys/${key}`) });
  }
  return (
    <section className="rounded-2xl border bg-white p-4">
      <h2 className="text-lg font-bold">⚡ แบบสำรวจ / ลงชื่อ</h2>
      {list.map((s, i) => (
        <div key={s.key} className="mt-2 rounded-lg border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <b className="flex-1">{s.title}</b>
            <button onClick={() => toggle(i)} className={`min-h-[40px] rounded-lg px-3 font-semibold ${s.on ? "bg-green-600 text-white" : "border-2 border-black"}`}>
              {s.on ? "เปิดอยู่ · กดปิด" : "ปิดอยู่ · กดเปิด"}
            </button>
            <button onClick={() => show(s.key)} className="min-h-[40px] rounded-lg border-2 border-black px-3">ดูรายชื่อ</button>
            <a href={`${API}/admin/surveys/${s.key}/csv`} className="min-h-[40px] rounded-lg border-2 border-black px-3 py-2">CSV</a>
          </div>
          {rows[s.key] && (
            <ol className="mt-2 list-decimal space-y-1 pl-6 text-sm">
              {rows[s.key].map((r) => (
                <li key={r.house}>
                  ซ.{r.soi} · {r.house} · {r.name} · {r.phone} · {(r.picks || []).join(", ")} {r.note && `· ${r.note}`}
                </li>
              ))}
              {rows[s.key].length === 0 && <li className="list-none text-neutral-500">ยังไม่มีใครลงชื่อ</li>}
            </ol>
          )}
        </div>
      ))}
      {msg && <p className="mt-2 text-red-700">{msg}</p>}
    </section>
  );
}
