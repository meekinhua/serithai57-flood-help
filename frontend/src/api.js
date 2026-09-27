// Every backend call goes through here. The platform injects REACT_APP_BACKEND_URL.
const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include", // admin session cookie
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
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
