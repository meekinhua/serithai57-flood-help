// A short line at the top ("ซ่อนแล้ว · ดูได้ที่ …") from anywhere; RepairApp shows it as its toast.
export const notify = (text) => window.dispatchEvent(new CustomEvent("app-toast", { detail: text }));

// Scroll to a place and flash it once: "this is where it went".
export function flashTo(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.remove("anim-fresh");
  void el.offsetWidth; // restart the animation
  el.classList.add("anim-fresh");
}
