// 20 Oct: hand-drawn SVG decor for ตลาด — a street-market banner, a colour per shelf, an awning over the sell box.
// Pure SVG (no image files, no licences, sharp on any phone, ~4 KB). Colours stay soft so the text on top reads.

export const SHELF_TONE = {
  food: { bg: "#FFE9D6", deep: "#C2621B", blob: "#FFD2AE" },
  goods: { bg: "#FFF3C9", deep: "#8A6A00", blob: "#FFE58F" },
  service: { bg: "#DDF2EA", deep: "#17734F", blob: "#B6E4D2" },
  home: { bg: "#E4EDFB", deep: "#2F5DA8", blob: "#C5D7F5" },
};

// a few dots in one corner of a shelf tile
export function TileDots({ color }) {
  return (
    <svg
      className="pointer-events-none absolute right-1.5 top-1.5 h-6 w-6 opacity-50"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {[4, 12, 20].map((x) =>
        [4, 12].map((y) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill={color} />
        )),
      )}
    </svg>
  );
}

function House({ x, w, h, wall, roof, door }) {
  const top = 112 - h;
  return (
    <g>
      <rect x={x} y={top} width={w} height={h} rx="2" fill={wall} />
      <path
        d={`M${x - 4} ${top + 2} L${x + w / 2} ${top - 16} L${x + w + 4} ${top + 2} Z`}
        fill={roof}
      />
      <rect
        x={x + 6}
        y={top + 10}
        width={w / 2 - 9}
        height="10"
        rx="1.5"
        fill="#FFFFFF"
        opacity=".85"
      />
      <rect
        x={x + w / 2 + 3}
        y={top + 10}
        width={w / 2 - 9}
        height="10"
        rx="1.5"
        fill="#FFFFFF"
        opacity=".85"
      />
      <rect
        x={x + w / 2 - 6}
        y={112 - 20}
        width="12"
        height="20"
        rx="1.5"
        fill={door}
      />
    </g>
  );
}

export function MarketBanner({ sub }) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-[#FFF4D6]"
      style={{ minHeight: 132 }}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 360 132"
        preserveAspectRatio="xMaxYMax slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mkSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFF8E6" />
            <stop offset="1" stopColor="#FFEFC8" />
          </linearGradient>
          <linearGradient id="mkFade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#FFF8E6" stopOpacity=".95" />
            <stop offset=".55" stopColor="#FFF8E6" stopOpacity=".8" />
            <stop offset=".75" stopColor="#FFF8E6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="360" height="132" fill="url(#mkSky)" />
        <g transform="translate(52 16) scale(0.86)">
          <circle cx="318" cy="24" r="13" fill="#F7C948" opacity=".9" />
          <ellipse
            cx="250"
            cy="22"
            rx="18"
            ry="5"
            fill="#FFFFFF"
            opacity=".8"
          />
          <ellipse
            cx="200"
            cy="34"
            rx="12"
            ry="4"
            fill="#FFFFFF"
            opacity=".7"
          />
          {/* bunting */}
          <path
            d="M196 34 Q275 46 360 28"
            stroke="#C9B48A"
            strokeWidth="1"
            fill="none"
          />
          {[2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
            const x = 160 + i * 20;
            const y = 31 + Math.sin((i / 9) * Math.PI) * 9;
            const c = ["#E8913A", "#1E6B47", "#F2C14E", "#3C6FC4"][i % 4];
            return (
              <path
                key={i}
                d={`M${x - 5} ${y} L${x + 5} ${y} L${x} ${y + 9} Z`}
                fill={c}
                opacity=".85"
              />
            );
          })}
          {/* houses */}
          <House
            x={196}
            w={44}
            h={52}
            wall="#F6D9B8"
            roof="#C2621B"
            door="#8A4B1C"
          />
          <House
            x={246}
            w={50}
            h={62}
            wall="#E9F1E6"
            roof="#1E6B47"
            door="#2F5DA8"
          />
          <House
            x={302}
            w={46}
            h={48}
            wall="#FBE7C6"
            roof="#B4462E"
            door="#6B4A2E"
          />
          {/* tree */}
          <rect x="181" y="86" width="5" height="26" rx="2" fill="#7A5230" />
          <circle cx="183" cy="80" r="14" fill="#5FA36F" />
          <circle cx="175" cy="88" r="9" fill="#4E9160" />
          {/* food cart with umbrella */}
          <g>
            <path d="M214 92 Q234 70 254 92 Z" fill="#E8913A" />
            <path d="M224 92 Q234 76 244 92 Z" fill="#FFFFFF" opacity=".6" />
            <rect x="233" y="92" width="2" height="8" fill="#6B4A2E" />
            <rect
              x="216"
              y="100"
              width="36"
              height="14"
              rx="3"
              fill="#1E6B47"
            />
            <rect x="220" y="103" width="12" height="4" rx="2" fill="#F2C14E" />
            <circle cx="222" cy="116" r="4" fill="#3A3A3A" />
            <circle cx="246" cy="116" r="4" fill="#3A3A3A" />
            <path
              d="M226 98 q2 -6 0 -10 M231 98 q2 -6 0 -10"
              stroke="#FFFFFF"
              strokeWidth="1.2"
              fill="none"
              opacity=".8"
            />
          </g>
          {/* ground */}
        </g>
        <rect y="112" width="360" height="20" fill="#E8D7A8" />
        <rect y="112" width="360" height="3" fill="#D8C48E" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect
            key={i}
            x={150 + i * 28}
            y="121"
            width="14"
            height="2"
            rx="1"
            fill="#FFFFFF"
            opacity=".6"
          />
        ))}
        <rect width="360" height="112" fill="url(#mkFade)" />
      </svg>
      <div className="relative max-w-[60%] p-4 pr-0">
        <h2 className="text-[26px] font-extrabold leading-tight text-[#15201A]">
          ตลาดเพื่อนบ้าน
        </h2>
        <p className="mt-1 text-[14px] font-semibold leading-snug text-[#5C4A1E]">
          {sub}
        </p>
      </div>
    </div>
  );
}

// striped awning over the "ขายอะไร / ประกาศหา" box
export function Awning() {
  return (
    <svg
      className="block h-5 w-full"
      viewBox="0 0 120 10"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {Array.from({ length: 12 }, (_, i) => (
        <path
          key={i}
          d={`M${i * 10} 0 H${i * 10 + 10} V5 Q${i * 10 + 5} 10 ${i * 10} 5 Z`}
          fill={i % 2 ? "#FFFFFF" : "#1E6B47"}
        />
      ))}
    </svg>
  );
}
