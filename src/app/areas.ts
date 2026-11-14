import { BarChart3, type LucideIcon, Zap } from 'lucide-react';

/**
 * Pages that belong together share one place in the navigation and a row of tabs. The sidebar
 * stays short however many tools the CRM grows: a new tool joins an area instead of the sidebar.
 */
export type Area = { id: string; label: string; icon: LucideIcon; tabs: Array<{ to: string; label: string }> };

export const AREAS: Area[] = [
  {
    id: 'insights',
    label: 'Insights',
    icon: BarChart3,
    tabs: [
      { to: '/forecast', label: 'Forecast' },
      { to: '/reports', label: 'Reports' },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    icon: Zap,
    tabs: [
      { to: '/workflows', label: 'Workflows' },
      { to: '/sequences', label: 'Sequences' },
      { to: '/forms', label: 'Forms' },
      { to: '/meetings', label: 'Booking pages' },
    ],
  },
];

/** The area a path is in, if any: "/reports/rep_1" is in Insights. */
export function areaOf(pathname: string): Area | undefined {
  return AREAS.find((area) => area.tabs.some((tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`)));
}
