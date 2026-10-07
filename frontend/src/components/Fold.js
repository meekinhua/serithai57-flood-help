// Opens and closes smoothly (CSS grid rows 0fr → 1fr); children stay mounted so nothing jumps.
export default function Fold({ open, children, className = "" }) {
  return (
    <div className={`fold ${open ? "open" : ""} ${className}`} aria-hidden={!open}>
      <div>{children}</div>
    </div>
  );
}
