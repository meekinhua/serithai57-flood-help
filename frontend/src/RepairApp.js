import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, load, save, viewerId } from "./api";
import { HOTLINE_GROUPS, VILLAGE_NAME, timeAgo } from "./config";
import Sheet from "./components/Sheet";
import Announcements, { UrgentBar } from "./components/Announcements";
import { WeatherAlerts, WeatherChip, WindyMap } from "./components/Weather";
import { mediaUrl } from "./media";
import { flashTo } from "./notify";
import { MediaStrip } from "./components/MediaGallery";
import { ServiceBoard, ServiceForm } from "./components/ServiceBoard";
import WasteBoard from "./components/WasteBoard";
import { lookOf, ordered } from "./components/Look";
import { TextsContext } from "./components/Texts";
import MyHome, { homeBadgeOf } from "./components/MyHome";
import SurveyBoxes from "./components/SurveyBox";
import { BottomNav, CommunityFeed, CommunityIntro, IntentChoices, JoinSheetBody, NEED_CHOICES, OFFER_CHOICES, PostedSheetBody, ProsList } from "./components/Community";
import { CleanupPlan } from "./components/CleanupPage";
import Forum from "./components/Forum";
import WatchPanel, { WaterPill, WaterView, waterStatus } from "./components/WatchPanel";
import { LostBoard, LostForm, LostPreview, shareLost } from "./components/LostFound";
import { WaterForm } from "./components/Forms";
import { CanalForm, LeakForm, LeakList, LeakSheet, PumpForm, PumpList } from "./components/Canal";
import { AfterFloodGuide, HireList, IssueBoard, IssueForm, JobBoard, JobForm, LendBoard, LendForm } from "./components/RepairBoards";

// ซ่อมบ้าน mode (2 Oct 2026): the water is gone. Lend & borrow, ask for hands, tradesmen with neighbours'
// reviews, soi problems for the district, and an after-flood checklist. The flood board is at /flood (read-only).
// 2 Oct afternoon, heavy rain again: a water-watch panel sits on top (street level, canals, leaks — reporting
// stays open), rides out / errands / hiring a tradesman go on the jobs board, and lost pets & things get a board.
const REFRESH_MS = 30000;
// 3 Oct: the water is gone, people only care about getting the house back — recovery first,
// the rest (water levels, lost & found, soi issues) one tap further under "อื่นๆ".
// 6 Oct: rebuilt as the neighbours' community. People pick what they want to do (CommunityIntro), the
// feed shows everything at once; the boards stay one tap away. Waste and the checklist move under "อื่นๆ".
const MAIN_TABS = {
  lost: ["🐾", "หาย · เจอ"],
  feed: ["📰", "ล่าสุด"],
  jobs: ["🙋", "ขอแรง"],
  lend: ["🧰", "ยืม · ซื้อขาย"],
  forum: ["💬", "ถาม-ตอบ"],
};
const MORE_TABS = {
  waste: ["♻️", "ขยะ · รถเก็บ"],
  guide: ["📋", "เช็กลิสต์หลังน้ำลด"],
  issues: ["📍", "ปัญหาซอย"],
};
const TABS = { ...MAIN_TABS, ...MORE_TABS };
// which bottom-bar page a link's #hash opens (old links keep working: #water → the map, #feed → เพื่อนบ้าน)
const pageOf = (h) => (h === "pros" ? "pros" : h === "map" || h === "water" ? "map" : TABS[h] ? "community" : "home");

function PageTitle({ title, sub }) {
  return (
    <div className="mb-3 px-1">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {sub && <p className="text-[15px] text-[#45504A]">{sub}</p>}
    </div>
  );
}

