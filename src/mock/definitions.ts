import type { ObjectDefinition, Option, User } from '../contracts/metadata';

/** The mock's fixed "now", so generated data and relative filters never drift. */
export const MOCK_NOW = '2026-11-14T13:00:00.000Z';
export const MOCK_TODAY = MOCK_NOW.slice(0, 10);

export const users: User[] = [
  { id: 'usr_maya', name: 'Maya Okafor', email: 'maya@northwind.example' },
  { id: 'usr_priya', name: 'Priya Raman', email: 'priya@northwind.example' },
  { id: 'usr_jonas', name: 'Jonas Lindqvist', email: 'jonas@northwind.example' },
  { id: 'usr_dario', name: 'Dario Conti', email: 'dario@northwind.example' },
  { id: 'usr_aiko', name: 'Aiko Tanaka', email: 'aiko@northwind.example' },
  { id: 'usr_femi', name: 'Femi Adeyemi', email: 'femi@northwind.example' },
];

export const CURRENT_USER_ID = 'usr_maya';

export const lifecycleStages: Option[] = [
  { id: 'subscriber', label: 'Subscriber' },
  { id: 'lead', label: 'Lead', tone: 'info' },
  { id: 'mql', label: 'Marketing qualified', tone: 'info' },
  { id: 'sql', label: 'Sales qualified', tone: 'warning' },
  { id: 'opportunity', label: 'Opportunity', tone: 'warning' },
  { id: 'customer', label: 'Customer', tone: 'success' },
];

export const leadStatuses: Option[] = [
  { id: 'new', label: 'New', tone: 'info' },
  { id: 'attempting', label: 'Attempting contact' },
  { id: 'connected', label: 'Connected', tone: 'success' },
  { id: 'nurturing', label: 'Nurturing' },
  { id: 'unqualified', label: 'Unqualified', tone: 'danger' },
];

export const sources: Option[] = [
  { id: 'website', label: 'Website form' },
  { id: 'referral', label: 'Referral' },
  { id: 'outbound', label: 'Outbound' },
  { id: 'event', label: 'Event' },
  { id: 'paid', label: 'Paid search' },
  { id: 'partner', label: 'Partner' },
  { id: 'import', label: 'Import' },
];

export const contactTags: Option[] = [
  { id: 'decision-maker', label: 'Decision maker' },
  { id: 'champion', label: 'Champion' },
  { id: 'billing', label: 'Billing' },
  { id: 'technical', label: 'Technical' },
  { id: 'newsletter', label: 'Newsletter' },
];

export const industries: Option[] = [
  'Software',
  'Healthcare',
  'Logistics',
  'Retail',
  'Manufacturing',
  'Financial services',
  'Education',
  'Hospitality',
  'Construction',
  'Professional services',
  'Media',
  'Energy',
].map((label) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label }));

export const companySizes: Option[] = ['1–10', '11–50', '51–200', '201–1,000', '1,001–5,000', '5,000+'].map((label, index) => ({
  id: `size-${index + 1}`,
  label,
}));

export const companyTypes: Option[] = [
  { id: 'prospect', label: 'Prospect', tone: 'info' },
  { id: 'customer', label: 'Customer', tone: 'success' },
  { id: 'partner', label: 'Partner', tone: 'warning' },
  { id: 'former', label: 'Former customer', tone: 'danger' },
];

export const dealStages: Option[] = [
  { id: 'qualified', label: 'Qualified' },
  { id: 'discovery', label: 'Discovery', tone: 'info' },
  { id: 'proposal', label: 'Proposal sent', tone: 'info' },
  { id: 'negotiation', label: 'Negotiation', tone: 'warning' },
  { id: 'contract', label: 'Contract out', tone: 'warning' },
  { id: 'won', label: 'Closed won', tone: 'success' },
  { id: 'lost', label: 'Closed lost', tone: 'danger' },
];

export const OPEN_STAGES = ['qualified', 'discovery', 'proposal', 'negotiation', 'contract'];

export const forecastCategories: Option[] = [
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'best', label: 'Best case', tone: 'info' },
  { id: 'commit', label: 'Commit', tone: 'success' },
  { id: 'omitted', label: 'Left out', tone: 'danger' },
];

export const priorities: Option[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium', tone: 'info' },
  { id: 'high', label: 'High', tone: 'danger' },
];

