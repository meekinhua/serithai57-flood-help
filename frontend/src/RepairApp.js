import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { API, api, load, save, viewerId } from "./api";
import { HOTLINE_GROUPS, JOB_TYPES, VILLAGE_NAME, timeAgo } from "./config";
import Sheet from "./components/Sheet";
import Announcements from "./components/Announcements";
import { WeatherAlerts, WeatherTopBar, WindyMap } from "./components/Weather";
import { ServiceBoard, ServiceForm } from "./components/ServiceBoard";
import WasteBoard from "./components/WasteBoard";
import SurveyBoxes from "./components/SurveyBox";
import RecoveryStart from "./components/RecoveryStart";
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
const MAIN_TABS = {
  start: ["🏠", "ฟื้นฟูบ้าน"],
  pros: ["🔧", "ช่าง · ร้าน"],
  lend: ["🧰", "ยืม · ให้ยืม"],
  jobs: ["🙋", "ขอแรง"],
  waste: ["♻️", "ขยะ · รถเก็บ"],
  forum: ["💬", "ถาม-ตอบ"],
};
const MORE_TABS = {
  guide: ["📋", "เช็กลิสต์"],
  issues: ["📍", "ปัญหาซอย"],
  lost: ["🐾", "หาย · เจอ"],
  water: ["💧", "ระดับน้ำ · แผนที่"],
};
const TABS = { ...MAIN_TABS, ...MORE_TABS };

