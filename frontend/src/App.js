import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, load, save, viewerId } from "./api";
import { ANNOUNCEMENT_LEVELS, HOTLINE_GROUPS, KINDS, WATER_TREND, WATER_WHERE, VILLAGE_NAME, WATER_LEVELS, categoryOf, osmLink, paymentBadge, timeAgo, waterOf } from "./config";
import MapView from "./components/MapView";
import Sheet from "./components/Sheet";
import { PostForm, WaterForm } from "./components/Forms";
import { PostDetail, PostSummary, waitingHours } from "./components/PostCard";
import Announcements from "./components/Announcements";
import AdminPanel, { AdminLogin } from "./components/AdminPanel";
import { mediaUrl } from "./media";
import Guide from "./components/Guide";
import { WeatherAlerts, WeatherCard, WeatherTopBar, WindyMap } from "./components/Weather";
import { ServiceBoard, ServiceForm, ServiceStrip } from "./components/ServiceBoard";
import { TripsStrip } from "./components/Trips";
import { CanalForm, PumpForm, PumpList } from "./components/Canal";
import { mergeZones, withLiveDrops } from "./components/ZonesPage";
import { useCountUp } from "./motion";

const REFRESH_MS = 20000;
const WEATHER_REFRESH_MS = 10 * 60 * 1000; // server caches Open-Meteo for 10 min too
const WATER_NOW_HOURS = 3; // "now" = reports from the last 3 h
const WATER_PREV_HOURS = 9; // compared with the 3–9 h before, for the trend
const IS_ADMIN_PAGE = window.location.pathname.replace(/\/+$/, "") === "/admin";

