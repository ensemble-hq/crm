import type { Option, PropertyValue } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import {
  MOCK_NOW,
  companySizes,
  companyTypes,
  contactTags,
  countries,
  industries,
  leadStatuses,
  priorities,
  sources,
  users,
} from './definitions';

/**
 * Deterministic mock data at a realistic size, so lists, search and boards are designed against
 * the volume a real workspace has. Same seed, same data, on every load.
 */

export const VOLUME = { companies: 6_000, contacts: 50_000, deals: 2_400, tasks: 4_000 } as const;

const DAY = 86_400_000;
const NOW = Date.parse(MOCK_NOW);

/** A small seeded random-number generator, so the mock is the same on every load. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = [
  'Amara', 'Ingrid', 'Samir', 'Lucia', 'Tobias', 'Noor', 'Kenji', 'Elena', 'Mateo', 'Freya', 'Dmitri', 'Chidi', 'Hana', 'Rafael',
  'Sofia', 'Anders', 'Leila', 'Marcus', 'Yuki', 'Isabel', 'Oskar', 'Zainab', 'Felix', 'Camille', 'Arjun', 'Greta', 'Emeka', 'Nadia',
  'Julian', 'Mei', 'Henrik', 'Paloma', 'Tariq', 'Astrid', 'Diego', 'Signe', 'Kwame', 'Elif', 'Bruno', 'Thandiwe', 'Viktor', 'Aaliyah',
  'Lars', 'Renata', 'Idris', 'Clara', 'Jomo', 'Sunniva', 'Pablo', 'Mira', 'Callum', 'Fatima', 'Nico', 'Saoirse', 'Andrei', 'Lin',
  'Gabriel', 'Ottilie', 'Hassan', 'Beatrix',
];

const LAST_NAMES = [
  'Halvorsen', 'Okonkwo', 'Haddad', 'Moretti', 'Lindgren', 'Rahman', 'Watanabe', 'Petrova', 'Alvarez', 'Nilsson', 'Volkov', 'Eze',
  'Kobayashi', 'Santos', 'Ricci', 'Berg', 'Farouk', 'Whitfield', 'Sato', 'Navarro', 'Holm', 'Abubakar', 'Brandt', 'Dubois', 'Mehta',
  'Larsen', 'Obi', 'Karimi', 'Castell', 'Chen', 'Dahl', 'Vega', 'Aziz', 'Sorensen', 'Molina', 'Ek', 'Mensah', 'Demir', 'Costa',
  'Dlamini', 'Novak', 'Bell', 'Strand', 'Fontana', 'Bakr', 'Hartmann', 'Kamau', 'Holt', 'Ortega', 'Popescu', 'Fraser', 'Qureshi',
  'Marchetti', 'Byrne', 'Ionescu', 'Zhou', 'Teixeira', 'Lund', 'Mansour', 'Keller',
];

const COMPANY_FIRST = [
  'North', 'Bright', 'Corvid', 'Oak', 'Meridian', 'Fern', 'Tessel', 'Harbor', 'Cedar', 'Iron', 'Silver', 'Blue', 'Stone', 'Wild',
  'Clear', 'High', 'Red', 'Summit', 'Lake', 'Ember', 'Alder', 'Granite', 'Pine', 'Salt', 'Copper', 'Wren', 'Thistle', 'Moss', 'Kestrel',
  'Fallow', 'Marsh', 'Linden', 'Quill', 'Rook', 'Larch', 'Tide', 'Gale', 'Flint', 'Hazel', 'Otter',
];

const COMPANY_SECOND = [
  'wind', 'water', 'line', 'hill', 'field', 'gate', 'bridge', 'works', 'ford', 'point', 'crest', 'haven', 'well', 'mark', 'path',
  'brook', 'ridge', 'port', 'light', 'stead', 'vale', 'croft', 'wick', 'mere', 'shaw', 'holme', 'thorpe', 'combe', 'leigh', 'bank',
];

const COMPANY_KIND = ['Group', 'Labs', 'Partners', 'Logistics', 'Health', 'Systems', 'Studio', 'Foods', 'Capital', 'Supply', 'Dental', 'Freight'];

const JOB_TITLES = [
  'Chief Executive Officer', 'Head of Operations', 'Operations Manager', 'VP of Sales', 'Finance Director', 'IT Manager',
  'Procurement Lead', 'Marketing Manager', 'Office Manager', 'Chief Technology Officer', 'Customer Success Lead', 'Product Manager',
  'Founder', 'Head of People', 'Purchasing Manager', 'Managing Director',
];

const CITIES = [
  'Austin', 'London', 'Berlin', 'Amsterdam', 'Stockholm', 'Toronto', 'Melbourne', 'Lyon', 'Valencia', 'Dublin', 'Denver', 'Leeds',
  'Hamburg', 'Utrecht', 'Gothenburg', 'Vancouver',
];

const DEAL_NAMES = [
  'Annual platform licence', 'Team plan', 'Multi-site rollout', 'Pilot extension', 'Support add-on', 'Enterprise upgrade',
  'Renewal', 'Onboarding package', 'Additional seats', 'Integration project', 'Training programme', 'Premium tier',
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function pickOption(random: () => number, options: Option[]): string {
  return pick(random, options).id;
}

/** Picks an index with the given weights. */
function weighted(random: () => number, weights: number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = random() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index] ?? 0;
    if (roll <= 0) return index;
  }
  return weights.length - 1;
}

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function owner(random: () => number, unassignedShare: number): string | null {
  return random() < unassignedShare ? null : pick(random, users).id;
}

