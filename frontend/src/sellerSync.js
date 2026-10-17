// ลิงก์ร้านของฉัน (17 Oct): one seller, several phones / apps, no account (backend/seller.py).
// The pass is made here (random, never shown to anyone else); each post's edit key is registered under it, and any
// browser that opens serithai57.com/#shop-pass~<pass> pulls the keys back — "ของฉัน", edit, orders on every device.
import { api, load, save } from "./api";

const KEY = "sellerPass";
export const getPass = () => load(KEY, "");

export function ensurePass() {
  let p = getPass();
  if (!p) {
    const a = new Uint8Array(18);
    crypto.getRandomValues(a);
    p = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    save(KEY, p);
  }
  return p;
}

export const passLink = (p = getPass()) => `${window.location.origin}/#shop-pass~${p}`;

// a new post (or a key that arrived by a LINE link): keep it under the pass, if this browser has one
export async function pushKey(kind, id, key) {
  const p = getPass();
  if (!p || !id || !key) return;
  try {
    await api("/seller/sync", { method: "POST", headers: { "X-Seller-Pass": p }, body: JSON.stringify({ kind, id, key }) });
  } catch {}
}

// everything this browser owns → under the pass (made if needed)
export async function pushAll() {
  ensurePass();
  const jobs = [
    ...Object.entries(load("lendKeys", {})).map(([id, key]) => pushKey("lend", id, key)),
    ...Object.entries(load("serviceKeys", {})).map(([id, key]) => pushKey("service", id, key)),
  ];
  await Promise.all(jobs);
}

// the pass's posts → this browser; returns how many keys came in
export async function pullKeys() {
  const p = getPass();
  if (!p) return 0;
  try {
    const r = await api("/seller/sync", { headers: { "X-Seller-Pass": p } });
    save("lendKeys", { ...load("lendKeys", {}), ...(r.lend || {}) });
    save("serviceKeys", { ...load("serviceKeys", {}), ...(r.service || {}) });
    return Object.keys(r.lend || {}).length + Object.keys(r.service || {}).length;
  } catch {
    return 0;
  }
}
