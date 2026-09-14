import React from 'react';
import { DashboardIcon, BudgetIcon, TransactionsIcon, MoreIcon } from './components/icons';

// Single source of truth for tab identity -- id, label key, nav icon, and
// lazy-loaded panel component all in one ordered list, instead of
// Header.jsx and App.jsx each keeping their own separately-maintained
// copy of the same ids. The order here IS the swipe order: App.jsx walks
// TAB_ORDER by +/-1 to find the next/previous tab on a swipe, so this
// list is the one place that ordering can live.
//
// Four tabs, not five. Goals and Debt used to hold two of the five
// thumb-reach slots in the mobile bottom bar despite being setup screens
// visited a handful of times a year, next to Transactions, which is
// visited daily. Both now live one tap inside `more`, and both keep
// their preview cards on the Dashboard so they stay discoverable.
export const TABS = [
  {
    id: 'dashboard',
    key: 'nav.dashboard',
    Icon: DashboardIcon,
    Component: React.lazy(() => import('./components/DashboardTab')),
  },
  {
    id: 'transactions',
    key: 'nav.transactions',
    Icon: TransactionsIcon,
    Component: React.lazy(() => import('./components/TransactionsTab')),
  },
  {
    id: 'budget',
    key: 'nav.budget',
    Icon: BudgetIcon,
    Component: React.lazy(() => import('./components/BudgetTab')),
  },
  {
    id: 'more',
    key: 'nav.more',
    Icon: MoreIcon,
    Component: React.lazy(() => import('./components/MoreTab')),
  },
];

export const TAB_ORDER = TABS.map((tab) => tab.id);

/**
 * Where the centre "+" sits in the rendered nav row -- between
 * Transactions and Budget, so it lands under the middle of the screen
 * where either thumb reaches it.
 *
 * It is a *render position*, not a tab, and deliberately not an entry in
 * TABS: adding it there would make it a swipe stop (App.jsx walks
 * TAB_ORDER by +/-1) and a page that can be "navigated to", when it is
 * actually a button that opens a sheet over whatever tab is already
 * open. Header.jsx splices it into the row at this index; TAB_ORDER
 * stays four ids long and the swipe gesture never knows it exists.
 */
export const ADD_BUTTON_INDEX = 2;
