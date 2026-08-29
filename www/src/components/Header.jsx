import React from 'react';
import { LOCALES, useI18n } from '../i18n';
import MeifioMark from './MeifioMark';

const MEIFIO_HOME = 'https://dengf.github.io/meifio-blog/';

const TABS = [
  { id: 'dashboard', key: 'nav.dashboard' },
  { id: 'budget', key: 'nav.budget' },
  { id: 'transactions', key: 'nav.transactions' },
  { id: 'goals', key: 'nav.goals' },
  { id: 'debt', key: 'nav.debt' },
];

export default function Header({ activeTab, onTabChange, currencySymbol, onCurrencySymbolChange }) {
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

        {onCurrencySymbolChange && (
          <label className="app-currency">
            <span className="app-currency-label">{t('app.currency')}</span>
            <input
              type="text"
              className="app-currency-input"
              value={currencySymbol}
              maxLength={3}
              onChange={(e) => onCurrencySymbolChange(e.target.value)}
            />
          </label>
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
