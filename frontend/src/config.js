// บ้านสหกรณ์เคหะสถาน 4, ซ.เสรีไทย 57, แขวงคลองกุ่ม เขตบึงกุ่ม
// Boundary: OpenStreetMap way 1478507497 (landuse=residential)
export const VILLAGE_NAME = "บ้านสหกรณ์เคหะสถาน 4 (เสรีไทย 57)";
export const VILLAGE_CENTER = [13.7958, 100.67];
export const VILLAGE_ZOOM = 16;
// 9 Oct: cut out ชุมชนโต๊ะบาง (between the park and คลองระหัส; it only uses our exit) and the strip under the park (นวธานี) — the line runs along the ลำราง road
export const VILLAGE_BOUNDARY = [
  [13.8045107, 100.6649608],
  [13.8021235, 100.6650218],
  [13.8023053, 100.6658692],
  [13.7992588, 100.6662844],
  [13.7980021, 100.6666275],
  [13.7960034, 100.6674634],
  [13.79303, 100.6689847],
  [13.7928924, 100.6689603],
  [13.7927455, 100.6687709],
  [13.7924425, 100.6687764],
  [13.786371, 100.6723076],
  [13.7877058, 100.6731558],
  [13.7889926, 100.6750347],
  [13.7903221, 100.6744911],
  [13.7912586, 100.674232],
  [13.7929105, 100.6740703],
  [13.7944681, 100.6736678],
  [13.794661, 100.673675],
  [13.794385, 100.672623],
  [13.794, 100.671282],
  [13.7942871, 100.6711636],
  [13.7965257, 100.6702901],
  [13.7982259, 100.6698609],
  [13.7985382, 100.6705193],
  [13.7999105, 100.6698604],
  [13.8008781, 100.6696271],
  [13.8007251, 100.6692087],
  [13.8030013, 100.668275],
  [13.8029673, 100.6680454],
  [13.8052466, 100.6676938],
  [13.8045107, 100.6649608],
];

export const KINDS = {
  need: { label: "ขอความช่วยเหลือ", short: "ขอช่วย", emoji: "🆘", color: "#000000", pin: "#000000" },
  offer: { label: "ฉันช่วยได้", short: "ช่วยได้", emoji: "🤝", color: "#000000", pin: "#ffffff" },
  info: { label: "แจ้งข้อมูล", short: "ข้อมูล", emoji: "📍", color: "#525252", pin: "#a3a3a3" },
};

// Keys must match CATEGORIES in backend/server.py
export const CATEGORIES = {
  need: {
    evacuate: ["🚣", "ติดอยู่ / ต้องการอพยพ"],
    medical: ["🚑", "เจ็บป่วย / ฉุกเฉินทางการแพทย์"],
    vulnerable: ["👵", "ผู้สูงอายุ / ผู้ป่วยติดเตียง / เด็กเล็ก"],
    food: ["🍚", "อาหาร / น้ำดื่ม"],
    medicine: ["💊", "ยาประจำตัว / เวชภัณฑ์"],
    power: ["🔋", "ไฟฟ้า / ชาร์จแบต"],
    move_items: ["📦", "ช่วยยกของ / ย้ายรถ"],
    pets: ["🐶", "สัตว์เลี้ยง"],
    other: ["❓", "อื่นๆ"],
  },
  offer: {
    boat: ["🚤", "มีเรือ"],
    truck: ["🛻", "มีรถยกสูง"],
    food: ["🍱", "แจกอาหาร / น้ำ"],
    shelter: ["🏠", "ที่พักชั่วคราว"],
    parking: ["🅿️", "ที่จอดรถบนที่สูง"],
    labor: ["💪", "แรงงาน / ช่วยขนของ"],
    power: ["🔌", "จุดชาร์จไฟ"],
    other: ["🤝", "อื่นๆ"],
  },
  info: {
    road_ok: ["✅", "ถนนผ่านได้"],
    road_partial: ["⚠️", "ผ่านได้บางส่วน / มีสิ่งกีดขวาง (ต้นไม้ล้ม รถเสีย)"],
    road_blocked: ["⛔", "ถนนผ่านไม่ได้"],
    danger: ["⚡", "จุดอันตราย (ไฟรั่ว / ท่อ / สัตว์มีพิษ)"],
    shelter_point: ["🏫", "ศูนย์พักพิง"],
    supply_point: ["📦", "จุดแจกของ"],
    other: ["ℹ️", "อื่นๆ"],
  },
};

