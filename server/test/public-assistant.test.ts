import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AssistantReply, AssistantSettings, AssistantUsage } from '../../src/contracts/assistant';
import type { DaySlots, Meeting, PublicForm } from '../../src/contracts/capture';
import type { RecordDetail } from '../../src/contracts/records';
import { registerModelProvider } from '../src/assistant/providers';
import { type Crm, JONAS, MAYA, PRIYA, refusal, startCrm } from './harness';

let crm: Crm;

beforeAll(async () => {
  crm = await startCrm();
});

describe('public forms', () => {
  let formId: string;

  it('give a visitor the form and nothing about anyone else', async () => {
    formId = (await crm.call<{ id: string }>(MAYA, 'forms.save', { name: 'Demo request', heading: 'See it', fields: [{ property: 'name', required: true }, { property: 'email', required: true }, { property: 'phone', required: false }], submitLabel: 'Go', thanks: 'Thanks' })).id;
    const page = await crm.visit<PublicForm>('forms.public', formId);
    expect(Object.keys(page).sort()).toEqual(['fields', 'form']);
    expect(page.form).not.toHaveProperty('submissions');
    expect(await refusal(crm.visit('forms.list'))).toBe('Sign in to do that.');
    expect(await refusal(crm.visit('records.list', { objectId: 'contacts', page: 1, pageSize: 1 }))).toBe('Sign in to do that.');
  });

  it('take only the fields the form asks for', async () => {
    const result = await crm.visit<{ contactId: string; isNew: boolean }>('forms.submit', { formId, values: { name: 'Vera Visitor', email: 'vera@visitor.example', owner: MAYA, lifecycleStage: 'customer' } });
    expect(result.isNew).toBe(true);
    const made = (await crm.call<RecordDetail>(MAYA, 'records.get', result.contactId)).record.properties;
    expect(made).toMatchObject({ name: 'Vera Visitor', source: 'website', lifecycleStage: 'lead' });
    expect(made.owner).toBeUndefined();
    expect(await refusal(crm.visit('forms.submit', { formId, values: { email: 'x@example.com' } }))).toMatch(/is required/);
    expect(await refusal(crm.visit('forms.submit', { formId, values: { name: 'A', email: 'nope' } }))).toMatch(/not an email address/);
  });

  it('quietly drops submissions that look automated, and keeps a person\'s', async () => {
    const send = (email: string, more: Record<string, string>) => crm.visit<{ contactId: string }>('forms.submit', { formId, values: { name: 'Some Name', email, ...more } });
    const known = async (email: string) => (await crm.rows<{ id: string }>(sql`select id from records where properties->>'email' = ${email}`)).length;
    // Filled in the field people cannot see, or sent the form the instant it appeared.
    expect(await send('bot1@spam.example', { __website: 'http://spam.example', __took: '9000' })).toEqual({ contactId: '', isNew: false });
    expect(await send('bot2@spam.example', { __website: '', __took: '300' })).toEqual({ contactId: '', isNew: false });
    expect(await known('bot1@spam.example')).toBe(0);
    expect(await known('bot2@spam.example')).toBe(0);
    expect((await send('person@real.example', { __website: '', __took: '9000' })).contactId).not.toBe('');
    expect(await known('person@real.example')).toBe(1);
  });

  it('never let a visitor overwrite what the team has on a contact', async () => {
    const again = await crm.visit<{ contactId: string; isNew: boolean }>('forms.submit', { formId, values: { name: 'Someone Else', email: 'VERA@visitor.example', phone: '555-9' } });
    expect(again.isNew).toBe(false);
    const kept = (await crm.call<RecordDetail>(MAYA, 'records.get', again.contactId)).record.properties;
    expect(kept).toMatchObject({ name: 'Vera Visitor', phone: '555-9' });
  });
});

