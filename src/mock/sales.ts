import type { Filter, PropertyValue } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import type { DealPeople, DealPerson, LineItem, SalesApi } from '../contracts/sales';
import { MOCK_TODAY, OPEN_STAGES } from './definitions';
import { activeUsers, assertAllowed } from './team';

/** Line items, lead conversion and the forecast, in memory. */

const lineItems = new Map<string, LineItem[]>();
const dealPeople = new Map<string, DealPerson[]>();
const goals = new Map<string, number>([
  ['usr_maya', 2_200_000],
  ['usr_priya', 2_000_000],
  ['usr_jonas', 1_500_000],
  ['usr_dario', 4_000_000],
  ['usr_aiko', 1_200_000],
  ['usr_femi', 950_000],
]);
const DEFAULT_GOAL = 1_000_000;

export function lineTotal(item: Pick<LineItem, 'quantity' | 'unitPrice' | 'discountPercent'>): number {
  return Math.round(item.quantity * item.unitPrice * (1 - item.discountPercent / 100) * 100) / 100;
}

function quarter(): { label: string; from: string; to: string; elapsed: number } {
  const [year = 0, month = 1] = MOCK_TODAY.split('-').map(Number);
  const index = Math.floor((month - 1) / 3);
  const from = new Date(Date.UTC(year, index * 3, 1));
  const to = new Date(Date.UTC(year, index * 3 + 3, 0));
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { label: `Q${index + 1} ${year}`, from: iso(from), to: iso(to), elapsed: Math.min(1, (Date.parse(MOCK_TODAY) - from.getTime()) / (to.getTime() - from.getTime())) };
}

export type SalesDeps = {
  respond: <T>(compute: () => T) => Promise<T>;
  /** A record the caller may see; throws otherwise. */
  get: (recordId: string) => CrmRecord;
  assertCanEdit: (record: CrmRecord) => void;
  /** Records of an object that pass the filters and that the caller may see. */
  select: (query: { objectId: string; filters: Filter[] }) => CrmRecord[];
  setProperties: (record: CrmRecord, properties: Record<string, PropertyValue>) => void;
  upsertContact: (properties: Record<string, PropertyValue>) => { record: CrmRecord; isNew: boolean };
  /** Finds a company by its exact name, or makes one. */
  companyNamed: (name: string, ownerId: PropertyValue) => CrmRecord;
  createDeal: (properties: Record<string, PropertyValue>) => CrmRecord;
  logActivity: (recordId: string, kind: 'note' | 'meeting', title: string, body: string) => void;
};

