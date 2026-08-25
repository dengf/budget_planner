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
 * it sits in. Only the blossom is fixed -- it is the brand's one constant.
 *
 * Default height is deliberately larger than the surrounding text: at 1em the
 * mark rendered 35px wide, and six letters across 35px is mush. A logotype set
 * into running text normally sits a little above the text size for exactly
 * this reason.
 */
export default function MeifioMark({ height = '1.4em' }) {
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
        <path d="M14.799999999999999 100.0 V12.0 a24 24 0 0 1 24 -24" transform="translate(220.20 0)" />
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
      <g transform="translate(192.50 -25.00) scale(0.39)" fill="#B01243">
        <path id="mf-petal" d="M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z" />
        <use href="#mf-petal" transform="rotate(72 50 50)" />
        <use href="#mf-petal" transform="rotate(144 50 50)" />
        <use href="#mf-petal" transform="rotate(216 50 50)" />
        <use href="#mf-petal" transform="rotate(288 50 50)" />
      </g>
    </svg>
  );
}
