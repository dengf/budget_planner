import React, { useState } from 'react';
import { useI18n } from '../i18n';
import GoalsTab from './GoalsTab';
import DebtTab from './DebtTab';
import RulesSection from './RulesSection';
import RecurringSection from './RecurringSection';
import { GoalsIcon, DebtIcon, RulesIcon, RecurringIcon } from './icons';

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
 * A list that swaps itself for one section, rather than every section
 * stacked on one long scroll: this screen only grows from here (the
 * header's settings menu moves in next), and a stack of five full
 * panels is a screen nobody can find anything on. `section` is plain
 * local state, not a route -- there is no URL to restore and no history
 * to honour, so a router would be machinery for nothing.
 *
 * Every prop this receives comes straight from AppShell's single spread
 * onto the active panel; the sections are the same components the tab
 * bar used to render directly, with the same props, so nothing about
 * how a goal or a debt works changes here.
 */
const SECTIONS = [
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

export default function MoreTab(props) {
  const { t } = useI18n();
  const [sectionId, setSectionId] = useState(null);

  const section = SECTIONS.find((s) => s.id === sectionId);

  if (section) {
    const { Component } = section;
    // The back link sits *outside* the section, not inside a wrapper
    // panel around it -- every section component renders its own
    // `.panel` with its own heading, and nesting one panel in another
    // stacks two lots of padding and two backgrounds.
    return (
      <>
        <div className="more-back-row">
          <button type="button" className="more-back" onClick={() => setSectionId(null)}>
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
      <h2>{t('more.title')}</h2>
      <ul className="more-list">
        {SECTIONS.map(({ id, key, hintKey, Icon }) => (
          <li key={id}>
            <button type="button" className="more-item" onClick={() => setSectionId(id)}>
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
