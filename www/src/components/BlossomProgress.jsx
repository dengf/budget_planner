import React from 'react';

const PETAL = 'M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z';
const ROTATIONS = [0, 72, 144, 216, 288];

/**
 * The brand blossom as a savings goal's progress display, instead of a
 * generic bar. `filled` (0-5, from `goal_progress`'s `petals_filled`) is
 * decided in Rust -- this component only draws whatever count it is
 * handed, the same division of labour as every other rendered figure in
 * the app.
 */
export default function BlossomProgress({ filled = 0, size = 64 }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <svg className="goal-blossom" viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`${filled} of 5`}>
      <defs>
        <path id={`${uid}p`} d={PETAL} />
      </defs>
      {ROTATIONS.map((angle, i) => (
        <use
          key={angle}
          href={`#${uid}p`}
          transform={`rotate(${angle} 50 50)`}
          fill={i < filled ? '#B01243' : 'none'}
          stroke={i < filled ? 'none' : '#3a4a5e'}
          strokeWidth={i < filled ? 0 : 2}
        />
      ))}
    </svg>
  );
}
