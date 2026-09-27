import { WATER_LEVELS } from "../config";

// Water height on a standing adult, as a fraction of body height, per level (0..6).
const FRACTION = [0, 0.06, 0.15, 0.28, 0.4, 0.52, 0.74];
const RULER = [
  [6, "อก"],
  [5, "เอว"],
  [4, "ต้นขา"],
  [3, "เข่า"],
  [1, "ตาตุ่ม"],
];

const TOP = 14;
const GROUND = 190;
const BODY = GROUND - TOP;
const yFor = (level) => GROUND - BODY * (FRACTION[level] ?? 0);

// A person standing in water; the water rises/falls smoothly to the chosen level.
// The water is one group moved with a CSS transform, which animates reliably in every browser.
export default function WaterGauge({ level, className = "" }) {
  const lv = level == null ? null : WATER_LEVELS[level];
  const waterTop = level == null ? GROUND : yFor(level);
  const color = lv ? lv.color : "#60a5fa";
  return (
    <svg viewBox="0 0 160 200" className={className} role="img" aria-label={lv ? `ระดับน้ำ ${lv.label} ${lv.cm}` : "เลือกระดับน้ำ"}>
      <defs>
        <clipPath id="gauge-clip">
          <rect x="0" y="0" width="160" height="200" rx="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#gauge-clip)">
        <rect width="160" height="200" fill="#f5f5f5" />
        {RULER.map(([l, t]) => (
          <g key={t}>
            <line x1="100" x2="156" y1={yFor(l)} y2={yFor(l)} stroke={l === level ? "#171717" : "#d4d4d4"} strokeDasharray="3 3" />
            <text x="156" y={yFor(l) - 3} textAnchor="end" fontSize="10" fontWeight={l === level ? 700 : 400} fill={l === level ? "#171717" : "#a3a3a3"}>
              {t}
            </text>
          </g>
        ))}
        {/* person */}
        <g fill="#171717">
          <circle cx="62" cy={TOP + 14} r="13" />
          <rect x="47" y={TOP + 30} width="30" height="68" rx="10" />
          <rect x="36" y={TOP + 34} width="10" height="56" rx="5" transform={`rotate(8 41 ${TOP + 34})`} />
          <rect x="78" y={TOP + 34} width="10" height="56" rx="5" transform={`rotate(-8 83 ${TOP + 34})`} />
          <rect x="49" y={TOP + 92} width="12" height={GROUND - TOP - 92} rx="5" />
          <rect x="63" y={TOP + 92} width="12" height={GROUND - TOP - 92} rx="5" />
        </g>
        {/* water: surface at y=0 inside the group, the group slides to the level */}
        <g style={{ transform: `translateY(${waterTop}px)`, transition: "transform 0.8s cubic-bezier(0.3, 1.25, 0.5, 1)" }}>
          <rect x="0" y="2" width="160" height="200" fill={color} fillOpacity="0.5" style={{ transition: "fill 0.5s" }} />
          <g className="gauge-wave">
            <path d="M0 2 q10 -6 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 v4 H0 z" fill={color} fillOpacity="0.85" style={{ transition: "fill 0.5s" }} />
          </g>
        </g>
        <rect x="0" y={GROUND} width="160" height={200 - GROUND} fill="#a3a3a3" />
      </g>
      {lv && (
        <>
          <text x="154" y="20" textAnchor="end" fontSize="15" fontWeight="700" fill="#171717">
            {lv.label}
          </text>
          <text x="154" y="34" textAnchor="end" fontSize="11" fill="#525252">
            {lv.cm}
          </text>
        </>
      )}
    </svg>
  );
}

export { FRACTION as WATER_BODY_FRACTION };
