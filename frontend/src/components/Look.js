// 7 Oct 2026: home-page blocks are re-ordered and re-coloured from the chat with Claude (tools/site.py layout),
// stored in /home as layout[key] = {order, tone, border, fill, open}. Only these palettes exist, so the page
// keeps one look whatever is chosen.

export const TONES = {
  green: { line: "#1E6B47", soft: "#E4F0E9" },
  blue: { line: "#1F5FA8", soft: "#E3EDF9" },
  orange: { line: "#B45F06", soft: "#FCEFD9" },
  red: { line: "#B42318", soft: "#FDE7E4" },
  yellow: { line: "#A27C00", soft: "#FFF6DA" },
  gray: { line: "#45504A", soft: "#ECEFEC" },
};
const WIDTH = { none: 0, thin: 1, thick: 4 };

// The order blocks take when the layout says nothing about them.
export const DEFAULT_ORDER = ["events", "announce", "pros", "myhome", "watch", "fund", "water", "community", "survey", "hub", "archive"];

// A block's look: its own defaults, overridden by what the admin set. Returns inline styles for the frame
// (border + background) and, for a solid fill, the title bar.
export function lookOf(layout, key, defaults = {}) {
  const cfg = { tone: "gray", border: "thin", fill: "white", ...defaults, ...((layout || {})[key] || {}) };
  const t = TONES[cfg.tone] || TONES.gray;
  const w = WIDTH[cfg.border] ?? 1;
  const frame = {
    borderStyle: w ? "solid" : "none",
    borderWidth: w,
    borderColor: cfg.border === "thin" && cfg.fill !== "solid" ? "#DCE2DD" : t.line,
    background: cfg.fill === "soft" ? t.soft : "#FFFFFF",
  };
  if (cfg.border === "thin" && cfg.tone !== "gray") frame.borderColor = t.line;
  const head = cfg.fill === "solid" ? { background: t.line, color: "#FFFFFF" } : null;
  return { frame, head, open: cfg.open, solid: cfg.fill === "solid", line: t.line };
}

// Blocks sorted by layout order; site.py writes a full 1..n order, unset blocks keep DEFAULT_ORDER.
export function ordered(layout, keys) {
  const pos = (k) => (layout?.[k]?.order != null ? layout[k].order : DEFAULT_ORDER.indexOf(k) + 1) * 10 + DEFAULT_ORDER.indexOf(k) / 100;
  return [...keys].sort((a, b) => pos(a) - pos(b));
}
