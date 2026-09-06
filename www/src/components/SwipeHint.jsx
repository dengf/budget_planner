import React, { useState } from 'react';
import { useI18n } from '../i18n';
import { loadSeenSwipeHint, saveSeenSwipeHint } from '../swipeHint';

// `(pointer: coarse)` is the same signal App.jsx's own swipe gesture
// effectively requires (it only commits on `pointerType === 'touch'`) --
// a mouse/trackpad user is never shown a tip for a gesture their input
// device can't make. Read once, at module scope: the primary pointer
// type of a device doesn't change mid-session, so there's nothing to
// react to if it did.
function isTouchPrimary() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
}

/**
 * A one-time nudge that tabs can be changed by swiping, not just tapping
 * the bar above -- the gesture itself (App.jsx's `onMainPointer*`
 * handlers) has no visible affordance of its own, so without this, phone
 * users have no way to discover it. Shown exactly once per browser
 * (`swipeHint.js`'s localStorage flag, set the moment this renders, not
 * only on dismiss -- so ignoring it still counts as "seen" rather than
 * reappearing every session), plus a manual close for anyone who wants it
 * gone immediately.
 */
export default function SwipeHint() {
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const [show] = useState(() => {
    if (!isTouchPrimary() || loadSeenSwipeHint()) return false;
    saveSeenSwipeHint();
    return true;
  });

  if (!show || dismissed) return null;

  return (
    <div className="swipe-hint" role="status">
      <span>{t('app.swipeHint')}</span>
      <button
        type="button"
        className="dash-month-btn swipe-hint-close"
        aria-label={t('monthpicker.close')}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
