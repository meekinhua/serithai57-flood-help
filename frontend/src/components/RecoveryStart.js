// The landing tab once the water is gone (3 Oct 2026): "what do I do with my house now", step by step,
// each step one tap away from the board that helps with it.
const CLAIM_URL = "https://claim.bangkok.go.th/";

function Step({ n, emoji, title, tip, children }) {
  return (
    <section className="rounded-2xl bg-white p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black text-lg font-bold text-white" aria-hidden="true">
          {n}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-snug">
            <span aria-hidden="true">{emoji}</span> {title}
          </h3>
          <p className="text-sm text-neutral-700">{tip}</p>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">{children}</div>
    </section>
  );
}

function Go({ onClick, href, children, strong = false, badge }) {
  const cls = `relative flex min-h-[48px] items-center justify-center rounded-xl px-3 text-center font-semibold ${strong ? "bg-black text-white" : "border-2 border-black bg-white"}`;
  const b = badge > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{badge}</span>;
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
      {b}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {children}
      {b}
    </button>
  );
}

export default function RecoveryStart({ onTab, onJob, onLend, onIssue, counts = {} }) {
  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-neutral-600">น้ำแห้งแล้ว — ทำทีละขั้น แตะปุ่มเพื่อหาคนช่วย ของยืม หรือช่างในหมู่บ้าน</p>

      <Step
        n={1}
        emoji="⚡"
        title="ไฟฟ้าก่อน อย่าเพิ่งเปิดเบรกเกอร์"
        tip="ถ้าปลั๊ก สวิตช์ หรือตู้ไฟเคยจมน้ำ ให้ตากให้แห้งและให้คนที่รู้เรื่องดูก่อนเปิด · มีช่างไฟฟรี จ.–พ. 5–7 ต.ค. (ลงชื่อในกล่อง ⚡ บนสุด)"
      >
        <Go strong onClick={() => onJob("check")}>
          ⚡ ขอคนช่วยดูไฟ
        </Go>
        <Go onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>ลงชื่อช่างไฟฟรี ↑</Go>
        <Go onClick={() => onTab("pros")}>หาช่างไฟ</Go>
      </Step>

      <Step n={2} emoji="🧽" title="ล้างบ้าน ขัดโคลน ขนของ" tip="ไม่ต้องซื้อใหม่ทุกอย่าง — ยืมเครื่องฉีดน้ำ ไม้ขัด รถเข็นจากเพื่อนบ้าน หรือขอแรงอาสา">
        <Go strong onClick={() => onTab("lend")} badge={counts.lend}>
          🧰 ยืมอุปกรณ์
        </Go>
        <Go onClick={() => onJob("clean")}>🙋 ขอแรงช่วยล้าง</Go>
        <Go onClick={() => onJob("move")}>📦 ขอคนช่วยยกของ</Go>
      </Step>

      <Step n={3} emoji="🗑️" title="ขยะ: ชิ้นใหญ่ริมถนน เศษอาหารเก็บในบ้าน" tip="ดูวันรถเก็บและวิธีแยกขยะ · กองขยะส่งกลิ่นในซอยไหน แจ้งไว้ให้คหบาล/เขตเห็น">
        <Go strong onClick={() => onTab("waste")}>
          ♻️ วันรถเก็บ · วิธีแยก
        </Go>
        <Go onClick={onIssue}>📍 แจ้งกองขยะในซอย</Go>
        <Go onClick={() => onJob("trash")}>🗑️ ขอคนช่วยขนไปทิ้ง</Go>
      </Step>

      <Step n={4} emoji="🔧" title="ซ่อมบ้าน ซ่อมรถ ซ่อมเครื่องใช้ไฟฟ้า" tip="ช่างและร้านที่เพื่อนบ้านใช้แล้วรีวิว · ถามเพื่อนบ้านว่าซ่อมอะไรยังไง ใช้ร้านไหน">
        <Go strong onClick={() => onTab("pros")} badge={counts.pros}>
          🔧 ช่าง · ร้านแนะนำ
        </Go>
        <Go onClick={() => onJob("hire")}>🧑‍🔧 ประกาศหาช่าง</Go>
        <Go onClick={() => onTab("forum")}>💬 ถามเพื่อนบ้าน</Go>
      </Step>

      <Step n={5} emoji="💸" title="ขอเงินช่วยเหลือน้ำท่วม กทม." tip="ถ่ายรูปความเสียหายเก็บไว้ก่อนซ่อมหรือทิ้งของ · ยื่นขอออนไลน์ได้ที่เว็บ กทม.">
        <Go strong href={CLAIM_URL}>
          💸 ยื่นขอเงินช่วยเหลือ ↗
        </Go>
        <Go onClick={() => onTab("forum")}>ถามวิธียื่น</Go>
        <Go onClick={() => onTab("guide")}>📋 เช็กลิสต์ทั้งหมด</Go>
      </Step>
    </div>
  );
}
