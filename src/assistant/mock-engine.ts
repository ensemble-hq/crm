import { api } from '../api';
import type { Filter, ObjectDefinition, PropertyType, PropertyValue, User } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import { matchColumn } from '../lib/columns';
import { MOCK_NOW, MOCK_TODAY, OPEN_STAGES } from '../mock/definitions';
import { formatDate } from '../ui/PropertyValue';
import { describeFilter } from '../ui/filters';
import { compactCurrency, currency } from '../ui/styles';
import type { Attachment, CanvasItemInput, PageContext } from './types';

/**
 * A scripted stand-in for the assistant's model. It recognises a handful of requests by keyword,
 * then does real work against the API: the queries, the numbers and the changes are genuine, only
 * the "understanding" is faked. The real assistant replaces `respond` with a model that calls the
 * same tools.
 */

export type EngineContext = {
  objects: ObjectDefinition[];
  users: User[];
  currentUser: User;
  /** Writes a paragraph of the answer, word by word. */
  say(text: string): Promise<void>;
  /** Offers follow-up messages as buttons. */
  suggest(replies: string[]): void;
  /** Runs one tool and shows it as a row in the conversation. */
  tool<T>(name: string, label: string, run: () => Promise<T>, describe: (result: T) => string): Promise<T>;
  /** Puts something beside the conversation. Returns its id. */
  show(item: CanvasItemInput): string;
  /** Proposes a plan; nothing runs until the user approves it. */
  propose(plan: { title: string; summary: string; steps: Array<{ label: string; detail?: string; run: () => Promise<void> }>; doneText: string; doneLink?: { to: string; label: string } }): string;
  /** Fetches the object definitions again, after the assistant changed one. */
  refreshWorkspace(): Promise<void>;
  /** The page the user is on. */
  page: PageContext;
  /** Takes the user to another page. */
  navigate(to: string): void;
  /** Says that records changed, so open pages re-read. */
  touch(): void;
  /** Runs the plan the user was last shown. False when there is none waiting. */
  runPendingPlan(): Promise<boolean>;
};

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(date) - days * 86_400_000).toISOString().slice(0, 10);
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

async function pipelineByStage(ctx: EngineContext): Promise<void> {
  const deals = ctx.objects.find((object) => object.id === 'deals');
  const stages = deals?.properties.find((property) => property.id === 'stage')?.options ?? [];
  const rows = await ctx.tool(
    'summarize_records',
    'Adding up open deals by stage',
    () => api.summarize({ objectId: 'deals', viewId: 'open', groupBy: 'stage', sumProperty: 'amount' }),
    (result) => plural(result.length, 'stage'),
  );
  const bars = stages
    .map((stage) => ({ stage, row: rows.find((item) => item.value === stage.id) }))
    .filter((entry) => entry.row)
    .map((entry) => ({
      label: entry.stage.label,
      value: entry.row?.sum ?? 0,
      display: compactCurrency(entry.row?.sum ?? 0),
      note: plural(entry.row?.count ?? 0, 'deal'),
    }));
  const count = rows.reduce((sum, row) => sum + row.count, 0);
  const total = rows.reduce((sum, row) => sum + row.sum, 0);
  const late = rows.filter((row) => row.value === 'negotiation' || row.value === 'contract').reduce((sum, row) => sum + row.sum, 0);
  ctx.show({ kind: 'chart', title: 'Open pipeline by stage', subtitle: `${plural(count, 'open deal')} · ${compactCurrency(total)}`, bars });
  await ctx.say(
    `You have ${plural(count, 'open deal')} worth ${compactCurrency(total)}. ${compactCurrency(late)} of that is in Negotiation or Contract out, which is what could close soonest. The chart is on the right.`,
  );
  ctx.suggest(['Which big deals have gone quiet?', 'Who has closed the most this year?']);
}

async function wonByOwner(ctx: EngineContext): Promise<void> {
  const yearStart = `${MOCK_TODAY.slice(0, 4)}-01-01`;
  const rows = await ctx.tool(
    'summarize_records',
    'Adding up deals won this year by owner',
    () =>
      api.summarize({
        objectId: 'deals',
        filters: [
          { property: 'stage', operator: 'eq', value: 'won' },
          { property: 'closeDate', operator: 'between', value: [yearStart, MOCK_TODAY] },
        ],
        groupBy: 'owner',
        sumProperty: 'amount',
      }),
    (result) => plural(result.length, 'owner'),
  );
  const bars = rows
    .map((row) => ({
      label: ctx.users.find((user) => user.id === row.value)?.name ?? 'No owner',
      value: row.sum,
      display: compactCurrency(row.sum),
      note: plural(row.count, 'deal'),
    }))
    .sort((a, b) => b.value - a.value);
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  ctx.show({ kind: 'chart', title: 'Closed won this year, by owner', subtitle: compactCurrency(total), bars });
  const top = bars[0];
  await ctx.say(top ? `${top.label} leads with ${top.display} from ${top.note}. The team has closed ${compactCurrency(total)} so far this year.` : 'No deals have been won yet this year.');
  ctx.suggest(['How is the pipeline looking?', 'Which big deals have gone quiet?']);
}

