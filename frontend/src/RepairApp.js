import {
  Fragment,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { API, api, load, save, viewerId } from "./api";
import { pullKeys, pushAll, pushKey } from "./sellerSync";
import {
  HOTLINE_GROUPS,
  ISSUE_TYPES,
  LEND_KINDS,
  VILLAGE_NAME,
  isMarketShop,
  timeAgo,
} from "./config";
import Sheet from "./components/Sheet";
import Announcements, { UrgentBar } from "./components/Announcements";
import { WeatherAlerts, WeatherChip, WindyMap } from "./components/Weather";
import { mediaUrl } from "./media";
import { clearBadge } from "./push";
import { flashTo } from "./notify";
import { MediaStrip } from "./components/MediaGallery";
import { ServiceBoard, ServiceForm } from "./components/ServiceBoard";
import WasteBoard from "./components/WasteBoard";
import { lookOf, ordered } from "./components/Look";
import { TextsContext } from "./components/Texts";
import MyHome, { homeBadgeOf } from "./components/MyHome";
import SurveyBoxes from "./components/SurveyBox";
import {
  BottomNav,
  IntentChoices,
  JoinSheetBody,
  NEED_CHOICES,
  OFFER_CHOICES,
  PostedSheetBody,
  PRO_CATS,
  ProsList,
} from "./components/Community";
import { CleanupPlan } from "./components/CleanupPage";
import Forum, { TopicForm } from "./components/Forum";
import WatchPanel, {
  WaterPill,
  WaterView,
  waterStatus,
} from "./components/WatchPanel";
import {
  LostBoard,
  LostForm,
  LostHero,
  LostPreview,
  shareLost,
} from "./components/LostFound";
import InstallApp from "./components/InstallApp";
import QuickReport from "./components/QuickReport";
import { HelpHero, TalkHero } from "./components/HeroSlides";
import IssueHistory from "./components/IssueHistory";
import FloodTuck, { useFloodTools } from "./components/FloodTuck";
import { WaterForm } from "./components/Forms";
import {
  CanalForm,
  LeakForm,
  LeakList,
  LeakSheet,
  PumpForm,
  PumpList,
} from "./components/Canal";
import {
  AfterFloodGuide,
  HireList,
  IssueBoard,
  IssueCard,
  IssueForm,
  JobBoard,
  JobForm,
  LendBoard,
  LendForm,
} from "./components/RepairBoards";
import Market, { marketOpen } from "./components/Market";
// 15 Oct: links from the LINE bot carry ?home=4/917 — that house becomes this phone's บ้านฉัน (no typing it twice)
(() => {
  try {
    const p = new URLSearchParams(window.location.search);
    const h = (p.get("home") || "").trim();
    if (!/^\d{1,3}\/\d{1,5}/.test(h)) return;
    save("myHouse", h);
    save("lineHouse", h); // this phone came from LINE with that house: the "ผูกกับ LINE" card can say so
    p.delete("home");
    const q = p.toString();
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (q ? `?${q}` : "") + window.location.hash,
    );
  } catch {}
})();
const Map3D = lazy(() => import("./components/Map3D"));

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
  jobs: ["🙋", "ขอแรง · ช่วยได้"],
  lend: ["🧰", "ยืม · ให้ · ขาย"],
  forum: ["💬", "กระดานคุยกัน"],
  market: ["🛍️", "ตลาด"],
};
// 8 Oct: เพื่อนบ้าน has its own three tabs; ขอแรง and ยืม·ให้·ขาย are one "ช่วยกัน" tab with two lists
const GROUPS = [
  ["lost", "🐾", "หาย · เจอ"],
  ["help", "🤝", "ช่วยกัน"],
  ["talk", "💬", "คุยกัน"],
  ["map", "📍", "แจ้งปัญหา"], // 17 Oct: ตลาด moved up to the top bar; the map (soi problems) sits with the neighbours
];
const groupOf = (t) =>
  t === "jobs" || t === "lend"
    ? "help"
    : t === "forum"
      ? "talk"
      : t === "lost"
        ? "lost"
        : null;
