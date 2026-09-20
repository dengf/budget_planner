import React from 'react';

/*
 * The meifio logotype.
 *
 * Generated from meifio-brand/svg/logotype.svg -- letterforms constructed from
 * primitives, the plum blossom standing in for the first i's tittle and a peak
 * on the second. Do not hand-edit; regenerate from the brand repo if the mark
 * changes.
 *
 * The letters take currentColor so the mark inherits the colour of the byline
 * it sits in. Only the blossom is fixed -- it is the brand's one constant, and
 * meifio-brand/README.md is explicit that it does not recolour per tool.
 *
 * "Fixed" means fixed per theme, not one literal. The brand book gives the
 * blossom two values, #B01243 on light and #F2547F on dark, and this file used
 * to hardcode the light one -- so every one of these tools, all three of which
 * default to a dark page, drew the blossom in the plum meant for white paper.
 * It reads as a muddy maroon smudge at tittle size on #0f1720. `--brand-plum`
 * is declared in each app's main.css across all three theme tiers; the literal
 * stays as a fallback for any context that renders the mark without those
 * tokens.
 *
 * Default height is deliberately larger than the surrounding text: at 1em the
 * mark rendered 35px wide, and six letters across 35px is mush. A logotype set
 * into running text normally sits a little above the text size for exactly
 * this reason.
 *
 * This file is identical in mortgage_calculator, budget_planner and
 * postcard_maker, and is meant to stay that way -- the three copies had
 * already drifted to two different SVG element ids. Copy it whole rather than
 * editing one in place.
 */
export default function MeifioMark({ height = '1.4em' }) {
  /* The petal is drawn once and re-used five times, which needs an id, and an
     id is document-global. A hardcoded one breaks the moment the mark renders
     twice on a page (a header and a footer both wanting it is not exotic):
     every `use` in both copies resolves to whichever definition the document
     happens to reach first. `useId` makes it per-instance. */
  const petalId = `meifio-petal-${React.useId()}`;

  return (
    <svg
      className="meifio-mark"
      viewBox="-8 -33.0 383.2 143.0"
      style={{ height }}
      role="img"
      aria-label="meifio"
    >
      <title>meifio</title>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11.2 100.0 V24.0" transform="translate(0.00 0)" />
        <path d="M11.2 48.0 a24 24 0 0 1 48 0 V100.0" transform="translate(0.00 0)" />
        <path d="M59.2 48.0 a24 24 0 0 1 48 0 V100.0" transform="translate(0.00 0)" />
        <path d="M11.20 62.00 H77.20" transform="translate(115.40 0)" />
        <path d="M77.20 62.00 A33.0 33.0 0 1 0 71.23 80.93" transform="translate(115.40 0)" />
        <path d="M11.2 24.0 V100.0" transform="translate(200.80 0)" />
        <path
          d="M14.799999999999999 100.0 V12.0 a24 24 0 0 1 24 -24"
          transform="translate(220.20 0)"
        />
        <path d="M-3.200000000000001 24.0 H37.599999999999994" transform="translate(220.20 0)" />
        <path d="M11.2 24.0 V100.0" transform="translate(262.40 0)" />
        <path d="M44.2 29.0 a33.0 33.0 0 1 1 -0.01 0 z" transform="translate(281.80 0)" />
      </g>
      <path
        d="M273.60 -16.50 L284.60 5.50 L262.60 5.50 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <g transform="translate(192.50 -25.00) scale(0.39)" fill="var(--brand-plum, #B01243)">
        <path id={petalId} d="M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z" />
        <use href={`#${petalId}`} transform="rotate(72 50 50)" />
        <use href={`#${petalId}`} transform="rotate(144 50 50)" />
        <use href={`#${petalId}`} transform="rotate(216 50 50)" />
        <use href={`#${petalId}`} transform="rotate(288 50 50)" />
      </g>
    </svg>
  );
}