async function quietDeals(ctx: EngineContext): Promise<void> {
  const cutoff = daysBefore(MOCK_TODAY, 14);
  const found = await ctx.tool(
    'search_records',
    'Looking for open deals over $50,000 with no activity in two weeks',
    () =>
      api.listRecords({
        objectId: 'deals',
        filters: [
          { property: 'stage', operator: 'in', value: OPEN_STAGES },
          { property: 'amount', operator: 'gt', value: 50_000 },
          { property: 'lastActivity', operator: 'lt', value: cutoff },
        ],
        sort: { property: 'amount', direction: 'desc' },
        page: 1,
        pageSize: 25,
      }),
    (result) => plural(result.total, 'deal'),
  );
  if (found.total === 0) {
    await ctx.say('Nothing has gone quiet: every open deal over $50,000 has had activity in the last two weeks.');
    return;
  }
  const deals = found.records;
  const value = deals.reduce((sum, deal) => sum + (typeof deal.properties.amount === 'number' ? deal.properties.amount : 0), 0);
  const scope = found.total > deals.length ? `the ${deals.length} largest` : `all ${deals.length}`;
  ctx.show({
    kind: 'table',
    title: 'Large deals with no recent activity',
    subtitle: `${plural(found.total, 'deal')} · no activity since ${formatDate(cutoff)}`,
    objectId: 'deals',
    columns: ['name', 'company', 'stage', 'amount', 'lastActivity', 'owner'],
    records: deals,
    references: found.references,
    total: found.total,
  });
  await ctx.say(`${plural(found.total, 'open deal')} over $50,000 ${found.total === 1 ? 'has' : 'have'} had no activity in two weeks. The list is on the right, largest first.`);
  ctx.propose({
    title: 'Get these deals moving',
    summary: `Applies to ${scope} (${compactCurrency(value)} in total). Nothing changes until you run it.`,
    steps: [
      {
        label: `Mark ${plural(deals.length, 'deal')} as high priority`,
        run: async () => {
          await Promise.all(deals.map((deal) => api.updateRecord({ id: deal.id, properties: { priority: 'high' } })));
        },
      },
      {
        label: 'Add a note to each explaining why it was flagged',
        run: async () => {
          await Promise.all(deals.map((deal) => api.createActivity({ recordId: deal.id, kind: 'note', title: 'Note', body: 'Flagged by the assistant: no activity in two weeks on a deal over $50,000.' })));
        },
      },
      {
        label: 'Create a follow-up task on each deal for its owner',
        run: async () => {
          await Promise.all(deals.map((deal) => api.createActivity({ recordId: deal.id, kind: 'task', title: 'Task: check in on this deal', body: 'Created by the assistant.' })));
        },
      },
    ],
    doneText: `Done. ${plural(deals.length, 'deal')} ${deals.length === 1 ? 'is' : 'are'} now high priority, each with a note and a follow-up task. Open any of them to see the changes.`,
  });
  await ctx.say('I can also flag them and set up follow-ups. I have put a plan on the right; run it when you are happy with it.');
  ctx.suggest(['Run the plan']);
}

const SAMPLE_FILE: Attachment = {
  name: 'trade-show-leads.csv',
  size: 1_184,
  rows: [
    ['Full name', 'Email address', 'Mobile', 'Title', 'Company', 'City'],
    ['Imani Okoro', 'imani.okoro@fernbrookfoods.example', '+1 (415) 555-0134', 'Head of Operations', 'Fernbrook Foods', 'Austin'],
    ['Lukas Meyer', 'lukas.meyer@steinwerk.example', '+49 30 5550 142', 'Procurement Lead', 'Steinwerk', 'Berlin'],
    ['Rosa Delgado', 'rosa@casadelgado.example', '', 'Founder', 'Casa Delgado', 'Valencia'],
    ['Tomasz Zielinski', 'tomasz.z@nordhaven.example', '+46 8 555 0177', 'IT Manager', 'Nordhaven', 'Stockholm'],
    ['Aisha Rahman', 'aisha.rahman@brightquay.example', '+44 20 5550 0119', 'Finance Director', 'Brightquay', 'London'],
    ['Lukas Meyer', 'lukas.meyer@steinwerk.example', '+49 30 5550 142', 'Procurement Lead', 'Steinwerk', 'Berlin'],
    ['Keiko Morita', 'keiko.morita@harborline.example', '+1 (604) 555-0166', 'VP of Sales', 'Harborline', 'Vancouver'],
    ['Daniel Osei', 'daniel.osei@kestrelworks.example', '+1 (303) 555-0121', 'Operations Manager', 'Kestrelworks', 'Denver'],
    ['Marta Lindahl', 'marta@lindahl-studio.example', '', 'Managing Director', 'Lindahl Studio', 'Gothenburg'],
  ],
};