export const countries: Option[] = [
  'United States',
  'United Kingdom',
  'Germany',
  'Netherlands',
  'Sweden',
  'Canada',
  'Australia',
  'France',
  'Spain',
  'Ireland',
].map((label) => ({ id: label.toLowerCase().replace(/\s+/g, '-'), label }));

const contacts: ObjectDefinition = {
  id: 'contacts',
  singular: 'Contact',
  plural: 'Contacts',
  icon: 'users',
  primaryProperty: 'name',
  secondaryProperty: 'email',
  properties: [
    { id: 'name', label: 'Name', type: 'text', group: 'About', onCreate: true },
    { id: 'email', label: 'Email', type: 'email', group: 'About', onCreate: true, unique: true },
    { id: 'phone', label: 'Phone', type: 'phone', group: 'About', onCreate: true },
    { id: 'jobTitle', label: 'Job title', type: 'text', group: 'About', onCreate: true },
    { id: 'company', label: 'Company', type: 'reference', referenceObjectId: 'companies', group: 'About' },
    { id: 'owner', label: 'Owner', type: 'user', group: 'About', onCreate: true },
    { id: 'lifecycleStage', label: 'Lifecycle stage', type: 'select', options: lifecycleStages, group: 'Sales', onCreate: true },
    { id: 'leadStatus', label: 'Lead status', type: 'select', options: leadStatuses, group: 'Sales' },
    { id: 'source', label: 'Source', type: 'select', options: sources, group: 'Sales' },
    { id: 'tags', label: 'Tags', type: 'multiselect', options: contactTags, group: 'Sales' },
    { id: 'lastContacted', label: 'Last contacted', type: 'date', group: 'Sales', system: true },
    { id: 'city', label: 'City', type: 'text', group: 'Location' },
    { id: 'country', label: 'Country', type: 'select', options: countries, group: 'Location' },
    { id: 'marketingConsent', label: 'Marketing emails', type: 'boolean', group: 'Communication' },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    {
      id: 'all',
      name: 'All contacts',
      columns: ['name', 'company', 'jobTitle', 'lifecycleStage', 'owner', 'lastContacted'],
      filters: [],
      sort: { property: 'lastContacted', direction: 'desc' },
    },
    {
      id: 'mine',
      name: 'My contacts',
      columns: ['name', 'company', 'phone', 'lifecycleStage', 'leadStatus', 'lastContacted'],
      filters: [{ property: 'owner', operator: 'eq', value: '$me' }],
      sort: { property: 'lastContacted', direction: 'desc' },
    },
    {
      id: 'new-leads',
      name: 'New leads',
      columns: ['name', 'company', 'source', 'leadStatus', 'owner', 'createdAt'],
      filters: [
        { property: 'lifecycleStage', operator: 'in', value: ['lead', 'mql'] },
        { property: 'leadStatus', operator: 'eq', value: 'new' },
      ],
      sort: { property: 'createdAt', direction: 'desc' },
    },
    {
      id: 'customers',
      name: 'Customers',
      columns: ['name', 'company', 'jobTitle', 'tags', 'owner', 'lastContacted'],
      filters: [{ property: 'lifecycleStage', operator: 'eq', value: 'customer' }],
      sort: { property: 'name', direction: 'asc' },
    },
    {
      id: 'unassigned',
      name: 'Unassigned',
      columns: ['name', 'company', 'source', 'lifecycleStage', 'createdAt'],
      filters: [{ property: 'owner', operator: 'empty' }],
      sort: { property: 'createdAt', direction: 'desc' },
    },
  ],
};