const MORE_TABS = {
  waste: ["♻️", "ขยะ · รถเก็บ"],
  guide: ["📋", "เช็กลิสต์หลังน้ำลด"],
  issues: ["📍", "ปัญหาซอย"],
};
const TABS = { ...MAIN_TABS, ...MORE_TABS };
// which bottom-bar page a link's #hash opens (old links keep working: #water → the map, #feed → เพื่อนบ้าน)
const pageOf = (h) =>
  h === "pros"
    ? "pros"
    : h === "market"
      ? "market"
      : h === "map" || h === "water"
        ? "map"
        : TABS[h] || h === "feed"
          ? "community"
          : "home";

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
    return TABS[h] ? h : "lost"; // 8 Oct: เพื่อนบ้าน always opens on หาย·เจอ unless a link names another tab
  });
  const [lend, setLend] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [issues, setIssues] = useState([]);
  const [mapSeen, setMapSeen] = useState(() => {
    const v = load("mapSeen", 0);
    if (v) return v;
    save("mapSeen", Date.now() - 864e5); // first visit: only the last day's reports count as new
    return Date.now() - 864e5;
  });
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
      ...lost
        .filter(
          (x) =>
            pet(x) &&
            x.kind === "lost" &&
            age(x.created_at) < 2 * 864e5 &&
            !mine[x.id],
        )
        .map((x) => ({ key: x.id, x, kind: "lost" })),
      ...reunited
        .filter((x) => pet(x) && age(x.updated_at || x.created_at) < 864e5)
        .map((x) => ({ key: `r${x.id}`, x, kind: "home" })),
    ].filter(
      (n) =>
        !seenP[n.key] &&
        !peekQ.current.some((q) => q.key === n.key) &&
        peek?.key !== n.key,
    );
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
    const h =
      hash ??
      (p === "home" ? "" : p === "map" ? "map" : p === "pros" ? "pros" : null);
    setPage(p);
    if (h != null && window.location.hash.slice(1) !== h)
      window.history.pushState(
        { page: p },
        "",
        h ? `#${h}` : window.location.pathname + window.location.search,
      );
    window.scrollTo({ top: 0 });
  };
  const [prosQuery, setProsQuery] = useState("");
  const openPros = (group = "", focus = false, query = "") => {
    setProsGroup(group);
    setProsFocus(focus);
    setProsQuery(query);
    goPage("pros");
  };
  useEffect(() => {
    const onPop = () => {
      const h = window.location.hash.slice(1);
      // 17 Oct: a sheet or the photo viewer closing with the back button lands on the same page — stay where you were
      setPage((cur) => {
        if (cur !== pageOf(h)) window.scrollTo({ top: 0 });
        return pageOf(h);
      });
      if (TABS[h]) setTab(h);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 17 Oct: a browser joined to a seller's shop link picks up posts made on the seller's other phones
  useEffect(() => {
    pullKeys().then((n) => {
      if (n) {
        setLend((p) => [...p]);
        setServices((p) => [...p]);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [forumGo] = useState({ n: 0 });
  const [, setForumTick] = useState(0); // forumGo is mutated in place: this re-renders after it changed
  const [water, setWater] = useState([]);
  const [canal, setCanal] = useState(null);
  // highlight boxes (water watch, volunteer hand-out point): admins switch them on /admin, no redeploy
  const [home, setHome] = useState(() =>
    load("homeBlocks", { watch_on: true, watch_title: "", hub: { on: false } }),
  );
  const [services, setServices] = useState([]);
  // 16 Oct: shops you buy from (food / shop / supplies) live in ตลาด; ช่าง·บริการ lists the rest
  const prosOnly = services.filter((s) => PRO_CATS.includes(s.category));
  const shops = services.filter(isMarketShop);
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
    if (t === "market") return goPage("market", "market");
    setTab(t);
    save("repairTab3", t);
    goPage("community", t);
  };
  const go = (g) => {
    if (g.sheet) return setSheet(g.sheet);
    setSheet(null);
    showTab(g.tab);
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
  // a notification tap lands on /#lost-<id>, #jobs-, #lend-, #issue-, #shop-, #forum-: open that item (sw.js posts {go} to an open tab)
  const [issueGo, setIssueGo] = useState("");
  useEffect(() => {
    const open = (hash) => {
      // 17 Oct: the LINE bot sends a seller their own link #sell-<id>~<edit key>: this phone becomes the item's owner
      // (edit it, add photos / a menu, see orders), then the key leaves the address bar
      const k = (hash || "").match(/^#?sell-([\w-]{6,})~([\w-]{10,})$/);
      if (k) {
        save("lendKeys", { ...load("lendKeys", {}), [k[1]]: k[2] });
        pushKey("lend", k[1], k[2]);
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        return goItem("market", k[1]);
      }
      // 17 Oct: ลิงก์ร้านของฉัน opened on another phone / app: this browser joins the seller's shop
      const sp = (hash || "").match(/^#?shop-pass~([\w-]{20,64})$/);
      if (sp) {
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
        save("sellerPass", sp[1]);
        pushAll()
          .then(pullKeys)
          .then((n) => {
            setLend((p) => [...p]);
            setServices((p) => [...p]);
            setToast(
              n
                ? `✅ เชื่อมร้านแล้ว · เครื่องนี้เห็นของที่คุณขาย ${n} รายการ และออเดอร์`
                : "✅ เชื่อมร้านแล้ว · ลงขายเครื่องไหน ก็เห็นทุกเครื่อง",
            );
          });
        return showTab("market");
      }
      const m = (hash || "").match(
        /^#?(lost|jobs|lend|market|issue|shop|forum)-([\w-]{6,})$/,
      );
      if (!m) return;
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      if (m[1] === "issue") {
        goPage("map");
        return setIssueGo(m[2]); // opened once the map's reports are loaded
      }
      if (m[1] === "shop")
        return PRO_CATS.includes(
          (services.find((x) => x.id === m[2]) || {}).category,
        )
          ? openPros("")
          : showTab("market");
      if (m[1] === "forum") {
        forumGo.openId = m[2];
        forumGo.compose = false;
        forumGo.n += 1;
      }
      goItem(m[1], m[2]);
    };
    open(window.location.hash);
    clearBadge();
    const onVis = () => document.visibilityState === "visible" && clearBadge();
    document.addEventListener("visibilitychange", onVis);
    const onHash = () => open(window.location.hash);
    const onMsg = (e) => e.data?.go && open(new URL(e.data.go).hash);
    window.addEventListener("hashchange", onHash);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("hashchange", onHash);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
      api("/presence", {
        method: "POST",
        body: JSON.stringify({ id: viewerId() }),
      })
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
      setReunited(
        lf.filter(
          (x) =>
            x.status === "reunited" &&
            Date.now() - new Date(x.updated_at || x.created_at).getTime() <
              7 * 864e5,
        ),
      ); // 16 Oct: a week, so people see it was found
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
    const leave = () =>
      navigator.sendBeacon?.(
        `${API}/presence/leave`,
        new Blob([JSON.stringify({ id: viewerId() })], {
          type: "application/json",
        }),
      );
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
  const hubPins = useMemo(
    () =>
      home.hub?.on && home.hub.lat != null
        ? [
            {
              ...home.hub,
              tag: "ศูนย์อาสา",
              place: (home.hub.title || "")
                .split(":")
                .pop()
                .trim()
                .slice(0, 24),
            },
          ]
        : [],
    [home],
  );

  const eventsOn = useMemo(
    () => (home.events || []).filter((e) => e.on),
    [home],
  );

  const counts = {
    lend: lend.filter((x) => x.status !== "closed").length,
    jobs: jobs.filter(
      (x) => x.kind === "need" && x.status === "open" && x.type !== "hire",
    ).length,
    pros: services.length,
    lost: lost.length,
    issues: issues.length,
  };

  // first visit: nothing is "new" yet
  const [seenAt, setSeenAt] = useState(
    () => load("communitySeen", null) ?? Date.now(),
  );
  const [prosSeen, setProsSeen] = useState(
    () => load("prosSeen", null) ?? Date.now(),
  );
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
  const newestPro = Math.max(
    0,
    ...services.map((x) => new Date(x.created_at || 0).getTime() || 0),
  );
  useEffect(() => {
    if (page === "pros" && newestPro > prosSeen) {
      setProsSeen(newestPro);
      save("prosSeen", newestPro);
    }
  }, [page, newestPro, prosSeen]);
  const newest = Math.max(
    0,
    ...[...lend, ...jobs, ...topics].map(
      (x) => new Date(x.updated_at || x.created_at || 0).getTime() || 0,
    ),
  );
  useEffect(() => {
    if (page === "community" && newest > seenAt) {
      setSeenAt(newest);
      save("communitySeen", newest);
    }
  }, [page, newest, seenAt]);

  // neighbours still waiting for hands (ขอแรง, nobody has come yet)
  const needs = jobs.filter(
    (j) => j.kind === "need" && j.status === "open" && j.type !== "hire",
  );
  const hires = jobs.filter((j) => j.type === "hire" && j.status !== "done");
  const lostOpen = lost.filter((x) => x.status !== "reunited");
  const lostPets = lostOpen.filter(
    (x) =>
      x.kind === "lost" &&
      ["dog", "cat", "pet"].includes(x.category) &&
      Date.now() - new Date(x.created_at).getTime() < 7 * 864e5,
  );
  const homePets = reunited.filter(
    (x) =>
      ["dog", "cat", "pet"].includes(x.category) &&
      Date.now() - new Date(x.updated_at || x.created_at).getTime() < 864e5,
  );
  const needSig = needs.map((j) => j.id.slice(0, 6)).join(",");

  // 9 Oct: reports nobody on this phone has seen on the map yet → a dot on แผนที่หมู่บ้าน
  const openIssues = issues.filter((x) => x.status !== "fixed");
  const openIssue = useCallback(
    (x) => setSheet({ type: "issue", issue: x }),
    [],
  );
  useEffect(() => {
    // เสียงตามสาย is answered in บ้านฉัน (one answer per house), not reported as a map problem
    const go = (e) => {
      setSheet(null);
      goPage("home");
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent("speaker:open", { detail: e.detail || "" }),
          ),
        400,
      );
    };
    window.addEventListener("speaker:go", go);
    return () => window.removeEventListener("speaker:go", go);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const x = issueGo && issues.find((i) => i.id === issueGo);
    if (!x) return;
    setIssueGo("");
    openIssue(x);
  }, [issueGo, issues, openIssue]);
  // 📢 เสียงตามสาย layer: off by default (one switch on the map), loaded when switched on
  const [speakerOn, setSpeakerOn] = useState(() => load("speakerLayer", false));
  const [view3d, setView3d] = useState(false);
  const [edit3d, setEdit3d] = useState(false); // 🛠️ admin: the building editor over the map page
  const [map3dKey, setMap3dKey] = useState(0);
  const [mapMode, setMapMode] = useState(() => load("mapMode", "3d")); // 13 Oct: the village map opens in 3D
  const pickMap = (v) => {
    setMapMode(v);
    save("mapMode", v);
  };
  const [speakerPts, setSpeakerPts] = useState(null);
  useEffect(() => {
    if (!speakerOn || page !== "map") return;
    api("/speaker/map")
      .then(setSpeakerPts)
      .catch(() => {});
  }, [speakerOn, page]);
  // 🗺️ places the admin drew (shops, areas, routes, timed activities): refreshed every minute for on / soon
  const [places, setPlaces] = useState([]);
  useEffect(() => {
    if (page !== "map") return;
    const get = () =>
      api("/places")
        .then(setPlaces)
        .catch(() => {});
    get();
    const t = setInterval(get, 60000);
    return () => clearInterval(t);
  }, [page]);
  const placesNow = places.filter(
    (p) => p.times && (p.state === "on" || p.state === "soon"),
  );
  // หาย·เจอ on the map: still open, the last 3 weeks (MapView fades them with age)
  const lostOnMap = useMemo(
    () =>
      lostOpen.filter(
        (x) => Date.now() - new Date(x.created_at).getTime() < 21 * 864e5,
      ),
    [lostOpen],
  );
  const openLostFromMap = useCallback((x) => goItem("lost", x.id), []); // eslint-disable-line react-hooks/exhaustive-deps
  const newIssues = openIssues.filter(
    (x) => new Date(x.created_at).getTime() > mapSeen,
  );
  // what each page tab has to say (the bell lists it; ล้าง mutes it until it changes)
  const ws = waterStatus(water, canal);
  // 9 Oct: the water is gone, the flood tools are tucked away (one switch per phone); they come back by themselves if the water rises
  const [floodPref, setFloodPref] = useFloodTools();
  const floodOn = floodPref || !!ws.alarm;
  const show3d = mapMode === "3d" && !floodOn; // water levels, pumps and the speaker survey live on the 2D map
  const issuePins = useMemo(
    () =>
      openIssues
        .filter((x) => x.lat != null)
        .map((x) => ({
          ...x,
          emoji: (ISSUE_TYPES[x.type] || ["📍"])[0],
          title: (ISSUE_TYPES[x.type] || ["", "จุดปัญหา"])[1],
        })),
    [issues], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const notes = {
    home: homeBadge,
    pros:
      newestPro > prosSeen
        ? {
            level: "general",
            reasons: ["🔧 มีร้าน / ช่างใหม่ในหมู่บ้าน"],
            sig: `p${newestPro}`,
          }
        : null,
    community:
      needs.length || lostPets.length || homePets.length || newest > seenAt
        ? {
            level: "general",
            reasons: [
              ...homePets
                .slice(0, 2)
                .map((x) => ({
                  text: `🎉 เจอแล้ว: ${x.title}`,
                  go: ["lost", x.id],
                })),
              ...lostPets
                .slice(0, 4)
                .map((x) => ({
                  text: `🐾 ยังตามหา: ${x.title}${x.soi ? ` (ซ.${x.soi})` : ""}`,
                  go: ["lost", x.id],
                })),
              ...needs
                .slice(0, 4)
                .map((j) => ({
                  text: `🙋 ${j.name} ขอแรง: ${j.detail.length > 70 ? `${j.detail.slice(0, 70)}…` : j.detail}${j.soi ? ` (ซ.${j.soi})` : ""}`,
                  go: ["jobs", j.id],
                })),
              ...(newest > seenAt && !needs.length
                ? ["👥 มีโพสต์ใหม่จากเพื่อนบ้าน"]
                : []),
            ],
            sig:
              needs.length || lostPets.length || homePets.length
                ? `n${needSig}|p${lostPets.map((x) => x.id.slice(0, 6)).join(",")}|h${homePets.map((x) => x.id.slice(0, 6)).join(",")}`
                : `c${newest}`,
          }
        : null,
    map:
      ws.alarm || newIssues.length
        ? {
            level:
              ws.alarm ||
              newIssues.some((x) => x.type === "cover" || x.type === "danger")
                ? "important"
                : "general",
            reasons: [
              ...(ws.alarm
                ? [`💧 ระดับน้ำ: ${ws.text}${ws.sub ? ` · ${ws.sub}` : ""}`]
                : []),
              ...newIssues
                .slice(0, 4)
                .map(
                  (x) =>
                    `${(ISSUE_TYPES[x.type] || ["📍"])[0]} แจ้งใหม่: ${(ISSUE_TYPES[x.type] || ["", "จุดปัญหา"])[1]}${x.soi ? ` ซ.${x.soi}` : ""}`,
                ),
            ],
            sig: `m${ws.alarm ? ws.text : ""}|${newIssues.map((x) => x.id.slice(0, 6)).join(",")}`,
          }
        : null,
  };
  useEffect(() => {
    if (page !== "map" || !issues.length) return;
    const t = Date.now();
    setMapSeen(t);
    save("mapSeen", t);
  }, [page, issues.length]);
  const live = Object.entries(notes).filter(([k, b]) => b && ack[k] !== b.sig);
  // having looked at the community page counts as seen: the dot stays faint until every ask is taken
  const communitySig = notes.community?.sig;
  useEffect(() => {
    if (page !== "community" || !communitySig || ack.community === communitySig)
      return;
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
        onIssue={() => setSheet({ type: "quickReport" })}
        onIssues={() => showTab("issues")}
        onWaste={() => showTab("waste")}
        onElectricians={() => openPros("electric")}
        onPros={(g) => openPros(g)}
        onBadge={onHomeBadge}
        needs={needs}
        lost={lostOpen}
        flood={floodOn}
        floodAlarm={!!ws.alarm}
        onNeeds={(id) => goItem("jobs", id)}
        onAskHelp={() => setSheet({ type: "jobForm", kind: "need" })}
        onLost={(id) => goItem("lost", id)}
        market={marketOpen(lend)}
        onMarket={() => showTab("market")}
        onLostPosted={(x) =>
          setLost((p) => [x, ...p.filter((y) => y.id !== x.id)])
        }
      />
    ),
    announce: (
      <>
        <div className="mb-3 space-y-2 empty:hidden">
          <Announcements items={announcements} />
          <WeatherAlerts
            weather={weather}
            onOpenMap={() => setSheet({ type: "weather" })}
          />
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
            style={
              home.layout?.fund ? lookOf(home.layout, "fund").frame : undefined
            }
            className="mb-3 flex min-h-[52px] items-center gap-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 py-2"
          >
            <span className="text-2xl" aria-hidden="true">
              💰
            </span>
            <span className="min-w-0 flex-1">
              <b>เงินสมทบทีมอาสา · ยอดรับ-จ่ายเปิดให้ทุกคนดู</b>
              <span className="block text-sm text-neutral-700">
                รวบรวมจากกลุ่ม LINE · ได้รับ / ใช้ไป / คงเหลือ
              </span>
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
          <SurveyBoxes
            look={home.layout?.survey ? lookOf(home.layout, "survey") : null}
          />
        </div>
      </>
    ),
    hub: (
      <>
        {home.hub?.on && home.hub.title && (
          <div className="mt-2">
            <HubBox
              hub={home.hub}
              look={home.layout?.hub ? lookOf(home.layout, "hub") : null}
            />
          </div>
        )}
      </>
    ),
    // 17 Oct: shortcuts to what people come for (same words as the LINE menu); the flood archive + credits shrink to one line
    archive: (
      <>
        <section className="mt-3 grid grid-cols-3 gap-2" aria-label="ทางลัด">
          {[
            ["🛍️", "ตลาด", "ของกิน ของใช้ บริการ", () => showTab("market")],
            ["🔧", "ช่าง", "ไฟ ประปา แอร์", () => openPros("")],
            ["♻️", "ขยะ", "วันรถซอยคุณ", () => showTab("waste")],
          ].map(([e, t, h, fn]) => (
            <button
              key={t}
              onClick={fn}
              className="flex min-h-[84px] flex-col items-center justify-center rounded-2xl bg-white px-1 text-center shadow-sm active:bg-[#E4F0E9]"
            >
              <span className="text-3xl" aria-hidden="true">
                {e}
              </span>
              <b className="text-[16px] leading-tight">{t}</b>
              <span className="text-xs text-[#45504A]">{h}</span>
            </button>
          ))}
        </section>
        <p className="mt-4 flex flex-wrap justify-center gap-x-4 text-sm text-neutral-500">
          <a
            href="/flood"
            className="inline-flex min-h-[44px] items-center underline"
          >
            📦 คลังน้ำท่วม ก.ย.–ต.ค. 69
          </a>
          <a
            href="/credits.html"
            className="inline-flex min-h-[44px] items-center underline"
          >
            🎬 End credits ทีมอาสา
          </a>
        </p>
      </>
    ),
  };

  return (
    <TextsContext.Provider value={home.texts || {}}>
      <div className="min-h-screen bg-[#F2F4F1] text-[#15201A]">
        {peek && (
          <div
            key={peek.key}
            className={`peek fixed inset-x-3 bottom-[76px] z-40 mx-auto max-w-md rounded-2xl border-2 bg-white p-2 shadow-xl ${peek.leaving ? "peek-out" : "peek-in"} ${peek.kind === "home" ? "border-[#1E6B47]" : "border-[#E0A100]"}`}
            role="status"
          >
            <div className="flex items-center gap-2">
              {peek.x.media?.[0] ? (
                <img
                  src={mediaUrl(peek.x.media[0].id, "thumb")}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#F2F4F1] text-3xl"
                  aria-hidden="true"
                >
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
                <span
                  className={`block text-sm font-bold ${peek.kind === "home" ? "text-[#154D33]" : "text-[#B42318]"}`}
                >
                  {peek.kind === "home"
                    ? "🎉 เจอแล้ว! กลับบ้านแล้ว"
                    : "🐾 ช่วยกันดู · สัตว์เลี้ยงหาย"}
                </span>
                <span className="line-clamp-2 block text-[15px] font-bold leading-snug">
                  {peek.x.title}
                  {peek.x.soi ? ` (ซ.${peek.x.soi})` : ""}
                </span>
              </button>
              <button
                onClick={closePeek}
                aria-label="ปิด"
                className="min-h-[44px] min-w-[40px] shrink-0 text-[#45504A]"
              >
                ✕
              </button>
            </div>
            <span
              className="peek-timer absolute inset-x-3 bottom-0.5 h-0.5 origin-left rounded-full bg-[#E0A100]"
              aria-hidden="true"
            />
          </div>
        )}
        {/* 9 Oct: เพื่อนบ้าน is read first — the "write" buttons left the top of every tab for one floating button */}
        {page === "community" && !sheet && (
          <button
            onClick={() => setSheet({ type: "postPick" })}
            className={`fixed ${admin ? "bottom-[calc(112px+env(safe-area-inset-bottom))]" : "bottom-[calc(68px+env(safe-area-inset-bottom))]"} right-4 z-[800] flex min-h-[52px] items-center gap-1.5 rounded-full bg-[#1E6B47] px-5 text-base font-bold text-white shadow-[0_4px_14px_rgba(0,0,0,0.3)] active:bg-[#154D33]`}
          >
            ✏️ ลงประกาศ
          </button>
        )}
        {/* the status row at the bottom (water, weather, bell, share); the menu is on top */}
        <header className="fixed inset-x-0 bottom-0 z-[900] bg-[#15201A] pb-[env(safe-area-inset-bottom)] text-white shadow-[0_-2px_8px_rgba(0,0,0,0.25)]">
          {!online && (
            <p className="bg-red-700 px-3 py-1 text-center text-sm font-bold">
              ⚠️ เชื่อมต่อไม่ได้ กำลังลองใหม่
            </p>
          )}
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-2 py-1.5 sm:px-4">
            <button
              onClick={() => goPage("home")}
              aria-label="เสรีไทย 57 · กลับบ้านฉัน"
              className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5"
            >
              <img
                src={`${process.env.PUBLIC_URL}/logo-mark.png`}
                alt=""
                className="h-full w-full object-contain"
              />
            </button>
            {floodOn && (
              <WaterPill water={water} canal={canal} onOpen={openWater} />
            )}
            <WeatherChip
              weather={weather}
              onOpen={() => setSheet({ type: "weather" })}
              viewers={online ? viewers : 0}
            />
            {Object.values(notes).some(Boolean) && (
              <button
                onClick={() => setNotifyOpen(true)}
                aria-label={
                  live.length
                    ? `การแจ้งเตือน ${live.length} เรื่อง`
                    : "การแจ้งเตือน (ล้างแล้ว)"
                }
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
            <button
              onClick={share}
              aria-label="แชร์ลิงก์"
              className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 active:bg-white/20"
            >
              🔗
            </button>
          </div>
          {admin && (
            <div className="border-t border-white/20 bg-neutral-800">
              <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-1 text-sm sm:px-4">
                <span className="font-semibold">
                  🛡️ โหมดผู้ดูแล · {admin.name}
                </span>
                <a
                  href="/admin"
                  className="ml-auto flex min-h-[40px] items-center underline"
                >
                  📢 ประกาศ / ตั้งค่า
                </a>
              </div>
            </div>
          )}
        </header>

        <BottomNav
          page={page}
          badges={Object.fromEntries(
            Object.entries(notes).map(([k, b]) => [
              k,
              b && (ack[k] === b.sig ? "muted" : b.level),
            ]),
          )}
          onGo={(p) =>
            p === "pros"
              ? openPros("")
              : p === "community"
                ? showTab("lost")
                : p === "market"
                  ? showTab("market")
                  : goPage(p)
          }
          onHotline={() => setSheet({ type: "hotlines" })}
        />
        <UrgentBar items={announcements} />
        <main
          key={page}
          className="anim-page mx-auto max-w-5xl px-3 pb-28 pt-3 sm:px-4"
        >
          {page === "home" ? (
            <>
              {ordered(home.layout, Object.keys(blocks)).map((k) => (
                <Fragment key={k}>{blocks[k]}</Fragment>
              ))}

              <footer className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-neutral-500">
                <img
                  src={`${process.env.PUBLIC_URL}/logo.png`}
                  alt="Sahakorn Serithai 57"
                  className="h-28 w-auto"
                />
                {VILLAGE_NAME} · ข้อมูลในหน้านี้มาจากเพื่อนบ้านช่วยกันลง ·
                ระบบไม่รับเงิน ตกลงกันเอง
                {!admin && (
                  <a
                    href="/admin"
                    className="inline-flex min-h-[44px] items-center text-neutral-400 underline"
                  >
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
              <PageTitle
                title="🔧 ช่างซ่อมบ้าน"
                sub={`${prosOnly.length} ราย · คนแนะนำเยอะขึ้นก่อน${hires.length ? ` · มีคนกำลังหาช่าง ${hires.length} เรื่อง (ท้ายหน้า)` : ""}`}
              />
              {/* 7 Oct: everyone (admins too) gets the same list; neighbours looking for a tradesman sit quietly at its end */}
              <ProsList
                key={`${prosGroup}-${prosFocus}-${prosQuery}`}
                query={prosQuery}
                services={prosOnly}
                setServices={setServices}
                group={prosGroup}
                setGroup={setProsGroup}
                autoFocus={prosFocus}
                onAdd={() => setSheet({ type: "serviceForm", mode: "repair" })}
                onHire={() =>
                  setSheet({ type: "jobForm", kind: "need", jobType: "hire" })
                }
              />
              {hires.length > 0 && (
                <section className="mt-4 space-y-2">
                  <h3 className="text-lg font-bold">
                    🧑‍🔧 เพื่อนบ้านกำลังหาช่าง ({hires.length})
                  </h3>
                  <p className="text-[15px] text-[#45504A]">
                    มีค่าจ้าง · เป็นช่าง? กดดูเบอร์ แล้วโทรตกลงราคากันเอง
                  </p>
                  <HireList jobs={hires} setJobs={setJobs} admin={admin} />
                </section>
              )}
              {admin && (
                <details className="mt-4 rounded-xl bg-white p-3">
                  <summary className="min-h-[44px] cursor-pointer font-bold">
                    🛡️ เครื่องมือผู้ดูแล · แก้ ยืนยัน ปักหมุด ลบ ร้าน
                  </summary>
                  <div className="mt-2">
                    <ServiceBoard
                      repair
                      services={services}
                      setServices={setServices}
                      posts={[]}
                      admin={admin}
                      onAdd={() => setSheet({ type: "serviceForm" })}
                      onOpenPost={() => {}}
                    />
                  </div>
                </details>
              )}
            </>
          )}

          {page === "community" && (
            <>
              <PageTitle
                title="เพื่อนบ้านช่วยกัน"
                sub="หาย·เจอ · ขอแรง ยืม ให้ · คุยกัน · แจ้งปัญหาบนแผนที่"
              />
              <nav
                className="sticky top-[64px] z-[40] -mx-3 mb-3 bg-[#F2F4F1]/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4"
                aria-label="เพื่อนบ้าน"
              >
                <div className="grid grid-cols-4 gap-1 rounded-2xl border border-[#E3E7E2] bg-white p-1 shadow-sm">
                  {GROUPS.map(([g, icon, name]) => {
                    const on = groupOf(tab) === g;
                    const n =
                      g === "lost"
                        ? lostOpen.length
                        : g === "help"
                          ? counts.jobs
                          : 0;
                    return (
                      <button
                        key={g}
                        onClick={() =>
                          g === "map"
                            ? goPage("map")
                            : pick(
                                g === "lost"
                                  ? "lost"
                                  : g === "talk"
                                    ? "forum"
                                    : load("helpTab", "jobs"),
                              )
                        }
                        aria-current={on ? "page" : undefined}
                        className={`relative flex min-h-[54px] flex-col items-center justify-center rounded-xl text-[15px] leading-tight transition-colors ${on ? "bg-[#15201A] font-bold text-white" : "text-[#33403A]"}`}
                      >
                        <span className="text-lg" aria-hidden="true">
                          {icon}
                        </span>
                        {name}
                        {n > 0 && (
                          <span
                            className={`absolute right-1.5 top-1 rounded-full px-1.5 text-xs font-bold text-white ${g === "lost" ? "bg-[#B42318]" : "bg-[#1E6B47]"}`}
                          >
                            {n}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </nav>

              <div
                key={groupOf(tab) || tab}
                ref={navRef}
                className="anim-in scroll-mt-36"
              >
                {tab === "lost" && (
                  <>
                    {/* 8 Oct: หาย·เจอ is the reason people keep the app after the flood, so it leads this page */}
                    <LostHero
                      noAdd
                      items={lostOpen}
                      reunited={reunited}
                      onOpen={(id) => goItem("lost", id)}
                      onAll={() =>
                        document
                          .getElementById("lost-board")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          })
                      }
                      onAdd={(kind) => setSheet({ type: "lostForm", kind })}
                      onPets={() => {
                        goPage("home");
                        setTimeout(
                          () => flashTo(document.getElementById("myhome-pets")),
                          450,
                        );
                      }}
                    />
                    <section id="lost-board" className="card scroll-mt-36 p-3">
                      <LostBoard
                        noAdd
                        items={lost}
                        reunited={reunited}
                        setItems={setLost}
                        admin={admin}
                        onAdd={(kind) => setSheet({ type: "lostForm", kind })}
                      />
                    </section>
                  </>
                )}
                {(tab === "jobs" || tab === "lend") && (
                  <>
                    <HelpHero
                      jobs={jobs}
                      lend={lend}
                      onOpen={(t, id) => goItem(t, id)}
                    />
                    <div
                      className="grid grid-cols-2 gap-1 rounded-2xl bg-[#E6EBE7] p-1"
                      role="tablist"
                    >
                      {["jobs", "lend"].map((k) => (
                        <button
                          key={k}
                          role="tab"
                          aria-selected={tab === k}
                          onClick={() => {
                            save("helpTab", k);
                            pick(k);
                          }}
                          className={`min-h-[46px] rounded-xl text-[15px] ${tab === k ? "bg-white font-bold shadow-sm" : "text-[#45504A]"}`}
                        >
                          {MAIN_TABS[k][0]} {MAIN_TABS[k][1]}
                          {counts[k] > 0 ? ` · ${counts[k]}` : ""}
                        </button>
                      ))}
                    </div>
                    <section key={tab} className="card anim-in mt-2 p-3">
                      {tab === "jobs" ? (
                        <JobBoard
                          noAdd
                          jobs={jobs}
                          setJobs={setJobs}
                          admin={admin}
                          onAdd={(kind) => setSheet({ type: "jobForm", kind })}
                          onPaid={() => openPros("")}
                        />
                      ) : (
                        <LendBoard
                          noAdd
                          items={lend}
                          setItems={setLend}
                          admin={admin}
                          onAdd={(kind) => setSheet({ type: "lendForm", kind })}
                        />
                      )}
                    </section>
                  </>
                )}

                {tab === "forum" && (
                  <>
                    <TalkHero
                      onOpen={(id) => {
                        forumGo.openId = id;
                        forumGo.compose = false;
                        forumGo.n += 1;
                        setForumTick((t) => t + 1);
                        setTimeout(
                          () =>
                            document
                              .getElementById("forum-board")
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              }),
                          150,
                        );
                      }}
                    />
                    <section id="forum-board" className="card scroll-mt-36 p-3">
                      <Forum
                        key={forumGo.n}
                        noCompose
                        admin={admin}
                        openId={forumGo.openId || null}
                        startCompose={!!forumGo.compose}
                      />
                    </section>
                  </>
                )}
                {!groupOf(tab) && (
                  <section className="card p-3">
                    {tab === "issues" && (
                      <IssueBoard
                        issues={issues}
                        setIssues={setIssues}
                        admin={admin}
                        onAdd={() => setSheet({ type: "quickReport" })}
                      />
                    )}
                    {tab === "waste" && (
                      <WasteBoard
                        admin={admin}
                        onReportTrash={() => setSheet({ type: "issueForm" })}
                      />
                    )}
                    {tab === "guide" && <AfterFloodGuide />}
                  </section>
                )}
              </div>

              {/* 16 Oct: the ขยะ / ปัญหาซอย cards under every tab are gone (clutter) — ขยะ is a บ้านฉัน tool, ปัญหาซอย is on the map + บ้านฉัน; #waste #issues still open */}
            </>
          )}

          {page === "market" && (
            <>
              <PageTitle
                title="🛍️ ตลาดเพื่อนบ้าน"
                sub="ของกิน · ของใช้ · บริการ · กดดูแล้วโทร·ทักผู้ขายได้เลย"
              />
              <section className="card p-3">
                <Market
                  items={lend}
                  setItems={setLend}
                  admin={admin}
                  shops={shops}
                  setServices={setServices}
                  pros={prosOnly}
                  onPros={(q) => openPros("", false, q)}
                  onAdd={(shelf) =>
                    setSheet({ type: "lendForm", kind: "sell", shelf })
                  }
                  onAddShop={(mode) => setSheet({ type: "serviceForm", mode })}
                  onAsk={() =>
                    setSheet({ type: "jobForm", kind: "need", jobType: "hire" })
                  }
                />
              </section>
            </>
          )}

          {page === "map" && (
            <>
              {/* 9 Oct: the map gets the screen; one line of title, the report button floats on the map */}
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="font-display min-w-0 flex-1 text-xl font-bold">
                  แผนที่หมู่บ้าน
                </h2>
                <span className="shrink-0 text-sm text-[#45504A]">
                  {floodOn
                    ? waterSub(water)
                    : `จุดปัญหา ${openIssues.length} จุด`}
                </span>
              </div>
              {placesNow.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                  {placesNow.map((p) => (
                    <span
                      key={p.id}
                      className={`rounded-full px-3 py-1 text-sm font-bold ${p.state === "on" ? "bg-[#E4F0E9] text-[#154D33]" : "bg-[#FFF3D6] text-[#7A4104]"}`}
                    >
                      {p.emoji} {p.name} ·{" "}
                      {p.state === "on"
                        ? `กำลังมีตอนนี้${p.when ? ` (${p.when})` : ""}`
                        : `อีก ${p.starts_in} นาที`}
                    </span>
                  ))}
                </div>
              )}
              {show3d && (
                <section className="-mx-3 sm:mx-0">
                  <div className="h-[calc(100dvh-236px)] min-h-[360px] border-y border-[#DCE2DD] sm:overflow-hidden sm:rounded-xl sm:border">
                    <Suspense
                      fallback={
                        <p className="grid h-full place-items-center text-neutral-600">
                          กำลังสร้างหมู่บ้านจำลอง… 🏡
                        </p>
                      }
                    >
                      <Map3D
                        key={map3dKey}
                        className="h-full w-full"
                        pins={issuePins}
                        onPin={openIssue}
                        admin={!!admin}
                      >
                        {admin && (
                          <button
                            onClick={() => setEdit3d(true)}
                            className="absolute bottom-[164px] right-3 z-10 flex min-h-[44px] items-center gap-1 rounded-full bg-[#15201A] px-3 text-[15px] font-bold text-white shadow-lg"
                          >
                            🛠️ แก้อาคาร
                          </button>
                        )}
                        <div className="absolute bottom-10 left-2 z-10 flex flex-col items-start gap-1.5">
                          <button
                            onClick={() => setSheet({ type: "issueHistory" })}
                            className="flex min-h-[44px] items-center gap-1 rounded-full border border-[#D5DBD6] bg-white/95 px-3 text-[15px] font-bold shadow"
                          >
                            🕘 ประวัติ
                          </button>
                          <button
                            onClick={() => pickMap("2d")}
                            className="flex min-h-[44px] items-center gap-1 rounded-full border border-[#D5DBD6] bg-white/95 px-3 text-[15px] font-bold shadow"
                          >
                            🗺️ แผนที่ 2D · น้ำ · เสียงตามสาย
                          </button>
                        </div>
                        <button
                          onClick={() => setSheet({ type: "quickReport" })}
                          className="absolute bottom-24 right-3 z-10 flex min-h-[52px] items-center gap-1.5 rounded-full bg-[#1E6B47] px-4 text-base font-bold text-white shadow-lg active:bg-[#154D33]"
                        >
                          📍 แจ้งจุดปัญหา
                        </button>
                      </Map3D>
                    </Suspense>
                  </div>
                </section>
              )}
              {!show3d && (
                <section className="-mx-3 sm:mx-0">
                  <WaterView
                    trips={trips}
                    focus={focus}
                    hubs={hubPins}
                    events={eventsOn}
                    onFocusTrip={(t) =>
                      setFocus({ lat: t.lat, lng: t.lng, t: Date.now() })
                    }
                    water={water}
                    canal={canal}
                    admin={admin}
                    onWater={() => setSheet({ type: "water" })}
                    onCanal={() => setSheet({ type: "canal" })}
                    onLeaks={() => setSheet({ type: "leaks" })}
                    onLeak={(leak) => setSheet({ type: "leak", leak })}
                    onPump={(pump) => setSheet({ type: "pump", pump })}
                    onPumps={() => setSheet({ type: "pumps" })}
                    issues={openIssues}
                    flood={floodOn}
                    onIssue={openIssue}
                    lost={lostOnMap}
                    onLost={openLostFromMap}
                    speaker={speakerOn ? speakerPts : null}
                    places={places}
                    tall
                  >
                    <div className="absolute right-3 top-[60px] z-[650] flex flex-col items-end gap-1">
                      <button
                        onClick={() =>
                          floodOn ? setView3d(true) : pickMap("3d")
                        }
                        className="flex min-h-[44px] items-center gap-1 rounded-full border border-[#D5DBD6] bg-white/95 px-3 text-[15px] font-bold shadow"
                      >
                        🏙️ ดูแบบ 3D
                      </button>
                      <button
                        onClick={() => {
                          setSpeakerOn(!speakerOn);
                          save("speakerLayer", !speakerOn);
                        }}
                        aria-pressed={speakerOn}
                        className={`flex min-h-[44px] items-center gap-1 rounded-full border px-3 text-[15px] font-bold shadow ${speakerOn ? "border-[#15201A] bg-[#15201A] text-white" : "border-[#D5DBD6] bg-white/95"}`}
                      >
                        📢 เสียงตามสาย {speakerOn ? "✓" : ""}
                      </button>
                      {speakerOn && (
                        <span className="rounded-lg bg-white/95 px-2 py-1 text-xs shadow">
                          <span className="text-[#B42318]">■</span> ไม่ได้ยิน ·{" "}
                          <span className="text-[#1E6B47]">■</span> ได้ยินชัด ·{" "}
                          {speakerPts ? `${speakerPts.length} บ้านตอบ` : "…"}
                        </span>
                      )}
                      {speakerOn && (
                        <button
                          onClick={() =>
                            window.dispatchEvent(new Event("speaker:go"))
                          }
                          className="min-h-[40px] rounded-full bg-[#15201A] px-3 text-sm font-bold text-white shadow"
                        >
                          บ้านฉันได้ยินไหม? ตอบ ›
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setSheet({ type: "issueHistory" })}
                      className="absolute right-3 top-3 z-[650] flex min-h-[44px] items-center gap-1 rounded-full border border-[#D5DBD6] bg-white/95 px-3 text-[15px] font-bold shadow"
                    >
                      🕘 ประวัติ
                    </button>
                    <button
                      onClick={() => setSheet({ type: "quickReport" })}
                      className="absolute bottom-24 right-3 z-[650] flex min-h-[52px] items-center gap-1.5 rounded-full bg-[#1E6B47] px-4 text-base font-bold text-white shadow-lg active:bg-[#154D33]"
                    >
                      📍 แจ้งจุดปัญหา
                    </button>
                  </WaterView>
                </section>
              )}
              {edit3d && admin && (
                <Suspense fallback={null}>
                  <div className="fixed inset-0 z-[3000] bg-white">
                    <Map3D
                      edit
                      className="h-full w-full"
                      onClose={() => {
                        setEdit3d(false);
                        setMap3dKey((k) => k + 1); // show the edits on the map page
                      }}
                    />
                  </div>
                </Suspense>
              )}
              {view3d && (
                <Suspense fallback={null}>
                  <div className="fixed inset-0 z-[3000] bg-white">
                    <Map3D
                      className="h-full w-full"
                      onClose={() => setView3d(false)}
                    />
                  </div>
                </Suspense>
              )}
              {!ws.alarm && (
                <FloodTuck
                  on={floodPref}
                  setOn={setFloodPref}
                  className="mb-2"
                />
              )}
            </>
          )}
        </main>

        {notifyOpen && (
          <Sheet title="🔔 การแจ้งเตือน" onClose={() => setNotifyOpen(false)}>
            <div className="space-y-3">
              {[
                ["home", "🏠 บ้านฉัน"],
                ["pros", "🔧 ช่าง · บริการ"],
                ["community", "👥 เพื่อนบ้าน"],
                ["map", "🗺️ แผนที่หมู่บ้าน"],
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
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${b.level === "important" ? "bg-[#B42318] text-white" : "bg-[#1E6B47] text-white"}`}
                        >
                          {muted
                            ? "ล้างแล้ว · ยังค้างอยู่"
                            : b.level === "important"
                              ? "สำคัญ"
                              : "อัปเดต"}
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
                            else if (k === "community")
                              showTab(needs.length ? "jobs" : tab);
                            else goPage(k);
                          }}
                          className="min-h-[44px] flex-1 rounded-xl bg-white text-[15px] font-bold"
                        >
                          ไปดู ›
                        </button>
                        {!muted && (
                          <button
                            onClick={() => clearNotes([k])}
                            className="min-h-[44px] shrink-0 rounded-xl px-3 text-[15px] font-bold text-[#45504A] underline"
                          >
                            ล้าง
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              {live.length > 0 && (
                <button
                  onClick={() => clearNotes(Object.keys(notes))}
                  className="min-h-[52px] w-full rounded-xl border-2 border-[#15201A] text-base font-bold"
                >
                  🔕 ล้างการแจ้งเตือนทั้งหมด
                </button>
              )}
              <p className="text-sm text-[#45504A]">
                ล้างแล้วจะเหลือจุดจางๆ บนปุ่มจนกว่าเรื่องนั้นจะจบ ไม่ต้องรีบ
                ช่วยได้เมื่อสะดวก · ถ้ามีเรื่องใหม่ จะเตือนอีกครั้ง
              </p>
            </div>
          </Sheet>
        )}
        {sheet?.type === "postPick" && (
          <Sheet title="✏️ ลงเรื่องอะไร?" onClose={() => setSheet(null)}>
            {(() => {
              const write = () => setSheet({ type: "topicForm" }); // 9 Oct: a popup — the form below the hero was out of sight
              const groups = [
                [
                  "lost",
                  "🐾 หาย · เจอ",
                  [
                    [
                      "😢",
                      "ของ / สัตว์หาย",
                      "ทั้งหมู่บ้านเห็นรูปทันที",
                      () => setSheet({ type: "lostForm", kind: "lost" }),
                    ],
                    [
                      "🙌",
                      "เจอของ / สัตว์ หาเจ้าของ",
                      "",
                      () => setSheet({ type: "lostForm", kind: "found" }),
                    ],
                    ...(load("petsHave", false)
                      ? []
                      : [
                          [
                            "🐶",
                            "ลงรูปสัตว์เลี้ยงไว้ก่อน",
                            "ถ้าหาย กดปุ่มเดียว",
                            () => {
                              setSheet(null);
                              goPage("home");
                              setTimeout(
                                () =>
                                  flashTo(
                                    document.getElementById("myhome-pets"),
                                  ),
                                450,
                              );
                            },
                          ],
                        ]),
                  ],
                ],
                [
                  "help",
                  "🤝 ช่วยกัน",
                  [
                    [
                      "🙋",
                      "ขอแรง / ขอติดรถ / ฝากซื้อ",
                      "",
                      () => setSheet({ type: "jobForm", kind: "need" }),
                    ],
                    [
                      "💪",
                      "ฉันช่วยได้ / มีรถออกไป",
                      "",
                      () => setSheet({ type: "jobForm", kind: "offer" }),
                    ],
                    ...Object.entries(LEND_KINDS).map(([k, v]) => [
                      v.emoji,
                      v.verb,
                      "",
                      () => setSheet({ type: "lendForm", kind: k }),
                    ]),
                  ],
                ],
                [
                  "talk",
                  "💬 คุยกัน",
                  [
                    [
                      "✍️",
                      "ตั้งกระทู้ถาม / แชร์ความรู้",
                      "",
                      () => write("forum"),
                    ],
                  ],
                ],
              ];
              const here = groupOf(tab);
              return [
                ...groups.filter((g) => g[0] === here),
                ...groups.filter((g) => g[0] !== here),
              ].map(([g, title, opts]) => (
                <div key={g} className="mb-3">
                  <p className="mb-1 px-1 text-sm font-bold text-[#45504A]">
                    {title}
                  </p>
                  <div className="space-y-1.5">
                    {opts.map(([icon, text, sub, go]) => (
                      <button
                        key={text}
                        onClick={go}
                        className="card flex min-h-[56px] w-full items-center gap-3 p-3 text-left active:bg-[#F2F4F1]"
                      >
                        <span className="text-2xl" aria-hidden="true">
                          {icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <b className="block text-[16px] leading-tight">
                            {text}
                          </b>
                          {sub && (
                            <span className="block text-sm text-[#45504A]">
                              {sub}
                            </span>
                          )}
                        </span>
                        <span aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()}
          </Sheet>
        )}
        {sheet?.type === "topicForm" && (
          <Sheet
            title="✍️ ตั้งกระทู้ถาม / แชร์ความรู้"
            onClose={() => setSheet(null)}
          >
            <TopicForm
              onCancel={() => setSheet(null)}
              onDone={(t) => {
                setSheet(null);
                forumGo.openId = t.id;
                forumGo.compose = false;
                forumGo.n += 1;
                setForumTick((n) => n + 1);
                pick("forum");
                setToast("ตั้งกระทู้แล้ว · เพื่อนบ้านจะเข้ามาตอบ");
                setTimeout(
                  () =>
                    document
                      .getElementById("forum-board")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  300,
                );
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "lendForm" && (
          <Sheet
            title={
              sheet.kind === "sell"
                ? sheet.shelf === "food"
                  ? "🍲 ขายของกิน"
                  : sheet.shelf === "goods"
                    ? "🧺 ขายของใช้"
                    : "🛍️ ลงขายของ"
                : "ยืม · ให้ · ขาย"
            }
            onClose={() => setSheet(null)}
          >
            <LendForm
              kind={sheet.kind}
              shelf={sheet.shelf || ""}
              onDone={(x) => {
                setLend((p) => [x, ...p]);
                posted(
                  x.kind === "sell" ? "market" : "lend",
                  `${LEND_KIND_TEXT[x.kind] || "🧰"} ${x.title}${x.price ? ` ${x.price}` : ""}${x.soi ? ` (ซ.${x.soi})` : ""}`,
                );
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "jobForm" && (
          <Sheet
            title={
              sheet.kind === "need"
                ? "🙋 ขอแรงช่วยที่บ้าน"
                : "💪 ลงชื่ออาสาไปช่วย"
            }
            onClose={() => setSheet(null)}
          >
            <JobForm
              kind={sheet.kind}
              jobType={sheet.jobType}
              onDone={(j) => {
                setJobs((p) => [j, ...p]);
                posted(
                  j.type === "hire" ? "pros" : "jobs",
                  `${j.type === "hire" ? "🧑‍🔧 หาช่าง" : j.kind === "need" ? "🙋 ขอแรง" : "💪 ช่วยได้"}: ${j.detail}${j.soi ? ` (ซ.${j.soi})` : ""}`,
                );
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
              <p className="text-base">
                {["dog", "cat", "pet"].includes(sheet.item.category)
                  ? "ขึ้นหน้าแรกของทุกคนในหมู่บ้านแล้ว แบบนี้ 👇"
                  : "อยู่ในหาย · เจอ ของเพื่อนบ้านแล้ว แบบนี้ 👇"}
              </p>
              <LostPreview
                x={sheet.item}
                photo={
                  sheet.item.media?.[0]
                    ? mediaUrl(sheet.item.media[0].id, "thumb")
                    : null
                }
              />
              <InstallApp
                inSheet
                why="ติดตั้งไว้ ถ้ามีคนเห็นแล้วแจ้งมา มือถือจะเด้งบอกคุณทันที"
              />
              <button
                onClick={() => shareLost(sheet.item)}
                className="min-h-[56px] w-full rounded-xl bg-[#06C755] text-lg font-bold text-white"
              >
                📤 ส่งต่อในกลุ่ม LINE (ยิ่งแชร์ ยิ่งเจอเร็ว)
              </button>
              <button
                onClick={() => setSheet(null)}
                className="min-h-[48px] w-full rounded-xl border border-[#C9D1CB] font-bold"
              >
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
                setCanal((c) => ({
                  ...(c || { pumps: [], leaks: [] }),
                  reports: [r, ...((c && c.reports) || [])],
                }));
                setSheet(null);
                setToast("ขอบคุณที่แจ้งระดับคลอง");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "leaks" && (
          <Sheet
            title="🕳️ รูรั่วริมคลอง / เขื่อน"
            onClose={() => setSheet(null)}
          >
            <LeakList
              leaks={canal?.leaks || []}
              onLeak={(leak) => setSheet({ type: "leak", leak })}
              onAdd={() => setSheet({ type: "leakForm" })}
            />
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
                      await api(`/admin/leaks/${l.id}`, {
                        method: "DELETE",
                      }).catch((e) => setToast(e.message));
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
            <PumpList
              pumps={(canal?.pumps || []).filter((x) => x.status !== "removed")}
              onPump={(pump) => setSheet({ type: "pump", pump })}
              admin={!!admin}
            />
          </Sheet>
        )}
        {sheet?.type === "pump" && (
          <Sheet
            title={sheet.pump ? "⚙️ สถานะเครื่องสูบ" : "⚙️ เพิ่มเครื่องสูบ"}
            onClose={() => setSheet(null)}
          >
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
                setCanal((c) => ({
                  ...(c || { reports: [], pumps: [] }),
                  leaks: [l, ...((c && c.leaks) || [])],
                }));
                setSheet(null);
                setToast("แจ้งรูรั่วแล้ว");
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "issueHistory" && (
          <Sheet title="🕘 จุดปัญหาย้อนหลัง" onClose={() => setSheet(null)}>
            <IssueHistory
              onOpen={(x) =>
                setSheet({ type: "issue", issue: x, from: "history" })
              }
            />
          </Sheet>
        )}
        {sheet?.type === "issue" && (
          <Sheet
            title="📍 จุดปัญหา"
            onClose={() =>
              setSheet(
                sheet.from === "history" ? { type: "issueHistory" } : null,
              )
            }
          >
            <ul>
              <IssueCard
                issue={
                  issues.find((y) => y.id === sheet.issue.id) || sheet.issue
                }
                admin={admin}
                onChanged={(x) => {
                  setIssues((p) =>
                    p.some((y) => y.id === x.id)
                      ? p.map((y) => (y.id === x.id ? x : y))
                      : x.status !== "fixed"
                        ? [x, ...p]
                        : p,
                  );
                  setSheet((sh) =>
                    sh?.type === "issue" ? { ...sh, issue: x } : sh,
                  );
                  if (x.status === "fixed") {
                    setSheet(
                      sheet.from === "history"
                        ? { type: "issueHistory" }
                        : null,
                    );
                    setToast("ขอบคุณครับ · เอาหมุดออกจากแผนที่แล้ว");
                  }
                }}
                onDeleted={(id) => {
                  setIssues((p) => p.filter((y) => y.id !== id));
                  setSheet(null);
                }}
              />
            </ul>
            <p className="mt-2 text-sm text-[#45504A]">
              ใครเห็นว่าเคลียร์แล้วกดบอกได้ · ถ้ายังไม่หาย กด “ยังไม่หาย”
              ในหน้าปัญหาซอยได้
            </p>
          </Sheet>
        )}
        {sheet?.type === "quickReport" && (
          <Sheet
            title="📍 แจ้งจุดปัญหาในหมู่บ้าน"
            onClose={() => setSheet(null)}
          >
            <QuickReport
              type={sheet.kind || ""}
              onMore={() => setSheet({ type: "issueForm" })}
              onDone={(x) => {
                setIssues((p) => [x, ...p]);
                setSheet(null);
                goPage("map");
                if (x.lat != null)
                  setFocus({ lat: x.lat, lng: x.lng, t: Date.now() });
                setToast("แจ้งแล้ว · ขึ้นบนแผนที่หมู่บ้านแล้ว ขอบคุณครับ");
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
          <Sheet
            title={
              {
                service: "🙋 ลงบริการ",
                shop: "🏪 ลงร้านในตลาด",
                repair: "🔧 ลงช่าง / แนะนำช่าง",
              }[sheet.mode] ||
              (sheet.prefill?.category ? "🏪 ลงร้านในตลาด" : "แนะนำช่าง / ร้าน")
            }
            onClose={() => setSheet(null)}
          >
            <ServiceForm
              repair
              mode={sheet.mode || ""}
              prefill={sheet.prefill || {}}
              onDone={(s) => {
                setServices((p) => [s, ...p]);
                posted(
                  PRO_CATS.includes(s.category) ? "pros" : "market",
                  `⭐ ${PRO_CATS.includes(s.category) ? "แนะนำช่าง" : "ในตลาด"}: ${s.name}${s.detail ? ` · ${s.detail}` : ""}`,
                );
              }}
            />
          </Sheet>
        )}
        {sheet?.type === "intent" && (
          <Sheet
            title={sheet.need ? "ขอความช่วยเหลือ" : "แนะนำ / ให้ / ขาย"}
            onClose={() => setSheet(null)}
          >
            <IntentChoices
              need={sheet.need}
              choices={sheet.need ? NEED_CHOICES : OFFER_CHOICES}
              onPick={go}
            />
          </Sheet>
        )}
        {sheet?.type === "join" && (
          <Sheet
            title={
              sheet.job.kind === "need"
                ? "ไปช่วยเพื่อนบ้าน"
                : "ขอให้มาช่วยบ้านฉัน"
            }
            onClose={() => setSheet(null)}
          >
            <JoinSheetBody
              job={sheet.job}
              onJoined={(j) =>
                setJobs((p) => p.map((x) => (x.id === j.id ? j : x)))
              }
              onClose={() => setSheet(null)}
            />
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
                        <a
                          href={`tel:${num.replace(/\D/g, "")}`}
                          className="flex min-h-[56px] flex-wrap items-center gap-x-3 rounded-xl border border-neutral-200 px-4 py-2 active:bg-neutral-50"
                        >
                          <span className="text-xl font-bold tabular-nums text-red-700">
                            📞 {num}
                          </span>
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
  return w
    ? `แจ้งล่าสุด ${timeAgo(w.created_at)}${w.soi ? ` · ซ.${w.soi}` : ""} · คลอง เครื่องสูบ รถอาสา`
    : "ระดับน้ำที่เพื่อนบ้านแจ้ง · คลอง · เครื่องสูบ · รถอาสา";
}

const LEND_KIND_TEXT = {
  lend: "มีของให้ยืม:",
  give: "มีของให้ฟรี:",
  want: "ตามหา / อยากได้:",
  sell: "ขาย:",
};

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
          <h2 className="break-words text-lg font-bold leading-snug">
            {ev.title}
          </h2>
          {ev.when && (
            <p className="font-semibold text-red-700">🕘 {ev.when}</p>
          )}
          {ev.sub && <p className="text-sm text-neutral-700">{ev.sub}</p>}
        </div>
      </div>
      <MediaStrip media={ev.media || []} size={88} />
      {ev.items?.length > 0 && (
        <ol className="mt-2 space-y-1.5">
          {ev.items.map((t, i) => (
            <li
              key={i}
              className="flex gap-2 rounded-lg bg-white px-2 py-1.5 text-[15px] leading-snug"
            >
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
              <a
                href="/cleanup"
                className="mt-2 block text-center text-sm underline"
              >
                เปิดแผนเต็มจอ ↗
              </a>
            </div>
          )}
        </>
      ) : (
        ev.link && (
          <a
            href={ev.link}
            className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-center text-lg font-bold text-white"
          >
            {ev.link_label || "ดูรายละเอียด ›"}
          </a>
        )
      )}
      {linked && (
        <button
          onClick={onMap}
          className="mt-2 min-h-[44px] w-full rounded-lg border-2 border-red-600 bg-white font-semibold text-red-800"
        >
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
        {hub.sub && (
          <span className="block text-sm text-neutral-700">{hub.sub}</span>
        )}
      </span>
    </>
  );
  const cls =
    "mb-3 flex min-h-[56px] items-center gap-3 rounded-xl border-4 border-yellow-400 bg-yellow-50 px-3 py-2";
  const style = look?.frame;
  return hub.lat != null && hub.lng != null ? (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${hub.lat},${hub.lng}`}
      target="_blank"
      rel="noreferrer"
      className={cls}
      style={style}
    >
      {body}
      <span className="shrink-0 font-semibold underline">นำทาง ›</span>
    </a>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}