describe('booking pages', () => {
  let slot: string;
  const book = (pageId: string, startsAt: string, index: number) => crm.visit<Meeting>('booking.book', { bookingPageId: pageId, startsAt, name: `Visitor ${index}`, email: `visitor${index}@book.example` });

  beforeAll(async () => {
    await crm.call(MAYA, 'booking.savePage', { name: 'Intro call', hostIds: [MAYA], durationMinutes: 30, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 9, toHour: 11 });
    await crm.call(MAYA, 'booking.savePage', { name: 'Team demo', hostIds: [PRIYA, JONAS], durationMinutes: 60, days: [1, 2, 3, 4, 5, 6, 7], fromHour: 9, toHour: 10 });
    const { days } = await crm.visit<{ days: DaySlots[] }>('booking.slots', 'intro-call');
    slot = `${days[0]?.date}T${days[0]?.times[0]}`;
  });

  it('give one slot to one person, however many ask at the same moment', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => book('intro-call', slot, index)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(String(refused.reason.message)).toBe('That time has just been taken. Please choose another.');
    const { days } = await crm.visit<{ days: DaySlots[] }>('booking.slots', 'intro-call');
    expect(days.find((day) => day.date === slot.slice(0, 10))?.times ?? []).not.toContain(slot.slice(11));
  });

  it('refuse a time the page is not offering', async () => {
    expect(await refusal(book('intro-call', `${slot.slice(0, 10)}T03:00`, 99))).toMatch(/just been taken/);
  });

  it('share a slot between the people on a page in turn, then close it', async () => {
    const { days } = await crm.visit<{ days: DaySlots[] }>('booking.slots', 'team-demo');
    const when = `${days[0]?.date}T${days[0]?.times[0]}`;
    const hosts = [(await book('team-demo', when, 20)).hostId, (await book('team-demo', when, 21)).hostId];
    expect(hosts.sort()).toEqual([JONAS, PRIYA].sort());
    expect(await refusal(book('team-demo', when, 22))).toMatch(/just been taken/);
  });
});

