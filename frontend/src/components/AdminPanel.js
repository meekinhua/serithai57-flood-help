import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
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

const TABS = [
  ["announcements", "📢 ประกาศ"],
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
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1 sm:grid-cols-4" role="tablist">
        {TABS.map(([key, text]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-[44px] rounded-lg font-semibold ${tab === key ? "bg-white shadow" : "text-neutral-600"}`}>
            {text}
          </button>
        ))}
      </div>
      {tab === "announcements" && <AnnouncementsAdmin admin={admin} onPublicChange={onPublicChange} />}
      {tab === "admins" && <AdminsAdmin admin={admin} />}
      {tab === "audit" && <AuditAdmin />}
      {tab === "account" && <AccountAdmin />}
    </div>
  );
}