export type Dataset = {
  byObject: Map<string, CrmRecord[]>;
  byId: Map<string, CrmRecord>;
};

function record(objectId: string, id: string, createdAt: number, properties: Record<string, PropertyValue>): CrmRecord {
  const created = new Date(createdAt).toISOString();
  return { id, objectId, properties: { ...properties, createdAt: created.slice(0, 10) }, createdAt: created, updatedAt: created };
}

function generateCompanies(random: () => number): CrmRecord[] {
  const combinations = COMPANY_FIRST.length * COMPANY_SECOND.length * COMPANY_KIND.length;
  const result: CrmRecord[] = [];
  for (let index = 0; index < VOLUME.companies; index += 1) {
    // A stride coprime with the number of combinations visits each name once.
    const slot = (index * 7_919) % combinations;
    const first = COMPANY_FIRST[slot % COMPANY_FIRST.length] as string;
    const second = COMPANY_SECOND[Math.floor(slot / COMPANY_FIRST.length) % COMPANY_SECOND.length] as string;
    const kind = COMPANY_KIND[Math.floor(slot / (COMPANY_FIRST.length * COMPANY_SECOND.length))] as string;
    const sizeIndex = weighted(random, [22, 30, 24, 14, 7, 3]);
    const createdAt = NOW - Math.floor(random() * 1_100) * DAY;
    result.push(
      record('companies', `com_${pad(index + 1, 5)}`, createdAt, {
        name: `${first}${second} ${kind}`,
        domain: `${first}${second}${kind}`.toLowerCase().concat('.example'),
        industry: pickOption(random, industries),
        size: (companySizes[sizeIndex] as Option).id,
        annualRevenue: Math.round((0.4 + random() * 3) * 10 ** (5 + sizeIndex * 0.55) * 0.01) * 100,
        type: (companyTypes[weighted(random, [58, 30, 5, 7])] as Option).id,
        owner: owner(random, 0.08),
        lastActivity: isoDate(createdAt + Math.floor(random() * (NOW - createdAt))),
        city: pick(random, CITIES),
        country: pickOption(random, countries),
      }),
    );
  }
  return result;
}

function generateContacts(random: () => number, companies: CrmRecord[]): CrmRecord[] {
  const result: CrmRecord[] = [];
  for (let index = 0; index < VOLUME.contacts; index += 1) {
    const first = pick(random, FIRST_NAMES);
    const last = pick(random, LAST_NAMES);
    // Squaring skews contacts toward a subset of companies, as real accounts do.
    const company = random() < 0.06 ? null : (companies[Math.floor(random() ** 1.6 * companies.length)] as CrmRecord);
    const domain = company ? String(company.properties.domain) : 'mail.example';
    const lifecycleIndex = weighted(random, [14, 34, 14, 10, 8, 20]);
    const createdAt = NOW - Math.floor(random() ** 1.4 * 1_000) * DAY;
    const tags = contactTags.filter(() => random() < 0.14).map((tag) => tag.id);
    result.push(
      record('contacts', `con_${pad(index + 1, 6)}`, createdAt, {
        name: `${first} ${last}`,
        email: `${first}.${last}`.toLowerCase().concat('@', domain),
        phone: random() < 0.78 ? `+1 (${200 + Math.floor(random() * 700)}) 555-${pad(Math.floor(random() * 10_000), 4)}` : null,
        jobTitle: pick(random, JOB_TITLES),
        company: company ? company.id : null,
        owner: owner(random, 0.12),
        lifecycleStage: ['subscriber', 'lead', 'mql', 'sql', 'opportunity', 'customer'][lifecycleIndex] as string,
        leadStatus: (leadStatuses[weighted(random, [20, 22, 28, 20, 10])] as Option).id,
        source: pickOption(random, sources),
        tags,
        lastContacted: random() < 0.82 ? isoDate(createdAt + Math.floor(random() * (NOW - createdAt))) : null,
        city: company ? String(company.properties.city) : pick(random, CITIES),
        country: company ? String(company.properties.country) : pickOption(random, countries),
        marketingConsent: random() < 0.64,
      }),
    );
  }
  return result;
}

const STAGE_IDS = ['qualified', 'discovery', 'proposal', 'negotiation', 'contract', 'won', 'lost'];
const STAGE_WEIGHTS = [14, 11, 8, 5, 3, 27, 32];
const STAGE_PROBABILITY = [10, 25, 50, 70, 90, 100, 0];