// Paid help: the app only shows the offer; people arrange and pay each other directly.
export const PAYMENT = {
  need: { free: "ขอความช่วยเหลือ (ไม่มีค่าใช้จ่าย)", paid: "ยินดีจ่ายค่าตอบแทน", badge: "ยินดีจ่าย", pricePlaceholder: "เช่น 500 บาท / ตามตกลง" },
  offer: { free: "ช่วยฟรี / จิตอาสา", paid: "มีค่าบริการ (รับจ้าง)", badge: "รับจ้าง", pricePlaceholder: "เช่น 100 บาท/เที่ยว, 300 บาท/ชม." },
};

export function paymentBadge(post) {
  if (post.payment !== "paid" || !PAYMENT[post.kind]) return "";
  return `💰 ${PAYMENT[post.kind].badge}${post.price ? ` ${post.price}` : ""}`;
}

// Index = level stored in the DB (backend WATER_MAX_LEVEL = 6).
// ต้นขา added between เข่า and เอว after residents asked for a 60-70 cm step.
export const WATER_LEVELS = [
  { level: 0, label: "ไม่ท่วม", cm: "0 ซม.", color: "#16a34a" },
  { level: 1, label: "ตาตุ่ม", cm: "~10 ซม.", color: "#84cc16" },
  { level: 2, label: "ครึ่งแข้ง", cm: "20–30 ซม.", color: "#eab308" },
  { level: 3, label: "เข่า", cm: "40–50 ซม.", color: "#f59e0b" },
  { level: 4, label: "ต้นขา", cm: "60–70 ซม.", color: "#ea580c" },
  { level: 5, label: "เอว", cm: "80–90 ซม.", color: "#dc2626" },
  { level: 6, label: "อกขึ้นไป", cm: "1 ม.+", color: "#7e22ce" },
];

export const STATUS = {
  open: { need: "รอความช่วยเหลือ", offer: "พร้อมช่วย", info: "ยังเป็นปัจจุบัน", cls: "bg-neutral-100 text-neutral-700" },
  helping: { need: "มีคนกำลังไปช่วย", offer: "กำลังช่วยอยู่", info: "กำลังจัดการ", cls: "bg-black text-white" },
  done: { need: "ช่วยเสร็จแล้ว", offer: "ปิดแล้ว", info: "ไม่เป็นปัจจุบันแล้ว", cls: "border border-neutral-300 text-neutral-500" },
};

// Live staff trips (keys must match backend/trips.py)
export const VEHICLES = {
  boat: ["🚤", "เรือ"],
  bigtruck: ["🚛", "รถใหญ่ / รถทหาร"],
  truck: ["🛻", "กระบะ / รถยกสูง"],
  car: ["🚗", "รถเก๋ง"],
  motorbike: ["🏍️", "มอเตอร์ไซค์"],
  walk: ["🚶", "เดินเท้า"],
};
export const MISSIONS = {
  food: ["🍱", "แจกข้าว / อาหาร"],
  water: ["💧", "แจกน้ำดื่ม"],
  evacuate: ["🚣", "รับคน / อพยพ"],
  medical: ["🏥", "รับส่งผู้ป่วย"],
  cargo: ["📦", "ขนของ"],
  survey: ["🔍", "สำรวจพื้นที่"],
  other: ["🤝", "อื่นๆ"],
  standby: ["👷", "ทีมช่วยเหลือ/อาสา"], // /staff open, not on a trip
};
export const PHASES = {
  enroute: ["🚀", "กำลังไป", "bg-sky-600 text-white"],
  serving: ["📍", "ถึงแล้ว / กำลังให้บริการ", "bg-emerald-600 text-white"],
  out_of_stock: ["⛔", "ของหมดแล้ว", "bg-neutral-500 text-white"],
  returning: ["↩️", "กำลังกลับฐาน", "bg-neutral-700 text-white"],
  standby: ["🟢", "ออนไลน์", "bg-emerald-100 text-emerald-900"],
};

