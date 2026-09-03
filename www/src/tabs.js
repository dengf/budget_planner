import React from 'react';
import {
  DashboardIcon,
  BudgetIcon,
  TransactionsIcon,
  GoalsIcon,
  DebtIcon,
} from './components/icons';

// Single source of truth for tab identity -- id, label key, nav icon, and
// lazy-loaded panel component all in one ordered list, instead of
// Header.jsx and App.jsx each keeping their own separately-maintained
// copy of the same five ids. The order here IS the swipe order: App.jsx
// walks TAB_ORDER by +/-1 to find the next/previous tab on a swipe, so
// this list is the one place that ordering can live.
export const TABS = [
  {
    id: 'dashboard',
    key: 'nav.dashboard',
    Icon: DashboardIcon,
    Component: React.lazy(() => import('./components/DashboardTab')),
  },
  {
    id: 'budget',
    key: 'nav.budget',
    Icon: BudgetIcon,
    Component: React.lazy(() => import('./components/BudgetTab')),
  },
  {
    id: 'transactions',
    key: 'nav.transactions',
    Icon: TransactionsIcon,
    Component: React.lazy(() => import('./components/TransactionsTab')),
  },
  {
    id: 'goals',
    key: 'nav.goals',
    Icon: GoalsIcon,
    Component: React.lazy(() => import('./components/GoalsTab')),
  },
  {
    id: 'debt',
    key: 'nav.debt',
    Icon: DebtIcon,
    Component: React.lazy(() => import('./components/DebtTab')),
  },
];

export const TAB_ORDER = TABS.map((tab) => tab.id);