describe('the assistant', () => {
  // A stand-in model that follows a script: look something up, then show it and ask for two changes, then finish.
  const seen: { tools: string[]; system: string } = { tools: [], system: '' };
  const scripted: AIAdapter = {
    async generate(messages: AIMessage[], config) {
      seen.tools = (config?.tools ?? []).map((tool) => tool.name);
      seen.system = messages.find((message) => message.role === 'system')?.content ?? '';
      const results = messages.filter((message) => message.role === 'tool');
      const usage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 };
      const base = { usage, model: 'scripted', latencyMs: 1 };
      const deal = /deal id (\S+)/.exec(messages.find((message) => message.role === 'user')?.content ?? '')?.[1] ?? '';
      if (results.length === 0) return { ...base, content: 'Let me look.', toolCalls: [{ id: 'c1', name: 'records_summarize', arguments: { objectId: 'deals', groupBy: 'stage', sumProperty: 'amount' } }] };
      if (results.length === 1) {
        return {
          ...base,
          content: '',
          toolCalls: [
            { id: 'c2', name: 'show_chart', arguments: { title: 'Pipeline', bars: [{ label: 'Qualified', value: 100, display: '$100' }] } },
            { id: 'c3', name: 'records_update', arguments: { step: 'Mark it high priority', input: { id: deal, properties: { priority: 'high' } } } },
            { id: 'c4', name: 'records_delete', arguments: { step: 'Delete it', input: [deal] } },
            { id: 'c5', name: 'records_list', arguments: { objectId: 'deals', filters: [{ property: 'no_such_field', operator: 'eq', value: 'x' }], page: 1, pageSize: 5 } },
          ],
        };
      }
      return { ...base, content: 'The plan is ready.' };
    },
  } as AIAdapter;

  let deal: string;
  beforeAll(async () => {
    registerModelProvider({ id: 'scripted', label: 'Scripted', hint: '', needsKey: false, needsBaseUrl: false, defaultModel: 'scripted', create: () => scripted });
    deal = await crm.seed('deals', { name: 'Assisted', owner: MAYA, stage: 'qualified', amount: 100, priority: 'low' });
  });
  const ask = (as: string) => crm.call<AssistantReply>(as, 'assistant.turn', { messages: [{ role: 'user', text: `How is the pipeline? deal id ${deal}` }], page: { path: '/deals', objectId: 'deals' } });

  it('needs a model connected, by someone who manages settings, and never gives the key back', async () => {
    expect(await refusal(ask(MAYA))).toMatch(/No model is connected/);
    expect(await refusal(crm.call(JONAS, 'assistant.saveSettings', { provider: 'scripted' }))).toMatch(/can't change the assistant's model/);
    expect(await refusal(crm.call(MAYA, 'assistant.saveSettings', { provider: 'anthropic' }))).toMatch(/needs an API key/);
    const saved = await crm.call<AssistantSettings>(MAYA, 'assistant.saveSettings', { provider: 'scripted', apiKey: 'a-secret-key' });
    expect(saved).toMatchObject({ configured: true, provider: 'scripted', hasKey: true });
    expect(JSON.stringify(saved)).not.toContain('a-secret-key');
    const [stored] = await crm.rows<{ api_key_encrypted: string }>(sql`select api_key_encrypted from assistant_settings`);
    expect(stored?.api_key_encrypted).not.toContain('a-secret-key');
  });

  it('looks things up itself, and turns every change into a plan step without making it', async () => {
    const reply = await ask(MAYA);
    const kinds = reply.events.map((event) => event.type);
    expect(kinds).toEqual(['say', 'tool', 'show', 'tool', 'say', 'plan']);
    const plan = reply.events.find((event) => event.type === 'plan');
    expect(plan?.type === 'plan' && plan.steps).toEqual([
      { label: 'Mark it high priority', operation: 'records.update', input: { id: deal, properties: { priority: 'high' } } },
      { label: 'Delete it', operation: 'records.delete', input: [deal] },
    ]);
    // Nothing was changed or deleted by the turn itself.
    expect((await crm.call<RecordDetail>(MAYA, 'records.get', deal)).record.properties.priority).toBe('low');
    // A lookup that fails is told to the model, and the turn carries on.
    const failed = reply.events.filter((event) => event.type === 'tool')[1];
    expect(failed).toMatchObject({ ok: false, result: 'Deals have no property "no_such_field".' });
  });

  it('is given the operations as tools, but not its own, nor the ones for public pages', async () => {
    expect(seen.tools).toEqual(expect.arrayContaining(['records_list', 'records_update', 'workflows_save', 'show_chart', 'show_records']));
    expect(seen.tools.filter((name) => /^(assistant|agents|audit)_|^forms_submit$|^booking_book$/.test(name))).toEqual([]);
    expect(seen.system).toContain('Maya Okafor');
    expect(seen.system).toContain('deals (Deal;');
  });

  it('acts with the access of whoever is asking', async () => {
    // Jonas, a sales rep, cannot see a deal Maya owns... unless it is his team's. Use someone outside the team.
    const reply = await ask('usr_aiko');
    const lookup = reply.events.find((event) => event.type === 'tool');
    expect(lookup).toMatchObject({ ok: true, result: '0 rows' });
  });

  it('records each turn, and shows a person only their own use', async () => {
    const all = await crm.call<AssistantUsage>(MAYA, 'assistant.usage');
    expect(all.turns).toBe(3);
    expect(all.failed).toBe(1);
    expect(all.byPerson.map((row) => row.userId).sort()).toEqual(['usr_aiko', MAYA].sort());
    const own = await crm.call<AssistantUsage>('usr_aiko', 'assistant.usage');
    expect(own.byPerson.map((row) => row.userId)).toEqual(['usr_aiko']);
  });
});
