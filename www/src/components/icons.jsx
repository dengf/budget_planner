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
 * Header trigger for `YourDataMenu` -- the plan artifact's own `#i-gear`
 * glyph (a spoked circle), used verbatim. An earlier round swapped this
 * for three preference sliders instead, on the judgment that a spoked
 * gear at header-icon size read as a sun/brightness toggle this app has
 * no matching control for; overridden here on explicit request to match
 * the approved plan's own icon rather than that earlier substitution.
 * Sized via `nav-icon` rather than the inherited `.field-icon` -- like
 * the bottom nav's icons, this one stands alone in its own 44px tap
 * target instead of sitting beside label text.
 *
 * mortgage_calculator now carries this same glyph for the same button;
 * the two were different icons on the same control until this round.
 * Change both or neither. (The redundant `aria-hidden` that used to be
 * spelled out on the <svg> is gone -- `ICON_PROPS` already sets it.) */
export function SettingsIcon() {
  return (
    <svg {...ICON_PROPS} className="nav-icon">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6M18.7 18.7l-1.6-1.6M6.9 6.9 5.3 5.3" />
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
      <path d="M5 19V9M12 19V5M19 19v-6" />
      <path d="M3 21h18" />
    </svg>
  );
}

/** Manual entry, in the "Add a transaction" method row -- a pen, the
 *  plan artifact's own `#i-pen` glyph, matching `CameraIcon`/
 *  `SpreadsheetIcon`/`RecurringIcon` right below it as that row's other
 *  three method icons. */
export function PenIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M4 20h4L19.2 8.8a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16Z" />
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

/**
 * Categorization rules -- a funnel. A rule takes the whole stream of
 * incoming transactions and sorts each one by a keyword, which is what a
 * funnel shape says without a label; a tag or a label glyph would say
 * "this names one thing", which is the result, not the mechanism.
 */
export function RulesIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M4 5h16l-6 7v7l-4-2v-5Z" />
    </svg>
  );
}

/** Recurring expenses -- the standard cycle arrow, with the clock hand
 *  inside it that separates "repeats" from "refresh/undo". */
export function RecurringIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
      <path d="M12 8.5V12l2.5 1.5" />
    </svg>
  );
}

/** Categories, in More -- a price tag, the one shape that reads as
 *  "a single thing, labelled and sorted" without borrowing RulesIcon's
 *  funnel (the stream of transactions) or a category badge's filled
 *  register (CategoryIcons.jsx is a deliberately different, "cute" style
 *  -- see its own doc comment for why this file doesn't reuse it). */
export function CategoriesIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <path d="M11.5 4H6a2 2 0 0 0-2 2v5.5a2 2 0 0 0 .6 1.4l8 8a2 2 0 0 0 2.8 0l5.5-5.5a2 2 0 0 0 0-2.8l-8-8a2 2 0 0 0-1.4-.6Z" />
      <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/**
 * The "More" tab -- a plain horizontal ellipsis, deliberately NOT the
 * same shape as `SettingsIcon` above. Both can be on screen at once (the
 * header keeps its settings trigger while More holds Goals/Debt), and
 * two near-identical dot-and-line glyphs a few hundred pixels apart read
 * as the same control rendered twice. A spoked circle for settings,
 * three dots for "the rest of the app" -- the distinction has to survive
 * at 19px. (This note used to say "sliders for settings", describing a
 * glyph SettingsIcon no longer draws; the point it makes is unchanged.)
 */
export function MoreIcon() {
  return (
    <svg {...NAV_ICON_PROPS}>
      <circle cx="5.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
