import React from 'react';
import { LOCALES, useI18n } from '../i18n';
import YourDataMenu from './YourDataMenu';
import MonthYearPicker from './MonthYearPicker';
import { TABS, ADD_BUTTON_INDEX } from '../tabs';

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
  setViewMonth,
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
      {/* One bar, not a brand row plus a title plus a picker per tab: a
          month strip on the left (shared across Dashboard/Budget/
          Transactions -- see App.jsx's single `viewMonth` state), the
          language picker and the settings gear on the right. The app's
          own title/byline stay in More -- looked at once then ignored,
          same as Goals/Debt/Rules/Recurring (see MoreTab.jsx). The
          language picker itself lives here rather than there: it's a
          control someone might reach for on first launch, before they've
          found More. */}
      <header className="app-header">
        <MonthYearPicker
          value={viewMonth}
          onChange={setViewMonth}
          todayMonth={today}
          locale={locale}
        />

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
              plus theme/currency), not a screen someone navigates to, and
              doesn't deserve one of the five thumb-reach slots the mobile
              bottom bar has room for. */}
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