const companies: ObjectDefinition = {
  id: 'companies',
  singular: 'Company',
  plural: 'Companies',
  icon: 'building',
  primaryProperty: 'name',
  secondaryProperty: 'domain',
  properties: [
    { id: 'name', label: 'Name', type: 'text', group: 'About', onCreate: true },
    { id: 'domain', label: 'Website', type: 'url', group: 'About', onCreate: true },
    { id: 'industry', label: 'Industry', type: 'select', options: industries, group: 'About', onCreate: true },
    { id: 'size', label: 'Employees', type: 'select', options: companySizes, group: 'About', onCreate: true },
    { id: 'annualRevenue', label: 'Annual revenue', type: 'currency', group: 'About' },
    { id: 'type', label: 'Type', type: 'select', options: companyTypes, group: 'Sales', onCreate: true },
    { id: 'owner', label: 'Owner', type: 'user', group: 'Sales', onCreate: true },
    { id: 'lastActivity', label: 'Last activity', type: 'date', group: 'Sales', system: true },
    { id: 'city', label: 'City', type: 'text', group: 'Location' },
    { id: 'country', label: 'Country', type: 'select', options: countries, group: 'Location' },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    {
      id: 'all',
      name: 'All companies',
      columns: ['name', 'industry', 'size', 'type', 'owner', 'lastActivity'],
      filters: [],
      sort: { property: 'lastActivity', direction: 'desc' },
    },
    {
      id: 'mine',
      name: 'My companies',
      columns: ['name', 'industry', 'type', 'annualRevenue', 'lastActivity'],
      filters: [{ property: 'owner', operator: 'eq', value: '$me' }],
      sort: { property: 'lastActivity', direction: 'desc' },
    },
    {
      id: 'customers',
      name: 'Customers',
      columns: ['name', 'industry', 'size', 'annualRevenue', 'owner', 'country'],
      filters: [{ property: 'type', operator: 'eq', value: 'customer' }],
      sort: { property: 'annualRevenue', direction: 'desc' },
    },
    {
      id: 'prospects',
      name: 'Prospects',
      columns: ['name', 'industry', 'size', 'owner', 'country', 'createdAt'],
      filters: [{ property: 'type', operator: 'eq', value: 'prospect' }],
      sort: { property: 'createdAt', direction: 'desc' },
    },
  ],
};

const deals: ObjectDefinition = {
  id: 'deals',
  singular: 'Deal',
  plural: 'Deals',
  icon: 'handshake',
  primaryProperty: 'name',
  secondaryProperty: 'company',
  properties: [
    { id: 'name', label: 'Deal name', type: 'text', group: 'About', onCreate: true },
    { id: 'amount', label: 'Amount', type: 'currency', group: 'About', onCreate: true },
    { id: 'stage', label: 'Stage', type: 'select', options: dealStages, group: 'About', onCreate: true, required: true },
    { id: 'closeDate', label: 'Close date', type: 'date', group: 'About', onCreate: true },
    { id: 'probability', label: 'Probability (%)', type: 'number', group: 'About' },
    { id: 'forecast', label: 'Forecast category', type: 'select', options: forecastCategories, group: 'About' },
    { id: 'owner', label: 'Owner', type: 'user', group: 'About', onCreate: true },
    { id: 'company', label: 'Company', type: 'reference', referenceObjectId: 'companies', group: 'Associations' },
    { id: 'contact', label: 'Primary contact', type: 'reference', referenceObjectId: 'contacts', group: 'Associations' },
    { id: 'priority', label: 'Priority', type: 'select', options: priorities, group: 'Details', onCreate: true },
    { id: 'source', label: 'Source', type: 'select', options: sources, group: 'Details' },
    { id: 'lastActivity', label: 'Last activity', type: 'date', group: 'Details', system: true },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    {
      id: 'open',
      name: 'Open deals',
      columns: ['name', 'company', 'stage', 'amount', 'closeDate', 'owner'],
      filters: [{ property: 'stage', operator: 'in', value: OPEN_STAGES }],
      sort: { property: 'closeDate', direction: 'asc' },
    },
    {
      id: 'mine',
      name: 'My open deals',
      columns: ['name', 'company', 'stage', 'amount', 'closeDate', 'priority'],
      filters: [
        { property: 'owner', operator: 'eq', value: '$me' },
        { property: 'stage', operator: 'in', value: OPEN_STAGES },
      ],
      sort: { property: 'closeDate', direction: 'asc' },
    },
    {
      id: 'closing-this-month',
      name: 'Closing this month',
      columns: ['name', 'company', 'stage', 'amount', 'closeDate', 'owner'],
      filters: [
        { property: 'stage', operator: 'in', value: OPEN_STAGES },
        { property: 'closeDate', operator: 'between', value: ['$monthStart', '$monthEnd'] },
      ],
      sort: { property: 'amount', direction: 'desc' },
    },
    {
      id: 'won',
      name: 'Won',
      columns: ['name', 'company', 'amount', 'closeDate', 'owner', 'source'],
      filters: [{ property: 'stage', operator: 'eq', value: 'won' }],
      sort: { property: 'closeDate', direction: 'desc' },
    },
    {
      id: 'all',
      name: 'All deals',
      columns: ['name', 'company', 'stage', 'amount', 'closeDate', 'owner'],
      filters: [],
      sort: { property: 'closeDate', direction: 'desc' },
    },
  ],
  board: { groupBy: 'stage', sumProperty: 'amount', dateProperty: 'closeDate' },
  calendar: { dateProperty: 'closeDate' },
  lineItems: true,
};