// Contact board categories. Keys must match SERVICE_CATEGORIES in backend/services.py
export const SERVICE_CATEGORIES = {
  electrician: ["⚡", "ช่างไฟ"],
  plumber: ["🔧", "ช่างประปา / ปั๊มน้ำ"],
  truck: ["🛻", "รถยกสูง / กระบะ"],
  rental: ["🚗", "เช่ารถ / รับส่ง"],
  boat: ["🚤", "เรือรับจ้าง"],
  porter: ["💪", "จ้างขนของ / หิ้วของ"],
  cleaning: ["🧹", "ล้างบ้าน / ทำความสะอาด"],
  repair: ["🛠️", "ช่างซ่อม (แอร์ รถ เครื่องใช้)"],
  food: ["🍜", "ร้านอาหาร / ส่งอาหาร (เปิดประจำ)"],
  supplies: ["🛒", "ของใช้ / กระสอบทราย"],
  pets: ["🐾", "รับฝากสัตว์เลี้ยง"],
  // after the flood (repair mode)
  ac: ["❄️", "ล้าง / ซ่อมแอร์"],
  appliance: ["🧺", "ซ่อมตู้เย็น เครื่องซักผ้า"],
  carpenter: ["🪚", "ช่างไม้ / บิวต์อิน / ประตู"],
  painter: ["🎨", "ทาสี / ฉาบ / กันเชื้อรา"],
  roof: ["🏠", "หลังคา / กันซึม"],
  pest: ["🐜", "กำจัดปลวก / แมลง"],
  vehicle: ["🚗", "ซ่อมรถ / มอไซค์จมน้ำ"],
  junk: ["🚛", "รับขนขยะ / ของพัง"],
  // the village marketplace after the flood (7 Oct)
  shop: ["🏪", "ร้านค้า (เปิดประจำ)"], // 16 Oct: homemade / made-to-order goes to ตลาดเพื่อนบ้าน instead
  beauty: ["💇", "ตัดผม / เสริมสวย / นวด"],
  tutor: ["📚", "ติวเตอร์ / สอนพิเศษ"],
  other: ["📞", "อื่นๆ"],
};
// Flood-era categories stay for old listings; the repair-mode form offers these first.
export const REPAIR_SERVICE_ORDER = [
  "electrician",
  "plumber",
  "ac",
  "appliance",
  "carpenter",
  "painter",
  "roof",
  "pest",
  "vehicle",
  "cleaning",
  "junk",
  "repair",
  "truck",
  "porter",
  "shop",
  "food",
  "beauty",
  "tutor",
  "other",
];

