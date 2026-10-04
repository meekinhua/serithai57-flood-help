// Worklist for the electricians who check flooded houses (5–7 Oct 2026).
// Opened with the private link /tech#tk=<key> (it shows residents' phone numbers). Each technician types a name once;
// "รับงาน" / "เสร็จ" / "ไม่อยู่บ้าน" are recorded with that name and the time, so several technicians can split the
// village by zone, walk soi by soi, and the team can see how many houses are done.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { createBaseMap } from "./MapView";

const SURVEY = "electric";
const STATUS = {
  todo: { label: "ยังไม่ตรวจ", color: "#dc2626", chip: "bg-red-100 text-red-800" },
  claimed: { label: "รับงานแล้ว", color: "#f59e0b", chip: "bg-amber-100 text-amber-900" },
  done: { label: "ตรวจเสร็จ", color: "#16a34a", chip: "bg-emerald-100 text-emerald-900" },
  absent: { label: "ไม่อยู่บ้าน", color: "#6b7280", chip: "bg-neutral-200 text-neutral-800" },
  again: { label: "ต้องกลับมาอีก", color: "#7c3aed", chip: "bg-violet-100 text-violet-900" },
};
// signs of a live fault: these houses go first
const URGENT = /ร้อน|ไหม้|ช็อต|ช๊อต|ไฟดูด|ไฟรั่ว|ไม่มีไฟ|ยกไม่ขึ้น|on breaker ไม่ได้|ประกาย|ควัน/;

