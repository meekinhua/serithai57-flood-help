import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, load, save, viewerId } from "./api";
import { HOTLINE_GROUPS, JOB_TYPES, VILLAGE_NAME, timeAgo } from "./config";
import Sheet from "./components/Sheet";
import Announcements from "./components/Announcements";
import { WeatherAlerts, WeatherTopBar, WindyMap } from "./components/Weather";
import { ServiceBoard, ServiceForm } from "./components/ServiceBoard";
import WasteBoard from "./components/WasteBoard";
import { lookOf, ordered } from "./components/Look";
import { TextsContext } from "./components/Texts";
import MyHome from "./components/MyHome";
import SurveyBoxes from "./components/SurveyBox";
import { BottomNav, CommunityFeed, CommunityIntro, FoldBox, IntentChoices, JoinSheetBody, NEED_CHOICES, OFFER_CHOICES, PeopleIcon, PostedSheetBody, ProsList, WaterIcon } from "./components/Community";
import { CleanupPlan } from "./components/CleanupPage";
import Forum from "./components/Forum";
import WatchPanel, { WaterPill, WaterView } from "./components/WatchPanel";
import { LostBoard, LostForm } from "./components/LostFound";
import { WaterForm } from "./components/Forms";
import { CanalForm, LeakForm, LeakList, LeakSheet, PumpForm, PumpList } from "./components/Canal";
import { AfterFloodGuide, IssueBoard, IssueForm, JobBoard, JobForm, LendBoard, LendForm } from "./components/RepairBoards";

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
  feed: ["📰", "ล่าสุด"],
  jobs: ["🙋", "ขอแรง"],
  pros: ["🔧", "ช่าง · ร้าน"],
  lend: ["🧰", "ยืม · ซื้อขาย"],
  forum: ["💬", "ถาม-ตอบ"],
};
const MORE_TABS = {
  waste: ["♻️", "ขยะ · รถเก็บ"],
  guide: ["📋", "เช็กลิสต์หลังน้ำลด"],
  issues: ["📍", "ปัญหาซอย"],
  lost: ["🐾", "หาย · เจอ"],
};
const TABS = { ...MAIN_TABS, ...MORE_TABS };

