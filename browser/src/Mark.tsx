// Three faceted slabs cut from one gradient: separate accounts, one book.
// The gradient spans the whole mark in user space rather than repeating per
// slab, which is what makes it read as one object rather than three.
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="openportfolio">
      <defs>
        <linearGradient id="mark-facet" gradientUnits="userSpaceOnUse" x1="6" y1="6" x2="46" y2="58">
          <stop offset="0" stopColor="#8b9cff" />
          <stop offset="0.55" stopColor="#5b6cf0" />
          <stop offset="1" stopColor="#7c5cf0" />
        </linearGradient>
        <linearGradient id="mark-spec" gradientUnits="userSpaceOnUse" x1="0" y1="6" x2="0" y2="20">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g
        transform="translate(3.2 3.2) scale(0.9)"
        strokeLinejoin="round"
        strokeWidth="3.5"
        stroke="url(#mark-facet)"
        fill="url(#mark-facet)"
      >
        <path d="M2 54 H14 L17.6 38 H5.6 Z" opacity="0.42" />
        <path d="M23 54 H35 L41.4 23 H29.4 Z" opacity="0.7" />
        <path d="M44 54 H56 L65 8 H53 Z" />
        <path d="M5.6 38 H17.6 L16.5 43 H4.5 Z" fill="url(#mark-spec)" stroke="none" opacity="0.5" />
        <path d="M29.4 23 H41.4 L40.3 28 H28.3 Z" fill="url(#mark-spec)" stroke="none" opacity="0.45" />
        <path d="M53 8 H65 L63.9 13 H51.9 Z" fill="url(#mark-spec)" stroke="none" opacity="0.4" />
      </g>
    </svg>
  );
}
