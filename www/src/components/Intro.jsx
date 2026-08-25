import React from 'react';
import { useI18n } from '../i18n';

export default function Intro() {
  const { t } = useI18n();
  return (
    <div className="intro">
      <p className="intro-lede">{t('intro.lede')}</p>
      <p className="intro-privacy">
        <b>{t('intro.privacy')}</b> {t('intro.privacyDetail')}{' '}
        <a href="privacy.html">{t('intro.privacyLink')}</a>.
      </p>
    </div>
  );
}
