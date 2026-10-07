import { createContext, useContext } from "react";

// 7 Oct: wording changed from the chat without a redeploy (tools/site.py text). Every call carries its own
// default, so the page reads the same with nothing stored. {soi}-style holes are filled from `vars`.
// Open the page with ?texts=1 to see each key next to its text.
export const TextsContext = createContext({});
const SHOW_KEYS = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("texts");

export function useT() {
  const texts = useContext(TextsContext) || {};
  return (key, fallback, vars) => {
    let s = texts[key] ?? fallback;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? "");
    return SHOW_KEYS ? `[${key}] ${s}` : s;
  };
}
