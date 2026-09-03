import React from 'react';

/**
 * Category badge icons: 14 starter-preset icons plus 2 generic fallbacks
 * for a hand-typed category. Deliberately a different visual register
 * from icons.jsx's thin-stroke toolbar icons -- these are solid, rounded,
 * filled shapes (fill="currentColor", no stroke) sitting inside a colored
 * circle, meant to read as this app's one overtly "cute" surface (see
 * categoryVisuals.js). Not an oversight that these don't match icons.jsx;
 * a future pass shouldn't "fix" them into the outline style.
 *
 * Every icon is `aria-hidden` -- the category name text next to the badge
 * already carries the accessible name, same reasoning icons.jsx uses for
 * its own decorative icons.
 *
 * Where a shape needs a "hole" (a coin's ring, a heart's cross), it's a
 * single `<path fillRule="evenodd">` rather than an opaque shape drawn in
 * a hardcoded color -- the hole is genuine transparency, so it shows
 * whatever color the badge circle behind it happens to be, instead of
 * baking in one specific palette color.
 */
const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
};

export function PaycheckIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M2.5 6.5A2 2 0 0 1 4.5 4.5h15A2 2 0 0 1 21.5 6.5v10A2 2 0 0 1 19.5 18.5h-15A2 2 0 0 1 2.5 16.5ZM12 8.2a3.3 3.3 0 1 1 0 6.6 3.3 3.3 0 0 1 0-6.6Z"
      />
    </svg>
  );
}

export function BriefcaseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M4 8.5A2 2 0 0 1 6 6.5h3V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5h3A2 2 0 0 1 20 8.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2ZM11 5h2v1.5h-2ZM4 12.5h16V14H4Z"
      />
    </svg>
  );
}

export function TrendingUpIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 16.5 9.2 10.3 13.2 14.3 18.3 9.2 20.6 11.5 13.2 18.9 9.2 14.9 5.3 18.7Z" />
      <path d="M15.5 5.5H21v5.5Z" />
    </svg>
  );
}

export function BuildingIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M5 3h10v18H5Zm12 6h4v12h-4ZM7.5 6H9v2H7.5Zm3.5 0h1.5v2H11Zm-3.5 4H9v2H7.5Zm3.5 0h1.5v2H11Zm-3.5 4H9v2H7.5Zm3.5 0h1.5v2H11Zm7.3-2h1.4v2h-1.4Zm0 4h1.4v2h-1.4Z"
      />
    </svg>
  );
}

export function CoinIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm0 5.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4Z"
      />
    </svg>
  );
}

export function HouseIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M12 3 21 11.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8.5ZM10 21v-7h4v7Z"
      />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M13 2 5 14h6l-2 8 10-13h-6Z" />
    </svg>
  );
}

export function BasketIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path fillRule="evenodd" d="M8.5 8c0-4 7-4 7 0h-1.8c0-2-3.4-2-3.4 0Z" />
      <rect x="4.5" y="8" width="15" height="2.4" rx="1.2" />
      <path d="M5 10.4h14l-1.5 10.1a1.5 1.5 0 0 1-1.5 1.3H8a1.5 1.5 0 0 1-1.5-1.3Z" />
    </svg>
  );
}

export function CarIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 15.5 5.5 10.5A2 2 0 0 1 7.4 9h9.2a2 2 0 0 1 1.9 1.5L20 15.5V18a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H7v1a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <circle cx="7.5" cy="17.3" r="1.6" />
      <circle cx="16.5" cy="17.3" r="1.6" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M12 20.5S3 14.8 3 9.2C3 6.2 5.2 4 8 4c1.8 0 3.2 1 4 2.3C12.8 5 14.2 4 16 4c2.8 0 5 2.2 5 5.2 0 5.6-9 11.3-9 11.3ZM11 8h2v2.5h2.5v2H13V15h-2v-2.5H8.5v-2H11Z"
      />
    </svg>
  );
}

export function CardIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Zm0 3h18v2.5H3Z"
      />
    </svg>
  );
}

export function SparkleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 2c.6 4.4 1.6 7.4 4 9.8-2.4.8-3.4 3.8-4 8.2-.6-4.4-1.6-7.4-4-8.2 2.4-2.4 3.4-5.4 4-9.8Z" />
      <path d="M18 4c.3 1.6.8 2.6 2 3-1.2.4-1.7 1.4-2 3-.3-1.6-.8-2.6-2-3 1.2-.4 1.7-1.4 2-3Z" />
    </svg>
  );
}

export function PeopleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="16" cy="8" r="2.2" opacity="0.85" />
      <path d="M12.5 20c.2-3.8 2-5.8 4.3-5.8s4.3 2.2 4.3 5.8Z" opacity="0.85" />
      <circle cx="9" cy="8" r="2.6" />
      <path d="M4 20c0-4.2 2.2-6.5 5-6.5s5 2.3 5 6.5Z" />
    </svg>
  );
}

export function TagIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M12.6 3H19a2 2 0 0 1 2 2v6.4a2 2 0 0 1-.6 1.4l-7.6 7.6a2 2 0 0 1-2.8 0L3.6 14a2 2 0 0 1 0-2.8l7.6-7.6a2 2 0 0 1 1.4-.6Zm2.9 3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z"
      />
    </svg>
  );
}

export function IncomeGenericIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path
        fillRule="evenodd"
        d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19ZM11 7h2v4h4v2h-4v4h-2v-4H7v-2h4Z"
      />
    </svg>
  );
}

export function ExpenseGenericIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path fillRule="evenodd" d="M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19ZM7 11h10v2H7Z" />
    </svg>
  );
}

export const CATEGORY_ICONS = {
  paycheck: PaycheckIcon,
  briefcase: BriefcaseIcon,
  'trending-up': TrendingUpIcon,
  building: BuildingIcon,
  coin: CoinIcon,
  house: HouseIcon,
  bolt: BoltIcon,
  basket: BasketIcon,
  car: CarIcon,
  heart: HeartIcon,
  card: CardIcon,
  sparkle: SparkleIcon,
  people: PeopleIcon,
  tag: TagIcon,
  'income-generic': IncomeGenericIcon,
  'expense-generic': ExpenseGenericIcon,
};