/** The sales half of the mock API. */
export function createSalesApi(deps: SalesDeps): SalesApi {
  const withNames = (people: DealPerson[]): DealPeople => ({ people, references: Object.fromEntries(people.map((person) => [person.contactId, { objectId: 'contacts', label: String(deps.get(person.contactId).properties.name ?? 'Contact') }])) });
  return {
    listLineItems: (dealId) =>
      deps.respond(() => {
        deps.get(dealId);
        return lineItems.get(dealId) ?? [];
      }),

    listDealPeople: (dealId) =>
      deps.respond(() => {
        deps.get(dealId);
        return withNames(dealPeople.get(dealId) ?? []);
      }),

    saveDealPeople: (input) =>
      deps.respond(() => {
        deps.assertCanEdit(deps.get(input.dealId));
        if (new Set(input.people.map((person) => person.contactId)).size !== input.people.length) throw new Error('A contact can be on a deal once. Change their role instead of adding them again.');
        dealPeople.set(input.dealId, input.people);
        return withNames(input.people);
      }),

    saveLineItems: (input) =>
      deps.respond(() => {
        const deal = deps.get(input.dealId);
        deps.assertCanEdit(deal);
        const items = input.items.filter((item) => item.name.trim() !== '');
        lineItems.set(input.dealId, items);
        const total = items.reduce((sum, item) => sum + lineTotal(item), 0);
        if (input.setAmount) deps.setProperties(deal, { amount: Math.round(total) });
        return { items, total };
      }),

    convertLead: (input) =>
      deps.respond(() => {
        const lead = deps.get(input.leadId);
        deps.assertCanEdit(lead);
        if (typeof lead.properties.contact === 'string') throw new Error('This lead has already been converted.');
        const email = lead.properties.email;
        if (typeof email !== 'string' || email === '') throw new Error('Add an email address first, so the lead can become a contact.');
        const ownerId = lead.properties.owner ?? null;
        const companyName = typeof lead.properties.companyName === 'string' ? lead.properties.companyName.trim() : '';
        const company = companyName ? deps.companyNamed(companyName, ownerId) : undefined;
        const { record: contact } = deps.upsertContact({
          name: lead.properties.name ?? email,
          email,
          phone: lead.properties.phone ?? null,
          jobTitle: lead.properties.jobTitle ?? null,
          company: company?.id ?? null,
          owner: ownerId,
          source: lead.properties.source ?? null,
          lifecycleStage: input.createDeal ? 'opportunity' : 'sql',
          leadStatus: 'connected',
        });
        const deal = input.createDeal
          ? deps.createDeal({
              name: input.dealName?.trim() || `${companyName || String(lead.properties.name)}: new deal`,
              amount: input.amount ?? (typeof lead.properties.estimatedValue === 'number' ? lead.properties.estimatedValue : null),
              stage: 'qualified',
              forecast: 'pipeline',
              probability: 10,
              closeDate: new Date(Date.parse(MOCK_TODAY) + 45 * 86_400_000).toISOString().slice(0, 10),
              owner: ownerId,
              company: company?.id ?? null,
              contact: contact.id,
              priority: 'medium',
              source: lead.properties.source ?? null,
            })
          : undefined;
        deps.setProperties(lead, { status: 'qualified', contact: contact.id, deal: deal?.id ?? null });
        deps.logActivity(contact.id, 'note', 'Converted from a lead', `Was the lead "${String(lead.properties.name)}"${deal ? ', with a new deal opened' : ''}.`);
        return { contactId: contact.id, companyId: company?.id ?? null, dealId: deal?.id ?? null };
      }),

    getForecast: () =>
      deps.respond(() => {
        const period = quarter();
        const inPeriod: Filter = { property: 'closeDate', operator: 'between', value: [period.from, period.to] };
        const won = deps.select({ objectId: 'deals', filters: [inPeriod, { property: 'stage', operator: 'in', value: ['won'] }] });
        const open = deps.select({ objectId: 'deals', filters: [inPeriod, { property: 'stage', operator: 'in', value: OPEN_STAGES }] });
        const amount = (deal: CrmRecord) => (typeof deal.properties.amount === 'number' ? deal.properties.amount : 0);
        const sum = (deals: CrmRecord[], userId: string, category?: string) => deals.filter((deal) => deal.properties.owner === userId && (!category || deal.properties.forecast === category)).reduce((total, deal) => total + amount(deal), 0);
        const rows = activeUsers()
          .map((user) => ({
            userId: user.id,
            goal: goals.get(user.id) ?? DEFAULT_GOAL,
            won: sum(won, user.id),
            commit: sum(open, user.id, 'commit'),
            best: sum(open, user.id, 'best'),
            pipeline: sum(open, user.id, 'pipeline'),
            openDeals: open.filter((deal) => deal.properties.owner === user.id && deal.properties.forecast !== 'omitted').length,
          }))
          // People whose deals the caller cannot see would show as zeros; leave them out.
          .filter((row) => row.won + row.commit + row.best + row.pipeline > 0);
        return { period: period.label, from: period.from, to: period.to, elapsed: period.elapsed, rows };
      }),

    setGoal: (input) =>
      deps.respond(() => {
        assertAllowed('managePeople', 'set goals');
        goals.set(input.userId, Math.max(0, Math.round(input.amount)));
      }),
  };
}
