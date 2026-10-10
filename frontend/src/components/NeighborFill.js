// 🗺️ บ้านฉัน (10 Oct 2026): members fill in the houses around their own — tap a roof, type its number — and
// check the ones already there (✓ ถูก / ✗ ไม่ใช่). Only within 150 m of their own pinned house.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { api, load, save } from "../api";
import { notify } from "../notify";
import { createBaseMap } from "./MapView";

const SRC = { owner: "เจ้าของบ้านปักเอง", neighbor: "เพื่อนบ้านช่วยใส่", team: "ทีมตรวจแล้ว" };
const COLOR = { owner: "#1E6B47", team: "#1E6B47", neighbor: "#2563EB" };

export default function NeighborFill({ info, onPin }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState(null); // {kind: "new", lat, lng} | {kind: "known", ...known}
  const [num, setNum] = useState("");
  const [busy, setBusy] = useState(false);
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const pinned = info.precision === "house";

  const reload = () =>
    api(`/myhome/neighbors?house=${encodeURIComponent(info.house)}`)
      .then(setD)
      .catch((e) => setErr(e.message));
  useEffect(() => {
    if (pinned) reload();
  }, [info.house, pinned]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !d || !el.current) return;
    if (!map.current) {
      map.current = createBaseMap(el.current, { center: d.me, zoom: 19 });
      layer.current = L.layerGroup().addTo(map.current);
      L.circle(d.me, { radius: d.radius, color: "#15201A", weight: 1, dashArray: "4 4", fill: false, interactive: false }).addTo(map.current);
      map.current.on("click", (e) => {
        setSel({ kind: "new", lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
        setNum("");
      });
    }
    const g = layer.current;
    g.clearLayers();
    L.marker(d.me, {
      icon: L.divIcon({
        className: "",
        html: '<div style="background:#15201A;color:#fff;border-radius:8px;padding:2px 6px;font:700 12px sans-serif;white-space:nowrap">🏠 บ้านคุณ</div>',
        iconSize: null,
        iconAnchor: [30, 10],
      }),
    }).addTo(g);
    for (const r of d.roofs) {
      L.circleMarker(r, { radius: 7, color: "#fff", weight: 2, fillColor: "#9AA59F", fillOpacity: 0.9 })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setSel({ kind: "new", lat: r[0], lng: r[1] });
          setNum("");
        })
        .addTo(g);
    }
    for (const k of d.known) {
      const bad = k.no > k.ok;
      L.marker([k.lat, k.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="background:${bad ? "#B42318" : COLOR[k.src]};color:#fff;border:2px solid #fff;border-radius:8px;padding:1px 5px;font:700 12px sans-serif;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)">${k.house.replace(/^4\//, "")}${k.mine === "ok" ? " ✓" : ""}</div>`,
          iconSize: null,
          iconAnchor: [16, 10],
        }),
      })
        .on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          setSel({ kind: "known", ...k });
        })
        .addTo(g);
    }
    if (sel?.kind === "new") L.circleMarker([sel.lat, sel.lng], { radius: 11, color: "#DC2626", weight: 3, fill: false }).addTo(g);
  }, [open, d, sel]);

  async function addHouse() {
    if (!/^\d{1,5}[ก-ฮ]?$/.test(num.trim())) return setErr("☝️ ใส่เลขบ้าน เช่น 917");
    setBusy(true);
    setErr("");
    try {
      const r = await api("/myhome/neighbors", { method: "POST", body: JSON.stringify({ by: info.house, house: num.trim(), lat: sel.lat, lng: sel.lng }) });
      notify(r.note);
      save("neighborAdds", load("neighborAdds", 0) + 1);
      setSel(null);
      setNum("");
      await reload();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }
  async function vote(ok) {
    setBusy(true);
    setErr("");
    try {
      await api("/myhome/neighbors/vote", { method: "POST", body: JSON.stringify({ by: info.house, house: sel.house, ok }) });
      notify(ok ? "ขอบคุณที่ช่วยยืนยันครับ" : "รับทราบ · ทีมจะตรวจให้ ถ้ารู้เลขที่ถูก แตะหลังคาแล้วใส่เลขได้เลย");
      setSel(null);
      await reload();
    } catch (e) {
      setErr(e.message);
    }
    setBusy(false);
  }

  const nKnown = d?.known.length || 0;
  const nRoof = d?.roofs.length || 0;
  if (!open)
    return (
      <button onClick={() => (pinned ? setOpen(true) : onPin())} className="card mt-2 flex min-h-[60px] w-full items-center gap-2.5 p-2 pr-3 text-left">
        <span className="ic ic-sm ic-green" aria-hidden="true">
          🗺️
        </span>
        <span className="min-w-0 flex-1 leading-snug">
          <b className="block text-[15px]">ช่วยเติมแผนที่ · ใส่เลขบ้านข้างๆ คุณ</b>
          <span className="block text-sm text-[#45504A]">
            {pinned ? (d ? `รอบบ้านคุณมีเลขแล้ว ${nKnown} หลัง · ยังว่าง ${nRoof} หลังคา` : "แตะหลังคาบ้านข้างๆ แล้วใส่เลขที่") : "ปักหมุดบ้านคุณก่อน แล้วช่วยใส่บ้านรอบๆ ได้"}
          </span>
        </span>
        <span className="shrink-0 font-bold text-[#1E6B47]">{pinned ? "เปิด ▾" : "ปักหมุด ›"}</span>
      </button>
    );
  return (
    <div className="card anim-in mt-2 p-3">
      <div className="flex items-center gap-2">
        <b className="flex-1 text-base">🗺️ ช่วยเติมแผนที่รอบบ้านคุณ</b>
        <button
          onClick={() => {
            setOpen(false);
            setSel(null);
            map.current?.remove();
            map.current = null;
          }}
          className="min-h-[40px] text-sm font-bold text-[#1E6B47]"
        >
          ย่อ ▴
        </button>
      </div>
      <p className="text-sm text-[#45504A]">
        แตะ <b>จุดเทา</b> (หลังคาที่ยังไม่มีเลข) หรือตรงไหนก็ได้ แล้วใส่เลขบ้าน · แตะ<b>ป้ายเลข</b>เพื่อบอกว่าถูกหรือไม่ · เขียว = เจ้าของปักเอง · น้ำเงิน = เพื่อนบ้านใส่ · แดง = มีคนว่าไม่ใช่
      </p>
      <div ref={el} className="mt-2 h-[360px] rounded-xl border" />
      {sel?.kind === "new" && (
        <div className="mt-2 rounded-xl border-2 border-[#DC2626] p-3">
          <p className="text-[15px] font-bold">บ้านหลังที่วงแดง เลขที่อะไร?</p>
          <div className="mt-1 flex items-center gap-1">
            <span className="text-lg font-bold">4/</span>
            <input
              autoFocus
              value={num}
              onChange={(e) => setNum(e.target.value.replace(/[^\dก-ฮ]/g, ""))}
              inputMode="numeric"
              placeholder="เช่น 917"
              className="min-h-[48px] w-28 rounded-lg border px-2 text-lg"
            />
            <button disabled={busy || !num} onClick={addHouse} className="min-h-[48px] flex-1 rounded-xl bg-[#1E6B47] font-bold text-white disabled:opacity-50">
              บันทึก
            </button>
          </div>
          <button onClick={() => setSel(null)} className="mt-1 min-h-[36px] text-sm text-[#45504A] underline">
            ยกเลิก
          </button>
        </div>
      )}
      {sel?.kind === "known" && (
        <div className="mt-2 rounded-xl border-2 border-[#15201A] p-3">
          <p className="text-[15px] font-bold">
            {sel.house} · {SRC[sel.src]}
            {sel.ok + sel.no > 0 && (
              <span className="font-normal text-[#45504A]">
                {" "}
                · ✓ {sel.ok} · ✗ {sel.no}
              </span>
            )}
          </p>
          <p className="text-sm text-[#45504A]">หมุดนี้ใช่บ้าน {sel.house} จริงไหม?</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button disabled={busy} onClick={() => vote(true)} className="min-h-[48px] rounded-xl bg-[#1E6B47] font-bold text-white disabled:opacity-50">
              ✓ ถูก
            </button>
            <button disabled={busy} onClick={() => vote(false)} className="min-h-[48px] rounded-xl border-2 border-[#B42318] font-bold text-[#B42318] disabled:opacity-50">
              ✗ ไม่ใช่
            </button>
          </div>
          <button onClick={() => setSel(null)} className="mt-1 min-h-[36px] text-sm text-[#45504A] underline">
            ปิด
          </button>
        </div>
      )}
      {err && <p className="mt-2 rounded-lg bg-[#FDE8E6] p-2 text-sm font-bold text-[#B42318]">{err}</p>}
      <p className="mt-2 text-sm text-[#45504A]">
        รอบบ้านคุณ (150 ม.) มีเลขแล้ว {nKnown} หลัง · ยังว่าง {nRoof} หลังคา
        {load("neighborAdds", 0) > 0 && ` · คุณช่วยใส่ไปแล้ว ${load("neighborAdds", 0)} หลัง ขอบคุณครับ 🙏`}
      </p>
    </div>
  );
}