function techKey() {
  const m = window.location.hash.match(/[#&]tk=([A-Za-z0-9_-]{12,})/);
  if (m) {
    save("techKey", m[1]);
    window.history.replaceState(null, "", window.location.pathname);
  }
  return load("techKey", "");
}

function tapi(path, options = {}) {
  const name = load("techName", "");
  return api(path, { ...options, headers: { "X-Tech-Key": load("techKey", ""), ...(name ? { "X-Tech-Name": encodeURIComponent(name.slice(0, 40)) } : {}), ...options.headers } });
}

const statusOf = (r) => r.job?.status || "todo";
const mainSoi = (soi) => (String(soi || "").match(/\d+/) || [""])[0];
const isUrgent = (r) => URGENT.test(`${(r.picks || []).join(" ")} ${r.note || ""}`) || (r.picks || []).includes("ไฟรั่ว / ไฟดูด");
const time = (iso) => (iso ? new Date(iso).toLocaleString("th-TH", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "");

export default function TechPage() {
  const [key] = useState(techKey);
  const [me, setMe] = useState(() => load("techName", ""));
  const [nameDraft, setNameDraft] = useState(me);
  const [rows, setRows] = useState(null);
  const [zones, setZones] = useState(null);
  const [err, setErr] = useState("");
  const [show, setShow] = useState(() => load("techShow", "open")); // open | mine | done | all
  const [zone, setZone] = useState(() => load("techZone", ""));
  const [soi, setSoi] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    document.title = "งานช่างไฟ · เสรีไทย 57";
    api("/zones").then(setZones).catch(() => {});
  }, []);

  const refresh = () =>
    tapi(`/tech/${SURVEY}/jobs`)
      .then((r) => {
        setRows(r);
        setErr("");
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    if (!key) return;
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const soiZone = zones?.soi_zone || {};
  const zoneOf = (r) => soiZone[mainSoi(r.soi)] || "?";

  async function setStatus(r, status, note = "") {
    setBusy(r.house);
    try {
      const res = await tapi(`/tech/${SURVEY}/jobs`, { method: "POST", body: JSON.stringify({ house: r.house, status, note }) });
      setRows((rs) => rs.map((x) => (x.house === r.house ? { ...x, job: res.job } : x)));
    } catch (e) {
      setErr(e.message);
    }
    setBusy("");
  }

  const counts = useMemo(() => {
    const c = { all: 0, todo: 0, claimed: 0, done: 0, absent: 0, again: 0 };
    const byTech = {};
    for (const r of rows || []) {
      c.all++;
      c[statusOf(r)]++;
      if (r.job?.tech && r.job.status !== "todo") {
        const t = (byTech[r.job.tech] = byTech[r.job.tech] || { done: 0, open: 0 });
        if (["done", "absent"].includes(r.job.status)) t.done++;
        else t.open++;
      }
    }
    return { c, byTech };
  }, [rows]);

  const shown = useMemo(() => {
    let list = rows || [];
    if (show === "open") list = list.filter((r) => ["todo", "claimed", "again"].includes(statusOf(r)));
    if (show === "mine") list = list.filter((r) => r.job?.tech === me && statusOf(r) !== "todo");
    if (show === "done") list = list.filter((r) => ["done", "absent"].includes(statusOf(r)));
    if (zone) list = list.filter((r) => zoneOf(r) === zone);
    if (soi) list = list.filter((r) => mainSoi(r.soi) === soi);
    return list;
  }, [rows, show, zone, soi, me, zones]); // eslint-disable-line react-hooks/exhaustive-deps

  // group by zone → soi so a technician walks one soi at a time
  const groups = useMemo(() => {
    const g = new Map();
    for (const r of shown) {
      const k = `${zoneOf(r)}|${mainSoi(r.soi) || r.soi || "?"}`;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(r);
    }
    for (const list of g.values()) list.sort((a, b) => isUrgent(b) - isUrgent(a));
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b, "th", { numeric: true }));
  }, [shown, zones]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!key)
    return (
      <Shell>
        <p className="rounded-xl bg-amber-50 p-4">หน้านี้สำหรับทีมช่างเท่านั้น · เปิดจากลิงก์ที่ทีมอาสาส่งให้ครับ</p>
      </Shell>
    );

  if (!me)
    return (
      <Shell>
        <form
          className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            const n = nameDraft.trim();
            if (!n) return;
            save("techName", n);
            setMe(n);
          }}
        >
          <h2 className="text-lg font-bold">ชื่อช่าง / ชื่อทีม</h2>
          <p className="text-sm text-neutral-600">ใส่ครั้งเดียว ใช้บันทึกว่าใครรับงานบ้านไหน (เช่น "ช่างเอก ทีม 1")</p>
          <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={40} className="min-h-[48px] w-full rounded-lg border border-neutral-300 px-3 text-lg" placeholder="ชื่อช่าง" />
          <button className="min-h-[48px] w-full rounded-xl bg-black font-bold text-white">เริ่มใช้งาน</button>
        </form>
      </Shell>
    );

  const pct = counts.c.all ? Math.round(((counts.c.done + counts.c.absent) / counts.c.all) * 100) : 0;
  return (
    <Shell
      right={
        <button
          onClick={() => {
            save("techName", "");
            setNameDraft(me);
            setMe("");
          }}
          title="เปลี่ยนชื่อช่าง"
          className="rounded-full bg-white/15 px-3 py-1 text-sm"
        >
          👷 {me}
        </button>
      }
    >
      {err && <p className="mb-2 rounded-lg bg-red-50 p-2 text-red-700">{err}</p>}
      {!rows ? (
        <p className="p-4 text-center text-neutral-500">กำลังโหลด…</p>
      ) : (
        <>
          <section className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
            <div className="flex items-baseline justify-between">
              <b className="text-lg">ตรวจแล้ว {counts.c.done + counts.c.absent} / {counts.c.all} หลัง</b>
              <span className="text-sm text-neutral-600">{pct}%</span>
            </div>
            <div className="my-2 h-3 overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} />
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {Object.entries(STATUS).map(([k, s]) => (
                <span key={k} className={`rounded-full px-2 py-1 font-semibold ${s.chip}`}>
                  {s.label} {counts.c[k]}
                </span>
              ))}
            </div>
            {Object.keys(counts.byTech).length > 0 && (
              <p className="mt-2 text-xs text-neutral-600">
                👷 {Object.entries(counts.byTech).map(([t, n]) => `${t}: เสร็จ ${n.done}${n.open ? ` · ค้าง ${n.open}` : ""}`).join("  |  ")}
              </p>
            )}
          </section>

          <TechMap zones={zones} rows={rows} soi={soi} onSoi={(s) => setSoi((cur) => (cur === s ? "" : s))} />

          <div className="my-3 space-y-2">
            <div className="grid grid-cols-4 gap-1 rounded-xl bg-white p-1 text-sm">
              {[
                ["open", "ยังต้องไป"],
                ["mine", "ของฉัน"],
                ["done", "เสร็จแล้ว"],
                ["all", "ทั้งหมด"],
              ].map(([k, t]) => (
                <button
                  key={k}
                  onClick={() => {
                    setShow(k);
                    save("techShow", k);
                  }}
                  className={`min-h-[40px] rounded-lg font-semibold ${show === k ? "bg-black text-white" : "text-neutral-700"}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {["", ...(zones?.zones || []).map((z) => z.id)].map((z) => (
                <button
                  key={z || "all"}
                  onClick={() => {
                    setZone(z);
                    setSoi("");
                    save("techZone", z);
                  }}
                  className={`min-h-[36px] min-w-[44px] rounded-full border-2 px-3 text-sm font-bold ${zone === z ? "border-black bg-black text-white" : "border-neutral-300 bg-white"}`}
                  style={z && zone !== z ? { borderColor: (zones.zones.find((x) => x.id === z) || {}).color } : undefined}
                >
                  {z ? `โซน ${z}` : "ทุกโซน"}
                </button>
              ))}
              {soi && (
                <button onClick={() => setSoi("")} className="min-h-[36px] rounded-full bg-amber-200 px-3 text-sm font-bold">
                  ซอย {soi} ✕
                </button>
              )}
            </div>
          </div>

          {groups.length === 0 && <p className="rounded-xl bg-white p-4 text-center text-neutral-500">ไม่มีบ้านในรายการนี้</p>}
          {groups.map(([k, list]) => {
            const [z, s] = k.split("|");
            return (
              <section key={k} className="mb-3">
                <h3 className="sticky top-0 z-10 -mx-1 mb-1 bg-[#f5f3ee]/95 px-1 py-1 text-sm font-bold">
                  โซน {z} · ซอย {s} <span className="font-normal text-neutral-500">({list.length} หลัง)</span>
                </h3>
                <div className="space-y-2">
                  {list.map((r) => (
                    <Job key={r.house} r={r} me={me} busy={busy === r.house} onStatus={(st, note) => setStatus(r, st, note)} />
                  ))}
                </div>
              </section>
            );
          })}
          <p className="py-4 text-center text-xs text-neutral-500">อัปเดตเองทุก 30 วินาที · เบอร์โทรในหน้านี้ใช้ติดต่อเจ้าของบ้านเท่านั้น</p>
        </>
      )}
    </Shell>
  );
}

function Shell({ children, right }) {
  return (
    <div className="min-h-screen bg-[#f5f3ee] text-neutral-900">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-[#0b1622] px-4 py-3 text-white">
        <div>
          <b>⚡ งานช่างไฟ ตรวจบ้านหลังน้ำท่วม</b>
          <span className="block text-xs text-white/70">หมู่บ้านสหกรณ์เคหะสถาน 4 · จ.–พ. 5–7 ต.ค.</span>
        </div>
        {right}
      </header>
      <main className="mx-auto max-w-2xl px-3 py-3">{children}</main>
    </div>
  );
}

const ASK = {
  done: ["บันทึกสั้นๆ (ถ้ามี) เช่น เปลี่ยนเบรกเกอร์ / ปลอดภัยแล้ว", "✅ ยืนยัน ตรวจเสร็จ", "bg-emerald-600 text-white"],
  absent: ["หมายเหตุ (ถ้ามี) เช่น โทรแล้วไม่รับ", "🚪 ยืนยัน ไม่อยู่บ้าน", "bg-neutral-700 text-white"],
  again: ["ต้องกลับมาทำอะไร (ถ้ามี)", "↩︎ ยืนยัน ต้องกลับมาอีก", "bg-violet-700 text-white"],
};

function Job({ r, me, busy, onStatus }) {
  const [ask, setAsk] = useState(""); // which status is waiting for a note
  const [note, setNote] = useState("");
  const pick = (st) => {
    if (!ASK[st]) return onStatus(st, "");
    setNote(r.job?.note || "");
    setAsk(st);
  };
  const st = statusOf(r);
  const s = STATUS[st];
  const urgent = isUrgent(r) && !["done", "absent"].includes(st);
  const mine = r.job?.tech === me;
  const btn = "min-h-[44px] flex-1 rounded-lg px-2 text-sm font-bold disabled:opacity-50";
  return (
    <article className={`rounded-xl border-l-8 bg-white p-3 shadow-sm ${urgent ? "ring-2 ring-red-500" : ""}`} style={{ borderLeftColor: s.color }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <b className="text-lg">{r.house}</b> <span className="text-neutral-600">ซ.{r.soi || "?"}</span>
          {urgent && <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">ด่วน</span>}
          <span className="block text-sm">{r.name || "—"}</span>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${s.chip}`}>{s.label}</span>
      </div>
      {r.phone && (
        <a href={`tel:${r.phone}`} className="mt-1 inline-block font-semibold text-blue-700 underline">
          📞 {r.phone.replace(/(\d{3})(\d{3})(\d+)/, "$1-$2-$3")}
        </a>
      )}
      {(r.picks || []).length > 0 && <p className="mt-1 text-sm">⚠️ {r.picks.join(" · ")}</p>}
      {r.note && <p className="mt-1 whitespace-pre-line break-words text-sm text-neutral-700">📝 {r.note}</p>}
      {r.job?.tech && st !== "todo" && (
        <p className="mt-1 text-xs text-neutral-600">
          👷 {r.job.tech} · {time(r.job.at)}
          {r.job.note ? ` · ${r.job.note}` : ""}
        </p>
      )}
      {ask ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            onStatus(ask, note.trim());
            setAsk("");
          }}
        >
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} placeholder={ASK[ask][0]} className="w-full rounded-lg border border-neutral-300 px-3 py-2" />
          <div className="flex gap-1">
            <button disabled={busy} className={`${btn} ${ASK[ask][2]}`}>
              {ASK[ask][1]}
            </button>
            <button type="button" onClick={() => setAsk("")} className={`${btn} max-w-[30%] border-2 border-neutral-300`}>
              ยกเลิก
            </button>
          </div>
        </form>
      ) : (
      <div className="mt-2 flex gap-1">
        {st === "todo" || st === "again" ? (
          <button disabled={busy} onClick={() => pick("claimed")} className={`${btn} bg-amber-400`}>
            🙋 รับงาน
          </button>
        ) : null}
        {st !== "done" && (
          <button disabled={busy} onClick={() => pick("done")} className={`${btn} bg-emerald-600 text-white`}>
            ✅ ตรวจเสร็จ
          </button>
        )}
        {(st === "claimed" || st === "todo") && (
          <button disabled={busy} onClick={() => pick("absent")} className={`${btn} border-2 border-neutral-400`}>
            🚪 ไม่อยู่
          </button>
        )}
        {(st === "done" || st === "absent") && (
          <button disabled={busy} onClick={() => pick("again")} className={`${btn} border-2 border-violet-500 text-violet-800`}>
            ↩︎ ต้องกลับมาอีก
          </button>
        )}
        {st === "claimed" && mine && (
          <button disabled={busy} onClick={() => pick("todo")} className={`${btn} border-2 border-neutral-300 text-neutral-600`}>
            คืนงาน
          </button>
        )}
      </div>
      )}
    </article>
  );
}

