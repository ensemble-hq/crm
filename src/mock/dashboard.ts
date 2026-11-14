/**
 * Mock data for the dashboard. Shapes here are a first sketch of what the API contracts will
 * return; the real backend replaces this module without the pages changing.
 */

export type Trend = { direction: 'up' | 'down'; value: string; good: boolean };

export type Kpi = {
  id: string;
  label: string;
  value: string;
  trend: Trend;
  /** 14 points; the last 5 are the current week and drawn lighter. */
  series: number[];
};

export type StageSummary = { id: string; name: string; deals: number; amount: number };

export type DealStatus = 'on-track' | 'at-risk' | 'stalled';

export type ClosingDeal = {
  id: string;
  name: string;
  company: string;
  owner: string;
  amount: number;
  stage: string;
  closes: string;
  probability: number;
  status: DealStatus;
};

export type TaskKind = 'call' | 'email' | 'meeting' | 'todo';

export type Task = {
  id: string;
  kind: TaskKind;
  title: string;
  related: string;
  due: string;
  overdue: boolean;
};

export type ActivityKind = 'email' | 'call' | 'meeting' | 'note' | 'deal' | 'form';

export type Activity = {
  id: string;
  kind: ActivityKind;
  actor: string;
  summary: string;
  target: string;
  when: string;
};

export const currentUser = { name: 'Maya Okafor', firstName: 'Maya', initials: 'MO', workspace: 'Northwind' };

export const kpis: Kpi[] = [
  {
    id: 'pipeline',
    label: 'Open pipeline',
    value: '$1.84M',
    trend: { direction: 'up', value: '9%', good: true },
    series: [9, 10, 9, 12, 11, 13, 14, 13, 15, 16, 15, 18, 19, 21],
  },
  {
    id: 'won',
    label: 'Closed won',
    value: '$312,400',
    trend: { direction: 'up', value: '14%', good: true },
    series: [6, 8, 7, 9, 12, 10, 11, 14, 13, 15, 14, 17, 18, 20],
  },
  {
    id: 'win-rate',
    label: 'Win rate',
    value: '31%',
    trend: { direction: 'down', value: '2%', good: false },
    series: [18, 19, 17, 18, 16, 17, 15, 16, 15, 14, 16, 15, 14, 15],
  },
  {
    id: 'cycle',
    label: 'Avg. sales cycle',
    value: '34 days',
    trend: { direction: 'down', value: '3 days', good: true },
    series: [20, 19, 20, 18, 19, 17, 18, 16, 17, 15, 16, 15, 14, 14],
  },
];

/** Closed-won revenue per day, in thousands. `previous` is the comparison period. */
export const revenue = {
  total: '$312,400',
  trend: { direction: 'up', value: '14%', good: true } satisfies Trend,
  ticks: ['Oct 17', 'Oct 24', 'Oct 31', 'Nov 7', 'Nov 13'],
  current: [4, 6, 5, 8, 7, 10, 9, 12, 10, 13, 12, 16, 14, 17, 15, 18, 22, 19, 24, 20, 25, 27, 23, 30, 28, 33, 30, 36],
  previous: [3, 4, 6, 5, 7, 6, 9, 8, 8, 10, 9, 11, 10, 13, 12, 14, 15, 14, 17, 16, 18, 19, 18, 21, 20, 23, 22, 24],
  currentLabel: 'Oct 17 – Nov 13',
  previousLabel: 'Sep 19 – Oct 16',
};

export const stages: StageSummary[] = [
  { id: 'qualified', name: 'Qualified', deals: 42, amount: 486_000 },
  { id: 'discovery', name: 'Discovery', deals: 31, amount: 412_500 },
  { id: 'proposal', name: 'Proposal sent', deals: 19, amount: 388_200 },
  { id: 'negotiation', name: 'Negotiation', deals: 11, amount: 341_900 },
  { id: 'contract', name: 'Contract out', deals: 6, amount: 211_400 },
];

export const closingDeals: ClosingDeal[] = [
  { id: 'd1', name: 'Annual platform licence', company: 'Halvorsen Freight', owner: 'Maya Okafor', amount: 84_000, stage: 'Contract out', closes: 'Nov 18', probability: 90, status: 'on-track' },
  { id: 'd2', name: 'Team plan, 40 seats', company: 'Brightwater Dental', owner: 'Jonas Lindqvist', amount: 28_800, stage: 'Negotiation', closes: 'Nov 20', probability: 70, status: 'on-track' },
  { id: 'd3', name: 'Multi-site rollout', company: 'Corvid Coffee Roasters', owner: 'Maya Okafor', amount: 126_500, stage: 'Negotiation', closes: 'Nov 21', probability: 60, status: 'at-risk' },
  { id: 'd4', name: 'Pilot extension', company: 'Tessellate Labs', owner: 'Priya Raman', amount: 18_000, stage: 'Proposal sent', closes: 'Nov 22', probability: 40, status: 'stalled' },
  { id: 'd5', name: 'Support add-on', company: 'Oakline Property Group', owner: 'Dario Conti', amount: 12_400, stage: 'Proposal sent', closes: 'Nov 26', probability: 50, status: 'on-track' },
  { id: 'd6', name: 'Enterprise upgrade', company: 'Meridian Health Partners', owner: 'Priya Raman', amount: 210_000, stage: 'Discovery', closes: 'Nov 28', probability: 25, status: 'at-risk' },
];

export const tasks: Task[] = [
  { id: 't1', kind: 'call', title: 'Call Ingrid about redlines', related: 'Halvorsen Freight', due: 'Yesterday', overdue: true },
  { id: 't2', kind: 'email', title: 'Send revised pricing', related: 'Corvid Coffee Roasters', due: '11:00', overdue: false },
  { id: 't3', kind: 'meeting', title: 'Discovery call', related: 'Meridian Health Partners', due: '14:30', overdue: false },
  { id: 't4', kind: 'todo', title: 'Update close date and next step', related: 'Tessellate Labs', due: 'Today', overdue: false },
  { id: 't5', kind: 'email', title: 'Follow up after demo', related: 'Oakline Property Group', due: 'Today', overdue: false },
];

export const activity: Activity[] = [
  { id: 'a1', kind: 'deal', actor: 'Jonas Lindqvist', summary: 'moved a deal to Negotiation', target: 'Brightwater Dental · $28,800', when: '12 min ago' },
  { id: 'a2', kind: 'email', actor: 'Ingrid Halvorsen', summary: 'replied to your email', target: 'Re: Contract redlines', when: '38 min ago' },
  { id: 'a3', kind: 'form', actor: 'New lead', summary: 'submitted the demo request form', target: 'Samir Haddad · Fernhill Logistics', when: '1 h ago' },
  { id: 'a4', kind: 'meeting', actor: 'Priya Raman', summary: 'logged a meeting', target: 'Meridian Health Partners · Intro', when: '2 h ago' },
  { id: 'a5', kind: 'call', actor: 'Dario Conti', summary: 'logged a call', target: 'Oakline Property Group · 14 min', when: '3 h ago' },
  { id: 'a6', kind: 'note', actor: 'Maya Okafor', summary: 'added a note', target: 'Corvid Coffee Roasters', when: 'Yesterday' },
];
