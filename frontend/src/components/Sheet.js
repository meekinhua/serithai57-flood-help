import { useEffect, useRef } from "react";

// A bottom sheet on phones, a dialog on wider screens.
// 17 Oct, phones: fits the screen even with the browser bars / keyboard (dvh), keeps clear of the home bar
// (safe area), the list inside scrolls on its own, and the phone's back button closes the sheet instead of
// leaving the page (a history entry is pushed when it opens).
export default function Sheet({ title, onClose, children }) {
  const close = useRef(onClose);
  close.current = onClose;
  const id = useRef(Math.random().toString(36).slice(2));
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && userClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    if (window.history.state?.sheet !== id.current) window.history.pushState({ ...(window.history.state || {}), sheet: id.current }, ""); // once (dev mounts twice)
    const onPop = (e) => {
      if (e.state?.sheet !== id.current) close.current();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      document.body.style.overflow = "";
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // closed by the person (✕, the dimmed area, Esc): take our history entry back, which closes the sheet
  function userClose() {
    if (window.history.state?.sheet === id.current) window.history.back();
    else close.current();
  }

  return (
    <div className="anim-fade fixed inset-0 z-[1000] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={userClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ maxHeight: "92dvh" }}
        className="anim-sheet flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:max-w-lg sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-neutral-300 sm:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-4 py-1.5">
          <h2 className="min-w-0 text-lg font-semibold leading-snug">{title}</h2>
          <button onClick={userClose} aria-label="ปิด" className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg text-2xl text-neutral-500 active:bg-neutral-100">
            ✕
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-3">{children}</div>
      </div>
    </div>
  );
}
