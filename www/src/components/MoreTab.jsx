import React from 'react';
import { useI18n } from '../i18n';
import GoalsTab from './GoalsTab';
import DebtTab from './DebtTab';
import RulesSection from './RulesSection';
import RecurringSection from './RecurringSection';
import CategoriesScreen from './CategoriesScreen';
import MeifioMark from './MeifioMark';
import { GoalsIcon, DebtIcon, RulesIcon, RecurringIcon, CategoriesIcon } from './icons';
import { MEIFIO_HOME } from '../meifioHome';

/**
 * Everything that isn't one of the three screens someone opens daily.
 *
 * Goals and Debt each used to hold one of five slots in the mobile
 * bottom bar. They are setup screens -- a goal is created once and
 * watched, a debt plan is entered once and followed -- so they sat next
 * to Transactions, which is opened several times a day, and cost it type
 * size: five labels across 360px forced the whole bar down to 0.68rem.
 *
 * The categorization rules and recurring-expense tables join them here
 * from the bottom of the Transactions tab, for the same reason: a rule
 * is written once and then applies itself to every transaction added
 * afterwards, which is setup, not daily use.
 *
 * Categories joins the list the same way, moved out of Budget's old
 * four-column grid -- creating, renaming or removing a category, the
 * goals/debt-commitments toggle, and the Savings target are all setup
 * decisions made rarely, not the daily "tap a row, type an amount" work
 * Budget itself is for now. See CategoriesScreen.jsx's own doc comment.
 *
 * A list that swaps itself for one section, rather than every section
 * stacked on one long scroll: this screen only grows from here, and a
 * stack of five full panels is a screen nobody can find anything on.
 * `section` is plain local state, not a route -- there is no URL to
 * restore and no history to honour, so a router would be machinery for
 * nothing.
 *
 * The app's title and byline live at the top of the list screen (not
 * inside any one section) -- moved here from the header row, which now
 * carries only the shared month control, the language picker and the
 * settings gear. Identity (title/byline) is looked-at-once-then-ignored
 * in the same way Goals/Debt/Rules/Recurring are, so it belongs on the
 * one screen that isn't opened daily. The language picker itself moved
 * back to the header on explicit request -- a control someone might
 * reach for on first launch, before ever finding More, reads better
 * living where every screen can see it than buried a level deep.
 *
 * Every prop this receives comes straight from AppShell's single spread
 * onto the active panel; the sections are the same components the tab
 * bar used to render directly, with the same props, so nothing about
 * how a goal or a debt works changes here.
 *
 * `moreSectionId`/`onMoreSectionChange` are owned by App.jsx, not local
 * state here -- lifted so DesktopSidebar.jsx can jump straight into a
 * section (e.g. Goals) instead of always landing on this list first.
 * `SECTIONS` is exported for the same reason: DesktopSidebar reuses this
 * exact list/icon/label set rather than keeping its own copy.
 */
export const SECTIONS = [
  {
    id: 'categories',
    key: 'budget.categoriesTitle',
    hintKey: 'more.categoriesHint',
    Icon: CategoriesIcon,
    Component: CategoriesScreen,
  },
  {
    id: 'goals',
    key: 'goals.title',
    hintKey: 'more.goalsHint',
    Icon: GoalsIcon,
    Component: GoalsTab,
  },
  {
    id: 'debt',
    key: 'debt.title',
    hintKey: 'more.debtHint',
    Icon: DebtIcon,
    Component: DebtTab,
  },
  {
    id: 'rules',
    key: 'transactions.rulesTitle',
    hintKey: 'more.rulesHint',
    Icon: RulesIcon,
    Component: RulesSection,
  },
  {
    id: 'recurring',
    key: 'recurring.title',
    hintKey: 'more.recurringHint',
    Icon: RecurringIcon,
    Component: RecurringSection,
  },
];

export default function MoreTab({ moreSectionId, onMoreSectionChange, ...props }) {
  const { t } = useI18n();

  const section = SECTIONS.find((s) => s.id === moreSectionId);

  if (section) {
    const { Component } = section;
    // The back link sits *outside* the section, not inside a wrapper
    // panel around it -- every section component renders its own
    // `.panel` with its own heading, and nesting one panel in another
    // stacks two lots of padding and two backgrounds.
    return (
      <>
        <div className="more-back-row">
          <button type="button" className="more-back" onClick={() => onMoreSectionChange(null)}>
            <span aria-hidden="true">&#8249;</span>
            {t('more.title')}
          </button>
        </div>
        <Component {...props} />
      </>
    );
  }

  return (
    <div className="panel">
      <div className="app-brand">
        <h1 className="app-title">{t('app.title')}</h1>
        <a className="app-byline" href={MEIFIO_HOME}>
          {t('app.byline')
            .split('{logo}')
            .flatMap((part, i) => (i === 0 ? [part] : [<MeifioMark key="mark" />, part]))}
        </a>
      </div>
      <h2 className="section-start">{t('more.title')}</h2>
      <ul className="more-list">
        {SECTIONS.map(({ id, key, hintKey, Icon }) => (
          <li key={id}>
            <button type="button" className="more-item" onClick={() => onMoreSectionChange(id)}>
              <span className="more-item-icon">
                <Icon />
              </span>
              <span className="more-item-body">
                <span className="more-item-name">{t(key)}</span>
                <span className="more-item-hint">{t(hintKey)}</span>
              </span>
              <span className="more-item-chevron" aria-hidden="true">
                &#8250;
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