async function importFile(ctx: EngineContext, file: Attachment): Promise<void> {
  const contacts = ctx.objects.find((object) => object.id === 'contacts');
  const [header, ...rows] = file.rows ?? [];
  if (!contacts || !header || rows.length === 0) {
    await ctx.say(`I could not read rows from ${file.name}. In this mock I can read CSV files with a header row.`);
    ctx.suggest(['Use a sample file']);
    return;
  }
  const mapping = await ctx.tool(
    'map_columns',
    `Reading ${file.name} and matching its columns to contact fields`,
    async () => {
      await pause(500);
      return header.map((column, index) => ({
        column,
        index,
        property: matchColumn(column, contacts),
        sample: rows[0]?.[index] ?? '',
      }));
    },
    (result) => `${result.filter((item) => item.property).length} of ${result.length} columns matched`,
  );
  const emailColumn = mapping.find((item) => item.property === 'email');
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    const key = emailColumn ? (row[emailColumn.index] ?? '').toLowerCase() : row.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const duplicates = rows.length - unique.length;
  const label = (propertyId: string | null) => contacts.properties.find((property) => property.id === propertyId)?.label ?? null;
  const unmatched = mapping.filter((item) => !item.property).map((item) => item.column);

  ctx.show({
    kind: 'mapping',
    title: `Columns in ${file.name}`,
    subtitle: `${plural(rows.length, 'row')}${duplicates ? ` · ${plural(duplicates, 'duplicate')}` : ''}`,
    rows: mapping.map((item) => ({ column: item.column, property: label(item.property), sample: item.sample })),
  });
  await ctx.say(
    `${file.name} has ${plural(rows.length, 'row')}. I matched ${mapping.length - unmatched.length} of its ${mapping.length} columns to contact fields${
      unmatched.length ? `; ${unmatched.map((column) => `"${column}"`).join(' and ')} has no matching field, so I would leave it out` : ''
    }.${duplicates ? ` ${plural(duplicates, 'row')} repeats an email already in the file.` : ''}`,
  );

  const created: CrmRecord[] = [];
  ctx.propose({
    title: `Import ${plural(unique.length, 'contact')}`,
    summary: 'New contacts are owned by you and start as new leads. Nothing is created until you run it.',
    steps: [
      ...(duplicates ? [{ label: `Skip ${plural(duplicates, 'duplicate row')}`, run: () => pause(300) }] : []),
      {
        label: `Create ${plural(unique.length, 'contact')}`,
        detail: 'Owner: you · Lifecycle stage: Lead · Lead status: New · Source: Import',
        run: async () => {
          for (const row of unique) {
            const properties: Record<string, PropertyValue> = { owner: ctx.currentUser.id, lifecycleStage: 'lead', leadStatus: 'new', source: 'import' };
            for (const item of mapping) {
              if (item.property) properties[item.property] = row[item.index] || null;
            }
            created.push(await api.createRecord({ objectId: 'contacts', properties }));
          }
        },
      },
      {
        label: 'Add a note to each saying where it came from',
        run: async () => {
          await Promise.all(created.map((contact) => api.createActivity({ recordId: contact.id, kind: 'note', title: 'Note', body: `Imported from ${file.name} by the assistant.` })));
        },
      },
    ],
    doneText: `Imported ${plural(unique.length, 'contact')}. They are at the top of the New leads view.`,
    doneLink: { to: '/contacts?view=new-leads', label: 'Open New leads' },
  });
  await ctx.say('The column matching and the import plan are on the right. Run the plan to create the contacts.');
  ctx.suggest(['Run the plan']);
}

/** The type a new field most likely needs, from the words used for it. */
function guessType(label: string): PropertyType {
  if (/date|day|deadline|renewal|expir|birthday|anniversary/i.test(label)) return 'date';
  if (/amount|price|value|revenue|cost|budget|fee|\bmrr\b|\barr\b/i.test(label)) return 'currency';
  if (/count|number of|score|quantity|seats|headcount/i.test(label)) return 'number';
  if (/e-?mail/i.test(label)) return 'email';
  if (/phone|mobile/i.test(label)) return 'phone';
  if (/website|url|link|linkedin/i.test(label)) return 'url';
  return 'text';
}

