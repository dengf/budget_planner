import React from 'react';

export const PETAL = 'M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z';
const ROTATIONS = [0, 72, 144, 216, 288];

/**
 * The brand blossom as a savings goal's progress display, instead of a
 * generic bar. `filled` (0-5, from `goal_progress`'s `petals_filled`) is
 * decided in Rust -- this component only draws whatever count it is
 * handed, the same division of labour as every other rendered figure in
 * the app.
 *
 * A filled petal's color used to be hardcoded (`#B01243`, meifio plum) --
 * now `var(--accent)` via `.goal-blossom-petal-filled` (see main.css),
 * since the app's own `--accent` token is that same plum. An empty
 * petal's outline is `var(--line)` for the same theme-awareness, in place
 * of its own old hardcoded `#3a4a5e`.
 */
export default function BlossomProgress({ filled = 0, size = 64 }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg
      className="goal-blossom"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={`${filled} of 5`}
    >
      <defs>
        <path id={`${uid}p`} d={PETAL} />
      </defs>
      {ROTATIONS.map((angle, i) => (
        <use
          key={angle}
          href={`#${uid}p`}
          transform={`rotate(${angle} 50 50)`}
          className={i < filled ? 'goal-blossom-petal-filled' : 'goal-blossom-petal-empty'}
          strokeWidth={i < filled ? 0 : 2}
        />
      ))}
    </svg>
  );
}

/**
 * A large, low-opacity rendering of the same five-petal path, purely
 * decorative -- the one place this app spends visual boldness on its own
 * brand mark instead of a generic gradient/pattern, behind Dashboard's
 * hero Savings figure (see `.dash-blossom-watermark` in main.css, which
 * sets the actual size/position/opacity/color; this component only
 * draws the shape). Reuses `PETAL` rather than a second copy of the path
 * string, same reasoning as `BlossomProgress` itself. `aria-hidden`
 * because it carries no information -- the real progress indicator is
 * `BlossomProgress` above.
 */
export function BlossomWatermark({ className }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      {ROTATIONS.map((angle) => (
        <path key={angle} d={PETAL} fill="currentColor" transform={`rotate(${angle} 50 50)`} />
      ))}
    </svg>
  );
}
