import React from 'react';
import { LOCALES, useI18n } from '../i18n';
import MeifioMark from './MeifioMark';
import YourDataMenu from './YourDataMenu';
import { TABS, ADD_BUTTON_INDEX } from '../tabs';

const MEIFIO_HOME = 'https://dengf.github.io/meifio-blog/';

export default function Header({
  activeTab,
  onTabChange,
  onOpenAdd,
  currencySymbol,
  onCurrencySymbolChange,
  theme,
  onThemeChange,
  wasmModule,
  today,
  viewMonth,
  categories,
  transactions,
  rules,
  budgetPlan,
  goals,
  debts,
  recurring,
  clearAllData,
  importData,
}) {
  const { t, locale, setLocale } = useI18n();

  return (
    <>
      <header className="app-header">
        <div className="app-brand">
          <h1 className="app-title">{t('app.title')}</h1>
          <a className="app-byline" href={MEIFIO_HOME}>
            {t('app.byline')
              .split('{logo}')
              .flatMap((part, i) => (i === 0 ? [part] : [<MeifioMark key="mark" />, part]))}
          </a>
        </div>

        <div className="app-switches">
          <select
            className="app-language-select"
            aria-label={t('app.language')}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id} lang={l.id}>
                {l.name}
              </option>
            ))}
          </select>

          {/* "My data" lives in the header row, not the tab bar below --
              it's a menu of rare, whole-app actions (export/import/clear,
              plus the currency symbol below), not a screen someone
              navigates to, and doesn't deserve one of the five
              thumb-reach slots the mobile bottom bar has room for.
              Folded into one gear icon instead of its own pill plus a
              separate currency field, so the header is a title and two
              small controls rather than a row of settings widgets on
              every single screen. */}
          <YourDataMenu
            wasmModule={wasmModule}
            today={today}
            viewMonth={viewMonth}
            categories={categories}
            transactions={transactions}
            rules={rules}
            budgetPlan={budgetPlan}
            goals={goals}
            debts={debts}
            recurring={recurring}
            clearAllData={clearAllData}
            importData={importData}
            currencySymbol={currencySymbol}
            onCurrencySymbolChange={onCurrencySymbolChange}
            theme={theme}
            onThemeChange={onThemeChange}
          />
        </div>
      </header>

      {/* A sibling of `.app-header`, not a child of it -- `position: sticky`
          can't stick past the bottom edge of its own parent, and the header
          above is only as tall as the brand/language row, nowhere near the
          page's full scroll height. Living directly under `.app` (which
          grows with the whole page) is what lets the nav stay stuck for
          the entire scroll, not just the first screenful. */}
      {/* The centre "+" is spliced into the row at ADD_BUTTON_INDEX
          rather than being a TABS entry -- see that constant's own
          comment in tabs.js for why it must not become a swipe stop.
          It renders as a sibling of the tab buttons so the row's
          `space-around` distribution still spaces four labels evenly
          around it. */}
      <nav className="app-tabs">
        {TABS.flatMap(({ id, key, Icon }, i) => {
          const tab = (
            <button
              key={id}
              className={id === activeTab ? 'app-tab active' : 'app-tab'}
              onClick={() => onTabChange(id)}
            >
              <Icon />
              <span className="app-tab-label">{t(key)}</span>
            </button>
          );
          if (i !== ADD_BUTTON_INDEX) return [tab];
          return [
            <button
              key="add"
              type="button"
              className="app-tab-add"
              aria-label={t('nav.add')}
              onClick={() => onOpenAdd?.('manual')}
            >
              <span aria-hidden="true">+</span>
            </button>,
            tab,
          ];
        })}
      </nav>
    </>
  );
}
