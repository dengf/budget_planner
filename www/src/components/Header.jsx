import React from 'react';
import { LOCALES, useI18n } from '../i18n';
import MeifioMark from './MeifioMark';

const MEIFIO_HOME = 'https://dengf.github.io/meifio-blog/';

const TABS = [
  { id: 'budget', key: 'nav.budget' },
  { id: 'transactions', key: 'nav.transactions' },
  { id: 'goals', key: 'nav.goals' },
  { id: 'debt', key: 'nav.debt' },
  { id: 'report', key: 'nav.report' },
];

const REGIONS = [
  { id: 'US', label: 'US' },
  { id: 'SG', label: 'SG' },
];

export default function Header({ activeTab, onTabChange, region, onRegionChange }) {
  const { t, locale, setLocale } = useI18n();

  return (
    <header className="app-header">
      <div className="app-brand">
        <h1 className="app-title">{t('app.title')}</h1>
        <a className="app-byline" href={MEIFIO_HOME}>
          {t('app.byline').split('{logo}').flatMap((part, i) =>
            i === 0 ? [part] : [<MeifioMark key="mark" />, part],
          )}
        </a>
      </div>

      <div className="app-switches">
        <div className="app-regions" role="group" aria-label={t('app.language')}>
          {LOCALES.map((l) => (
            <button
              key={l.id}
              type="button"
              className={l.id === locale ? 'app-region active' : 'app-region'}
              aria-pressed={l.id === locale}
              title={l.name}
              lang={l.id}
              onClick={() => setLocale(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>

        {onRegionChange && (
          <div className="app-regions" role="group" aria-label={t('app.region')}>
            {REGIONS.map((r) => (
              <button
                key={r.id}
                type="button"
                className={r.id === region ? 'app-region active' : 'app-region'}
                aria-pressed={r.id === region}
                onClick={() => onRegionChange(r.id)}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={tab.id === activeTab ? 'app-tab active' : 'app-tab'}
            onClick={() => onTabChange(tab.id)}
          >
            {t(tab.key)}
          </button>
        ))}
      </nav>
    </header>
  );
}