function generateDeals(random: () => number, companies: CrmRecord[], contactsByCompany: Map<string, CrmRecord[]>): CrmRecord[] {
  const result: CrmRecord[] = [];
  for (let index = 0; index < VOLUME.deals; index += 1) {
    const company = companies[Math.floor(random() ** 1.6 * companies.length)] as CrmRecord;
    const people = contactsByCompany.get(company.id) ?? [];
    const stageIndex = weighted(random, STAGE_WEIGHTS);
    const open = stageIndex < 5;
    const createdAt = NOW - Math.floor((open ? random() * 120 : 30 + random() * 900) + 5) * DAY;
    // Open deals close in the coming weeks (a few are overdue); closed deals closed in the past.
    const closeAt = open ? NOW + Math.floor(random() * 80 - 8) * DAY : Math.min(NOW - DAY, createdAt + Math.floor(15 + random() * 90) * DAY);
    const seats = 5 + Math.floor(random() ** 2 * 200);
    const name = pick(random, DEAL_NAMES);
    result.push(
      record('deals', `deal_${pad(index + 1, 5)}`, createdAt, {
        name: name === 'Team plan' || name === 'Additional seats' ? `${name}, ${seats} seats` : name,
        amount: Math.round((1_500 + random() ** 2.4 * 240_000) / 100) * 100,
        stage: STAGE_IDS[stageIndex] as string,
        closeDate: isoDate(closeAt),
        probability: STAGE_PROBABILITY[stageIndex] as number,
        owner: owner(random, 0.02),
        company: company.id,
        contact: people.length > 0 ? pick(random, people).id : null,
        priority: (priorities[weighted(random, [35, 45, 20])] as Option).id,
        source: pickOption(random, sources),
        // Open deals are mostly being worked; a minority have gone quiet.
        lastActivity: isoDate(open ? Math.max(createdAt, NOW - Math.floor(random() ** 3 * 45) * DAY) : createdAt + Math.floor(random() * (closeAt - createdAt))),
      }),
    );
  }
  return result;
}

const TASK_NAMES: Array<{ type: string; name: string }> = [
  { type: 'call', name: 'Call about the proposal' },
  { type: 'call', name: 'Check in by phone' },
  { type: 'email', name: 'Send revised pricing' },
  { type: 'email', name: 'Follow up after the demo' },
  { type: 'email', name: 'Share the security questionnaire' },
  { type: 'meeting', name: 'Prepare for the review meeting' },
  { type: 'meeting', name: 'Book a kickoff call' },
  { type: 'todo', name: 'Update the close date and next step' },
  { type: 'todo', name: 'Get legal sign-off on the contract' },
  { type: 'todo', name: 'Confirm the decision maker' },
];

/** Tasks hang off deals; nine in ten are done. Open ones fall across the coming month, with a few overdue. */
function generateTasks(random: () => number, deals: CrmRecord[]): CrmRecord[] {
  const result: CrmRecord[] = [];
  for (let index = 0; index < VOLUME.tasks; index += 1) {
    const deal = deals[Math.floor(random() * deals.length)] as CrmRecord;
    const done = random() < 0.9;
    const template = pick(random, TASK_NAMES);
    const createdAt = NOW - Math.floor(done ? 20 + random() * 400 : random() * 30) * DAY;
    const dueAt = done ? createdAt + Math.floor(random() * 14) * DAY : NOW + (Math.floor(random() * 30) - 2) * DAY;
    result.push(
      record('tasks', `task_${pad(index + 1, 5)}`, createdAt, {
        name: template.name,
        type: template.type,
        dueDate: isoDate(dueAt),
        priority: (priorities[weighted(random, [30, 50, 20])] as Option).id,
        status: done ? 'done' : 'open',
        // A task belongs to whoever owns the deal, when someone does.
        owner: typeof deal.properties.owner === 'string' ? deal.properties.owner : pick(random, users).id,
        deal: deal.id,
        contact: deal.properties.contact ?? null,
        company: deal.properties.company ?? null,
      }),
    );
  }
  return result;
}

let cached: Dataset | undefined;

export function dataset(): Dataset {
  if (cached) return cached;
  const random = mulberry32(20_261_114);
  const companies = generateCompanies(random);
  const contacts = generateContacts(random, companies);
  const contactsByCompany = new Map<string, CrmRecord[]>();
  for (const contact of contacts) {
    const companyId = contact.properties.company;
    if (typeof companyId !== 'string') continue;
    const list = contactsByCompany.get(companyId);
    if (list) list.push(contact);
    else contactsByCompany.set(companyId, [contact]);
  }
  const deals = generateDeals(random, companies, contactsByCompany);
  const tasks = generateTasks(random, deals);
  const byId = new Map<string, CrmRecord>();
  for (const item of [...companies, ...contacts, ...deals, ...tasks]) byId.set(item.id, item);
  cached = {
    byObject: new Map([
      ['companies', companies],
      ['contacts', contacts],
      ['deals', deals],
      ['tasks', tasks],
    ]),
    byId,
  };
  return cached;
}