export const taskTypes: Option[] = [
  { id: 'todo', label: 'To-do' },
  { id: 'call', label: 'Call', tone: 'info' },
  { id: 'email', label: 'Email', tone: 'info' },
  { id: 'meeting', label: 'Meeting', tone: 'warning' },
];

export const taskStatuses: Option[] = [
  { id: 'open', label: 'To do' },
  { id: 'done', label: 'Done', tone: 'success' },
];

const tasks: ObjectDefinition = {
  id: 'tasks',
  singular: 'Task',
  plural: 'Tasks',
  icon: 'check',
  primaryProperty: 'name',
  secondaryProperty: 'dueDate',
  properties: [
    { id: 'name', label: 'Task', type: 'text', group: 'About', onCreate: true },
    { id: 'type', label: 'Type', type: 'select', options: taskTypes, group: 'About', onCreate: true },
    { id: 'dueDate', label: 'Due', type: 'date', group: 'About', onCreate: true },
    { id: 'priority', label: 'Priority', type: 'select', options: priorities, group: 'About', onCreate: true },
    { id: 'status', label: 'Status', type: 'select', options: taskStatuses, group: 'About', required: true },
    { id: 'owner', label: 'Assigned to', type: 'user', group: 'About', onCreate: true },
    { id: 'deal', label: 'Deal', type: 'reference', referenceObjectId: 'deals', group: 'About what' },
    { id: 'contact', label: 'Contact', type: 'reference', referenceObjectId: 'contacts', group: 'About what' },
    { id: 'company', label: 'Company', type: 'reference', referenceObjectId: 'companies', group: 'About what' },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    {
      id: 'due',
      name: 'Due now',
      columns: ['name', 'type', 'dueDate', 'priority', 'deal', 'contact'],
      filters: [
        { property: 'owner', operator: 'in', value: ['$me'] },
        { property: 'status', operator: 'in', value: ['open'] },
        { property: 'dueDate', operator: 'lt', value: '$tomorrow' },
      ],
      sort: { property: 'dueDate', direction: 'asc' },
    },
    {
      id: 'upcoming',
      name: 'Upcoming',
      columns: ['name', 'type', 'dueDate', 'priority', 'deal', 'contact'],
      filters: [
        { property: 'owner', operator: 'in', value: ['$me'] },
        { property: 'status', operator: 'in', value: ['open'] },
        { property: 'dueDate', operator: 'gt', value: '$today' },
      ],
      sort: { property: 'dueDate', direction: 'asc' },
    },
    {
      id: 'team',
      name: 'Everyone\'s open tasks',
      columns: ['name', 'owner', 'type', 'dueDate', 'priority', 'deal'],
      filters: [{ property: 'status', operator: 'in', value: ['open'] }],
      sort: { property: 'dueDate', direction: 'asc' },
    },
    {
      id: 'done',
      name: 'Done',
      columns: ['name', 'owner', 'type', 'dueDate', 'deal', 'contact'],
      filters: [{ property: 'status', operator: 'in', value: ['done'] }],
      sort: { property: 'dueDate', direction: 'desc' },
    },
  ],
  completion: { property: 'status', open: 'open', done: 'done' },
  calendar: { dateProperty: 'dueDate' },
};

export const leadStatusOptions: Option[] = [
  { id: 'new', label: 'New', tone: 'info' },
  { id: 'working', label: 'Working', tone: 'warning' },
  { id: 'qualified', label: 'Qualified', tone: 'success' },
  { id: 'unqualified', label: 'Unqualified', tone: 'danger' },
];

