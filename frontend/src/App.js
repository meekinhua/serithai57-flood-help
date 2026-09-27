import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, load, save, viewerId } from "./api";
import { ANNOUNCEMENT_LEVELS, HOTLINE_GROUPS, KINDS, VILLAGE_NAME, WATER_LEVELS, categoryOf, osmLink, paymentBadge, timeAgo, waterOf } from "./config";
import MapView from "./components/MapView";
import Sheet from "./components/Sheet";
import { PostForm, WaterForm } from "./components/Forms";
import { PostDetail, PostSummary } from "./components/PostCard";
import Announcements from "./components/Announcements";
import AdminPanel, { AdminLogin } from "./components/AdminPanel";
import { mediaUrl } from "./media";
import Guide from "./components/Guide";
import { WeatherAlerts, WeatherCard, WindyMap } from "./components/Weather";
import { useCountUp } from "./motion";

const REFRESH_MS = 20000;
const WEATHER_REFRESH_MS = 10 * 60 * 1000; // server caches Open-Meteo for 10 min too
const WATER_STAT_HOURS = 6;
const IS_ADMIN_PAGE = window.location.pathname.replace(/\/+$/, "") === "/admin";

export default function App() {
  const [posts, setPosts] = useState([]);
  const [water, setWater] = useState([]);
  const [showDone, setShowDone] = useState(false);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState("list"); // phones: list | map
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

  useEffect(() => {
    const loadWeather = () => api("/weather").then(setWeather).catch(() => {});
    loadWeather();
    const t = setInterval(loadWeather, WEATHER_REFRESH_MS);
    return () => clearInterval(t);
  }, []);
  const [admin, setAdmin] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Admin session: secret link /admin#key=... logs in once, then the cookie carries it.
  useEffect(() => {
    const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (key) window.history.replaceState(null, "", window.location.pathname); // don't leave the key in the URL bar/history
    const check = key ? api("/auth/key", { method: "POST", body: JSON.stringify({ key }) }) : api("/auth/me");
    check
      .then(setAdmin)
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
      const [p, w, a] = await Promise.all([api(`/posts?include_done=${showDone}`), api("/water"), api("/announcements")]);
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

  const visible = useMemo(
    () => posts.filter((p) => filter === "all" || (filter === "paid" ? p.payment === "paid" : p.kind === filter)),
    [posts, filter]
  );
  const counts = useMemo(() => {
    const c = { need: 0, urgent: 0, offer: 0, info: 0 };
    for (const p of posts) {
      if (p.status === "done") continue;
      c[p.kind]++;
      if (p.urgent && p.status === "open") c.urgent++;
    }
    return c;
  }, [posts]);

  const selected = sheet?.type === "detail" ? posts.find((p) => p.id === sheet.id) : null;
  const openDetail = useCallback((id) => setSheet({ type: "detail", id }), []);

  function upsert(post) {
    setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
  }

  function showOnMap(p) {
    setSheet(null);
    setTab("map");
    setFocus({ lat: p.lat, lng: p.lng, t: Date.now() });
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
        `   ${[p.place, p.people != null && `${p.people} คน`, `${p.name} ${p.phone}`.trim()].filter(Boolean).join(" · ")}`,
        `   ${osmLink(p.lat, p.lng)}`
      );
    });
    if (!open.length) lines.push("ยังไม่มีคำขอที่ค้างอยู่");
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

  // Village-wide picture: the deepest report in the last 6 h (newest wins a tie).
  // Falls back to the latest report when nothing is that recent.
  const waterStat = useMemo(() => {
    const since = Date.now() - WATER_STAT_HOURS * 3600 * 1000;
    const recent = water.filter((w) => new Date(w.created_at).getTime() >= since);
    if (recent.length) {
      const top = recent.reduce((a, b) => (b.level > a.level ? b : a));
      return { report: top, label: `ระดับน้ำสูงสุด (${WATER_STAT_HOURS} ชม.)`, sub: `จาก ${recent.length} รายงาน · ${timeAgo(top.created_at)}` };
    }
    if (water.length) return { report: water[0], label: "ระดับน้ำล่าสุด", sub: `${timeAgo(water[0].created_at)} (เก่ากว่า ${WATER_STAT_HOURS} ชม.)` };
    return null;
  }, [water, updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps -- updatedAt re-evaluates the 6 h window on each poll

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

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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

        <div className="mt-3">
          <WeatherCard weather={weather} onOpenMap={() => setSheet({ type: "weather" })} />
        </div>

        {/* Phone: tabs. Desktop: map and list side by side. */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-neutral-200 p-1 lg:hidden" role="tablist">
          {[["list", "📋 รายการ"], ["map", "🗺️ แผนที่"]].map(([key, text]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`min-h-[44px] rounded-lg font-semibold ${tab === key ? "bg-white shadow" : "text-neutral-600"}`}>
              {text}
            </button>
          ))}
        </div>

        <div className="mt-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-4">
          <section className={`${tab === "map" ? "block" : "hidden"} lg:block`}>
            <div className="relative h-[65vh] overflow-hidden rounded-xl border border-neutral-300 bg-white lg:sticky lg:top-20 lg:h-[calc(100vh-7rem)]">
              <MapView posts={visible} water={water} onSelect={openDetail} focus={focus} />
            </div>
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
              {visible.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-neutral-500">ยังไม่มีรายการ</li>}
            </ul>

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
                        <span className="min-w-0 truncate text-neutral-600">
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

        </>
        )}

        <footer className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-neutral-500">
          <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Sahakorn Serithai 57" className="h-32 w-auto" />
          แผนที่ © ผู้ร่วมพัฒนา OpenStreetMap · ข้อมูลในหน้านี้มาจากชาวบ้านช่วยกันแจ้ง กรณีอันตรายถึงชีวิตโทร 1669 / 199 ทันที
          {!admin && (
            <a href="/admin" className="mt-1 inline-flex min-h-[44px] items-center text-neutral-400 underline">
              สำหรับผู้ดูแล
            </a>
          )}
        </footer>
      </main>

      {sheet?.type === "form" && (
        <Sheet title={`${KINDS[sheet.kind].emoji} ${KINDS[sheet.kind].label}`} onClose={() => setSheet(null)}>
          <PostForm
            kind={sheet.kind}
            onDone={(p) => {
              upsert(p);
              setSheet({ type: "detail", id: p.id });
              setToast("ส่งแล้ว ทุกคนเห็นรายการนี้แล้ว");
            }}
          />
        </Sheet>
      )}
      {sheet?.type === "water" && (
        <Sheet title="💧 แจ้งระดับน้ำ" onClose={() => setSheet(null)}>
          <WaterForm
            onDone={(w) => {
              setWater((prev) => [w, ...prev]);
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

      {showGuide && <Guide onClose={closeGuide} />}

      {toast && (
        <div key={toast} role="status" className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
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
