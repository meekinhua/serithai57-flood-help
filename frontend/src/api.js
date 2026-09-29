import { useEffect, useState } from "react";
// Every backend call goes through here. The platform injects REACT_APP_BACKEND_URL.
export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

// Team link (serithai57.com/hq#k=… or /team#k=…): the team works without accounts. The key comes in the
// URL #fragment (never sent to the server or in Referer), is kept on this device, and goes out as a header.
export function teamKey() {
  const m = window.location.hash.match(/[#&]k=([A-Za-z0-9_-]{16,})/);
  if (m) {
    save("teamKey", m[1]);
    // drop the key from the address bar so a screenshot or a copied URL doesn't leak it
    const rest = window.location.hash.replace(/[#&]?k=[A-Za-z0-9_-]+/, "").replace(/^#?&?/, "");
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
  }
  return load("teamKey", "");
}

export function useTeamKey() {
  const [key, setKey] = useState(() => teamKey());
  useEffect(() => {
    const on = () => setKey(teamKey());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return key;
}

export function forgetTeamKey() {
  save("teamKey", "");
}

export async function api(path, options = {}) {
  const key = teamKey();
  const res = await fetch(`${API}${path}`, {
    credentials: "include", // admin session cookie
    ...options,
    headers: { "Content-Type": "application/json", ...(key ? { "X-Team-Key": key } : {}), ...options.headers },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = typeof body.detail === "string" ? body.detail : body.detail?.[0]?.msg || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// Small localStorage helpers; storage can be unavailable (private mode), so never throw.
// Anonymous per-browser id for the "people viewing now" counter.
export function viewerId() {
  let id = load("viewerId", null);
  if (!id) {
    id = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^A-Za-z0-9_-]/g, "");
    save("viewerId", id);
  }
  return id;
}

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