export default function RepairApp() {
  const [tab, setTab] = useState(() => (TABS[window.location.hash.slice(1)] ? window.location.hash.slice(1) : load("repairTab2", "start")));
  const [lend, setLend] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [issues, setIssues] = useState([]);
  const [lost, setLost] = useState([]);
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
    save("repairTab2", t);
    window.history.replaceState(null, "", `#${t}`);
  };
  const navRef = useRef(null);
  const openWater = () => {
    pick("water");
    setTimeout(() => navRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  useEffect(() => {
    document.title = "ซ่อมบ้าน เสรีไทย 57";
    const onHash = () => TABS[window.location.hash.slice(1)] && setTab(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(async () => {
    if (document.visibilityState === "visible")
      api("/presence", { method: "POST", body: JSON.stringify({ id: viewerId() }) })
        .then((r) => setViewers(r.online))
        .catch(() => {});
    try {
      const [l, j, i, s, a, lf, w, cn, hm] = await Promise.all([
        api("/lend"),
        api("/jobs"),
        api("/issues"),
        api("/services"),
        api("/announcements"),
        api("/lost"),
        api("/water").catch(() => []),
        api("/canal").catch(() => null),
        api("/home").catch(() => null),
      ]);
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
    const loadTrips = () => document.visibilityState === "visible" && api("/trips").then(setTrips).catch(() => {});
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
    api("/weather").then(setWeather).catch(() => {});
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
    () => (home.hub?.on && home.hub.lat != null ? [{ ...home.hub, tag: "ศูนย์อาสา", place: (home.hub.title || "").split(":").pop().trim().slice(0, 24) }] : []),
    [home]
  );

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

  return (
    <div className="min-h-screen bg-stone-100 text-neutral-900">
      <header className="sticky top-0 z-[900] bg-black text-white shadow">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2 sm:px-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white min-[400px]:flex">
            <img src={`${process.env.PUBLIC_URL}/logo-mark.png`} alt="Sahakorn Serithai 57" className="h-full w-full object-contain" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold sm:text-xl">ซ่อมบ้าน เสรีไทย 57</h1>
            <p className="truncate text-xs text-neutral-400 sm:text-sm">
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
          <button onClick={() => setSheet({ type: "hotlines" })} aria-label="เบอร์สำคัญ" className="min-h-[44px] shrink-0 rounded-lg bg-red-600 px-3 font-semibold active:bg-red-700">
            ☎️
          </button>
          <button onClick={share} aria-label="แชร์" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/10 px-3 active:bg-white/20">
            🔗
          </button>
        </div>
        <WeatherTopBar weather={weather} onOpen={() => setSheet({ type: "weather" })} />
        {admin && (
          <div className="border-t border-white/20 bg-neutral-800">
            <div className="mx-auto flex max-w-5xl items-center gap-3 px-3 py-1 text-sm sm:px-4">
              <span className="font-semibold">🛡️ โหมดผู้ดูแล · {admin.name}</span>
              <a href="/admin" className="ml-auto flex min-h-[40px] items-center underline">📢 ประกาศ / ตั้งค่า</a>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-3 pb-10 pt-3 sm:px-4">
        {eventsOn.map((e, i) => (
          <EventBox
            key={i}
            ev={e}
            onMap={() => {
              if (e.tab && TABS[e.tab]) return pick(e.tab);
              const [lat, lng] = eventSpot(e);
              setFocus({ lat, lng, t: Date.now() });
              pick("water");
            }}
          />
        ))}
        <SurveyBoxes />
        <div className="mb-3 space-y-2 empty:hidden">
          <Announcements items={announcements} />
          <WeatherAlerts weather={weather} onOpenMap={() => setSheet({ type: "weather" })} />
        </div>

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

        {home.fund_on && <a href="/fund" className="mb-3 flex min-h-[52px] items-center gap-3 rounded-xl border-2 border-emerald-600 bg-emerald-50 px-3 py-2">
          <span className="text-2xl" aria-hidden="true">💰</span>
          <span className="min-w-0 flex-1">
            <b>เงินสมทบทีมอาสา · ยอดรับ-จ่ายเปิดให้ทุกคนดู</b>
            <span className="block text-sm text-neutral-700">รวบรวมจากกลุ่ม LINE · ได้รับ / ใช้ไป / คงเหลือ</span>
          </span>
          <span className="shrink-0 font-semibold underline">ดู ›</span>
        </a>}

        <nav ref={navRef} className="scroll-mt-28 grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-sm sm:grid-cols-6" aria-label="หมวด">
          {Object.entries(MAIN_TABS).map(([k, [emoji, text]]) => (
            <button
              key={k}
              onClick={() => pick(k)}
              aria-current={tab === k ? "page" : undefined}
              className={`relative flex min-h-[60px] flex-col items-center justify-center rounded-xl px-1 text-center text-xs font-semibold leading-tight sm:text-sm ${tab === k ? "bg-black text-white" : "text-neutral-700 active:bg-neutral-100"}`}
            >
              <span className="text-2xl" aria-hidden="true">{emoji}</span>
              {text}
              {counts[k] > 0 && (
                <span className={`absolute right-1 top-1 rounded-full px-1.5 text-[10px] ${tab === k ? "bg-white text-black" : "bg-black text-white"}`}>{counts[k]}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-1 flex flex-wrap items-center gap-1 px-1 text-sm" aria-label="หมวดอื่นๆ">
          <span className="text-neutral-500">อื่นๆ:</span>
          {Object.entries(MORE_TABS).map(([k, [emoji, text]]) => (
            <button
              key={k}
              onClick={() => pick(k)}
              aria-current={tab === k ? "page" : undefined}
              className={`min-h-[36px] rounded-full px-3 ${tab === k ? "bg-black text-white" : "bg-white text-neutral-700 active:bg-neutral-100"}`}
            >
              <span aria-hidden="true">{emoji}</span> {text}
              {counts[k] > 0 && <span className="ml-1 text-xs text-neutral-500">({counts[k]})</span>}
            </button>
          ))}
        </div>

        <div className="mt-3">
          {tab === "water" && (
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
          )}
          {tab === "start" && (
            <RecoveryStart
              counts={counts}
              onTab={pick}
              onJob={(jobType) => setSheet({ type: "jobForm", kind: "need", jobType })}
              onLend={(kind) => setSheet({ type: "lendForm", kind })}
              onIssue={() => setSheet({ type: "issueForm" })}
            />
          )}
          {tab === "forum" && <Forum admin={admin} />}
          {tab === "lend" && <LendBoard items={lend} setItems={setLend} admin={admin} onAdd={(kind) => setSheet({ type: "lendForm", kind })} />}
          {tab === "jobs" && <JobBoard jobs={jobs} setJobs={setJobs} admin={admin} onAdd={(kind) => setSheet({ type: "jobForm", kind })} />}
          {tab === "pros" && <HireStrip jobs={jobs} onOpen={() => pick("jobs")} onAdd={() => setSheet({ type: "jobForm", kind: "need", jobType: "hire" })} />}
          {tab === "lost" && <LostBoard items={lost} setItems={setLost} admin={admin} onAdd={(kind) => setSheet({ type: "lostForm", kind })} />}
          {tab === "pros" && (
            <div className="rounded-xl bg-white p-3">
              <ServiceBoard repair services={services} setServices={setServices} posts={[]} admin={admin} onAdd={() => setSheet({ type: "serviceForm" })} onOpenPost={() => {}} />
            </div>
          )}
          {tab === "issues" && <IssueBoard issues={issues} setIssues={setIssues} admin={admin} onAdd={() => setSheet({ type: "issueForm" })} />}
          {tab === "waste" && <WasteBoard admin={admin} onReportTrash={() => setSheet({ type: "issueForm" })} />}
          {tab === "guide" && <AfterFloodGuide />}
        </div>

        {home.hub?.on && home.hub.title && (
          <div className="mt-8">
            <HubBox hub={home.hub} />
          </div>
        )}
        <section className="mt-3 grid gap-2 sm:grid-cols-2">
          <a href="/flood" className="flex min-h-[64px] items-center gap-3 rounded-xl border-2 border-neutral-400 bg-white px-3 py-2">
            <span className="text-2xl" aria-hidden="true">📦</span>
            <span>
              <b>คลังภารกิจน้ำท่วม ก.ย.–ต.ค. 2569</b>
              <span className="block text-sm text-neutral-600">แผนที่ คำขอ ระดับน้ำ ย้อนหลัง · ดูอย่างเดียว</span>
            </span>
          </a>
          <a href="/credits.html" className="flex min-h-[64px] items-center gap-3 rounded-xl bg-[#0b1622] px-3 py-2 text-white">
            <span className="text-2xl" aria-hidden="true">🎬</span>
            <span>
              <b>End credits ทีมอาสา</b>
              <span className="block text-sm text-[#f2b872]">ขอบคุณทุกคน ทุกร้าน ทุกหน่วยงาน · เปิดเสียง</span>
            </span>
          </a>
        </section>

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

      {sheet?.type === "lendForm" && (
        <Sheet title="🧰 ลงของ ยืม · ให้ยืม · ให้ฟรี" onClose={() => setSheet(null)}>
          <LendForm
            kind={sheet.kind}
            onDone={(x) => {
              setLend((p) => [x, ...p]);
              setSheet(null);
              pick("lend");
              setToast("ลงรายการแล้ว · จัดการคิว/ปิดรายการได้จากเครื่องนี้");
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
              setSheet(null);
              pick("jobs");
              setToast("ลงแล้ว ทุกคนเห็นแล้ว");
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
        <Sheet title="🔧 ลงชื่อช่าง / ร้าน" onClose={() => setSheet(null)}>
          <ServiceForm
            repair
            onDone={(s) => {
              setServices((p) => [s, ...p]);
              setSheet(null);
              setToast("ลงชื่อแล้ว เพื่อนบ้านโทรหาได้ทันที");
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
            {[...HOTLINE_GROUPS, { title: "🏛️ หลังน้ำลด", items: [["1555", "กทม. · แจ้งขยะ ถนน ไฟถนน"], ["1323", "สายด่วนสุขภาพจิต"], ["1130", "การไฟฟ้านครหลวง"]] }].map((group) => (
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
        <div key={toast} role="status" className="anim-toast pointer-events-none fixed inset-x-3 top-16 z-[1100] mx-auto max-w-md rounded-xl bg-neutral-900 px-4 py-3 text-center text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// Neighbours looking for a tradesman right now (jobs of type "hire"), shown above the contact board
function HireStrip({ jobs, onOpen, onAdd }) {
  const hires = jobs.filter((j) => j.type === "hire" && j.status !== "done");
  return (
    <section className="mb-3 rounded-xl border-2 border-black bg-yellow-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 flex-1 font-bold">
          {JOB_TYPES.hire[0]} เพื่อนบ้านกำลังหาช่าง ({hires.length})
          <span className="block text-sm font-normal text-neutral-600">ช่างที่ว่าง ดูแล้วติดต่อรับงานได้เลย</span>
        </h3>
        <button onClick={onAdd} className="min-h-[44px] rounded-lg bg-black px-3 font-semibold text-white">➕ ฉันหาช่าง</button>
      </div>
      {hires.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hires.slice(0, 5).map((j) => (
            <li key={j.id}>
              <button onClick={onOpen} className="w-full rounded-lg bg-white p-2 text-left text-sm shadow-sm">
                <b>{j.soi ? `ซ.${j.soi} · ` : ""}{j.detail}</b>
                <span className="block text-xs text-neutral-500">{j.name} · {timeAgo(j.created_at)}{j.when && ` · ${j.when}`}</span>
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
        <span className="pt-1 text-3xl" aria-hidden="true">{ev.icon || "🧱"}</span>
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
          <button onClick={() => { setPlanMounted(true); setPlan((o) => !o); }} aria-expanded={plan} className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-3 text-center text-lg font-bold text-white">
            {plan ? "▲ ซ่อนแผนรถ" : ev.link_label || "🗺️ ดูแผนรถตามโซน ▼"}
          </button>
          {planMounted && (
            <div className="mt-2" hidden={!plan}>
              <CleanupPlan embedded />
              <a href="/cleanup" className="mt-2 block text-center text-sm underline">เปิดแผนเต็มจอ ↗</a>
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
function HubBox({ hub }) {
  const body = (
    <>
      <span className="text-2xl" aria-hidden="true">📍</span>
      <span className="min-w-0 flex-1">
        <b className="break-words">{hub.title}</b>
        {hub.sub && <span className="block text-sm text-neutral-700">{hub.sub}</span>}
      </span>
    </>
  );
  const cls = "mb-3 flex min-h-[56px] items-center gap-3 rounded-xl border-4 border-yellow-400 bg-yellow-50 px-3 py-2";
  return hub.lat != null && hub.lng != null ? (
    <a href={`https://www.google.com/maps/search/?api=1&query=${hub.lat},${hub.lng}`} target="_blank" rel="noreferrer" className={cls}>
      {body}
      <span className="shrink-0 font-semibold underline">นำทาง ›</span>
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