export default function RepairApp() {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1);
    const saved = load("repairTab3", "feed");
    return TABS[h] ? h : TABS[saved] ? saved : "feed"; // a tab that no longer exists (e.g. "water") falls back to the feed
  });
  const [lend, setLend] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [issues, setIssues] = useState([]);
  const [lost, setLost] = useState([]);
  const [topics, setTopics] = useState([]);
  const [prosGroup, setProsGroup] = useState("");
  const [forumGo, setForumGo] = useState({ n: 0 }); // feed / "ask" door → open a topic or the form
  const [water, setWater] = useState([]);
  const [canal, setCanal] = useState(null);
  // highlight boxes (water watch, volunteer hand-out point): admins switch them on /admin, no redeploy
  const [home, setHome] = useState(() => load("homeBlocks", { watch_on: true, watch_title: "", hub: { on: false } }));
  const [services, setServices] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [weather, setWeather] = useState(null);
  const [admin, setAdmin] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [toast, setToast] = useState("");
  const [online, setOnline] = useState(true);
  const [viewers, setViewers] = useState(null);
  const [trips, setTrips] = useState([]); // helpers' boats / trucks / staff on duty, live
  const [focus, setFocus] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  const pick = (t) => {
    setTab(t);
    save("repairTab3", t);
    window.history.replaceState(null, "", `#${t}`);
  };
  const navRef = useRef(null);
  // home blocks that fold like the ⚡ box; each phone remembers open / closed
  const waterRef = useRef(null);
  const [waterOpenRaw, setWaterOpenRaw] = useState(() => (window.location.hash === "#water" ? true : load("waterBoxOpen", null)));
  const [commOpenRaw, setCommOpenRaw] = useState(() => load("communityBoxOpen", null));
  const waterOpen = waterOpenRaw ?? home.layout?.water?.open ?? false;
  const commOpen = commOpenRaw ?? home.layout?.community?.open ?? true;
  const setWaterOpen = (v) => {
    setWaterOpenRaw(v);
    save("waterBoxOpen", v);
  };
  const setCommOpen = (v) => {
    setCommOpenRaw(v);
    save("communityBoxOpen", v);
  };
  const showTab = (t) => {
    setCommOpen(true);
    pick(t);
    setTimeout(() => navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
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
  const posted = (tab, text) => {
    pick(tab);
    setSheet({ type: "posted", text });
  };
  const openWater = () => {
    setWaterOpen(true);
    setTimeout(() => waterRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  useEffect(() => {
    document.title = "ซ่อมบ้าน เสรีไทย 57";
    const onHash = () => {
      const h = window.location.hash.slice(1);
      if (h === "water") return setWaterOpenRaw(true);
      if (TABS[h]) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
        api("/lost"),
        api("/water").catch(() => []),
        api("/canal").catch(() => null),
        api("/home").catch(() => null),
        api("/forum").catch(() => null),
      ]);
      if (ft) setTopics(ft);
      setLost(lf);
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
      setUpdatedAt(new Date());
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

  async function share() {
    const url = window.location.origin;
    const text = `ซ่อมบ้าน เสรีไทย 57 — ยืม/ให้ยืมของ · ขอแรงช่วยล้างบ้าน · ช่างที่เพื่อนบ้านแนะนำ · แจ้งปัญหาในซอย`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "ซ่อมบ้าน เสรีไทย 57", text, url });
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
              if (e.tab && TABS[e.tab]) return pick(e.tab);
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
        onElectricians={() => {
          setProsGroup("electric");
          showTab("pros");
        }}
        onPros={(g) => {
          setProsGroup(g);
          showTab("pros");
        }}
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
    water: (
      <>
        <FoldBox
          boxRef={waterRef}
          look={lookOf(home.layout, "water")}
          icon={WaterIcon}
          title="ระดับน้ำ · แผนที่หมู่บ้าน"
          sub={waterSub(water)}
          open={waterOpen}
          onToggle={() => setWaterOpen(!waterOpen)}
        >
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
        </FoldBox>
      </>
    ),
    community: (
      <>
        {home.tabs_on && (
          <FoldBox
            look={lookOf(home.layout, "community")}
            icon={PeopleIcon}
            title="เพื่อนบ้านช่วยกัน"
            sub="เบอร์ช่างที่ใช้แล้วดี · ขอแรง · ยืม ซื้อขาย · ถามกัน"
            open={commOpen}
            onToggle={() => setCommOpen(!commOpen)}
          >
            <CommunityIntro
              services={services}
              onGroup={(g) => {
                setProsGroup(g);
                showTab("pros");
              }}
              onAll={() => {
                setProsGroup("");
                showTab("pros");
              }}
              onNeed={() => setSheet({ type: "intent", need: true })}
              onOffer={() => setSheet({ type: "intent", need: false })}
              onAsk={() => askForum()}
            />
            <nav ref={navRef} className="-mx-4 mt-5 scroll-mt-28 overflow-x-auto border-t border-[#E6EBE7] px-4 pt-4" aria-label="หมวด">
              <div className="flex w-max gap-2">
                {Object.entries(MAIN_TABS).map(([k, [, text]]) => (
                  <button
                    key={k}
                    onClick={() => pick(k)}
                    aria-current={tab === k ? "page" : undefined}
                    className={`min-h-[44px] whitespace-nowrap rounded-full px-4 text-[15px] ${tab === k ? "bg-[#15201A] font-bold text-white" : "border border-[#C9D1CB] bg-white"}`}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </nav>

            <div className="mt-3">
              {tab === "feed" && (
                <CommunityFeed
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
              {tab === "jobs" && <JobBoard jobs={jobs} setJobs={setJobs} admin={admin} onAdd={(kind) => setSheet({ type: "jobForm", kind })} />}
              {tab === "pros" && admin && <HireStrip jobs={jobs} onOpen={() => pick("jobs")} onAdd={() => setSheet({ type: "jobForm", kind: "need", jobType: "hire" })} />}
              {tab === "lost" && <LostBoard items={lost} setItems={setLost} admin={admin} onAdd={(kind) => setSheet({ type: "lostForm", kind })} />}
              {tab === "pros" && !admin && <ProsList services={services} setServices={setServices} group={prosGroup} setGroup={setProsGroup} onAdd={() => setSheet({ type: "serviceForm" })} />}
              {tab === "pros" && admin && (
                <div className="rounded-xl bg-white p-3">
                  <ServiceBoard repair services={services} setServices={setServices} posts={[]} admin={admin} onAdd={() => setSheet({ type: "serviceForm" })} onOpenPost={() => {}} />
                </div>
              )}
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
          </FoldBox>
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
        <header className="sticky top-0 z-[900] bg-[#15201A] text-white shadow">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:px-4">
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white min-[400px]:flex">
              <img src={`${process.env.PUBLIC_URL}/logo-mark.png`} alt="Sahakorn Serithai 57" className="h-full w-full object-contain" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display truncate text-xl font-bold">เสรีไทย 57</h1>
              <p className="truncate text-sm text-[#C5D1CA]">
                {online && viewers != null && (
                  <span className="mr-1 font-semibold text-emerald-400">
                    <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" aria-hidden="true" />
                    {viewers.toLocaleString("th-TH")} คนกำลังดู ·{" "}
                  </span>
                )}
                {online ? `อัปเดต ${updatedAt ? timeAgo(updatedAt) : "…"}` : "⚠️ เชื่อมต่อไม่ได้ กำลังลองใหม่"}
              </p>
            </div>
            <WaterPill water={water} canal={canal} onOpen={openWater} />
            <button onClick={share} aria-label="แชร์" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 active:bg-white/20">
              🔗
            </button>
          </div>
          <WeatherTopBar weather={weather} onOpen={() => setSheet({ type: "weather" })} />
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

        <main className="mx-auto max-w-5xl px-3 pb-28 pt-3 sm:px-4">
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
        </main>
        <BottomNav
          onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          onPros={() => {
            setProsGroup("");
            showTab("pros");
          }}
          onMap={openWater}
          onHotline={() => setSheet({ type: "hotlines" })}
        />

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
                posted("jobs", `${j.kind === "need" ? "🙋 ขอแรง" : "💪 ช่วยได้"}: ${j.detail}${j.soi ? ` (ซ.${j.soi})` : ""}`);
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
                setSheet(null);
                pick("lost");
                setToast("ลงประกาศแล้ว เพื่อนบ้านช่วยกันดู");
              }}
            />
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
            className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg"
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

// Neighbours looking for a tradesman right now (jobs of type "hire"), shown above the contact board
function HireStrip({ jobs, onOpen, onAdd }) {
  const hires = jobs.filter((j) => j.type === "hire" && j.status !== "done");
  return (
    <section className="mb-3 rounded-xl border-2 border-black bg-yellow-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 font-bold">
          {JOB_TYPES.hire[0]} เพื่อนบ้านกำลังหาช่าง ({hires.length})<span className="block text-sm font-normal text-neutral-600">ช่างที่ว่าง ดูแล้วติดต่อรับงานได้เลย</span>
        </h3>
        <button onClick={onAdd} className="min-h-[44px] rounded-lg bg-black px-3 font-semibold text-white">
          ➕ ฉันหาช่าง
        </button>
      </div>
      {hires.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hires.slice(0, 5).map((j) => (
            <li key={j.id}>
              <button onClick={onOpen} className="w-full rounded-lg bg-white p-2 text-left text-sm shadow-sm">
                <b>
                  {j.soi ? `ซ.${j.soi} · ` : ""}
                  {j.detail}
                </b>
                <span className="block text-xs text-neutral-500">
                  {j.name} · {timeAgo(j.created_at)}
                  {j.when && ` · ${j.when}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
