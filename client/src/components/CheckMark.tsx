// The green check that marks a moment of "done" (a day cleared, a list emptied, a reading confirmed):
// it pops in and draws its tick when an ancestor carries `just-cleared` (styles.css, "my tasks").

export function CheckMark({ size = 22 }: { size?: number }) {
  return (
    <span className="day-check" aria-hidden="true">
      <svg viewBox="0 0 24 24" width={size} height={size}>
        <circle cx="12" cy="12" r="10.5" />
        <path d="M7 12.5l3.2 3.2L17 9" />
      </svg>
    </span>
  );
}