export default function RepairApp() {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1);
    const saved = load("repairTab3", "feed");
    return TABS[h] ? h : TABS[saved] ? saved : "feed"; // a tab that no longer exists (e.g. "pros") falls back to the feed
  });
  const [lend, setLend] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [issues, setIssues] = useState([]);
  const [lost, setLost] = useState([]);
  const [reunited, setReunited] = useState([]);
  // the peek: a new lost pet / a pet back home slides in at the top, stays ~7 s, slides away; once per phone.
  // Nothing stays above บ้านฉัน; the 🔔 list and เพื่อนบ้าน › หาย·เจอ keep them for later.
  const [peek, setPeek] = useState(null); // {x, kind: "lost" | "home", leaving}
  const peekQ = useRef([]);
  useEffect(() => {
    const on = (e) => setToast(e.detail);
    window.addEventListener("app-toast", on);
    return () => window.removeEventListener("app-toast", on);
  }, []);
  const nextPeek = useCallback(() => {
    const n = peekQ.current.shift();
    if (n) {
      save("petSeen", { ...load("petSeen", {}), [n.key]: Date.now() });
      setPeek({ ...n, leaving: false });
    } else setPeek(null);
  }, []);
  const closePeek = useCallback(() => {
    setPeek((p) => (p ? { ...p, leaving: true } : p));
    setTimeout(nextPeek, 320); // the slide-out, then the next one
  }, [nextPeek]);
  useEffect(() => {
    if (!peek || peek.leaving) return;
    const t = setTimeout(closePeek, 7000);
    return () => clearTimeout(t);
  }, [peek, closePeek]);
  useEffect(() => {
    // what this phone has not been told yet: lost pets of the last 2 days, pets home in the last day (not my own posts)
    const seenP = load("petSeen", {});
    const mine = load("lostKeys", {});
    const pet = (x) => ["dog", "cat", "pet"].includes(x.category);
    const age = (t) => Date.now() - new Date(t).getTime();
    const fresh = [
      ...lost.filter((x) => pet(x) && x.kind === "lost" && age(x.created_at) < 2 * 864e5 && !mine[x.id]).map((x) => ({ key: x.id, x, kind: "lost" })),
      ...reunited.filter((x) => pet(x) && age(x.updated_at || x.created_at) < 864e5).map((x) => ({ key: `r${x.id}`, x, kind: "home" })),
    ].filter((n) => !seenP[n.key] && !peekQ.current.some((q) => q.key === n.key) && peek?.key !== n.key);
    if (!fresh.length) return;
    peekQ.current.push(...fresh.slice(0, 3)); // never a long parade
    if (!peek) setTimeout(nextPeek, 1200); // after the page has settled
  }, [lost, reunited]); // eslint-disable-line react-hooks/exhaustive-deps
  const [topics, setTopics] = useState([]);
  const [prosGroup, setProsGroup] = useState("");
  // 7 Oct: four pages under a bottom bar — บ้านฉัน is the main one; the device's back button walks back through them
  const [page, setPage] = useState(() => pageOf(window.location.hash.slice(1)));
  const [prosFocus, setProsFocus] = useState(false);
  const goPage = (p, hash) => {
    const h = hash ?? (p === "home" ? "" : p === "map" ? "map" : p === "pros" ? "pros" : null);
    setPage(p);
    if (h != null && window.location.hash.slice(1) !== h) window.history.pushState({ page: p }, "", h ? `#${h}` : window.location.pathname + window.location.search);
    window.scrollTo({ top: 0 });
  };
  const openPros = (group = "", focus = false) => {
    setProsGroup(group);
    setProsFocus(focus);
    goPage("pros");
  };
  useEffect(() => {
    const onPop = () => {
      const h = window.location.hash.slice(1);
      setPage(pageOf(h));
      window.scrollTo({ top: 0 });
      if (TABS[h]) setTab(h);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [forumGo, setForumGo] = useState({ n: 0 }); // feed / "ask" door → open a topic or the form
  const [water, setWater] = useState([]);
  const [canal, setCanal] = useState(null);
  // highlight boxes (water watch, volunteer hand-out point): admins switch them on /admin, no redeploy
  const [home, setHome] = useState(() => load("homeBlocks", { watch_on: true, watch_title: "", hub: { on: false } }));
  const [services, setServices] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [updatedTick, setUpdatedTick] = useState(0); // +1 after every refresh
  const [weather, setWeather] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(true);
  const [viewers, setViewers] = useState(null);
  const [trips, setTrips] = useState([]); // helpers' boats / trucks / staff on duty, live
  const [focus, setFocus] = useState(null);

  const pick = (t) => {
    setTab(t);
    save("repairTab3", t);
    window.history.replaceState({ page: "community" }, "", `#${t}`);
  };
  const navRef = useRef(null);
  const showTab = (t) => {
    if (t === "pros") return openPros("");
    setTab(t);
    save("repairTab3", t);
    goPage("community", t);
  };
  const go = (g) => {
    if (g.sheet) return setSheet(g.sheet);
    setSheet(null);
    showTab(g.tab);
  };
  const askForum = (openId = null) => {
    setForumGo((f) => ({ n: f.n + 1, openId, compose: !openId }));
    showTab("forum");
  };
  const goItem = (t, id) => {
    showTab(t);
    if (!id) return;
    let n = 0;
    const find = () => {
      const el = document.querySelector(`[data-item="${id}"]`);
      if (el) flashTo(el);
      else if (n++ < 12) setTimeout(find, 150); // the page is still drawing
    };
    setTimeout(find, 200);
  };
  const posted = (tab, text) => {
    showTab(tab);
    setSheet({ type: "posted", text });
  };
  const openWater = () => goPage("map");

  useEffect(() => {
    document.title = "บ้านฉัน · เสรีไทย 57";
  }, []);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "visible")
      api("/presence", { method: "POST", body: JSON.stringify({ id: viewerId() }) })
        .then((r) => setViewers(r.online))
        .catch(() => {});
    try {
      const [l, j, i, s, a, lf, w, cn, hm, ft] = await Promise.all([
        api("/lend"),
        api("/jobs"),
        api("/issues"),
        api("/services"),
        api("/announcements"),
        api("/lost?include_closed=true"),
        api("/water").catch(() => []),
        api("/canal").catch(() => null),
        api("/home").catch(() => null),
        api("/forum").catch(() => null),
      ]);
      if (ft) setTopics(ft);
      setLost(lf.filter((x) => x.status !== "reunited"));
      setReunited(lf.filter((x) => x.status === "reunited" && Date.now() - new Date(x.updated_at || x.created_at).getTime() < 2 * 864e5));
      if (hm) {
        setHome(hm);
        save("homeBlocks", hm);
      }
      setWater(w);
      if (cn) setCanal(cn);
      setLend(l);
      setJobs(j);
      setIssues(i);
      setServices(s);
      setAnnouncements(a);
      setOnline(true);
      setUpdatedTick((n) => n + 1);
    } catch {
      setOnline(false);
    }
  }, []);

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

  // vehicles move: poll their positions every 10 s while the page is visible
  useEffect(() => {
    const loadTrips = () =>
      document.visibilityState === "visible" &&
      api("/trips")
        .then(setTrips)
        .catch(() => {});
    loadTrips();
    const t = setInterval(loadTrips, 10000);
    document.addEventListener("visibilitychange", loadTrips);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", loadTrips);
    };
  }, []);

  // leaving the page: drop off the "people viewing" counter right away
  useEffect(() => {
    const leave = () => navigator.sendBeacon?.(`${API}/presence/leave`, new Blob([JSON.stringify({ id: viewerId() })], { type: "application/json" }));
    window.addEventListener("pagehide", leave);
    return () => window.removeEventListener("pagehide", leave);
  }, []);

  useEffect(() => {
    api("/weather")
      .then(setWeather)
      .catch(() => {});
    api("/auth/me")
      .then((u) => u.role !== "staff" && setAdmin(u))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // the yellow box's place, also pinned on the map (same admin setting, so it moves with it)
  const hubPins = useMemo(() => (home.hub?.on && home.hub.lat != null ? [{ ...home.hub, tag: "ศูนย์อาสา", place: (home.hub.title || "").split(":").pop().trim().slice(0, 24) }] : []), [home]);

  const eventsOn = useMemo(() => (home.events || []).filter((e) => e.on), [home]);

  const counts = {
    lend: lend.filter((x) => x.status !== "closed").length,
    jobs: jobs.filter((x) => x.kind === "need" && x.status === "open" && x.type !== "hire").length,
    pros: services.length,
    lost: lost.length,
    issues: issues.length,
  };

  // first visit: nothing is "new" yet
  const [seenAt, setSeenAt] = useState(() => load("communitySeen", null) ?? Date.now());
  const [prosSeen, setProsSeen] = useState(() => load("prosSeen", null) ?? Date.now());
  const [homeBadge, setHomeBadge] = useState(() => {
    const b = load("homeBadge", null);
    return typeof b === "string" ? { level: b, reasons: [], sig: b } : b; // older phones kept a plain word
  });
  // the reader's "ล้างแจ้งเตือน": {tab: the signature cleared}; a badge with a new signature lights up again
  const [ack, setAck] = useState(() => load("badgeAck", {}));
  const [notifyOpen, setNotifyOpen] = useState(false);
  const onHomeBadge = useCallback((b) => {
    setHomeBadge(b);
    save("homeBadge", b);
  }, []);
  // away from บ้านฉัน its tab still says when something there needs the reader (checked with the 30 s refresh)
  useEffect(() => {
    const h = load("myHouse", "");
    if (page === "home" || !h || updatedTick % 4) return; // every ~2 minutes is plenty for a badge
    api(`/myhome?house=${encodeURIComponent(h)}`)
      .then((d) => onHomeBadge(homeBadgeOf(d)))
      .catch(() => {});
  }, [page, updatedTick, onHomeBadge]);
  const newestPro = Math.max(0, ...services.map((x) => new Date(x.created_at || 0).getTime() || 0));
  useEffect(() => {
    if (page === "pros" && newestPro > prosSeen) {
      setProsSeen(newestPro);
      save("prosSeen", newestPro);
    }
  }, [page, newestPro, prosSeen]);
  const newest = Math.max(0, ...[...lend, ...jobs, ...topics].map((x) => new Date(x.updated_at || x.created_at || 0).getTime() || 0));
  useEffect(() => {
    if (page === "community" && newest > seenAt) {
      setSeenAt(newest);
      save("communitySeen", newest);
    }
  }, [page, newest, seenAt]);

  // neighbours still waiting for hands (ขอแรง, nobody has come yet)
  const needs = jobs.filter((j) => j.kind === "need" && j.status === "open" && j.type !== "hire");
  const hires = jobs.filter((j) => j.type === "hire" && j.status !== "done");
  const lostOpen = lost.filter((x) => x.status !== "reunited");
  const lostPets = lostOpen.filter((x) => x.kind === "lost" && ["dog", "cat", "pet"].includes(x.category) && Date.now() - new Date(x.created_at).getTime() < 7 * 864e5);
  const homePets = reunited.filter((x) => ["dog", "cat", "pet"].includes(x.category) && Date.now() - new Date(x.updated_at || x.created_at).getTime() < 864e5);
  const lostHot = lostOpen.filter((x) => x.kind === "lost" && Date.now() - new Date(x.created_at).getTime() < 7 * 864e5);
  const needSig = needs.map((j) => j.id.slice(0, 6)).join(",");

  // what each page tab has to say (the bell lists it; ล้าง mutes it until it changes)
  const ws = waterStatus(water, canal);
  const notes = {
    home: homeBadge,
    pros: newestPro > prosSeen ? { level: "general", reasons: ["🔧 มีร้าน / ช่างใหม่ในหมู่บ้าน"], sig: `p${newestPro}` } : null,
    community:
      needs.length || lostPets.length || homePets.length || newest > seenAt
        ? {
            level: "general",
            reasons: [
              ...homePets.slice(0, 2).map((x) => ({ text: `🎉 เจอแล้ว: ${x.title}`, go: ["lost", x.id] })),
              ...lostPets.slice(0, 4).map((x) => ({ text: `🐾 ยังตามหา: ${x.title}${x.soi ? ` (ซ.${x.soi})` : ""}`, go: ["lost", x.id] })),
              ...needs.slice(0, 4).map((j) => ({ text: `🙋 ${j.name} ขอแรง: ${j.detail.length > 70 ? `${j.detail.slice(0, 70)}…` : j.detail}${j.soi ? ` (ซ.${j.soi})` : ""}`, go: ["jobs", j.id] })),
              ...(newest > seenAt && !needs.length ? ["👥 มีโพสต์ใหม่จากเพื่อนบ้าน"] : []),
            ],
            sig:
              needs.length || lostPets.length || homePets.length ? `n${needSig}|p${lostPets.map((x) => x.id.slice(0, 6)).join(",")}|h${homePets.map((x) => x.id.slice(0, 6)).join(",")}` : `c${newest}`,
          }
        : null,
    map: ws.alarm ? { level: "important", reasons: [`💧 ระดับน้ำ: ${ws.text}${ws.sub ? ` · ${ws.sub}` : ""}`], sig: `m${ws.text}` } : null,
  };
  const live = Object.entries(notes).filter(([k, b]) => b && ack[k] !== b.sig);
  // having looked at the community page counts as seen: the dot stays faint until every ask is taken
  const communitySig = notes.community?.sig;
  useEffect(() => {
    if (page !== "community" || !communitySig || ack.community === communitySig) return;
    const next = { ...ack, community: communitySig };
    setAck(next);
    save("badgeAck", next);
  }, [page, communitySig, ack]);
  const clearNotes = (keys) => {
    const next = { ...ack };
    for (const k of keys) if (notes[k]) next[k] = notes[k].sig;
    setAck(next);
    save("badgeAck", next);
  };

  async function share() {
    const url = window.location.origin;
    const text = `🏠 บ้านฉัน เสรีไทย 57 · ใส่บ้านเลขที่ครั้งเดียว รู้วันรถขยะ ไฟดับ น้ำหน้าบ้าน ช่างที่เพื่อนบ้านแนะนำ`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "บ้านฉัน · เสรีไทย 57", text, url });
        return;
      } catch {}
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setToast("คัดลอกลิงก์แล้ว");
    } catch {}
  }

  // 7 Oct: the home page's blocks, ordered and coloured by home.layout (tools/site.py layout), no redeploy
  const blocks = {
    events: (
      <>
        {eventsOn.map((e, i) => (
          <EventBox
            key={i}
            ev={e}
            onMap={() => {
              if (e.tab && TABS[e.tab]) return showTab(e.tab);
              const [lat, lng] = eventSpot(e);
              setFocus({ lat, lng, t: Date.now() });
              openWater();
            }}
          />
        ))}
      </>
    ),
    myhome: (
      <MyHome
        water={water}
        services={services}
        look={home.layout?.myhome ? lookOf(home.layout, "myhome") : null}
        onIssue={() => setSheet({ type: "issueForm" })}
        onIssues={() => showTab("issues")}
        onElectricians={() => openPros("electric")}
        onPros={(g) => openPros(g)}
        onBadge={onHomeBadge}
        needs={needs}
        lost={lostOpen}
        onNeeds={(id) => goItem("jobs", id)}
        onAskHelp={() => setSheet({ type: "jobForm", kind: "need" })}
        onLost={(id) => goItem("lost", id)}
        onLostPosted={(x) => setLost((p) => [x, ...p.filter((y) => y.id !== x.id)])}
      />
    ),
    announce: (
      <>
        <div className="mb-3 space-y-2 empty:hidden">
          <Announcements items={announcements} />
          <WeatherAlerts weather={weather} onOpenMap={() => setSheet({ type: "weather" })} />
        </div>
      </>
    ),
    watch: (
      <>
        {home.watch_on && (
          <div className="mb-3">
            <WatchPanel
              title={home.watch_title}
              water={water}
              canal={canal}
              onWater={() => setSheet({ type: "water" })}
              onCanal={() => setSheet({ type: "canal" })}
              onLeak={() => setSheet({ type: "leakForm" })}
              onLeaks={() => setSheet({ type: "leaks" })}
              onMap={openWater}
            />
          </div>
        )}
      </>
    ),
    fund: (
      <>
        {home.fund_on && (
          <a
            href="/fund"
            style={home.layout?.fund ? lookOf(home.layout, "fund").frame : undefined}
            className="mb-3 flex min-h-[52px] items-center gap-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 py-2"
          >
            <span className="text-2xl" aria-hidden="true">
              💰
            </span>
            <span className="min-w-0 flex-1">
              <b>เงินสมทบทีมอาสา · ยอดรับ-จ่ายเปิดให้ทุกคนดู</b>
              <span className="block text-sm text-neutral-700">รวบรวมจากกลุ่ม LINE · ได้รับ / ใช้ไป / คงเหลือ</span>
            </span>
            <span className="shrink-0 font-semibold underline">ดู ›</span>
          </a>
        )}
      </>
    ),
    survey: (
      <>
        {/* 7 Oct: the electricians' visit is over for now; the sign-up box waits down here, folded, in case they come back */}
        <div className="mt-2">
          <SurveyBoxes look={home.layout?.survey ? lookOf(home.layout, "survey") : null} />
        </div>
      </>
    ),
    hub: (
      <>
        {home.hub?.on && home.hub.title && (
          <div className="mt-2">
            <HubBox hub={home.hub} look={home.layout?.hub ? lookOf(home.layout, "hub") : null} />
          </div>
        )}
      </>
    ),
    archive: (
      <>
        <section className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href="/flood" className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-neutral-400 bg-white px-3 py-2">
            <span className="text-2xl" aria-hidden="true">
              📦
            </span>
            <span>
              <b>คลังภารกิจน้ำท่วม ก.ย.–ต.ค. 2569</b>
              <span className="block text-sm text-neutral-600">แผนที่ คำขอ ระดับน้ำ ย้อนหลัง · ดูอย่างเดียว</span>
            </span>
          </a>
          <a href="/credits.html" className="flex min-h-[64px] items-center gap-3 rounded-xl bg-[#0b1622] px-3 py-2 text-white">
            <span className="text-2xl" aria-hidden="true">
              🎬
            </span>
            <span>
              <b>End credits ทีมอาสา</b>
              <span className="block text-sm text-[#f2b872]">ขอบคุณทุกคน ทุกร้าน ทุกหน่วยงาน · เปิดเสียง</span>
            </span>
          </a>
        </section>
      </>
    ),
  };

  return (
    <TextsContext.Provider value={home.texts || {}}>
      <div className="min-h-screen bg-[#F2F4F1] text-[#15201A]">
        <BottomNav
          page={page}
          badges={Object.fromEntries(Object.entries(notes).map(([k, b]) => [k, b && (ack[k] === b.sig ? "muted" : b.level)]))}
          onGo={(p) => (p === "pros" ? openPros("") : goPage(p, p === "community" ? tab : undefined))}
          onHotline={() => setSheet({ type: "hotlines" })}
        />
        <UrgentBar items={announcements} />
        {peek && (
          <div
            key={peek.key}
            className={`peek fixed inset-x-3 top-[68px] z-40 mx-auto max-w-md rounded-2xl border-2 bg-white p-2 shadow-xl ${peek.leaving ? "peek-out" : "peek-in"} ${peek.kind === "home" ? "border-[#1E6B47]" : "border-[#E0A100]"}`}
            role="status"
          >
            <div className="flex items-center gap-2">
              {peek.x.media?.[0] ? (
                <img src={mediaUrl(peek.x.media[0].id, "thumb")} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
              ) : (
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#F2F4F1] text-3xl" aria-hidden="true">
                  🐾
                </span>
              )}
              <button
                onClick={() => {
                  closePeek();
                  goItem("lost", peek.x.id);
                }}
                className="min-w-0 flex-1 text-left"
              >
                <span className={`block text-sm font-bold ${peek.kind === "home" ? "text-[#154D33]" : "text-[#B42318]"}`}>
                  {peek.kind === "home" ? "🎉 เจอแล้ว! กลับบ้านแล้ว" : "🐾 ช่วยกันดู · สัตว์เลี้ยงหาย"}
                </span>
                <span className="line-clamp-2 block text-[15px] font-bold leading-snug">
                  {peek.x.title}
                  {peek.x.soi ? ` (ซ.${peek.x.soi})` : ""}
                </span>
              </button>
              <button onClick={closePeek} aria-label="ปิด" className="min-h-[44px] min-w-[40px] shrink-0 text-[#45504A]">
                ✕
              </button>
            </div>
            <span className="peek-timer absolute inset-x-3 bottom-0.5 h-0.5 origin-left rounded-full bg-[#E0A100]" aria-hidden="true" />
          </div>
        )}
        {/* 7 Oct: one row — water, weather, people here, share; the village's name lives in the footer */}
        <header className="fixed inset-x-0 bottom-0 z-[900] bg-[#15201A] pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-2px_8px_rgba(0,0,0,0.25)]">
          {!online && <p className="bg-red-700 px-3 py-1 text-center text-sm font-bold">⚠️ เชื่อมต่อไม่ได้ กำลังลองใหม่</p>}
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-2 py-1.5 sm:px-4">
            <button onClick={() => goPage("home")} aria-label="เสรีไทย 57 · กลับบ้านฉัน" className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5">
              <img src={`${process.env.PUBLIC_URL}/logo-mark.png`} alt="" className="h-full w-full object-contain" />
            </button>
            <WaterPill water={water} canal={canal} onOpen={openWater} />
            <WeatherChip weather={weather} onOpen={() => setSheet({ type: "weather" })} viewers={online ? viewers : 0} />
            {Object.values(notes).some(Boolean) && (
              <button
                onClick={() => setNotifyOpen(true)}
                aria-label={live.length ? `การแจ้งเตือน ${live.length} เรื่อง` : "การแจ้งเตือน (ล้างแล้ว)"}
                className={`relative min-h-[44px] min-w-[44px] shrink-0 rounded-lg px-2.5 active:bg-white/20 ${live.length ? "bg-white/15" : "bg-white/5 opacity-60"}`}
              >
                🔔
                {live.length > 0 && (
                  <span
                    key={live.length}
                    className={`anim-pop absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-xs font-bold ${live.some(([, b]) => b.level === "important") ? "bg-[#B42318]" : "bg-[#1E9E5A]"}`}
                  >
                    {live.length}
                  </span>
                )}
              </button>
            )}
            <button onClick={share} aria-label="แชร์ลิงก์" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 active:bg-white/20">
              🔗
            </button>
          </div>
          {admin && (
            <div className="border-t border-white/20 bg-neutral-800">
              <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-1 text-sm sm:px-4">
                <span className="font-semibold">🛡️ โหมดผู้ดูแล · {admin.name}</span>
                <a href="/admin" className="ml-auto flex min-h-[40px] items-center underline">
                  📢 ประกาศ / ตั้งค่า
                </a>
              </div>
            </div>
          )}
        </header>

        <main key={page} className="anim-page mx-auto max-w-5xl px-3 pb-28 pt-3 sm:px-4">
          {page === "home" ? (
            <>
              {ordered(home.layout, Object.keys(blocks)).map((k) => (
                <Fragment key={k}>{blocks[k]}</Fragment>
              ))}

              <footer className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-neutral-500">
                <img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Sahakorn Serithai 57" className="h-28 w-auto" />
                {VILLAGE_NAME} · ข้อมูลในหน้านี้มาจากเพื่อนบ้านช่วยกันลง · ระบบไม่รับเงิน ตกลงกันเอง
                {!admin && (
                  <a href="/admin" className="inline-flex min-h-[44px] items-center text-neutral-400 underline">
                    สำหรับผู้ดูแล
                  </a>
                )}
              </footer>
            </>
          ) : (
            blocks.announce
          )}

          {page === "pros" && (
            <>
              <PageTitle title="ช่าง · ร้าน ในหมู่บ้าน" sub={`${services.length} ราย · คนแนะนำเยอะขึ้นก่อน${hires.length ? ` · มีคนกำลังหาช่าง ${hires.length} เรื่อง (ท้ายหน้า)` : ""}`} />
              {/* 7 Oct: everyone (admins too) gets the same list; neighbours looking for a tradesman sit quietly at its end */}
              <ProsList
                key={`${prosGroup}-${prosFocus}`}
                services={services}
                setServices={setServices}
                group={prosGroup}
                setGroup={setProsGroup}
                autoFocus={prosFocus}
                onAdd={() => setSheet({ type: "serviceForm" })}
                onHire={() => setSheet({ type: "jobForm", kind: "need", jobType: "hire" })}
              />
              {hires.length > 0 && (
                <section className="mt-4 space-y-2">
                  <h3 className="text-lg font-bold">🧑‍🔧 เพื่อนบ้านกำลังหาช่าง ({hires.length})</h3>
                  <p className="text-[15px] text-[#45504A]">มีค่าจ้าง · เป็นช่าง? กดดูเบอร์ แล้วโทรตกลงราคากันเอง</p>
                  <HireList jobs={hires} setJobs={setJobs} admin={admin} />
                </section>
              )}
              {admin && (
                <details className="mt-4 rounded-xl bg-white p-3">
                  <summary className="min-h-[44px] cursor-pointer font-bold">🛡️ เครื่องมือผู้ดูแล · แก้ ยืนยัน ปักหมุด ลบ ร้าน</summary>
                  <div className="mt-2">
                    <ServiceBoard repair services={services} setServices={setServices} posts={[]} admin={admin} onAdd={() => setSheet({ type: "serviceForm" })} onOpenPost={() => {}} />
                  </div>
                </details>
              )}
            </>
          )}

          {page === "community" && (
            <>
              <PageTitle title="เพื่อนบ้านช่วยกัน" sub="ขอแรง · ยืม ให้ ขาย · ถามกัน · ข่าวในหมู่บ้าน" />
              <section className="rounded-[20px] border border-[#DCE2DD] bg-white p-4">
                <CommunityIntro
                  showPros={false}
                  services={services}
                  onGroup={(g) => openPros(g)}
                  onAll={() => openPros("")}
                  onNeed={() => setSheet({ type: "intent", need: true })}
                  onOffer={() => setSheet({ type: "intent", need: false })}
                  onAsk={() => askForum()}
                />
                <button onClick={() => pick("lost")} className="mt-2.5 flex min-h-[56px] w-full items-center gap-3 rounded-2xl border-2 border-[#E0A100] bg-[#FFF8E1] px-3 text-left">
                  <span className="text-2xl" aria-hidden="true">
                    🐾
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-base leading-tight">หาย · เจอ</b>
                    <span className="block text-sm text-[#45504A]">
                      {lostOpen.length ? `ตามหาอยู่ ${lostOpen.filter((x) => x.kind === "lost").length} · มีคนเจอ ${lostOpen.filter((x) => x.kind === "found").length}` : "หมาแมวหาย เจอของ ลงรูปไว้"}
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
                <nav ref={navRef} className="-mx-4 mt-5 scroll-mt-32 overflow-x-auto border-t border-[#E6EBE7] px-4 pt-4" aria-label="หมวด">
                  <div className="flex w-max gap-2">
                    {Object.entries(MAIN_TABS).map(([k, [, text]]) => (
                      <button
                        key={k}
                        onClick={() => pick(k)}
                        aria-current={tab === k ? "page" : undefined}
                        className={`min-h-[44px] whitespace-nowrap rounded-full px-4 text-[15px] ${tab === k ? "bg-[#15201A] font-bold text-white" : k === "lost" && lostHot.length ? "border-2 border-[#B42318] bg-[#FDE8E6] font-bold text-[#7A1A12]" : "border border-[#C9D1CB] bg-white"}`}
                      >
                        {k === "lost" ? "🐾 " : ""}
                        {text}
                        {k === "lost" && lostOpen.length > 0 && <span className="ml-1.5 rounded-full bg-[#B42318] px-1.5 text-sm text-white">{lostOpen.length}</span>}
                      </button>
                    ))}
                  </div>
                </nav>

                <div key={tab} className="anim-in mt-3">
                  {tab === "feed" && (
                    <CommunityFeed
                      lost={lostOpen}
                      lend={lend}
                      jobs={jobs}
                      services={services}
                      topics={topics}
                      onNeed={() => setSheet({ type: "intent", need: true })}
                      onTab={showTab}
                      onTopic={(id) => askForum(id)}
                      onJoin={(job) => setSheet({ type: "join", job })}
                    />
                  )}
                  {tab === "forum" && <Forum key={forumGo.n} admin={admin} openId={forumGo.openId || null} startCompose={!!forumGo.compose} />}
                  {tab === "lend" && <LendBoard items={lend} setItems={setLend} admin={admin} onAdd={(kind) => setSheet({ type: "lendForm", kind })} />}
                  {tab === "jobs" && <JobBoard jobs={jobs} setJobs={setJobs} admin={admin} onAdd={(kind) => setSheet({ type: "jobForm", kind })} onPaid={() => openPros("")} />}
                  {tab === "lost" && <LostBoard items={lost} reunited={reunited} setItems={setLost} admin={admin} onAdd={(kind) => setSheet({ type: "lostForm", kind })} />}
                  {tab === "issues" && <IssueBoard issues={issues} setIssues={setIssues} admin={admin} onAdd={() => setSheet({ type: "issueForm" })} />}
                  {tab === "waste" && <WasteBoard admin={admin} onReportTrash={() => setSheet({ type: "issueForm" })} />}
                  {tab === "guide" && <AfterFloodGuide />}
                </div>
                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[#E6EBE7] pt-4" aria-label="เรื่องอื่นในหมู่บ้าน">
                  {Object.entries(MORE_TABS).map(([k, [, text]]) => (
                    <button
                      key={k}
                      onClick={() => showTab(k)}
                      aria-current={tab === k ? "page" : undefined}
                      className={`min-h-[60px] rounded-2xl px-3 py-2 text-left ${tab === k ? "bg-[#15201A] text-white" : "border border-[#DCE2DD] bg-white"}`}
                    >
                      <b className="block text-base leading-tight">{text}</b>
                      <span className={`block text-sm ${tab === k ? "text-[#C5D1CA]" : "text-[#45504A]"}`}>
                        {MORE_SUB[k]}
                        {counts[k] > 0 ? ` · ${counts[k]}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          )}

          {page === "map" && (
            <>
              <PageTitle title="ระดับน้ำ · แผนที่หมู่บ้าน" sub={waterSub(water)} />
              <section className="rounded-[20px] border border-[#DCE2DD] bg-white p-3">
                <WaterView
                  trips={trips}
                  focus={focus}
                  hubs={hubPins}
                  events={eventsOn}
                  onFocusTrip={(t) => setFocus({ lat: t.lat, lng: t.lng, t: Date.now() })}
                  water={water}
                  canal={canal}
                  admin={admin}
                  onWater={() => setSheet({ type: "water" })}
                  onCanal={() => setSheet({ type: "canal" })}
                  onLeaks={() => setSheet({ type: "leaks" })}
                  onLeak={(leak) => setSheet({ type: "leak", leak })}
                  onPump={(pump) => setSheet({ type: "pump", pump })}
                  onPumps={() => setSheet({ type: "pumps" })}
                />
              </section>
            </>
          )}
        </main>

        {notifyOpen && (
          <Sheet title="🔔 การแจ้งเตือน" onClose={() => setNotifyOpen(false)}>
            <div className="space-y-3">
              {[
                ["home", "🏠 บ้านฉัน"],
                ["pros", "🔧 ช่าง · ร้าน"],
                ["community", "👥 เพื่อนบ้าน"],
                ["map", "🗺️ แผนที่น้ำ"],
              ]
                .filter(([k]) => notes[k])
                .map(([k, name]) => {
                  const b = notes[k];
                  const muted = ack[k] === b.sig;
                  return (
                    <div
                      key={k}
                      className={`rounded-2xl border-2 p-3 ${muted ? "border-[#DCE2DD] opacity-60" : b.level === "important" ? "border-[#B42318] bg-[#FDE8E6]" : "border-[#1E6B47] bg-[#E4F0E9]"}`}
                    >
                      <div className="flex items-center gap-2">
                        <b className="min-w-0 flex-1 text-base">{name}</b>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${b.level === "important" ? "bg-[#B42318] text-white" : "bg-[#1E6B47] text-white"}`}>
                          {muted ? "ล้างแล้ว · ยังค้างอยู่" : b.level === "important" ? "สำคัญ" : "อัปเดต"}
                        </span>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-[15px] leading-snug">
                        {(b.reasons || []).map((r, i) =>
                          typeof r === "string" ? (
                            <li key={i}>{r}</li>
                          ) : (
                            <li key={i}>
                              <button
                                onClick={() => {
                                  setNotifyOpen(false);
                                  goItem(...r.go);
                                }}
                                className="min-h-[36px] text-left underline decoration-dotted underline-offset-4"
                              >
                                {r.text} ›
                              </button>
                            </li>
                          ),
                        )}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => {
                            setNotifyOpen(false);
                            if (k === "pros") openPros("");
                            else if (k === "community") showTab(needs.length ? "jobs" : tab);
                            else goPage(k);
                          }}
                          className="min-h-[44px] flex-1 rounded-xl bg-white text-[15px] font-bold"
                        >
                          ไปดู ›
                        </button>
                        {!muted && (
                          <button onClick={() => clearNotes([k])} className="min-h-[44px] shrink-0 rounded-xl px-3 text-[15px] font-bold text-[#45504A] underline">
                            ล้าง
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              {live.length > 0 && (
                <button onClick={() => clearNotes(Object.keys(notes))} className="min-h-[52px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold">
                  🔕 ล้างการแจ้งเตือนทั้งหมด
                </button>
              )}
              <p className="text-sm text-[#45504A]">ล้างแล้วจะเหลือจุดจางๆ บนปุ่มจนกว่าเรื่องนั้นจะจบ ไม่ต้องรีบ ช่วยได้เมื่อสะดวก · ถ้ามีเรื่องใหม่ จะเตือนอีกครั้ง</p>
            </div>
          </Sheet>
        )}
        {sheet?.type === "lendForm" && (
          <Sheet title="ยืม · ให้ · ขาย" onClose={() => setSheet(null)}>
            <LendForm
              kind={sheet.kind}
              onDone={(x) => {
                setLend((p) => [x, ...p]);
                posted("lend", `${LEND_KIND_TEXT[x.kind] || "🧰"} ${x.title}${x.price ? ` ${x.price}` : ""}${x.soi ? ` (ซ.${x.soi})` : ""}`);
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "jobForm" && (
          <Sheet title={sheet.kind === "need" ? "🙋 ขอแรงช่วยที่บ้าน" : "💪 ลงชื่ออาสาไปช่วย"} onClose={() => setSheet(null)}>
            <JobForm
              kind={sheet.kind}
              jobType={sheet.jobType}
              onDone={(j) => {
                setJobs((p) => [j, ...p]);
                posted(j.type === "hire" ? "pros" : "jobs", `${j.type === "hire" ? "🧑‍🔧 หาช่าง" : j.kind === "need" ? "🙋 ขอแรง" : "💪 ช่วยได้"}: ${j.detail}${j.soi ? ` (ซ.${j.soi})` : ""}`);
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "lostForm" && (
          <Sheet title="🐾 หาย · เจอ" onClose={() => setSheet(null)}>
            <LostForm
              kind={sheet.kind}
              onDone={(x) => {
                setLost((p) => [x, ...p]);
                pick("lost");
                setSheet({ type: "lostPosted", item: x });
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "lostPosted" && (
          <Sheet title="✅ ประกาศแล้ว" onClose={() => setSheet(null)}>
            <div className="space-y-3">
              <p className="text-base">{["dog", "cat", "pet"].includes(sheet.item.category) ? "ขึ้นหน้าแรกของทุกคนในหมู่บ้านแล้ว แบบนี้ 👇" : "อยู่ในหาย · เจอ ของเพื่อนบ้านแล้ว แบบนี้ 👇"}</p>
              <LostPreview x={sheet.item} photo={sheet.item.media?.[0] ? mediaUrl(sheet.item.media[0].id, "thumb") : null} />
              <button onClick={() => shareLost(sheet.item)} className="min-h-[56px] w-full rounded-xl bg-[#06C755] text-lg font-bold text-white">
                📤 ส่งต่อในกลุ่ม LINE (ยิ่งแชร์ ยิ่งเจอเร็ว)
              </button>
              <button onClick={() => setSheet(null)} className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] font-bold">
                เสร็จแล้ว
              </button>
            </div>
          </Sheet>
        )}
        {sheet?.type === "water" && (
          <Sheet title="💧 แจ้งระดับน้ำ" onClose={() => setSheet(null)}>
            <WaterForm
              onDone={(w) => {
                setWater((p) => [w, ...p]);
                setSheet(null);
                setToast("ขอบคุณที่แจ้งระดับน้ำ");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "canal" && (
          <Sheet title="🌊 แจ้งระดับน้ำในคลอง" onClose={() => setSheet(null)}>
            <CanalForm
              onDone={(r) => {
                setCanal((c) => ({ ...(c || { pumps: [], leaks: [] }), reports: [r, ...((c && c.reports) || [])] }));
                setSheet(null);
                setToast("ขอบคุณที่แจ้งระดับคลอง");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "leaks" && (
          <Sheet title="🕳️ รูรั่วริมคลอง / เขื่อน" onClose={() => setSheet(null)}>
            <LeakList leaks={canal?.leaks || []} onLeak={(leak) => setSheet({ type: "leak", leak })} onAdd={() => setSheet({ type: "leakForm" })} />
          </Sheet>
        )}
        {sheet?.type === "leak" && (
          <Sheet title="🕳️ รูรั่ว" onClose={() => setSheet(null)}>
            <LeakSheet
              leak={sheet.leak}
              onDone={() => {
                setSheet(null);
                setToast("อัปเดตรูรั่วแล้ว");
                refresh();
              }}
              onDelete={
                admin
                  ? async (l) => {
                      await api(`/admin/leaks/${l.id}`, { method: "DELETE" }).catch((e) => setToast(e.message));
                      setSheet(null);
                      refresh();
                    }
                  : null
              }
            />
          </Sheet>
        )}
        {sheet?.type === "pumps" && (
          <Sheet title="⚙️ เครื่องสูบน้ำ" onClose={() => setSheet(null)}>
            <PumpList pumps={(canal?.pumps || []).filter((x) => x.status !== "removed")} onPump={(pump) => setSheet({ type: "pump", pump })} admin={!!admin} />
          </Sheet>
        )}
        {sheet?.type === "pump" && (
          <Sheet title={sheet.pump ? "⚙️ สถานะเครื่องสูบ" : "⚙️ เพิ่มเครื่องสูบ"} onClose={() => setSheet(null)}>
            <PumpForm
              pump={sheet.pump}
              admin={!!admin}
              onDone={() => {
                setSheet(null);
                setToast("บันทึกเครื่องสูบแล้ว");
                refresh();
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "leakForm" && (
          <Sheet title="🕳️ แจ้งรูรั่ว" onClose={() => setSheet(null)}>
            <LeakForm
              onDone={(l) => {
                setCanal((c) => ({ ...(c || { reports: [], pumps: [] }), leaks: [l, ...((c && c.leaks) || [])] }));
                setSheet(null);
                setToast("แจ้งรูรั่วแล้ว");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "issueForm" && (
          <Sheet title="📍 แจ้งปัญหาในซอย" onClose={() => setSheet(null)}>
            <IssueForm
              onDone={(x) => {
                setIssues((p) => [x, ...p]);
                setSheet(null);
                pick("issues");
                setToast("แจ้งแล้ว · ส่งต่อให้เขตได้จากลิงก์ด้านล่าง");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "serviceForm" && (
          <Sheet title="แนะนำช่าง / ร้าน" onClose={() => setSheet(null)}>
            <ServiceForm
              repair
              onDone={(s) => {
                setServices((p) => [s, ...p]);
                posted("pros", `⭐ แนะนำช่าง/ร้าน: ${s.name}${s.detail ? ` · ${s.detail}` : ""}`);
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "intent" && (
          <Sheet title={sheet.need ? "ขอความช่วยเหลือ" : "แนะนำ / ให้ / ขาย"} onClose={() => setSheet(null)}>
            <IntentChoices need={sheet.need} choices={sheet.need ? NEED_CHOICES : OFFER_CHOICES} onPick={go} />
          </Sheet>
        )}
        {sheet?.type === "join" && (
          <Sheet title={sheet.job.kind === "need" ? "ไปช่วยเพื่อนบ้าน" : "ขอให้มาช่วยบ้านฉัน"} onClose={() => setSheet(null)}>
            <JoinSheetBody job={sheet.job} onJoined={(j) => setJobs((p) => p.map((x) => (x.id === j.id ? j : x)))} onClose={() => setSheet(null)} />
          </Sheet>
        )}
        {sheet?.type === "posted" && (
          <Sheet title="ลงแล้ว" onClose={() => setSheet(null)}>
            <PostedSheetBody
              text={sheet.text}
              onClose={() => {
                setSheet(null);
                showTab(tab);
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
          <Sheet title="☎️ เบอร์สำคัญ" onClose={() => setSheet(null)}>
            <div className="space-y-4">
              {[
                ...HOTLINE_GROUPS,
                {
                  title: "🏛️ หลังน้ำลด",
                  items: [
                    ["1555", "กทม. · แจ้งขยะ ถนน ไฟถนน"],
                    ["1323", "สายด่วนสุขภาพจิต"],
                    ["1130", "การไฟฟ้านครหลวง"],
                  ],
                },
              ].map((group) => (
                <section key={group.title}>
                  <h3 className="mb-2 font-bold">{group.title}</h3>
                  <ul className="space-y-2">
                    {group.items.map(([num, text]) => (
                      <li key={`${group.title}-${num}`}>
                        <a href={`tel:${num.replace(/\D/g, "")}`} className="flex min-h-[56px] flex-wrap items-center gap-x-3 rounded-xl border border-neutral-200 px-4 py-2 active:bg-neutral-50">
                          <span className="text-xl font-bold tabular-nums text-red-700">📞 {num}</span>
                          <span>{text}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </Sheet>
        )}

        {toast && (
          <div
            key={toast}
            role="status"
            className="anim-toast pointer-events-none fixed inset-x-3 top-20 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg"
          >
            {toast}
          </div>
        )}
      </div>
    </TextsContext.Provider>
  );
}

// one line under the 💧 block's title: the newest street-level report, if any
function waterSub(water) {
  const w = water[0];
  return w ? `แจ้งล่าสุด ${timeAgo(w.created_at)}${w.soi ? ` · ซ.${w.soi}` : ""} · คลอง เครื่องสูบ รถอาสา` : "ระดับน้ำที่เพื่อนบ้านแจ้ง · คลอง · เครื่องสูบ · รถอาสา";
}

const LEND_KIND_TEXT = { lend: "มีของให้ยืม:", give: "มีของให้ฟรี:", want: "ตามหา / อยากได้:", sell: "ขาย:" };
const MORE_SUB = { waste: "วันนี้รถเข้าซอยไหน", guide: "ไฟ น้ำ ความปลอดภัย", issues: "ฝาท่อแตก ขยะ ไฟถนน", lost: "สัตว์เลี้ยง ของหาย" };

// Where an event's sign goes: its meeting point, or the middle of its line
export function eventSpot(e) {
  if (e.lat != null && e.lng != null) return [e.lat, e.lng];
  const l = e.line || [];
  return l.length ? l[Math.floor((l.length - 1) / 2)] : [13.7945, 100.6737];
}

// Red call-out box for a volunteer work session; tap = show it on the map
function EventBox({ ev, onMap }) {
  const [plan, setPlan] = useState(false);
  const [planMounted, setPlanMounted] = useState(false); // keep the maps once drawn: removing a Leaflet map mid-zoom crashes it
  const linked = ev.tab || ev.line?.length || ev.lat != null;
  return (
    <section className="mb-3 rounded-xl border-4 border-red-600 bg-red-50 px-3 py-2">
      <div className="flex items-start gap-3">
        <span className="pt-1 text-3xl" aria-hidden="true">
          {ev.icon || "🧱"}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-bold leading-snug">{ev.title}</h2>
          {ev.when && <p className="font-semibold text-red-700">🕘 {ev.when}</p>}
          {ev.sub && <p className="text-sm text-neutral-700">{ev.sub}</p>}
        </div>
      </div>
      <MediaStrip media={ev.media || []} size={88} />
      {ev.items?.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {ev.items.map((t, i) => (
            <li key={i} className="flex gap-2 rounded-lg bg-white px-2 py-1.5 text-[15px] leading-snug">
              <span className="font-bold text-red-700">{i + 1}.</span>
              <span>{t}</span>
            </li>
          ))}
        </ol>
      )}
      {ev.link === "/cleanup" ? (
        <>
          <button
            onClick={() => {
              setPlanMounted(true);
              setPlan((o) => !o);
            }}
            aria-expanded={plan}
            className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-center text-lg font-bold text-white"
          >
            {plan ? "▲ ซ่อนแผนรถ" : ev.link_label || "🗺️ ดูแผนรถตามโซน ▼"}
          </button>
          {planMounted && (
            <div className="mt-2" hidden={!plan}>
              <CleanupPlan embedded />
              <a href="/cleanup" className="mt-2 block text-center text-sm underline">
                เปิดแผนเต็มจอ ↗
              </a>
            </div>
          )}
        </>
      ) : (
        ev.link && (
          <a href={ev.link} className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-center text-lg font-bold text-white">
            {ev.link_label || "ดูรายละเอียด ›"}
          </a>
        )
      )}
      {linked && (
        <button onClick={onMap} className="mt-2 min-h-[44px] w-full rounded-lg border-2 border-red-600 bg-white font-semibold text-red-800">
          {ev.tab ? "ดูรายละเอียดเพิ่ม ›" : "ดูจุดบนแผนที่ ›"}
        </button>
      )}
    </section>
  );
}

// Yellow highlight box (the volunteers' hand-out point); with a pin it opens navigation
function HubBox({ hub, look }) {
  const body = (
    <>
      <span className="text-2xl" aria-hidden="true">
        📍
      </span>
      <span className="min-w-0 flex-1">
        <b className="break-words">{hub.title}</b>
        {hub.sub && <span className="block text-sm text-neutral-700">{hub.sub}</span>}
      </span>
    </>
  );
  const cls = "mb-3 flex min-h-[56px] items-center gap-3 rounded-xl border-4 border-yellow-400 bg-yellow-50 px-3 py-2";
  const style = look?.frame;
  return hub.lat != null && hub.lng != null ? (
    <a href={`https://www.google.com/maps/search/?api=1&query=${hub.lat},${hub.lng}`} target="_blank" rel="noreferrer" className={cls} style={style}>
      {body}
      <span className="shrink-0 font-semibold underline">นำทาง ›</span>
    </a>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
