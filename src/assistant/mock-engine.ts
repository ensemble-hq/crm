import { api } from '../api';
import type { ObjectDefinition, PropertyValue, User } from '../contracts/metadata';
import type { CrmRecord } from '../contracts/records';
import { MOCK_TODAY, OPEN_STAGES } from '../mock/definitions';
import { formatDate } from '../ui/PropertyValue';
import { compactCurrency } from '../ui/styles';
import type { Attachment, CanvasItemInput } from './types';

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

/** Which contact property a spreadsheet column most likely holds. */
const COLUMN_HINTS: Array<{ property: string; pattern: RegExp }> = [
  { property: 'email', pattern: /e-?mail/i },
  { property: 'phone', pattern: /phone|mobile|tel/i },
  { property: 'jobTitle', pattern: /title|role|position/i },
  { property: 'city', pattern: /city|town/i },
  { property: 'name', pattern: /name/i },
];

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
        property: COLUMN_HINTS.find((hint) => hint.pattern.test(column))?.property ?? null,
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

async function help(ctx: EngineContext): Promise<void> {
  await pause(300);
  await ctx.say('This is a scripted preview of the assistant, so it understands a few requests. Try one of these. The answers use the real data in this workspace.');
  ctx.suggest(['How is the pipeline looking?', 'Which big deals have gone quiet?', 'Who has closed the most this year?', 'Import a spreadsheet of leads']);
}

/** Answers one message. Each branch stands in for what the model would decide to do. */
export async function respond(input: { text: string; attachments: Attachment[] }, ctx: EngineContext): Promise<void> {
  const text = input.text.toLowerCase();
  const file = input.attachments[0];
  await pause(450);

  if (file) return importFile(ctx, file);
  if (/sample file/.test(text)) return importFile(ctx, SAMPLE_FILE);
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
  if (/add a |new field|property|i wish|redesign|customi[sz]e|change the (crm|layout|page)/.test(text)) return customization(ctx, input.text);
  return help(ctx);
}
