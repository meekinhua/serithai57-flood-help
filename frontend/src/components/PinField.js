import { useState } from "react";
import LocationPicker from "./LocationPicker";

// 16 Oct: an optional map pin for a shop / a thing for sale. Closed until asked for; only a pin the person actually
// moved counts (the picker reports its centre on open). onChange(null) = no pin.
export default function PinField({ value, onChange, title = "ร้านอยู่ตรงไหน", button = "🗺️ ปักหมุดร้าน (ไม่บังคับ)" }) {
  const [open, setOpen] = useState(!!value);
  const [touched, setTouched] = useState(!!value);
  const [loc, setLoc] = useState(value);
  return (
    <div>
      <p className="mb-1 block font-medium">{title}</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="min-h-[48px] w-full rounded-xl border-2 border-[#C9D1CB] bg-white text-base font-semibold">
          {button}
        </button>
      ) : (
        <div className="anim-in space-y-1">
          <LocationPicker
            value={loc}
            onChange={(p) => {
              setLoc(p);
              if (touched) onChange(p);
            }}
            onTouched={() => {
              setTouched(true);
              onChange(loc);
            }}
          />
          <div className="flex items-center gap-2">
            <p className={`min-w-0 flex-1 text-sm font-bold ${touched ? "text-[#1E6B47]" : "text-[#7A4104]"}`}>
              {touched ? "✓ หมุดอยู่ตรงนี้ · ลากแผนที่ปรับได้" : "ลากแผนที่ให้หมุด 📍 ชี้ตรงร้าน หรือกด GPS"}
            </p>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTouched(false);
                onChange(null);
              }}
              className="min-h-[40px] shrink-0 px-2 text-sm underline"
            >
              ไม่ปักแล้ว
            </button>
          </div>
        </div>
      )}
      {!open && <p className="mt-1 text-sm text-neutral-500">ปักไว้ เพื่อนบ้านกดดูทางไปร้านได้ · ไม่ปักก็ได้</p>}
    </div>
  );
}

export const mapLink = (x) => (x?.lat && x?.lng ? `https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lng}#map=18/${x.lat}/${x.lng}` : "");
