import { load, save } from "./api";

// Which visit this is (a fresh open of the site; reloads in the same tab count once).
const visitNo = (() => {
  try {
    const v = Number(sessionStorage.getItem("visitNo"));
    if (v) return v;
    const n = (Number(load("visitCount", 0)) || 0) + 1;
    save("visitCount", n);
    sessionStorage.setItem("visitNo", String(n));
    return n;
  } catch {
    return 1;
  }
})();

// On how many separate visits has this thing been on screen (this one included)?
// Boxes use it to step back on their own: full → small → gone, when nobody taps them.
export function seenVisits(key) {
  const all = load("seenVisits", {});
  const e = all[key];
  if (e && e.last === visitNo) return e.n;
  const n = (e?.n || 0) + 1;
  const keys = Object.keys(all);
  if (keys.length > 200) keys.slice(0, keys.length - 150).forEach((k) => delete all[k]);
  save("seenVisits", { ...all, [key]: { n, last: visitNo } });
  return n;
}