const TYPE_WORDS: Partial<Record<PropertyType, string>> = { date: 'a date', currency: 'a currency amount', number: 'a number', email: 'an email address', phone: 'a phone number', url: 'a web address', text: 'text' };

/** "Add a renewal date to deals": a new field is data, so the assistant makes it itself. */
async function addProperty(ctx: EngineContext, label: string, object: ObjectDefinition): Promise<void> {
  await pause(400);
  const name = `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
  const type = guessType(label);
  const existing = object.properties.find((property) => property.label.toLowerCase() === name.toLowerCase());
  if (existing) {
    await ctx.say(`${object.plural} already have a property called "${existing.label}". You can change it in Settings.`);
    return;
  }
  const group = object.properties[0]?.group ?? 'About';
  ctx.propose({
    title: `Add "${name}" to ${object.plural.toLowerCase()}`,
    summary: `A new property on every ${object.singular.toLowerCase()}. Nothing changes until you run it.`,
    steps: [
      {
        label: `Create the property "${name}"`,
        detail: `Type: ${TYPE_WORDS[type] ?? type} · Section: ${group}`,
        run: async () => {
          await api.createProperty({ objectId: object.id, label: name, type, group, onCreate: true, addToViews: true });
        },
      },
      { label: `Show it as a column in every ${object.singular.toLowerCase()} view and on the create form`, run: () => ctx.refreshWorkspace() },
    ],
    doneText: `Done. Every ${object.singular.toLowerCase()} now has "${name}". It is a column in the ${object.plural.toLowerCase()} list and a field on each record; existing records have it empty.`,
    doneLink: { to: `/${object.id}`, label: `Open ${object.plural.toLowerCase()}` },
  });
  await ctx.say(`I can add that. "${name}" would be ${TYPE_WORDS[type] ?? type} on every ${object.singular.toLowerCase()}. The plan is on the right.`);
  ctx.suggest(['Run the plan']);
}

async function customization(ctx: EngineContext, request: string): Promise<void> {
  await pause(400);
  ctx.show({
    kind: 'handoff',
    title: 'A change to the CRM itself',
    request,
    steps: ['Ensemble plans the change with you', 'It builds it in a private preview, on a copy of your data', 'You try it, then publish it to your CRM'],
  });
  await ctx.say('That is a change to how the CRM works, not to the data in it, so I would hand it to Ensemble. It builds the change in a preview you can try before anything goes live. The hand-off is on the right.');
}

function optionLabel(object: ObjectDefinition, propertyId: string, value: PropertyValue | undefined): string | undefined {
  const option = object.properties.find((property) => property.id === propertyId)?.options?.find((item) => item.id === value);
  return option?.label;
}

/** "Summarize this": reads the record on screen, its activity and what it is linked to. */
async function summarizeRecord(ctx: EngineContext, recordId: string): Promise<void> {
  const [detail, activity, related] = await ctx.tool(
    'get_record',
    'Reading this record, its activity and what it is linked to',
    () => Promise.all([api.getRecord(recordId), api.listActivity(recordId), api.listRelated(recordId)]),
    ([, items]) => plural(items.length, 'activity').replace('activitys', 'activities'),
  );
  const record = detail.record;
  const object = ctx.objects.find((item) => item.id === record.objectId);
  if (!object) return;
  const value = (id: string) => record.properties[id];
  const name = String(value(object.primaryProperty) ?? 'This record');
  const refLabel = (id: string) => (typeof value(id) === 'string' ? detail.references[value(id) as string]?.label : undefined);
  const owner = ctx.users.find((user) => user.id === value('owner'))?.name;

  let opening: string;
  if (object.id === 'deals') {
    const amount = typeof value('amount') === 'number' ? currency(value('amount') as number) : 'an unpriced';
    opening = `${name} is a ${amount} deal${refLabel('company') ? ` with ${refLabel('company')}` : ''}, in ${optionLabel(object, 'stage', value('stage')) ?? 'no stage'}${typeof value('closeDate') === 'string' ? `, due to close ${formatDate(value('closeDate') as string)}` : ''}.`;
  } else if (object.id === 'contacts') {
    opening = `${name} is ${value('jobTitle') ? `${String(value('jobTitle'))}` : 'a contact'}${refLabel('company') ? ` at ${refLabel('company')}` : ''}, currently ${(optionLabel(object, 'lifecycleStage', value('lifecycleStage')) ?? 'unclassified').toLowerCase()}.`;
  } else if (object.id === 'companies') {
    opening = `${name} is a ${(optionLabel(object, 'industry', value('industry')) ?? '').toLowerCase()} company with ${optionLabel(object, 'size', value('size')) ?? 'an unknown number of'} employees, marked as ${(optionLabel(object, 'type', value('type')) ?? 'unclassified').toLowerCase()}.`;
  } else {
    opening = `${name} is a ${object.singular.toLowerCase()}.`;
  }
  await ctx.say(`${opening} ${owner ? `${owner} owns it.` : 'Nobody owns it yet.'}`);

  const real = activity.filter((item) => item.kind !== 'change');
  const counts = (['email', 'call', 'meeting', 'note', 'task'] as const).map((kind) => ({ kind, count: real.filter((item) => item.kind === kind).length })).filter((entry) => entry.count > 0);
  const latest = real[0];
  if (latest) {
    const days = Math.max(0, Math.round((Date.parse(MOCK_NOW) - Date.parse(latest.occurredAt)) / 86_400_000));
    const breakdown = counts.map((entry) => plural(entry.count, entry.kind)).join(', ');
    const quiet = object.id === 'deals' && OPEN_STAGES.includes(String(value('stage'))) && days > 14;
    await ctx.say(
      `There is ${breakdown} on record. The most recent was "${latest.title}" ${days === 0 ? 'today' : `${plural(days, 'day')} ago`}${latest.body ? `: ${latest.body}` : '.'}${quiet ? ' Nothing has happened since, so this one needs a nudge.' : ''}`,
    );
  } else {
    await ctx.say('Nothing has been logged on it yet.');
  }
  const links = related.filter((group) => group.total > 0).map((group) => plural(group.total, (ctx.objects.find((item) => item.id === group.objectId)?.singular ?? 'record').toLowerCase()));
  if (links.length > 0) await ctx.say(`It is linked to ${links.join(' and ')}.`);
  ctx.suggest(['Draft a follow-up email', 'Add a note: left a voicemail']);
}

/** "Draft an email": finds who to write to from the record on screen and writes a first version. */
async function draftEmail(ctx: EngineContext, recordId: string): Promise<void> {
  const found = await ctx.tool(
    'get_record',
    'Finding who to write to and what was last said',
    async () => {
      const detail = await api.getRecord(recordId);
      const record = detail.record;
      const contactId = record.objectId === 'contacts' ? record.id : typeof record.properties.contact === 'string' ? record.properties.contact : undefined;
      const contact = !contactId ? undefined : contactId === record.id ? record : (await api.getRecord(contactId)).record;
      const activity = await api.listActivity(recordId);
      return { record, contact, last: activity.find((item) => item.kind !== 'change') };
    },
    (result) => (result.contact ? String(result.contact.properties.name) : 'no contact found'),
  );
  const email = found.contact?.properties.email;
  if (!found.contact || typeof email !== 'string') {
    await ctx.say('I could not find a contact with an email address on this record. Open a contact, or a deal with a primary contact, and ask again.');
    return;
  }
  const toName = String(found.contact.properties.name ?? '');
  const first = toName.split(' ')[0] ?? toName;
  const me = ctx.currentUser.name.split(' ')[0] ?? ctx.currentUser.name;
  const about = found.record.objectId === 'deals' ? String(found.record.properties.name ?? 'our proposal').toLowerCase() : 'our last conversation';
  const body = [
    `Hi ${first},`,
    `I wanted to follow up on ${about}.${found.last?.body ? ` When we last spoke: ${found.last.body.charAt(0).toLowerCase()}${found.last.body.slice(1)}` : ''}`,
    'Is there anything you need from me to move this forward? I can also set up a short call this week if that is easier.',
    `Best,\n${me}`,
  ].join('\n\n');
  ctx.show({ kind: 'draft', title: `Email to ${toName}`, to: email, toName, subject: `Following up on ${about}`, body });
  await ctx.say(`I have drafted a follow-up to ${toName}, using the last thing logged on this record. Edit it before you send; nothing has been sent.`);
}

/** Turns phrases like "mine", "closing this month" or "over $50k" into filters for an object. */
function filtersFrom(text: string, object: ObjectDefinition): Filter[] {
  const has = (id: string) => object.properties.some((property) => property.id === id);
  const filters: Filter[] = [];
  if (/\b(mine|my|i own)\b/.test(text) && has('owner')) filters.push({ property: 'owner', operator: 'in', value: ['$me'] });
  if (/unassigned|no owner|without an owner/.test(text) && has('owner')) filters.push({ property: 'owner', operator: 'empty' });
  if (has('stage')) {
    if (/\bwon\b/.test(text)) filters.push({ property: 'stage', operator: 'in', value: ['won'] });
    else if (/\blost\b/.test(text)) filters.push({ property: 'stage', operator: 'in', value: ['lost'] });
    else if (/\bopen\b|closing|pipeline/.test(text)) filters.push({ property: 'stage', operator: 'in', value: OPEN_STAGES });
  }
  if (/this month/.test(text) && has('closeDate')) filters.push({ property: 'closeDate', operator: 'between', value: ['$monthStart', '$monthEnd'] });
  const amount = /(?:over|above|more than|bigger than|at least)\s*\$?\s*([\d,.]+)\s*(k|m)?/.exec(text);
  if (amount?.[1] && has('amount')) {
    const scale = amount[2] === 'm' ? 1_000_000 : amount[2] === 'k' ? 1_000 : 1;
    filters.push({ property: 'amount', operator: 'gt', value: Number(amount[1].replace(/,/g, '')) * scale });
  }
  if (/high priority|urgent/.test(text) && has('priority')) filters.push({ property: 'priority', operator: 'in', value: ['high'] });
  if (has('lifecycleStage')) {
    if (/\bcustomers?\b/.test(text)) filters.push({ property: 'lifecycleStage', operator: 'in', value: ['customer'] });
    else if (/\bleads?\b/.test(text)) filters.push({ property: 'lifecycleStage', operator: 'in', value: ['lead', 'mql'] });
  }
  if (has('type') && object.id === 'companies') {
    if (/\bcustomers?\b/.test(text)) filters.push({ property: 'type', operator: 'in', value: ['customer'] });
    else if (/\bprospects?\b/.test(text)) filters.push({ property: 'type', operator: 'in', value: ['prospect'] });
  }
  return filters;
}

/** "Show only mine closing this month": sets the list's filters for the user. */
async function showFiltered(ctx: EngineContext, object: ObjectDefinition, filters: Filter[]): Promise<void> {
  const found = await ctx.tool(
    'search_records',
    `Filtering ${object.plural.toLowerCase()}`,
    () => api.listRecords({ objectId: object.id, filters, page: 1, pageSize: 1 }),
    (result) => plural(result.total, object.singular.toLowerCase()),
  );
  ctx.navigate(`/${object.id}?f=${encodeURIComponent(JSON.stringify(filters))}`);
  await ctx.say(
    `Showing ${plural(found.total, object.singular.toLowerCase())}: ${filters.map((filter) => describeFilter(filter, object, ctx.users)).join('; ')}. The list behind this is filtered now; use "Save as new view" there to keep it.`,
  );
}

/** "What should I do today?": the tasks due, and the deals that need the user. */
async function today(ctx: EngineContext): Promise<void> {
  const tasks = ctx.objects.find((object) => object.completion);
  if (!tasks) {
    await ctx.say('This workspace has no tasks set up, so I have nothing to plan your day from.');
    return;
  }
  const [due, closing] = await ctx.tool(
    'search_records',
    'Reading your tasks and the deals closing soon',
    () =>
      Promise.all([
        api.listRecords({ objectId: tasks.id, viewId: tasks.views[0]?.id, page: 1, pageSize: 10 }),
        api.listRecords({
          objectId: 'deals',
          filters: [
            { property: 'owner', operator: 'in', value: ['$me'] },
            { property: 'stage', operator: 'in', value: OPEN_STAGES },
            { property: 'closeDate', operator: 'lt', value: '$in14days' },
          ],
          sort: { property: 'closeDate', direction: 'asc' },
          page: 1,
          pageSize: 3,
        }),
      ]),
    ([tasksDue]) => plural(tasksDue.total, 'task'),
  );
  if (due.total === 0) {
    await ctx.say('Nothing is due today. A good day to work the pipeline.');
  } else {
    ctx.show({
      kind: 'table',
      title: 'Due today or overdue',
      subtitle: `${plural(due.total, 'task')}, oldest first`,
      objectId: tasks.id,
      columns: ['name', 'type', 'dueDate', 'priority', 'deal'],
      records: due.records,
      references: due.references,
      total: due.total,
    });
    const urgent = due.records.filter((task) => task.properties.priority === 'high').length;
    await ctx.say(`You have ${plural(due.total, 'task')} due. I would start with the oldest${urgent > 0 ? `; ${urgent} of the first ${due.records.length} are high priority` : ''}. The list is on the right.`);
  }
  const next = closing.records[0];
  if (next) {
    await ctx.say(
      `${plural(closing.total, 'deal')} of yours ${closing.total === 1 ? 'is' : 'are'} due to close within two weeks. The nearest is ${String(next.properties.name)} with ${
        typeof next.properties.company === 'string' ? (closing.references[next.properties.company]?.label ?? 'a company') : 'a company'
      }, on ${formatDate(String(next.properties.closeDate))}.`,
    );
  }
  ctx.suggest(['Which big deals have gone quiet?', 'Show only mine closing this month']);
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** "tomorrow", "friday", "next week" as a date, counted from today. Undefined when no day was named. */
function dueFrom(text: string): string | undefined {
  const start = Date.parse(MOCK_TODAY);
  const day = (offset: number) => new Date(start + offset * 86_400_000).toISOString().slice(0, 10);
  if (/\btoday\b/.test(text)) return day(0);
  if (/\btomorrow\b/.test(text)) return day(1);
  if (/\bnext week\b/.test(text)) return day(7);
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekday === -1) return undefined;
  const ahead = (weekday - new Date(start).getUTCDay() + 7) % 7 || 7;
  return day(ahead);
}

/** "Remind me to call them Thursday": makes a task, linked to the record on screen when there is one. */
async function remind(ctx: EngineContext, what: string): Promise<void> {
  const tasks = ctx.objects.find((object) => object.completion);
  if (!tasks?.completion) return help(ctx);
  const due = dueFrom(what.toLowerCase()) ?? dueFrom('tomorrow');
  const title = what.replace(/\s*\b(?:on|by|this|next)?\s*(?:today|tomorrow|next week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b\.?$/i, '').trim();
  const name = `${title.slice(0, 1).toUpperCase()}${title.slice(1)}`;
  const properties: Record<string, PropertyValue> = {
    name,
    type: /\b(call|phone|ring)\b/i.test(name) ? 'call' : /\b(e-?mail|send|write)\b/i.test(name) ? 'email' : /\b(meet|meeting)\b/i.test(name) ? 'meeting' : 'todo',
    dueDate: due ?? null,
    priority: 'medium',
    owner: ctx.currentUser.id,
    [tasks.completion.property]: tasks.completion.open,
  };
  let about = '';
  const recordId = ctx.page.recordId;
  await ctx.tool(
    'create_record',
    'Creating the task',
    async () => {
      if (recordId) {
        const { record } = await api.getRecord(recordId);
        const from = ctx.objects.find((object) => object.id === record.objectId);
        for (const property of tasks.properties) {
          if (property.type !== 'reference') continue;
          if (property.referenceObjectId === record.objectId) properties[property.id] = record.id;
          else {
            const carried = from?.properties.find((item) => item.type === 'reference' && item.referenceObjectId === property.referenceObjectId);
            const value = carried ? record.properties[carried.id] : undefined;
            if (typeof value === 'string') properties[property.id] = value;
          }
        }
        if (from && record.objectId !== tasks.id) about = `, linked to this ${from.singular.toLowerCase()}`;
      }
      return api.createRecord({ objectId: tasks.id, properties });
    },
    () => 'created',
  );
  ctx.touch();
  await ctx.say(`Done. "${name}" is on your task list${due ? `, due ${formatDate(due)}` : ''}${about}.`);
}

async function help(ctx: EngineContext): Promise<void> {
  await pause(300);
  await ctx.say('This is a scripted preview of the assistant, so it understands a few requests. Try one of these. The answers use the real data in this workspace.');
  ctx.suggest(['What should I do today?', 'How is the pipeline looking?', 'Which big deals have gone quiet?', 'Import a spreadsheet of leads', 'Add a renewal date to deals', 'Build a customer portal']);
}

/** Answers one message. Each branch stands in for what the model would decide to do. */
export async function respond(input: { text: string; attachments: Attachment[] }, ctx: EngineContext): Promise<void> {
  const text = input.text.toLowerCase();
  const file = input.attachments[0];
  await pause(450);

  if (file) return importFile(ctx, file);
  if (/sample file/.test(text)) return importFile(ctx, SAMPLE_FILE);
  const reminder = /^(?:remind me to|remember to|create a task to|add a task to|add a task:?|task:)\s+(.{3,})$/i.exec(input.text.trim());
  if (reminder?.[1]) return remind(ctx, reminder[1]);
  if (/what should i do|plan my day|my day|what.s (on|next|due)|to-?do list|what do i have/.test(text)) return today(ctx);
  const recordId = ctx.page.recordId;
  if (recordId) {
    const note = /^(?:add |log |leave )?(?:a )?note(?: that|:)?\s+(.{3,})$/i.exec(input.text.trim());
    if (note?.[1]) {
      const body = note[1];
      await ctx.tool('add_activity', 'Adding the note to this record', () => api.createActivity({ recordId, kind: 'note', title: 'Note', body }), () => 'saved');
      ctx.touch();
      await ctx.say('Added. It is at the top of the timeline.');
      return;
    }
    if (/summar|where does (this|it) stand|catch me up|brief me|what.s happening|tell me about this/.test(text)) return summarizeRecord(ctx, recordId);
    if (/e-?mail|draft|write to|follow.?up|reach out/.test(text)) return draftEmail(ctx, recordId);
  }
  if (/\b(show|filter|only|list|find)\b/.test(text)) {
    const target =
      ctx.objects.find((object) => text.includes(object.plural.toLowerCase()) || new RegExp(`\\b${object.singular.toLowerCase()}\\b`).test(text)) ??
      ctx.objects.find((object) => object.id === ctx.page.objectId) ??
      (/clos|won|lost|pipeline|priority|\$/.test(text) ? ctx.objects.find((object) => object.id === 'deals') : undefined);
    const filters = target ? filtersFrom(text, target) : [];
    if (target && filters.length > 0) return showFiltered(ctx, target, filters);
  }
  if (/\b(run|do it|go ahead|yes|approve)\b/.test(text)) {
    if (await ctx.runPendingPlan()) return;
    await ctx.say('There is no plan waiting to run. Ask me for something first, and I will propose one.');
    return;
  }
  if (/import|upload|csv|spreadsheet/.test(text)) {
    await ctx.say('Attach a CSV with the paperclip and I will match its columns to contact fields. Or try it with a sample file.');
    ctx.suggest(['Use a sample file']);
    return;
  }
  if (/quiet|stale|no activity|cold|stuck|at risk|attention/.test(text)) return quietDeals(ctx);
  if (/closed|won\b|most|leader|best rep/.test(text)) return wonByOwner(ctx);
  if (/pipeline|stage|forecast|chart|graph/.test(text)) return pipelineByStage(ctx);
  const field = /\badd (?:an? |the )?(.+?)(?: field| property| column)? (?:to|on|for) (?:the |each |every |all )?([a-z ]+?)s?\.?$/.exec(text);
  if (field?.[1] && field[2]) {
    const target = ctx.objects.find((object) => object.plural.toLowerCase() === `${field[2]}s` || object.singular.toLowerCase() === field[2] || object.plural.toLowerCase() === field[2]);
    if (target) return addProperty(ctx, field[1].trim(), target);
  }
  if (/portal|redesign|build (a|an|me)|new page|integrat|customi[sz]e|change the (crm|layout|page)|i wish/.test(text)) return customization(ctx, input.text);
  return help(ctx);
}

/**
 * A first draft of a reply to an email thread. Scripted: it picks an answer by the thread's topic.
 * The real assistant writes from the whole thread, the record's history and the user's own voice.
 */
export function draftReply(input: { subject: string; lastInbound: string | undefined; contactName: string; myName: string; awaitingThem?: boolean }): string {
  const first = input.contactName.split(' ')[0] ?? input.contactName;
  const me = input.myName.split(' ')[0] ?? input.myName;
  // The subject ends with the deal's name ("...: team plan, 30 seats"), which says nothing about the topic.
  const topic = `${input.subject.split(':')[0] ?? ''} ${input.lastInbound ?? ''}`.toLowerCase();
  let answer: string;
  if (input.awaitingThem) answer = 'I wanted to check whether you had a chance to look at my last message. Happy to answer any questions, or to pick this up later if the timing is off.';
  else if (/payment terms|two years|multi-year option if/.test(topic)) answer = 'On payment terms: yes, with a two-year commitment we can move to quarterly billing. I will send a revised order form reflecting that today.';
  else if (/single sign-on|sso|it lead|someone technical|data residency/.test(topic)) answer = 'I will bring in our solutions engineer for the technical questions. Would Tuesday or Wednesday afternoon suit your IT lead for a 20-minute call?';
  else if (/redline|liability|legal|contract|month end/.test(topic)) answer = 'Our legal team is reviewing the liability clause now. I expect to have their response to you by Wednesday, which keeps us on track to sign this month.';
  else if (/security|questionnaire|audit/.test(topic)) answer = 'I will have the completed security questionnaire back to you by the end of next week, together with our latest audit report.';
  else if (/renewal|extra seats|adding seats|planning meeting/.test(topic)) answer = 'I will send both versions of the renewal today: one at your current term with the extra seats, and one with the multi-year option.';
  else if (/demo|walkthrough|invite|booked/.test(topic)) answer = 'That time works. I have sent the invite and included your colleague. I will share a short agenda the day before.';
  else if (/pricing|quote|how long onboarding/.test(topic)) answer = 'I have attached the pricing and the onboarding plan. Onboarding takes two to three weeks for a team of your size, and there is no setup fee.';
  else answer = 'Thanks for the update. I will take this forward and come back to you with next steps by the end of tomorrow.';
  return `Hi ${first},\n\n${answer}\n\nBest,\n${me}`;
}
