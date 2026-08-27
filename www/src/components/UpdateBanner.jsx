import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { reloadOnto } from '../version-check';

/**
 * Tells someone a new deploy has landed, when the app can't just reload
 * out from under them.
 *
 * `startVersionCheck` already reloads silently and safely once the tab is
 * hidden -- nothing typed is lost, because nothing was in flight. But a
 * tab that stays open and focused (exactly the state someone watching for
 * their own deploy is in) never hits that path, and without this banner
 * the check finds the new version and does nothing visible at all: stuck
 * on stale content indefinitely, not just for GitHub Pages' ten-minute
 * HTML cache window.
 */
export default function UpdateBanner() {
  const { t } = useI18n();
  const [buildId, setBuildId] = useState(null);

  useEffect(() => {
    const onStale = (e) => setBuildId(e.detail.buildId);
    window.addEventListener('bp:stale-version', onStale);
    return () => window.removeEventListener('bp:stale-version', onStale);
  }, []);

  if (!buildId) return null;

  return (
    <div className="toast-region" aria-live="polite">
      <div className="toast update-toast" role="status">
        <span className="toast-message">{t('app.updateAvailable')}</span>
        <button className="btn secondary" onClick={() => reloadOnto(buildId)}>
          {t('app.reload')}
        </button>
        <button
          className="toast-dismiss"
          onClick={() => setBuildId(null)}
          aria-label={t('errors.dismiss')}
        >
          &times;
        </button>
      </div>
    </div>
  );
}
