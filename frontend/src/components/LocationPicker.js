import { useEffect, useRef, useState } from "react";
import { createBaseMap } from "./MapView";

// Pan the map so the centre pin sits on the spot. Easier with a thumb than tapping a tiny target.
export default function LocationPicker({ value, onChange }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const [gps, setGps] = useState("");

  useEffect(() => {
    const map = createBaseMap(elRef.current, value ? { center: [value.lat, value.lng], zoom: 18 } : {});
    const emit = () => {
      const c = map.getCenter();
      onChange({ lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) });
    };
    map.on("moveend", emit);
    emit();
    mapRef.current = map;
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function useGps() {
    if (!navigator.geolocation) return setGps("เครื่องนี้ไม่รองรับ GPS");
    setGps("กำลังหาตำแหน่ง…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        mapRef.current.setView([pos.coords.latitude, pos.coords.longitude], 18);
        setGps(`ได้ตำแหน่งแล้ว (แม่นยำ ~${Math.round(pos.coords.accuracy)} ม.) เลื่อนแผนที่ปรับได้`);
      },
      () => setGps("หาตำแหน่งไม่ได้ กรุณาเลื่อนแผนที่เอง"),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  return (
    <div>
      <div className="relative h-56 overflow-hidden rounded-lg border border-neutral-300 sm:h-64">
        <div ref={elRef} className="h-full w-full" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full text-4xl drop-shadow">
          📍
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={useGps} className="min-h-[44px] rounded-lg border border-neutral-300 bg-white px-4 font-medium active:bg-neutral-100">
          📡 ใช้ตำแหน่งปัจจุบัน
        </button>
        <span className="text-sm text-neutral-600">{gps || "เลื่อนแผนที่ให้หมุดชี้ตรงจุด"}</span>
      </div>
    </div>
  );
}
