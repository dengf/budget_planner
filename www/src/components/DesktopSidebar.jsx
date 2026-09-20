import React from 'react';
import { useI18n } from '../i18n';
import { TABS } from '../tabs';
import { SECTIONS } from './MoreTab';
import MeifioMark from './MeifioMark';
import { meifioHome } from '../meifioHome';

/**
 * The desktop-width nav -- a persistent left column, mounted only when
 * `useIsDesktop()` says so (see App.jsx). Purely presentational: no
 * `matchMedia` in here, so it's trivial to render and test directly.
 *
 * A sidebar isn't limited to the mobile bottom bar's 4-slot budget, so
 * unlike `Header.jsx`'s pill nav (Dashboard/Transactions/Budget/More),
 * this flattens `MoreTab`'s five sections (Categories/Goals/Debt/Rules/
 * Recurring) into direct top-level items instead of burying them one tap
 * behind "More" -- reusing `MoreTab`'s own exported `SECTIONS` so the
 * label/icon list can't drift between the two navs.
 */
export default function DesktopSidebar({ activeTab, moreSectionId, onNavigate, onOpenAdd }) {
  const { t, locale } = useI18n();

  const tabItems = TABS.filter((tab) => tab.id !== 'more');

  return (
    <nav className="app-sidebar" aria-label={t('nav.sidebarLabel')}>
      <a className="app-sidebar-brand" href={meifioHome(locale)} aria-label={t('nav.meifio')}>
        <MeifioMark height="1.1em" />
        <span>{t('app.title')}</span>
      </a>

      <ul className="app-sidebar-list">
        {tabItems.map(({ id, key, Icon }) => {
          const active = activeTab === id;
          return (
            <li key={id}>
              <button
                type="button"
                className={active ? 'app-sidebar-item active' : 'app-sidebar-item'}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate(id)}
              >
                <Icon />
                <span>{t(key)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <ul className="app-sidebar-list">
        {SECTIONS.map(({ id, key, Icon }) => {
          const active = activeTab === 'more' && moreSectionId === id;
          return (
            <li key={id}>
              <button
                type="button"
                className={active ? 'app-sidebar-item active' : 'app-sidebar-item'}
                aria-current={active ? 'page' : undefined}
                onClick={() => onNavigate('more', id)}
              >
                <Icon />
                <span>{t(key)}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <button type="button" className="app-sidebar-add" onClick={() => onOpenAdd?.('manual')}>
        <span aria-hidden="true">+</span>
        <span>{t('nav.add')}</span>
      </button>
    </nav>
  );
}