// ---------- repair mode (after the flood). Keys must match backend/repair.py ----------
export const LEND_KINDS = {
  lend: { emoji: "🤝", label: "ให้ยืม", verb: "มีของให้ยืม" },
  give: { emoji: "🎁", label: "ให้ฟรี", verb: "มีของให้ฟรี" },
  want: { emoji: "🔎", label: "ตามหา / อยากได้", verb: "ตามหาของ" },
  sell: { emoji: "🏷️", label: "ขาย", verb: "ขาย" },
};
export const LEND_CATEGORIES = {
  washer: ["💦", "เครื่องฉีดน้ำแรงดันสูง"],
  pump: ["⚙️", "ปั๊มน้ำ / ไดโว่"],
  vacuum: ["🌀", "เครื่องดูดฝุ่น-ดูดน้ำ"],
  dryer: ["🌬️", "พัดลม / เครื่องลดความชื้น"],
  ladder: ["🪜", "บันได"],
  cleaning: ["🧹", "ไม้ถู แปรง ถัง สายยาง"],
  tools: ["🧰", "เครื่องมือช่าง"],
  cart: ["🛒", "รถเข็น / รถลาก"],
  power: ["🔌", "ปลั๊กพ่วง / เครื่องปั่นไฟ"],
  furniture: ["🪑", "เฟอร์นิเจอร์ / ของใช้"],
  supplies: ["🧴", "น้ำยา / ถุงดำ / ถุงมือ"],
  food: ["🍱", "ของกิน / ของทำขาย"],
  clothes: ["👕", "เสื้อผ้า / กระเป๋า"],
  electronics: ["📱", "เครื่องใช้ไฟฟ้า / มือถือ"],
  kids: ["🧸", "ของเด็ก / ของเล่น"],
  plants: ["🪴", "ต้นไม้ / ของแต่งบ้าน"],
  other: ["📦", "อื่นๆ"],
  homemade: ["🍲", "อาหารทำเอง"],
  dessert: ["🧁", "ขนม · เบเกอรี่"],
  drinks: ["🧋", "เครื่องดื่ม"],
  handmade: ["🧶", "งานฝีมือ"],
};
// 🛍️ ตลาดเพื่อนบ้าน (15 Oct): the lend items of kind "sell". The form offers these when selling (homemade first);
// the four market ones are not offered for lend / give / want.
export const MARKET_ONLY = ["homemade", "dessert", "drinks", "handmade"];
export const MARKET_CATEGORIES = [...MARKET_ONLY, "plants", "clothes", "electronics", "furniture", "kids", "other"];
// the market's filter chips: [key, label, categories] — "used" takes everything not named before it
export const MARKET_FILTERS = [
  ["homemade", "🍲 อาหารทำเอง", ["homemade", "food"]],
  ["dessert", "🧁 ขนม", ["dessert"]],
  ["drinks", "🧋 เครื่องดื่ม", ["drinks"]],
  ["handmade", "🧶 งานฝีมือ", ["handmade"]],
  ["plants", "🪴 ต้นไม้", ["plants"]],
  ["used", "📦 มือสอง/อื่นๆ", null],
];
export const LEND_STATUS = {
  available: { label: "ว่าง", cls: "bg-emerald-100 text-emerald-800" },
  lent: { label: "มีคนยืมอยู่", cls: "bg-amber-100 text-amber-900" },
  closed: { label: "ปิดแล้ว", cls: "bg-neutral-200 text-neutral-600" },
};
export const JOB_TYPES = {
  clean: ["🧽", "ช่วยล้างบ้าน / ขัดโคลน"],
  move: ["📦", "ช่วยยกของ / ย้ายเฟอร์นิเจอร์"],
  trash: ["🗑️", "ช่วยขนของพังไปทิ้ง"],
  fix: ["🛠️", "ช่วยซ่อมเล็กๆ น้อยๆ"],
  check: ["⚡", "ช่วยดูไฟ / ปลั๊ก ก่อนเปิดใช้"],
  elderly: ["🧓", "บ้านผู้สูงอายุ / อยู่คนเดียว"],
  ride: ["🚗", "ติดรถออกไปข้างนอก"],
  errand: ["🛒", "ฝากซื้อของ / ยา"],
  hire: ["🧑‍🔧", "หาช่าง / จ้างงาน (มีค่าจ้าง)"],
  other: ["🙋", "อื่นๆ"],
};
// What each job type asks of the reader: [request: who answers, offer: who answers]
export const JOB_VERBS = {
  ride: ["🚗 ฉันไปส่งได้", "🙋 ขอติดรถด้วย"],
  errand: ["🛒 ฉันซื้อฝากให้", "🛒 ขอฝากซื้อ"],
  hire: ["🧑‍🔧 ฉันรับงานนี้", "🧑‍🔧 อยากจ้าง"],
};

