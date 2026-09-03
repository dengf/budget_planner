import React from 'react';

/**
 * Small inline outline icons for the three ways a transaction can enter
 * the app besides typing it in -- camera, PDF, spreadsheet. Hand-drawn
 * SVG, not an icon-font/library dependency, matching this app's
 * minimal-dependency stance (see `MeifioMark.jsx`). Decorative only: the
 * label text next to each one already carries the accessible name, so
 * these are `aria-hidden`.
 */
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'field-icon',
  'aria-hidden': true,
};

export function CameraIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.2-2h6.6l1.2 2h2A1.5 1.5 0 0 1 20 8.5v9A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  );
}

export function PdfIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
      <path d="M8.3 17v-4h1.1a1.3 1.3 0 1 1 0 2.6H8.3" />
      <path d="M12.1 17v-4h1c.9 0 1.6.9 1.6 2s-.7 2-1.6 2h-1Z" />
      <path d="M16 17v-4h2M16 15.2h1.6" />
    </svg>
  );
}

export function SpreadsheetIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="4" width="16" height="16" rx="1.2" />
      <path d="M4 9.5h16M4 14.5h16M9.5 4v16" />
    </svg>
  );
}

/**
 * Bottom/top nav icons -- same thin-stroke convention as the three
 * above, not CategoryIcons.jsx's soft-filled register (that one is
 * reserved for category badges only, see that file's own comment). A
 * bigger fixed size than `.field-icon` (15px) -- these sit alone in a tap
 * target rather than beside a text label they need to stay small next to.
 */
const NAV_ICON_PROPS = { ...ICON_PROPS, className: 'nav-icon' };

export function DashboardIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <rect x="4" y="4" width="7" height="9" rx="1.2" />
      <rect x="13" y="4" width="7" height="5" rx="1.2" />
      <rect x="13" y="11" width="7" height="9" rx="1.2" />
      <rect x="4" y="15" width="7" height="5" rx="1.2" />
    </svg>
  );
}

export function BudgetIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M12 3v9l7.8 4.5" />
      <path d="M20.4 13.5A8.4 8.4 0 1 1 12 3.6" />
    </svg>
  );
}

export function TransactionsIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M6 4h12a1 1 0 0 1 1 1v15l-3-2-3 2-3-2-3 2-3-2V5a1 1 0 0 1 1-1Z" />
      <path d="M8.5 9h7M8.5 13h7" />
    </svg>
  );
}

export function GoalsIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M12 4c1.4 2.6 2.4 4.4 4 5.5-1.6 1.6-2.6 3.8-4 6.5-1.4-2.7-2.4-4.9-4-6.5 1.6-1.1 2.6-2.9 4-5.5Z" />
      <path d="M12 16v4" />
    </svg>
  );
}

export function DebtIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M4 7 9.5 12.5 13 9 20 16" />
      <path d="M20 10.5V16h-5.5" />
    </svg>
  );
}