// One circle per soi: the number of houses still to visit; red = still open, green = all done. Tap = show that soi.
function TechMap({ zones, rows, soi, onSoi }) {
  const el = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [sois, setSois] = useState(null);
  useEffect(() => {
    api("/sois").then((d) => setSois(d.sois)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!zones || !el.current) return;
    const map = createBaseMap(el.current, { zoom: 16 });
    map.options.zoomAnimation = false; // removing a map mid-animation crashes Leaflet
    L.polyline(zones.main_road, { color: "#facc15", weight: 5, opacity: 0.9, interactive: false }).addTo(map);
    map.fitBounds(L.latLngBounds(zones.houses.map(([a, b]) => [a, b])), { padding: [8, 8], animate: false });
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      mapRef.current = null;
      map.stop();
      map.off();
      map.remove();
    };
  }, [zones]);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || !sois) return;
    layer.clearLayers();
    const by = {};
    for (const r of rows) {
      const k = mainSoi(r.soi);
      if (!sois[k]) continue;
      by[k] = by[k] || { open: 0, all: 0, urgent: 0 };
      by[k].all++;
      if (!["done", "absent"].includes(statusOf(r))) {
        by[k].open++;
        if (isUrgent(r)) by[k].urgent++;
      }
    }
    for (const [k, v] of Object.entries(by)) {
      const [lat, lng] = sois[k].center;
      const color = v.open === 0 ? "#16a34a" : v.urgent ? "#dc2626" : "#f59e0b";
      const size = k === soi ? 40 : 30;
      const icon = L.divIcon({
        className: "",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};color:#fff;border:3px solid ${k === soi ? "#000" : "#fff"};box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;font:700 11px/1 sans-serif">${v.open || "✓"}<span style="font-size:8px;font-weight:600">ซ.${k}</span></div>`,
      });
      L.marker([lat, lng], { icon }).on("click", () => onSoi(k)).addTo(layer);
    }
  }, [rows, sois, soi, zones]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <div ref={el} className="h-[45vh] min-h-[300px] w-full overflow-hidden rounded-2xl" />
      <p className="mt-1 text-xs text-neutral-600">วงกลม = จำนวนบ้านที่ยังต้องไปในซอยนั้น · 🔴 มีบ้านด่วน · 🟠 รอตรวจ · 🟢 เสร็จหมด · แตะวงกลมเพื่อดูเฉพาะซอยนั้น</p>
    </div>
  );
}
