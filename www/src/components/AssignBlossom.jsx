import React from 'react';

/**
 * The banner's icon -- the brand's five-petal blossom (same construction
 * as `MeifioMark`'s mark, see its own doc comment: "the blossom is the
 * brand's one constant"), reused here as a motif rather than duplicated
 * by hand. Deliberately NOT `AssignProgressRing` re-skinned: that ring's
 * `fraction` literally animates `petals_filled`-style progress, and the
 * plan's own "Savings is the hero" section keeps that one true animated
 * blossom on Dashboard. This one is static -- `currentColor`, set by the
 * `state` modifier class below, same three states the ring used to carry
 * (`start`/`over`/`onTrack`) so the banner's meaning doesn't change, only
 * its icon's shape.
 */
export default function AssignBlossom({ state }) {
  return (
    <svg
      className={`assign-blossom assign-blossom-${state}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <g fill="currentColor">
        <path
          id="assign-blossom-petal"
          d="M50 50 C41 46 34 38 34 27 A16 16 0 1 1 66 27 C66 38 59 46 50 50 Z"
        />
        <use href="#assign-blossom-petal" transform="rotate(72 50 50)" />
        <use href="#assign-blossom-petal" transform="rotate(144 50 50)" />
        <use href="#assign-blossom-petal" transform="rotate(216 50 50)" />
        <use href="#assign-blossom-petal" transform="rotate(288 50 50)" />
      </g>
    </svg>
  );
}