// ---------- lost & found (repair mode). Keys must match backend/repair.py ----------
export const LOST_KINDS = {
  lost: { emoji: "😢", label: "หาย", verb: "แจ้งของหาย / สัตว์หาย" },
  found: { emoji: "🙌", label: "เจอ", verb: "เจอสัตว์ / เจอของ" },
};
export const LOST_CATEGORIES = {
  dog: ["🐕", "หมา"],
  cat: ["🐈", "แมว"],
  pet: ["🐾", "สัตว์เลี้ยงอื่น"],
  item: ["🎒", "ของใช้ / ของมีค่า"],
  document: ["📄", "เอกสาร / บัตร"],
  vehicle: ["🛵", "รถ / จักรยาน"],
  other: ["📦", "อื่นๆ"],
};
export const JOB_STATUS = {
  open: { label: "ยังต้องการคน", cls: "bg-red-100 text-red-800" },
  scheduled: { label: "ได้คนแล้ว / นัดแล้ว", cls: "bg-amber-100 text-amber-900" },
  done: { label: "เสร็จแล้ว", cls: "bg-emerald-100 text-emerald-800" },
};
export const ISSUE_TYPES = {
  trash: ["🗑️", "กองขยะตกค้าง"],
  cover: ["🕳️", "ฝาท่อแตก / ฝาเปิด"],
  danger: ["⚠️", "จุดอันตราย"],
  drain: ["🌀", "ท่อ / ร่องน้ำตัน"],
  light: ["💡", "ไฟถนนดับ"],
  road: ["🚧", "ถนนพัง / หลุม"],
  tree: ["🌳", "ต้นไม้ล้ม / กิ่งขวาง"],
  wire: ["⚠️", "สายไฟห้อย / เสาเอียง"],
  water: ["🚰", "น้ำประปาไม่ไหล / ขุ่น"],
  smell: ["🦟", "น้ำขัง / กลิ่น / ยุง"],
  other: ["📍", "อื่นๆ"],
};
export const ISSUE_STATUS = {
  open: { label: "ยังไม่ได้แก้", cls: "bg-red-100 text-red-800" },
  reported: { label: "แจ้งเขตแล้ว", cls: "bg-amber-100 text-amber-900" },
  fixed: { label: "แก้แล้ว", cls: "bg-emerald-100 text-emerald-800" },
};

export const PRICING = {
  paid: { label: "มีค่าบริการ", badge: "💰" },
  free: { label: "ฟรี / จิตอาสา", badge: "🆓" },
  ask: { label: "สอบถามราคา", badge: "💬" },
};

// [number as displayed, label]; tel: links strip everything but digits.
export const HOTLINE_GROUPS = [
  {
    title: "🛡️ รปภ. หมู่บ้านสหกรณ์เคหสถาน 4",
    items: [
      ["02-379-6608", "ป้อม รปภ. ป้อมหน้า"],
      ["082-115-3110", "ป้อมหน้า (มือถือ)"],
      ["02-379-6936", "ป้อม รปภ. ป้อมท้าย"],
      ["02-379-7113", "รปภ. หน้าสำนักงาน"],
    ],
  },
  {
    title: "🚨 สายด่วนฉุกเฉิน",
    items: [
      ["1669", "เจ็บป่วยฉุกเฉิน / รถพยาบาล"],
      ["191", "ตำรวจ / เหตุด่วน"],
      ["199", "ดับเพลิง / กู้ภัย / งู สัตว์อันตรายเข้าบ้าน"],
      ["1784", "ปภ. สาธารณภัย"],
      ["1555", "กรุงเทพมหานคร"],
      ["1130", "การไฟฟ้านครหลวง (ไฟรั่ว / ตัดไฟ)"],
    ],
  },
];

