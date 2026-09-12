import React from 'react';
import { useI18n } from '../i18n';

/**
 * The privacy paragraph used to run two full sentences on every tab
 * (`intro.privacy` + `intro.privacyDetail`), which read fine once but
 * competed with whatever the page actually opened on for a second and
 * third repeat. This keeps the genuine strength -- the promise is real,
 * see `docs/superpowers/specs/2026-09-12-onboarding-and-transaction-entry-design.md`
 * -- in one line with a real destination for anyone who wants the fuller
 * explanation (`privacy.html`, unchanged), rather than restating it below
 * every tab's own content.
 */
export default function Intro() {
  const { t } = useI18n();
  return (
    <div className="intro">
      <p className="intro-lede">{t('intro.lede')}</p>
      <p className="intro-privacy">
        <span aria-hidden="true">🔒</span> {t('intro.privacyShort')}{' '}
        <a href="privacy.html">{t('intro.privacyLink')}</a>
      </p>
    </div>
  );
}
