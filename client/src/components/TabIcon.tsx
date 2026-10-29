// The phone bar's symbols: every tab an outline, the chosen one the same symbol filled. A detail cut out of a
// filled symbol (the check on the board, the gap around its clip) is drawn in the colour under it (--bar-bg:
// the solid mark under the chosen tab).

export type TabIconName = 'home' | 'cadets' | 'weeks' | 'tasks';

const HOUSE = 'M4 10.3 12 3.5l8 6.8v9.2a1.5 1.5 0 0 1-1.5 1.5H15v-4.5a3 3 0 0 0-6 0V21H5.5A1.5 1.5 0 0 1 4 19.5z';
const CAP_TOP = 'M12 5 2.4 9.8 12 14.6l9.6-4.8z';
const CAP_TASSEL = 'M21.6 9.8v5.4';
const STACK_TOP = 'M12 3.5 2.8 8.2 12 12.9l9.2-4.7z';
const STACK_LOWER = 'M2.8 12.4 12 17.1l9.2-4.7M2.8 16.6 12 21.3l9.2-4.7';
const CHECK = 'm8.8 13.6 2.3 2.3 4.3-4.5';
const CLIP = { x: 8.4, y: 2.9, width: 7.2, height: 3.8, rx: 1.1 };

function shapes(name: TabIconName, filled: boolean) {
  switch (name) {
    case 'home':
      return <path className={filled ? 'ti-fill' : undefined} d={HOUSE} />;
    case 'cadets':
      return filled ? (
        <>
          <path className="ti-fill" d={CAP_TOP} />
          {/* the band under the cap's top, a thin gap between them */}
          <path className="ti-solid" d="M5.35 13.85 12 17.2l6.65-3.35v2.9c-1.8 1.9-4.2 3.05-6.65 3.05s-4.85-1.15-6.65-3.05z" />
          <path d={CAP_TASSEL} />
        </>
      ) : (
        <>
          <path d={CAP_TOP} />
          <path d="M6.3 12.1v4.4c1.6 1.6 3.6 2.4 5.7 2.4s4.1-.8 5.7-2.4v-4.4" />
          <path d={CAP_TASSEL} />
        </>
      );
    case 'weeks':
      return (
        <>
          <path className={filled ? 'ti-fill' : undefined} d={STACK_TOP} />
          <path d={STACK_LOWER} />
        </>
      );
    case 'tasks':
      return filled ? (
        <>
          <rect className="ti-fill" x="4.8" y="4.8" width="14.4" height="16.6" rx="1.8" />
          {/* the clip stands apart from the board by a thin gap */}
          <rect className="ti-gap" {...CLIP} />
          <rect className="ti-fill" {...CLIP} />
          <path className="ti-cut" d={CHECK} />
        </>
      ) : (
        <>
          <path d="M8.4 4.8H6.6a1.8 1.8 0 0 0-1.8 1.8v13a1.8 1.8 0 0 0 1.8 1.8h10.8a1.8 1.8 0 0 0 1.8-1.8v-13a1.8 1.8 0 0 0-1.8-1.8h-1.8" />
          <rect {...CLIP} />
          <path d={CHECK} />
        </>
      );
  }
}

export function TabIcon({ name, filled }: { name: TabIconName; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`tab-icon${filled ? ' is-filled' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {shapes(name, filled)}
    </svg>
  );
}