// Categories where life/health is at stake: the urgent switch turns on by itself (can be turned off).
export const URGENT_CATEGORIES = ["evacuate", "medical", "vulnerable"];

// Words that mean "someone needs help" -- used to catch requests filed as info/offer or hidden in water notes.
export const NEED_WORDS =
  /ผู้สูงอายุ|คนแก่|ยาย|ตา(?=\s|$|ย)|ติดเตียง|ผู้ป่วย|ป่วย|คนพิการ|พิการ|เด็กเล็ก|เด็ก|ทารก|ตั้งครรภ์|ต้องการ|ขอความช่วยเหลือ|ช่วยด้วย|ขอ(?:อาหาร|น้ำ|ยา|เรือ|ความช่วย)|ไม่มีไฟ|ไฟดับ|ไม่มีอาหาร|ไม่มีน้ำ|ไม่เคยได้รับ|ติดอยู่|ออกไม่ได้|อพยพ|หิว|ยาหมด|ติดต่อไม่ได้/;

// Best guess of the request category from free text, for the "file this as a request?" prompt.
export function guessNeedCategory(text) {
  if (/ติดเตียง|ผู้สูงอายุ|คนแก่|ยาย|พิการ|เด็กเล็ก|ทารก|ตั้งครรภ์/.test(text)) return "vulnerable";
  if (/ป่วย|เจ็บ|บาดเจ็บ|หายใจ|ไม่สบาย/.test(text)) return "medical";
  if (/อพยพ|ติดอยู่|ออกไม่ได้|เรือ/.test(text)) return "evacuate";
  if (/ไฟ|ชาร์จ|แบต/.test(text)) return "power";
  if (/ยา/.test(text)) return "medicine";
  if (/อาหาร|น้ำดื่ม|ข้าว|หิว|ขนม/.test(text)) return "food";
  if (/ยก|ขน|ย้าย/.test(text)) return "move_items";
  if (/หมา|แมว|สัตว์/.test(text)) return "pets";
  return "other";
}

// "ผู้สูงอายุ 2 คน เด็ก 3 คน" -> 5 (null when no count is written)
export function peopleInText(text) {
  const nums = [...text.matchAll(/(\d+)\s*คน/g)].map((m) => Number(m[1]));
  return nums.length ? nums.reduce((a, b) => a + b, 0) : null;
}

// Same thresholds as backend level_from_cm()
export function levelFromCm(cm) {
  const bounds = [0, 15, 35, 55, 75, 99];
  const i = bounds.findIndex((b) => cm <= b);
  return i === -1 ? 6 : i;
}

export const WATER_TREND = {
  up: ["⬆️", "กำลังขึ้น"],
  steady: ["➡️", "ทรงตัว"],
  down: ["⬇️", "กำลังลด"],
};
export const WATER_WHERE = {
  street: ["🛣️", "บนถนน"],
  house: ["🏠", "ในบ้าน"],
};

export function categoryOf(post) {
  return CATEGORIES[post.kind]?.[post.category] || ["❓", post.category];
}

export function waterOf(level) {
  return WATER_LEVELS[level] || WATER_LEVELS[WATER_LEVELS.length - 1];
}

export const ANNOUNCEMENT_LEVELS = {
  danger: { label: "ด่วนมาก / อันตราย", icon: "🚨", cls: "bg-red-600 text-white border-red-800" },
  warning: { label: "เตือน", icon: "⚠️", cls: "bg-yellow-300 text-black border-black" },
  info: { label: "แจ้งทั่วไป", icon: "📢", cls: "bg-black text-white border-black" },
};

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
  return new Date(iso).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function osmLink(lat, lng) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}`;
}