const leads: ObjectDefinition = {
  id: 'leads',
  singular: 'Lead',
  plural: 'Leads',
  icon: 'star',
  primaryProperty: 'name',
  secondaryProperty: 'companyName',
  properties: [
    { id: 'name', label: 'Name', type: 'text', group: 'About', onCreate: true },
    { id: 'email', label: 'Email', type: 'email', group: 'About', onCreate: true },
    { id: 'phone', label: 'Phone', type: 'phone', group: 'About', onCreate: true },
    { id: 'jobTitle', label: 'Job title', type: 'text', group: 'About', onCreate: true },
    { id: 'companyName', label: 'Company', type: 'text', group: 'About', onCreate: true },
    { id: 'status', label: 'Status', type: 'select', options: leadStatusOptions, group: 'Qualification', onCreate: true, required: true },
    { id: 'source', label: 'Source', type: 'select', options: sources, group: 'Qualification', onCreate: true },
    { id: 'owner', label: 'Owner', type: 'user', group: 'Qualification', onCreate: true },
    { id: 'estimatedValue', label: 'Estimated value', type: 'currency', group: 'Qualification' },
    {
      id: 'fitScore',
      label: 'Fit score',
      type: 'number',
      group: 'Qualification',
      // An example to start from: a team changes the rules to its own idea of a good lead.
      scoring: [
        { points: 30, when: { property: 'source', operator: 'in', value: ['referral', 'partner'] } },
        { points: 25, when: { property: 'estimatedValue', operator: 'gt', value: 25_000 } },
        { points: 20, when: { property: 'jobTitle', operator: 'contains', value: 'Chief' } },
        { points: 15, when: { property: 'jobTitle', operator: 'contains', value: 'Head of' } },
        { points: 10, when: { property: 'phone', operator: 'notEmpty' } },
        { points: -20, when: { property: 'source', operator: 'eq', value: 'import' } },
      ],
    },
    { id: 'contact', label: 'Became contact', type: 'reference', referenceObjectId: 'contacts', group: 'After conversion', system: true },
    { id: 'deal', label: 'Became deal', type: 'reference', referenceObjectId: 'deals', group: 'After conversion', system: true },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    {
      id: 'mine',
      name: 'My open leads',
      columns: ['name', 'companyName', 'jobTitle', 'fitScore', 'status', 'source', 'createdAt'],
      filters: [
        { property: 'owner', operator: 'in', value: ['$me'] },
        { property: 'status', operator: 'in', value: ['new', 'working'] },
      ],
      sort: { property: 'createdAt', direction: 'desc' },
    },
    { id: 'open', name: 'All open leads', columns: ['name', 'companyName', 'fitScore', 'status', 'source', 'owner', 'createdAt'], filters: [{ property: 'status', operator: 'in', value: ['new', 'working'] }], sort: { property: 'createdAt', direction: 'desc' } },
    { id: 'all', name: 'All leads', columns: ['name', 'companyName', 'status', 'source', 'owner', 'createdAt'], filters: [], sort: { property: 'createdAt', direction: 'desc' } },
  ],
  board: { groupBy: 'status', sumProperty: 'estimatedValue', dateProperty: 'createdAt' },
  convertible: true,
};

export const productCategories: Option[] = ['Platform', 'Add-on', 'Services', 'Support'].map((label) => ({ id: label.toLowerCase(), label }));

export const billingOptions: Option[] = [
  { id: 'once', label: 'One-time' },
  { id: 'monthly', label: 'Monthly', tone: 'info' },
  { id: 'annual', label: 'Annual', tone: 'success' },
];

const products: ObjectDefinition = {
  id: 'products',
  singular: 'Product',
  plural: 'Products',
  icon: 'package',
  navigation: 'search',
  primaryProperty: 'name',
  secondaryProperty: 'sku',
  properties: [
    { id: 'name', label: 'Name', type: 'text', group: 'About', onCreate: true },
    { id: 'sku', label: 'SKU', type: 'text', group: 'About', onCreate: true, unique: true },
    { id: 'price', label: 'Price', type: 'currency', group: 'About', onCreate: true, required: true },
    { id: 'billing', label: 'Billed', type: 'select', options: billingOptions, group: 'About', onCreate: true },
    { id: 'category', label: 'Category', type: 'select', options: productCategories, group: 'About', onCreate: true },
    { id: 'active', label: 'For sale', type: 'boolean', group: 'About' },
    { id: 'createdAt', label: 'Created', type: 'date', group: 'Record', system: true },
  ],
  views: [
    { id: 'active', name: 'For sale', columns: ['name', 'sku', 'category', 'billing', 'price'], filters: [{ property: 'active', operator: 'eq', value: true }], sort: { property: 'name', direction: 'asc' } },
    { id: 'all', name: 'All products', columns: ['name', 'sku', 'category', 'billing', 'price', 'active'], filters: [], sort: { property: 'name', direction: 'asc' } },
  ],
};

export const objects: ObjectDefinition[] = [leads, contacts, companies, deals, products, tasks];
