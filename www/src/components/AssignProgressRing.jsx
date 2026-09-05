import React from 'react';

const RADIUS = 24;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The zero-based-budgeting "win state," made visual: a ring that fills as
 * `total_planned` approaches `income`. Text alone (the assign banner)
 * already said this; research on budgeting-app gamification consistently
 * points at a visibly filling indicator as what turns "assign every
 * dollar" into something that feels like progress rather than a chore.
 * Pure presentational -- `fraction` and `state` are derived by the
 * caller from budget_calc's own numbers, nothing new is calculated here.
 *
 * `aria-hidden` -- same convention as `CategoryBadge`: the adjacent
 * `.assign-label` text already carries the accessible meaning.
 */
export default function AssignProgressRing({ fraction, state }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const offset = CIRCUMFERENCE * (1 - clamped);
  return (
    <svg
      className={`assign-progress-ring assign-progress-ring-${state}`}
      viewBox="0 0 56 56"
      aria-hidden="true"
    >
      <circle className="ring-track" cx="28" cy="28" r={RADIUS} />
      <circle
        className="ring-fill"
        cx="28"
        cy="28"
        r={RADIUS}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 28 28)"
      />
    </svg>
  );
}
