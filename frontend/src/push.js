// Web Push for บ้านฉัน (backend push.py): the phone's own notifications, tied to the house number.
import { api, load, save } from "./api";

export const TOPICS = [
  ["lost", "🐾", "หาย·เจอ", "สัตว์เลี้ยงหาย/เจอ ทั้งหมู่บ้าน · ของหายในซอยคุณ", true],
  ["waste", "🚛", "รถขยะ", "เตือน 6 โมงเย็น ก่อนวันรถเข้าซอยคุณ", true],
  ["news", "📣", "ประกาศจากทีม", "เรื่องสำคัญเท่านั้น เช่น ตรวจไฟ เยียวยา น้ำมา", true],
  ["help", "🙋", "เพื่อนบ้านในซอยขอแรง", "มีคนในซอยคุณขอให้ช่วย", false],
];
export const defaultTopics = () => load("pushTopics", null) || TOPICS.filter((t) => t[4]).map((t) => t[0]);

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;

function keyBytes(b64) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return reg ? reg.pushManager.getSubscription() : null;
}

// "off" | "on" | "denied" | "ios-install" (iPhone: only from the home-screen icon) | "unsupported"
export async function pushStatus() {
  if (!pushSupported()) return isIOS() && !standalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await currentSub()) && Notification.permission === "granted" ? "on" : "off";
}

async function saveSub(sub, house, topics) {
  const j = sub.toJSON();
  const r = await api("/push/subscribe", { method: "POST", body: JSON.stringify({ sub: { endpoint: j.endpoint, keys: j.keys }, house: house || "", topics }) });
  save("pushTopics", topics);
  save("pushHouse", r.house || "");
  return r;
}

export async function enablePush(house, topics) {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error(perm === "denied" ? "denied" : "dismissed");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api("/push/key");
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  return saveSub(sub, house, topics);
}

export async function updatePush(house, topics) {
  const sub = await currentSub();
  if (sub) return saveSub(sub, house, topics);
}

export async function disablePush() {
  const sub = await currentSub();
  if (!sub) return;
  await api("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

export async function testPush() {
  const sub = await currentSub();
  if (!sub) throw new Error("ยังไม่ได้เปิดแจ้งเตือน");
  return api("/push/test", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) });
}