export default function App() {
  const [posts, setPosts] = useState([]);
  const [water, setWater] = useState([]);
  const [canal, setCanal] = useState(null); // {reports, pumps}: canal level vs the flood wall, and the pumps
  const [drops, setDrops] = useState([]); // truck drop points of the zone blocks, for the map
  useEffect(() => {
    Promise.all([api("/zones"), api("/ops").catch(() => null)])
      .then(([z, ops]) => {
        const zs = mergeZones(withLiveDrops(z, ops)).zones;
        setDrops(
          zs.flatMap((g) => [
            { tag: g.label || g.id, place: g.drop.place, lat: g.drop.lat, lng: g.drop.lng, color: g.color, person: ops?.points?.[g.id]?.person },
            ...(g.drop.extra || []).map((x) => ({ tag: x.tag || `${g.id}2`, place: x.place, lat: x.lat, lng: x.lng, color: g.color })),
          ])
        );
      })
      .catch(() => {});
  }, []);
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("map"); // phones: map | list — the map with requests on it is what people need first
  const [sheet, setSheet] = useState(null); // {type: "form"|"water"|"detail"|"hotlines", ...}
  const [focus, setFocus] = useState(null);
  const [online, setOnline] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [toast, setToast] = useState("");
  // First visit: show the animated how-to once (never on the admin page)
  const [showGuide, setShowGuide] = useState(() => !IS_ADMIN_PAGE && !load("guideSeen", false));
  const closeGuide = useCallback(() => {
    setShowGuide(false);
    save("guideSeen", true);
  }, []);
  // Posts that arrived after the first load get a highlight flash
  const knownIds = useRef(null);
  const [freshIds, setFreshIds] = useState(() => new Set());
  const [announcements, setAnnouncements] = useState([]);
  const [viewers, setViewers] = useState(null);
  const [weather, setWeather] = useState(null);
  const [services, setServices] = useState([]);
  const [trips, setTrips] = useState([]);

  // Boats/trucks move: poll their positions more often than the rest, only while the page is visible.
  useEffect(() => {
    const loadTrips = () => document.visibilityState === "visible" && api("/trips").then(setTrips).catch(() => {});
    loadTrips();
    const t = setInterval(loadTrips, 10000);
    document.addEventListener("visibilitychange", loadTrips);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", loadTrips);
    };
  }, []);

  // Weather never disappears: on failure we keep the last data (or show a placeholder) and retry sooner.
  useEffect(() => {
    let timer;
    const loadWeather = async () => {
      let next = WEATHER_REFRESH_MS;
      try {
        const w = await api("/weather");
        setWeather((prev) => (w.unavailable && prev?.current ? { ...prev, stale: true } : w));
        if (w.unavailable || w.stale) next = 60 * 1000;
      } catch {
        setWeather((prev) => (prev?.current ? { ...prev, stale: true } : { unavailable: true, alerts: [] }));
        next = 60 * 1000;
      }
      timer = setTimeout(loadWeather, next);
    };
    loadWeather();
    return () => clearTimeout(timer);
  }, []);
  const [admin, setAdmin] = useState(null);
  const [staffUser, setStaffUser] = useState(null); // staff share the login system but not admin powers
  const [authChecked, setAuthChecked] = useState(false);

  // Admin session: secret link /admin#key=... logs in once, then the cookie carries it.
  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (key) window.history.replaceState(null, "", window.location.pathname); // don't leave the key in the URL bar/history
    const check = key ? api("/auth/key", { method: "POST", body: JSON.stringify({ key }) }) : api("/auth/me");
    check
      .then((u) => (u.role === "staff" ? setStaffUser(u) : setAdmin(u)))
      .catch((err) => key && setToast(err.message))
      .finally(() => setAuthChecked(true));
  }, []);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setAdmin(null);
  }

  const refresh = useCallback(async () => {
    if (document.visibilityState === "visible") {
      // Presence ping rides along with each refresh; hidden tabs stop pinging and drop off within 60 s.
      api("/presence", { method: "POST", body: JSON.stringify({ id: viewerId() }) })
        .then((r) => setViewers(r.online))
        .catch(() => {});
    }
    try {
      const [p, w, a, sv, cn] = await Promise.all([
        api(`/posts?include_done=${showDone}`),
        api("/water"),
        api("/announcements"),
        api("/services"),
        api("/canal").catch(() => null),
      ]);
      if (cn) setCanal(cn);
      setServices(sv);
      setPosts(p);
      if (knownIds.current) {
        const fresh = p.filter((x) => !knownIds.current.has(x.id)).map((x) => x.id);
        if (fresh.length) setFreshIds(new Set(fresh));
      }
      knownIds.current = new Set([...(knownIds.current || []), ...p.map((x) => x.id)]);
      setWater(w);
      setAnnouncements(a);
      setOnline(true);
      setUpdatedAt(new Date());
    } catch {
      setOnline(false);
    }
  }, [showDone]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, REFRESH_MS);
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  useEffect(() => {
    // Leaving the page: tell the server right away so the counter drops without waiting 60 s.
    const leave = () => {
      const body = new Blob([JSON.stringify({ id: viewerId() })], { type: "application/json" });
      navigator.sendBeacon?.(`${API}/presence/leave`, body);
    };
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Requests first (helpers scan top-down), then offers, then info; info older than 12 h is folded away.
  const KIND_ORDER = { need: 0, offer: 1, info: 2 };
  const [showOldInfo, setShowOldInfo] = useState(false);
  const { visible, oldInfo } = useMemo(() => {
    const list = posts
      .filter((p) => filter === "all" || (filter === "paid" ? p.payment === "paid" : p.kind === filter))
      .sort(
        (a, b) =>
          KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
          (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
          (b.urgent && b.status === "open" ? 1 : 0) - (a.urgent && a.status === "open" ? 1 : 0) ||
          (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) ||
          b.created_at.localeCompare(a.created_at)
      );
    const cutoff = Date.now() - 12 * 3600 * 1000;
    const isOld = (p) => p.kind === "info" && !p.pinned && new Date(p.created_at).getTime() < cutoff;
    return { visible: list.filter((p) => !isOld(p)), oldInfo: list.filter(isOld) };
  }, [posts, filter]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = { need: 0, urgent: 0, offer: 0, info: 0 };
    for (const p of posts) {
      if (p.status === "done") continue;
      c[p.kind]++;
      if (p.urgent && p.status === "open") c.urgent++;
    }
    return c;
  }, [posts]);

  // The four big buttons may scroll off (long announcements, warnings): keep an SOS button reachable.
  const actionsRef = useRef(null);
  const [showFab, setShowFab] = useState(false);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([entry]) => setShowFab(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [authChecked]);

  // "You said you'd help 2 h ago -- done?" so requests don't stay "helping" forever.
  const [snoozeTick, setSnoozeTick] = useState(0);
  const reminder = useMemo(() => {
    const mine = load("myHelping", {});
    const snoozed = load("helpingSnooze", {});
    return posts.find(
      (p) => p.status === "helping" && mine[p.id] && Date.now() - mine[p.id] > 2 * 3600 * 1000 && !(snoozed[p.id] > Date.now())
    );
  }, [posts, snoozeTick]); // eslint-disable-line react-hooks/exhaustive-deps

  async function finishHelping(p) {
    const who = load("contact", {}).name || "ผู้ช่วย";
    try {
      upsert(await api(`/posts/${p.id}/status`, { method: "POST", body: JSON.stringify({ status: "done", name: who, note: "ช่วยเสร็จแล้ว" }) }));
      const mine = load("myHelping", {});
      delete mine[p.id];
      save("myHelping", mine);
      setToast("ขอบคุณที่ช่วยเหลือ 🙏");
    } catch (err) {
      setToast(err.message);
    }
  }

  function snoozeHelping(p) {
    save("helpingSnooze", { ...load("helpingSnooze", {}), [p.id]: Date.now() + 3600 * 1000 });
    setSnoozeTick((t) => t + 1);
  }

  const paidNeedCount = useMemo(() => posts.filter((p) => p.kind === "need" && p.payment === "paid" && p.status !== "done").length, [posts]);

  const selected = sheet?.type === "detail" ? posts.find((p) => p.id === sheet.id) : null;
  const openDetail = useCallback((id) => setSheet({ type: "detail", id }), []);

  function upsert(post) {
    setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
  }

  function showOnMap(p) {
    setSheet(null);
    setTab("map");
    // water reports have a level: open the map in water mode so the dot is visible
    setFocus({ lat: p.lat, lng: p.lng, t: Date.now(), water: p.level != null });
  }

  async function copySummary() {
    const open = posts.filter((p) => p.kind === "need" && p.status !== "done");
    const lines = [`🌊 สรุปคำขอความช่วยเหลือ ${VILLAGE_NAME}`, `ณ ${new Date().toLocaleString("th-TH")}`, ""];
    if (weather?.alerts?.length) {
      lines.push("🌦️ เตือนสภาพอากาศ");
      weather.alerts.forEach((a) => lines.push(`${a.icon} ${a.title}`));
      lines.push("");
    }
    if (announcements.length) {
      lines.push("📢 ประกาศจากผู้ดูแลหมู่บ้าน");
      announcements.forEach((a) => lines.push(`${ANNOUNCEMENT_LEVELS[a.level].icon} ${a.text}`));
      lines.push("");
    }
    open.forEach((p, i) => {
      const [emoji, cat] = categoryOf(p);
      lines.push(
        `${i + 1}. ${p.urgent ? "🔴ด่วน " : ""}${emoji} ${cat}${paymentBadge(p) ? ` [${paymentBadge(p)}]` : ""}${p.status === "helping" ? " (มีคนไปแล้ว)" : ""}`,
        `   ${p.detail}`,
        `   ${[p.place, p.people != null && `${p.people} คน`, p.name, p.has_phone && "เบอร์ดูในแอป", waitingHours(p) >= 3 && `รอมา ${Math.floor(waitingHours(p))} ชม.`].filter(Boolean).join(" · ")}`,
        `   ${osmLink(p.lat, p.lng)}`
      );
    });
    if (!open.length) lines.push("ยังไม่มีคำขอที่ค้างอยู่");
    if (services.length) lines.push("", `📇 บอร์ดติดต่อ ช่าง/รถ/รับจ้าง: ${services.length} ราย (เปิดในแอป)`);
    lines.push("", `แจ้ง / อัปเดต: ${window.location.origin}`);
    await copyText(lines.join("\n"));
    setToast("คัดลอกสรุปแล้ว วางในกลุ่ม LINE ได้เลย");
  }

  async function share() {
    const url = window.location.origin;
    const text = `ระบบช่วยเหลือน้ำท่วม ${VILLAGE_NAME} — แจ้งขอความช่วยเหลือ / เสนอช่วย / ดูระดับน้ำ`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "ช่วยกันน้ำท่วม", text, url });
        return;
      } catch {}
    }
    await copyText(`${text}\n${url}`);
    setToast("คัดลอกลิงก์แล้ว");
  }

  async function deleteWater(w) {
    if (!window.confirm(`ลบรายงานระดับน้ำ "${waterOf(w.level).label}" นี้?`)) return;
    try {
      await api(`/admin/water/${w.id}`, { method: "DELETE" });
      setWater((prev) => prev.filter((x) => x.id !== w.id));
    } catch (err) {
      setToast(err.message);
    }
  }

  // Village-wide picture NOW: the typical (median) level reported in the last 3 h, and whether it is
  // going down or up compared with the 3–9 h before. The deepest-ever report misleads once water falls.
  const waterStat = useMemo(() => {
    const t = Date.now();
    const ageH = (w) => (t - new Date(w.created_at).getTime()) / 3.6e6;
    const median = (arr) => {
      const v = arr.map((w) => w.level).sort((a, b) => a - b);
      return v[Math.floor((v.length - 1) / 2)];
    };
    const recent = water.filter((w) => ageH(w) <= WATER_NOW_HOURS);
    const before = water.filter((w) => ageH(w) > WATER_NOW_HOURS && ageH(w) <= WATER_PREV_HOURS);
    if (recent.length) {
      const now = median(recent);
      const report = recent.find((w) => w.level === now) || recent[0];
      let trend = "";
      if (before.length >= 2) {
        const prev = median(before);
        trend = now < prev ? `⬇️ ลดลงจาก${waterOf(prev).label} · ` : now > prev ? `⬆️ สูงขึ้นจาก${waterOf(prev).label} · ` : "➡️ ทรงตัว · ";
      }
      return { report, label: `ระดับน้ำตอนนี้ (${WATER_NOW_HOURS} ชม.)`, sub: `${trend}จาก ${recent.length} รายงาน` };
    }
    if (water.length) return { report: water[0], label: "⚠️ ยังไม่มีรายงานใหม่", sub: `ล่าสุด ${timeAgo(water[0].created_at)} · ช่วยแจ้งระดับน้ำ` };
    return null;
  }, [water, updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps -- updatedAt re-evaluates the time windows on each poll

  return (
    <div className="min-h-screen bg-neutral-100 text-neutral-900">
      <header className="sticky top-0 z-[900] bg-black text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2 sm:px-4">
          <Logo />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold sm:text-xl">ช่วยกันน้ำท่วม เสรีไทย 57</h1>
            <p className="truncate text-xs text-neutral-400 sm:text-sm">
              {online && viewers != null && (
                <span className="mr-1 font-semibold text-emerald-400">
                  <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
                  {viewers.toLocaleString("th-TH")} คนกำลังดู
                </span>
              )}
              {online && viewers != null && " · "}
              {online ? `อัปเดต ${updatedAt ? timeAgo(updatedAt) : "…"}` : "⚠️ เชื่อมต่อไม่ได้ กำลังลองใหม่"} · {VILLAGE_NAME}
            </p>
          </div>
          <button onClick={() => setSheet({ type: "hotlines" })} className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-3 font-semibold active:bg-red-700">
            ☎️ <span className="hidden min-[400px]:inline">เบอร์ฉุกเฉิน</span>
          </button>
          <button onClick={() => setShowGuide(true)} aria-label="เปิดวิธีใช้งาน" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 font-bold active:bg-white/20">
            ❓
          </button>
          <button onClick={share} aria-label="แชร์" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 active:bg-white/20">
            🔗
          </button>
        </div>
        {!IS_ADMIN_PAGE && <WeatherTopBar weather={weather} onOpen={() => setSheet({ type: "weather" })} />}
        {staffUser && !admin && (
          <div className="border-t border-white/20 bg-blue-900">
            <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-1 text-sm sm:px-4">
              <span className="font-semibold">👷 เจ้าหน้าที่ · {staffUser.name}</span>
              <a href="/staff" className="ml-auto flex min-h-[40px] items-center underline">ไปหน้าเจ้าหน้าที่ ›</a>
            </div>
          </div>
        )}
        {admin && (
          <div className="border-t border-white/20 bg-neutral-800">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1 text-sm sm:px-4">
              <span className="font-semibold">🛡️ โหมดผู้ดูแล · {admin.name}</span>
              {IS_ADMIN_PAGE ? (
                <a href="/" className="flex min-h-[40px] items-center underline">← หน้าหลัก (จัดการรายการ)</a>
              ) : (
                <a href="/admin" className="flex min-h-[40px] items-center underline">📢 ประกาศ / ตั้งค่า</a>
              )}
              <button onClick={logout} className="ml-auto min-h-[40px] underline">ออกจากโหมดผู้ดูแล</button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-3 pb-10 pt-3 sm:px-4">
        {IS_ADMIN_PAGE ? (
          !authChecked ? (
            <p className="p-6 text-center text-neutral-500">กำลังตรวจสอบ…</p>
          ) : admin ? (
            <AdminPanel admin={admin} onPublicChange={refresh} />
          ) : (
            <AdminLogin onLogin={setAdmin} />
          )
        ) : (
        <>
        <div className="mb-3 space-y-2 empty:hidden">
          <Announcements items={announcements} />
          <WeatherAlerts weather={weather} onOpenMap={() => setSheet({ type: "weather" })} />
        </div>

        {reminder && (
          <div role="status" className="anim-pop mb-3 rounded-xl border-2 border-black bg-yellow-100 p-3">
            <p className="font-bold">
              🙋 คุณรับช่วย “{categoryOf(reminder)[1]}”{reminder.place && ` (${reminder.place})`} ไว้ {Math.floor((Date.now() - load("myHelping", {})[reminder.id]) / 3.6e6)} ชม.แล้ว — เสร็จหรือยัง?
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => finishHelping(reminder)} className="min-h-[48px] rounded-lg bg-black font-semibold text-white">
                ✅ ช่วยเสร็จแล้ว
              </button>
              <button onClick={() => snoozeHelping(reminder)} className="min-h-[48px] rounded-lg border-2 border-black bg-white font-semibold">
                ยังไม่เสร็จ
              </button>
            </div>
          </div>
        )}

        {/* 1 Oct: the volunteer teams reach people on the street now, so the page opens on the map (water
            level, canals, pumps, truck drop points) with the fresh urgent requests right under it */}
        {/* Phone: tabs. Desktop: map and list side by side. */}
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1 lg:hidden" role="tablist">
          {[["map", "🗺️ แผนที่"], ["list", `🆘 คำขอ / รายการ${counts.need ? ` (${counts.need})` : ""}`]].map(([key, text]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-[44px] rounded-lg font-semibold ${tab === key ? "bg-white shadow" : "text-neutral-600"}`}>
              {text}
            </button>
          ))}
        </div>

        <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-4">
          <section className={`${tab === "map" ? "block" : "hidden"} lg:block`}>
            <div className="relative h-[65vh] overflow-hidden rounded-xl border border-neutral-300 bg-white lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
              <MapView
                posts={visible}
                water={water}
                trips={trips}
                onSelect={openDetail}
                focus={focus}
                filter={filter}
                onReportWater={() => setSheet({ type: "water" })}
                drops={drops}
                canal={canal}
                onReportCanal={() => setSheet({ type: "canal" })}
                onPump={(pump) => setSheet({ type: "pump", pump })}
                onPumps={() => setSheet({ type: "pumps" })}
              />
              <a href="/zones" className="absolute right-2 top-16 z-[500] rounded-full border-2 border-black bg-white px-3 py-2 text-xs font-bold shadow">
                🗺️ โซน · 🚚 จุดลงของ
              </a>
            </div>
            <UrgentNow posts={posts} onOpen={openDetail} />
            <Legend />
          </section>

          <section className={`${tab === "list" ? "block" : "hidden"} lg:block`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {[["all", "ทั้งหมด"], ["need", "🆘 ขอช่วย"], ["offer", "🤝 ช่วยได้"], ["paid", "💰 มีค่าจ้าง"], ["info", "📍 ข้อมูล"]].map(([key, text]) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  aria-pressed={filter === key}
                  className={`min-h-[44px] rounded-full px-4 text-sm font-medium ${filter === key ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 ring-1 ring-neutral-300"}`}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="h-5 w-5" />
                แสดงรายการที่เสร็จแล้ว
              </label>
              <button onClick={copySummary} className="ml-auto min-h-[44px] rounded-lg bg-black px-3 text-sm font-semibold text-white active:bg-neutral-800">
                📋 คัดลอกสรุปไป LINE
              </button>
            </div>

            <ul className="space-y-2">
              {visible.map((p, i) => (
                <li key={p.id} className="anim-row" style={{ "--i": Math.min(i, 10) }}>
                  <PostSummary post={p} onOpen={openDetail} fresh={freshIds.has(p.id)} />
                </li>
              ))}
              {visible.length === 0 && oldInfo.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-neutral-500">ยังไม่มีรายการ</li>}
            </ul>
            {oldInfo.length > 0 && (
              <div className="mt-2">
                <button onClick={() => setShowOldInfo((v) => !v)} className="min-h-[44px] w-full rounded-xl border border-neutral-300 bg-white text-sm font-semibold text-neutral-600">
                  {showOldInfo ? "ซ่อน" : "แสดง"}ข้อมูลเก่ากว่า 12 ชม. ({oldInfo.length}) {showOldInfo ? "▴" : "▾"}
                </button>
                {showOldInfo && (
                  <ul className="mt-2 space-y-2 opacity-80">
                    {oldInfo.map((p) => (
                      <li key={p.id}>
                        <PostSummary post={p} onOpen={openDetail} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {water.length > 0 && (
              <div className="mt-4 rounded-xl bg-white p-3">
                <h2 className="mb-2 font-semibold">💧 รายงานระดับน้ำล่าสุด</h2>
                <ul className="space-y-1 text-sm">
                  {water.slice(0, 8).map((w) => {
                    const lv = waterOf(w.level);
                    return (
                      <li key={w.id} className="flex items-center gap-2">
                        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: lv.color }} />
                        <b>{lv.label}</b>
                        {w.trend && <span title={WATER_TREND[w.trend][1]}>{WATER_TREND[w.trend][0]}</span>}
                        <span className="min-w-0 truncate text-neutral-600">
                          {w.cm != null && `${w.cm} ซม. · `}
                          {w.where && `${WATER_WHERE[w.where][1]} · `}
                          {timeAgo(w.created_at)}
                          {w.note && ` · ${w.note}`}
                        </span>
                        {w.media?.[0] && (
                          <a href={mediaUrl(w.media[0].id)} target="_blank" rel="noreferrer" aria-label="ดูรูประดับน้ำ" className="ml-auto flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center">
                            <img src={mediaUrl(w.media[0].id, "thumb")} alt="" loading="lazy" className="h-9 w-9 rounded object-cover" />
                          </a>
                        )}
                        <button onClick={() => showOnMap(w)} className={`${w.media?.[0] ? "" : "ml-auto "}min-h-[44px] min-w-[44px] shrink-0 px-2 text-black underline`}>
                          ดู
                        </button>
                        {admin && (
                          <button onClick={() => deleteWater(w)} className="min-h-[44px] shrink-0 px-2 text-red-700 underline">
                            ลบ
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>


        <div ref={actionsRef} className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <ActionButton color="bg-black text-white active:bg-neutral-800" onClick={() => setSheet({ type: "form", kind: "need" })}>
            🆘 ขอความช่วยเหลือ
          </ActionButton>
          <ActionButton color="border-2 border-black bg-white text-black active:bg-neutral-100" onClick={() => setSheet({ type: "form", kind: "offer" })}>
            🤝 ฉันช่วยได้
          </ActionButton>
          <ActionButton color="border-2 border-black bg-white text-black active:bg-neutral-100" onClick={() => setSheet({ type: "water" })}>
            💧 แจ้งระดับน้ำ
          </ActionButton>
          <ActionButton color="border-2 border-black bg-white text-black active:bg-neutral-100" onClick={() => setSheet({ type: "form", kind: "info" })}>
            📍 แจ้งข้อมูล / ถนน
          </ActionButton>
        </div>

        {/* zones A–I + truck drop points: for donors with trucks and for relief teams */}
        <a
          href="/zones"
          className="mt-2 flex min-h-[52px] items-center justify-center gap-2 rounded-xl border-4 border-yellow-400 bg-yellow-50 px-3 text-center font-bold text-black"
        >
          <span className="text-xl">🗺️</span>
          <span>
            แผนที่โซน A–I · 🚚 จุดลงของสำหรับรถใหญ่
            <span className="block text-xs font-normal text-neutral-600">ทีมช่วยเหลือเลือกโซน · คนนำของมาบริจาคดูจุดจอดริมถนนหลัก</span>
          </span>
        </a>
        {/* what the volunteer teams are doing, and how to join them (read only, nothing personal) */}
        <a href="/teamwork" className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-sky-700 px-3 text-center font-bold text-white">
          <span className="text-xl">💪</span>
          <span>
            ทีมอาสาหมู่บ้านทำอะไรอยู่ · อยากช่วย?
            <span className="block text-xs font-normal opacity-90">ส่งของถึงบ้านไปแล้วกี่หลัง · ทีมขาดอะไร · มาช่วยได้อย่างไร</span>
          </span>
        </a>
        {/* volunteer coordination: who is at which drop point, what each needs, hazards, boats */}
        <a href="/ops" className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-green-600 bg-green-50 px-3 text-center font-bold text-black">
          <span className="text-xl">🤝</span>
          <span>
            ห้องประสานงานอาสา
            <span className="block text-xs font-normal text-neutral-600">ใครอยู่จุดไหน · จุดไหนขาดอะไร · ⚠️ จุดอันตราย · 🚤 เรือ</span>
          </span>
        </a>

        {trips.length > 0 && (
          <div className="mt-3">
            <TripsStrip trips={trips} onFocus={showOnMap} />
          </div>
        )}

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat value={counts.need} label="คำขอค้างอยู่" sub={counts.urgent ? `ด่วน ${counts.urgent}` : ""} color="text-black" />
          <Stat value={counts.offer} label="ผู้พร้อมช่วย" color="text-black" />
          <Stat
            value={waterStat ? waterOf(waterStat.report.level).label : "–"}
            label={waterStat ? waterStat.label : "ระดับน้ำ"}
            sub={waterStat ? waterStat.sub : "ยังไม่มีรายงาน"}
            color="text-black"
            dot={waterStat ? waterOf(waterStat.report.level).color : null}
            onClick={waterStat ? () => showOnMap(waterStat.report) : null}
            actionLabel="ดูจุดนี้บนแผนที่"
          />
        </div>

        {/* Lower priority: weather detail (current weather is already in the header bar) and paid services */}
        <div className="mt-6">
          <WeatherCard weather={weather} onOpenMap={() => setSheet({ type: "weather" })} />
        </div>
        <div className="mt-3">
          <ServiceStrip
            services={services}
            paidNeeds={paidNeedCount}
            onOpen={(opts) => setSheet({ type: "board", ...opts })}
            onAdd={() => setSheet({ type: "serviceForm" })}
          />
        </div>

        </>
        )}

        <footer className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-neutral-500">
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Sahakorn Serithai 57" className="h-32 w-auto" />
          แผนที่ © ผู้ร่วมพัฒนา OpenStreetMap · ข้อมูลในหน้านี้มาจากชาวบ้านช่วยกันแจ้ง กรณีอันตรายถึงชีวิตโทร 1669 / 199 ทันที
          <span className="flex gap-4">
            <a href="/staff" className="mt-1 inline-flex min-h-[44px] items-center text-neutral-400 underline">
              สำหรับเจ้าหน้าที่
            </a>
            {!admin && (
              <a href="/admin" className="mt-1 inline-flex min-h-[44px] items-center text-neutral-400 underline">
                สำหรับผู้ดูแล
              </a>
            )}
          </span>
        </footer>
      </main>

      {sheet?.type === "form" && (
        <Sheet title={`${KINDS[sheet.kind].emoji} ${KINDS[sheet.kind].label}`} onClose={() => setSheet(null)}>
          {sheet.reason && <p className="mb-3 rounded-xl border-2 border-red-600 bg-red-50 p-3 text-sm font-semibold">{sheet.reason}</p>}
          <PostForm
            kind={sheet.kind}
            posts={posts}
            prefill={sheet.prefill}
            onOpenExisting={openDetail}
            onDone={(p, extra = {}) => {
              upsert(p);
              if (extra.suggestBoard) {
                setSheet({ type: "serviceForm", prefill: { detail: p.detail, price: extra.price, category: "other" } });
                setToast("ส่งแล้ว · ลงชื่อในบอร์ดติดต่อด้วย จะมีคนเห็นง่ายขึ้น");
                return;
              }
              setSheet({ type: "detail", id: p.id });
              setToast("ส่งแล้ว ทุกคนเห็นรายการนี้แล้ว");
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "canal" && (
        <Sheet title="🌊 แจ้งระดับน้ำในคลอง" onClose={() => setSheet(null)}>
          <CanalForm
            onDone={(r) => {
              setCanal((c) => ({ ...(c || { pumps: [] }), reports: [r, ...((c && c.reports) || [])] }));
              setSheet(null);
              setToast("ขอบคุณที่แจ้งระดับคลอง");
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "pumps" && (
        <Sheet title="⚙️ เครื่องสูบน้ำ" onClose={() => setSheet(null)}>
          <PumpList pumps={(canal?.pumps || []).filter((x) => x.status !== "removed")} onPump={(pump) => setSheet({ type: "pump", pump })} />
        </Sheet>
      )}
      {sheet?.type === "pump" && (
        <Sheet title={sheet.pump ? "⚙️ สถานะเครื่องสูบ" : "⚙️ เพิ่มเครื่องสูบ"} onClose={() => setSheet(null)}>
          <PumpForm
            pump={sheet.pump}
            onDone={() => {
              setSheet(null);
              setToast("บันทึกเครื่องสูบแล้ว");
              refresh();
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "water" && (
        <Sheet title="💧 แจ้งระดับน้ำ" onClose={() => setSheet(null)}>
          <WaterForm
            onDone={(w, extra = {}) => {
              setWater((prev) => [w, ...prev]);
              if (extra.needHint) {
                // A request hidden in a water note never reaches helpers: offer to file it properly.
                setSheet({
                  type: "form",
                  kind: "need",
                  prefill: { detail: extra.needHint, loc: { lat: w.lat, lng: w.lng } },
                  reason: "บันทึกระดับน้ำแล้ว · หมายเหตุของคุณดูเหมือนต้องการความช่วยเหลือ ส่งเป็นคำขอด้านล่าง จะมีคนเห็นและติดต่อกลับ",
                });
                return;
              }
              setSheet(null);
              setToast("ขอบคุณที่แจ้งระดับน้ำ");
            }}
          />
        </Sheet>
      )}
      {selected && (
        <Sheet title="รายละเอียด" onClose={() => setSheet(null)}>
          <PostDetail
            post={selected}
            admin={admin}
            onChanged={upsert}
            onShowOnMap={showOnMap}
            onDeleted={(id) => {
              setPosts((prev) => prev.filter((p) => p.id !== id));
              setSheet(null);
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "board" && (
        <Sheet title="📇 บอร์ดติดต่อ: ช่าง · รถ · รับจ้าง" onClose={() => setSheet(null)}>
          <ServiceBoard
            key={`${sheet.tab}-${sheet.category}`}
            services={services}
            setServices={setServices}
            posts={posts}
            admin={admin}
            initial={sheet}
            onAdd={() => setSheet({ type: "serviceForm" })}
            onOpenPost={openDetail}
          />
        </Sheet>
      )}
      {sheet?.type === "serviceForm" && (
        <Sheet title="📇 ลงชื่อรับงาน / ให้บริการ" onClose={() => setSheet(null)}>
          <ServiceForm
            prefill={sheet.prefill}
            onDone={(s) => {
              setServices((prev) => [s, ...prev]);
              setSheet({ type: "board", tab: "providers", category: s.category });
              setToast("ลงชื่อแล้ว เพื่อนบ้านโทรหาคุณได้ทันที");
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "weather" && (
        <Sheet title="🌦️ สภาพอากาศ (Windy)" onClose={() => setSheet(null)}>
          <WindyMap />
        </Sheet>
      )}
      {sheet?.type === "hotlines" && (
        <Sheet title="☎️ เบอร์ฉุกเฉิน" onClose={() => setSheet(null)}>
          <div className="space-y-4">
            {HOTLINE_GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-2 font-bold">{group.title}</h3>
                <ul className="space-y-2">
                  {group.items.map(([num, text]) => (
                    <li key={num}>
                      <a
                        href={`tel:${num.replace(/\D/g, "")}`}
                        className="flex min-h-[56px] flex-wrap items-center gap-x-3 rounded-xl border border-neutral-200 px-4 py-2 active:bg-neutral-50"
                      >
                        <span className="text-xl font-bold tabular-nums text-red-700 sm:text-2xl">📞 {num}</span>
                        <span>{text}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="mt-4 rounded-xl border-2 border-black p-3 text-sm">
            <b>ความปลอดภัย:</b> ตัดเบรกเกอร์ก่อนน้ำเข้าบ้าน · อย่าแตะปลั๊ก/สายไฟขณะตัวเปียก · ระวังสัตว์มีพิษ · อย่าเดินลุยน้ำที่มองไม่เห็นพื้น (ฝาท่อเปิด)
          </div>
        </Sheet>
      )}

      {!IS_ADMIN_PAGE && !sheet && !showGuide && showFab && (
        <button
          onClick={() => setSheet({ type: "form", kind: "need" })}
          className="anim-pop fixed bottom-4 right-4 z-[950] flex min-h-[56px] items-center gap-2 rounded-full bg-black px-5 text-lg font-bold text-white shadow-lg ring-4 ring-white active:scale-95 lg:hidden"
        >
          🆘 ขอความช่วยเหลือ
        </button>
      )}

      {showGuide && <Guide onClose={closeGuide} />}

      {toast && (
        <div key={toast} role="status" className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// Only what needs someone NOW: evacuation / medical, or requests marked urgent, asked in the last 12 h.
const URGENT_FRESH_H = 12;
const lastAskAt = (p) =>
  Math.max(new Date(p.created_at).getTime(), ...(p.history || []).filter((h) => /^(จาก LINE|เปิดใหม่|ทีมแจก)/.test(h.note || "")).map((h) => new Date(h.at).getTime()));
function UrgentNow({ posts, onOpen }) {
  const t = Date.now();
  const list = posts
    .filter((p) => p.kind === "need" && p.status !== "done" && (p.urgent || ["evacuate", "medical"].includes(p.category)) && t - lastAskAt(p) <= URGENT_FRESH_H * 3.6e6)
    .sort((a, b) => ["evacuate", "medical"].includes(b.category) - ["evacuate", "medical"].includes(a.category) || lastAskAt(b) - lastAskAt(a));
  if (!list.length)
    return <p className="mt-2 rounded-xl bg-green-50 px-3 py-2 text-sm font-semibold text-green-800">✅ ไม่มีเคสด่วนใหม่ใน {URGENT_FRESH_H} ชม. · ด่วนถึงชีวิตโทร 1669 / 199</p>;
  return (
    <section className="mt-2 rounded-2xl border-4 border-red-600 bg-red-50 p-3">
      <p className="text-lg font-black text-red-700">🚨 เคสด่วนใหม่ ({URGENT_FRESH_H} ชม.) · {list.length}</p>
      <ul className="mt-1 space-y-1">
        {list.slice(0, 6).map((p) => {
          const [emoji, label] = categoryOf(p);
          return (
            <li key={p.id}>
              <button onClick={() => onOpen(p)} className="flex min-h-[48px] w-full items-center gap-2 rounded-lg bg-white px-2 text-left shadow-sm">
                <span className="text-xl">{emoji}</span>
                <span className="min-w-0 flex-1">
                  <b>{p.place || p.house || label}</b>
                  <span className="block truncate text-sm text-neutral-700">{p.detail}</span>
                </span>
                <span className="shrink-0 text-xs text-neutral-500">{timeAgo(new Date(lastAskAt(p)).toISOString())}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {list.length > 6 && <p className="mt-1 text-sm text-red-800">+ อีก {list.length - 6} เคส ดูในรายการด้านล่าง</p>}
    </section>
  );
}

function Logo() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
      <img src={`${process.env.PUBLIC_URL}/logo-mark.png`} alt="Sahakorn Serithai 57" className="h-full w-full object-contain" />
    </span>
  );
}

function ActionButton({ color, onClick, children }) {
  return (
    <button onClick={onClick} className={`min-h-[56px] rounded-xl px-2 text-base font-bold leading-tight shadow-sm transition-transform duration-100 active:scale-95 sm:text-lg ${color}`}>
      {children}
    </button>
  );
}

function Stat({ value, label, sub, color, dot, onClick, actionLabel }) {
  const shown = useCountUp(value);
  const body = (
    <>
      <div className={`flex items-center justify-center gap-1.5 text-xl font-bold sm:text-2xl ${color}`}>
        {dot && <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />}
        <span key={typeof value === "string" ? value : "n"} className={typeof value === "string" ? "anim-pop" : ""}>
          {shown}
        </span>
      </div>
      <div className="text-xs text-neutral-600 sm:text-sm">{label}</div>
      {sub && <div className="text-xs font-semibold text-red-600">{sub}</div>}
    </>
  );
  return onClick ? (
    <button onClick={onClick} aria-label={`${label}: ${value} — ${actionLabel}`} className="rounded-xl bg-white p-2 active:bg-neutral-100">
      {body}
    </button>
  ) : (
    <div className="rounded-xl bg-white p-2">{body}</div>
  );
}

function Legend() {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
      {Object.values(KINDS).map((k) => (
        <span key={k.label} className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full border border-black" style={{ background: k.pin }} /> {k.short}
        </span>
      ))}
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded-full border-2 border-dashed border-black bg-white" /> มีคนไปช่วยแล้ว
      </span>
      <span>· 💧</span>
      {WATER_LEVELS.map((w) => (
        <span key={w.level} className="flex items-center gap-1">
          <span className="h-3 w-3 rounded-full" style={{ background: w.color }} /> {w.label}
        </span>
      ))}
      <span>· เส้นประ = ขอบเขตหมู่บ้าน</span>
      <span>· ⚫ตัวเลข = กลุ่มคำขอ แตะเพื่อซูม (🔴 = ยังไม่มีคนช่วย) · คำขอด่วนแสดงแยกเสมอ · ดูระดับน้ำ: กด “💧 ระดับน้ำ” บนแผนที่ · ปุ่มมุมซ้ายล่าง = เปิด/ปิด สีน้ำ ช่วยได้ ข้อมูล</span>
    </div>
  );
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
