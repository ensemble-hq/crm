import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DesignReply, EmailDesign } from '../../src/contracts/emailDesign';
import type { ConversationDetail, ConversationList, EmailTemplate } from '../../src/contracts/inbox';
import type { CrmRecord, JudgeResult, Judgement } from '../../src/contracts/records';
import type { Sequence } from '../../src/contracts/sequences';
import { LOOKS } from '../../src/lib/emailDesign';
import { registerModelProvider } from '../src/assistant/providers';
import { type Crm, FEMI, JONAS, MAYA, refusal, startCrm } from './harness';

let crm: Crm;
const theme = LOOKS[0]!.theme;
const design: EmailDesign = {
  theme,
  blocks: [
    { id: 'hello', kind: 'text', text: 'Hi {{firstName}},\n\nHere is the **plan** we talked about.', align: 'left' },
    { id: 'go', kind: 'button', label: 'See the plan', url: 'https://example.com/plan', align: 'left' },
    { id: 'bye', kind: 'signature', text: 'Best,\n{{myName}}' },
  ],
};
const sent = (to: string) => crm.rows<{ text: string; html: string | null; subject: string }>(sql`select payload->>'text' as text, payload->>'html' as html, payload->>'subject' as subject from dev_mail where direction = 'out' and payload->>'toEmail' = ${to} order by sequence`);

// A stand-in model. What it answers is set by each test.
let answers: Array<Record<string, unknown> | string> = [];
const heard: AIMessage[][] = [];
const scripted = {
  async generate(messages: AIMessage[]) {
    heard.push(messages);
    const answer = answers.shift() ?? 'I have nothing.';
    const base = { usage: { inputTokens: 200, outputTokens: 50, totalTokens: 250 }, model: 'scripted', latencyMs: 1 };
    if (typeof answer === 'string') return { ...base, content: answer };
    return '__answer' in answer ? { ...base, content: '', toolCalls: [{ id: `c${heard.length}`, name: 'answer', arguments: answer.__answer }] } : { ...base, content: '', toolCalls: [{ id: `c${heard.length}`, name: 'write_email', arguments: answer }] };
  },
} as unknown as AIAdapter;

beforeAll(async () => {
  crm = await startCrm();
  registerModelProvider({ id: 'scripted-designer', label: 'Scripted', hint: '', needsKey: false, needsBaseUrl: false, defaultModel: 'scripted', create: () => scripted });
});

describe('a designed email', () => {
  let template: EmailTemplate;

  it('is saved with its words as plain text beside the design', async () => {
    template = await crm.call<EmailTemplate>(MAYA, 'templates.save', { name: 'The plan', subject: 'Your plan, {{firstName}}', body: 'ignored', design });
    expect(template.design?.blocks).toHaveLength(3);
    expect(template.body).toBe('Hi {{firstName}},\n\nHere is the plan we talked about.\n\nSee the plan: https://example.com/plan\n\nBest,\n{{myName}}');
    expect(await refusal(crm.call(MAYA, 'templates.save', { name: 'Empty', subject: '', body: '', design: { theme, blocks: [] } }))).toMatch(/Add something/);
    expect(await refusal(crm.call(MAYA, 'templates.save', { name: 'Bad colour', subject: '', body: '', design: { theme: { ...theme, accent: 'red' }, blocks: design.blocks } }))).toBeTruthy();
  });

  it('keeps its design when only its name changes, and becomes plain again when asked', async () => {
    const renamed = await crm.call<EmailTemplate>(MAYA, 'templates.save', { id: template.id, name: 'The plan (v2)', subject: template.subject, body: template.body });
    expect(renamed.design?.blocks).toHaveLength(3);
    const copy = await crm.call<EmailTemplate>(MAYA, 'templates.save', { name: 'Copy', subject: 's', body: 'b', design });
    const plain = await crm.call<EmailTemplate>(MAYA, 'templates.save', { id: copy.id, name: 'Copy', subject: 's', body: 'Just words.', design: null });
    expect(plain.design).toBeUndefined();
    expect(plain.body).toBe('Just words.');
  });

  it('goes out from a sequence as HTML and as text, filled in for the person, with the way out under it', async () => {
    const ada = await crm.call<CrmRecord>(MAYA, 'records.create', { objectId: 'contacts', properties: { name: 'Ada Designed', email: 'ada.designed@example.com', owner: MAYA } });
    const sequence = await crm.call<Sequence>(MAYA, 'sequences.save', { name: 'Designed', status: 'active', steps: [{ id: 's1', kind: 'email', waitDays: 0, templateId: template.id }] });
    await crm.call(MAYA, 'sequences.enroll', { sequenceId: sequence.id, contactIds: [ada.id] });
    await crm.services.sequences.runDue(crm.system());
    await crm.services.mail.sweep(crm.system());
    const [mail] = await sent('ada.designed@example.com');
    expect(mail?.subject).toBe('Your plan, Ada');
    expect(mail?.text).toContain('Hi Ada,');
    expect(mail?.text).toContain('To stop getting these emails:');
    expect(mail?.html).toContain('<!doctype html>');
    expect(mail?.html).toContain('Hi Ada,');
    expect(mail?.html).toContain('<strong>plan</strong>');
    expect(mail?.html).toContain('href="https://example.com/plan"');
    expect(mail?.html).toContain('Stop getting these emails');
    expect(mail?.html).toContain('http://crm.test/u/');
    expect(mail?.html).not.toContain('{{');

    // The inbox keeps both, so the conversation can show it as it was sent.
    const list = await crm.call<ConversationList>(MAYA, 'inbox.list', { folder: 'open', search: 'Ada Designed', page: 1, pageSize: 5 });
    const detail = await crm.call<ConversationDetail>(MAYA, 'inbox.get', list.conversations[0]?.id);
    expect(detail.messages[0]?.html).toContain('Hi Ada,');
    expect(detail.messages[0]?.body).toContain('Hi Ada,');
  });

  it('can be sent to yourself as a test, with example names, and nothing is kept', async () => {
    const before = await crm.rows<{ total: number }>(sql`select count(*)::int as total from messages`);
    expect(await crm.call<{ to: string }>(JONAS, 'templates.sendTest', { subject: 'Your plan, {{firstName}}', body: '', design })).toEqual({ to: 'jonas@northwind.example' });
    const [mail] = await sent('jonas@northwind.example');
    expect(mail?.subject).toBe('[Test] Your plan, Alex');
    expect(mail?.html).toContain('Hi Alex,');
    expect(await crm.rows<{ total: number }>(sql`select count(*)::int as total from messages`)).toEqual(before);
  });

  it('keeps the HTML of an email that arrives', async () => {
    await crm.services.mail.receive(crm.system(), 'dev', 'html-in-1', { fromEmail: 'fancy@example.com', subject: 'Our newsletter', text: 'Plain words.', html: '<p>Fancy <b>words</b>.</p>', messageId: '<html-in-1@sender>' });
    const [row] = await crm.rows<{ id: string }>(sql`select id from inbound_emails where provider_message_id = 'html-in-1'`);
    await crm.services.mail.file(crm.system(), row?.id ?? '');
    const list = await crm.call<ConversationList>(MAYA, 'inbox.list', { folder: 'open', search: 'Our newsletter', page: 1, pageSize: 5 });
    const detail = await crm.call<ConversationDetail>(MAYA, 'inbox.get', list.conversations[0]?.id);
    expect(detail.messages[0]).toMatchObject({ body: 'Plain words.', html: '<p>Fancy <b>words</b>.</p>' });
  });
});

describe('designing with the connected model', () => {
  const written = { subject: 'A quick hello', note: 'I kept it short.', design: { theme, blocks: [{ id: 'a', kind: 'text', text: 'Hi {{firstName}}, hello.', align: 'left' }, { id: 'a', kind: 'signature', text: '{{myName}}' }] } };

  it('says so when no model is connected', async () => {
    expect(await refusal(crm.call(MAYA, 'templates.design', { prompt: 'A hello' }))).toMatch(/No model is connected/);
  });

  it('returns what the model wrote, with every block given an id of its own, and counts the use', async () => {
    await crm.call(MAYA, 'assistant.saveSettings', { provider: 'scripted-designer', model: 'scripted' });
    answers = [written];
    const reply = await crm.call<DesignReply>(JONAS, 'templates.design', { prompt: 'A short hello to a new lead' });
    expect(reply.subject).toBe('A quick hello');
    expect(reply.note).toBe('I kept it short.');
    expect(new Set(reply.design.blocks.map((block) => block.id)).size).toBe(2);
    const asked = heard[heard.length - 1]?.find((message) => message.role === 'user')?.content ?? '';
    expect(asked).toContain('Jonas');
    expect(asked).toContain('A short hello to a new lead');
    const [turn] = await crm.rows<{ question: string; input_tokens: number; user_id: string }>(sql`select question, input_tokens, user_id from assistant_turns order by created_at desc limit 1`);
    expect(turn).toMatchObject({ question: 'Design an email: A short hello to a new lead', input_tokens: 200, user_id: JONAS });
  });

  it('sends back an answer that does not fit, and takes the corrected one', async () => {
    answers = [{ subject: 'Bad', note: '', design: { theme: { ...theme, accent: 'blue' }, blocks: [{ id: 'x', kind: 'banner', text: 'no such block' }] } }, written];
    const reply = await crm.call<DesignReply>(MAYA, 'templates.design', { prompt: 'Try again' });
    expect(reply.subject).toBe('A quick hello');
    const retry = heard[heard.length - 1] ?? [];
    expect(retry[retry.length - 1]?.content).toMatch(/did not fit/);
  });

  it('gives up plainly when the model never produces an email', async () => {
    answers = ['Sorry, I cannot.', 'Still no.', 'No.'];
    expect(await refusal(crm.call(MAYA, 'templates.design', { prompt: 'Anything' }))).toMatch(/could not produce an email/);
  });

  it('changes only the part it was asked to, whatever else the model touched', async () => {
    const meddled = { subject: 'Changed subject', note: 'Shortened.', design: { theme: { ...theme, accent: '#FF0000' }, blocks: [{ id: 'hello', kind: 'text', text: 'Hi {{firstName}}, the plan.', align: 'left' }, { id: 'go', kind: 'button', label: 'CLICK NOW', url: 'https://evil.example', align: 'left' }, { id: 'bye', kind: 'signature', text: 'Bye' }] } };
    answers = [meddled];
    const reply = await crm.call<DesignReply>(MAYA, 'templates.design', { prompt: 'Shorter', subject: 'Your plan', design, blockId: 'hello' });
    expect(reply.subject).toBe('Your plan');
    expect(reply.design.theme).toEqual(theme);
    expect(reply.design.blocks[0]).toMatchObject({ id: 'hello', text: 'Hi {{firstName}}, the plan.' });
    expect(reply.design.blocks.slice(1)).toEqual(design.blocks.slice(1));
    expect(await refusal(crm.call(MAYA, 'templates.design', { prompt: 'Shorter', design, blockId: 'gone' }))).toMatch(/no longer there/);
  });
});

describe('a field the model fills in', () => {
  let lead: string;
  const value = async () => (await crm.call<{ record: CrmRecord }>(MAYA, 'records.get', lead)).record.properties.buyingIntent;
  // The stand-in answers `answer` calls from this list.
  const judging = (list: Array<Record<string, unknown> | string>) => {
    answers = list.map((item) => (typeof item === 'string' ? item : { __answer: item })) as typeof answers;
  };

  beforeAll(async () => {
    lead = await crm.seed('leads', { name: 'Judy Judged', email: 'judy@example.com', companyName: 'Acme', owner: JONAS, status: 'new' });
    await crm.call(JONAS, 'activity.create', { recordId: lead, kind: 'call', title: 'Discovery call', body: 'Asked for pricing for 40 seats and a start date in March.' });
  });

  it('is set up on a number, a choice or text, and on nothing that is worked out another way', async () => {
    expect(await refusal(crm.call(MAYA, 'properties.create', { objectId: 'leads', label: 'When to call', type: 'date', group: 'About', judged: 'When to call them' }))).toMatch(/a number, a choice or a text field/);
    expect(await refusal(crm.call(MAYA, 'properties.create', { objectId: 'leads', label: 'Both', type: 'number', group: 'About', formula: '1 + 1', judged: 'How keen' }))).toMatch(/choose one/);
    await crm.call(MAYA, 'properties.create', { objectId: 'leads', label: 'Buying intent', type: 'number', group: 'About', judged: 'How likely they are to buy this quarter' });
    // Nobody can type into it.
    await crm.call(MAYA, 'records.update', { id: lead, properties: { buyingIntent: 99 } });
    expect((await value()) ?? null).toBeNull();
  });

  it('is filled in from the record and its history, with the reason kept', async () => {
    judging([{ value: 82.4, reason: 'They asked for pricing for 40 seats and named a start date.' }]);
    const result = await crm.call<JudgeResult>(JONAS, 'records.judge', { objectId: 'leads', propertyId: 'buyingIntent', ids: [lead, 'lead_nope'] });
    expect(result.judged).toEqual([{ id: lead, value: 82, reason: 'They asked for pricing for 40 seats and named a start date.' }]);
    expect(result.skipped.map((item) => item.id)).toEqual(['lead_nope']);
    expect(await value()).toBe(82);
    const asked = heard[heard.length - 1]?.find((message) => message.role === 'user')?.content ?? '';
    expect(asked).toContain('How likely they are to buy this quarter');
    expect(asked).toContain('Company: Acme');
    expect(asked).toContain('Asked for pricing for 40 seats');
    expect(await crm.call<Judgement[]>(MAYA, 'records.judgements', lead)).toMatchObject([{ propertyId: 'buyingIntent', reason: 'They asked for pricing for 40 seats and named a start date.', model: 'scripted' }]);
  });

  it('leaves the field alone when the model answers badly twice, or the person may not change the record', async () => {
    judging([{ value: 140, reason: 'Too keen.' }, { value: 'lots', reason: 'Still wrong.' }]);
    const bad = await crm.call<JudgeResult>(JONAS, 'records.judge', { objectId: 'leads', propertyId: 'buyingIntent', ids: [lead] });
    expect(bad.judged).toEqual([]);
    expect(bad.skipped[0]?.reason).toMatch(/did not give a value that fits/);
    expect(await value()).toBe(82);

    judging([{ value: 10, reason: 'Not for you to change.' }]);
    const denied = await crm.call<JudgeResult>(FEMI, 'records.judge', { objectId: 'leads', propertyId: 'buyingIntent', ids: [lead] });
    expect(denied.judged).toEqual([]);
    expect(await value()).toBe(82);
    expect(await refusal(crm.call(MAYA, 'records.judge', { objectId: 'leads', propertyId: 'name', ids: [lead] }))).toMatch(/not a field the model fills in/);
  });

  it('can say it cannot tell', async () => {
    judging([{ value: null, reason: 'There is no history to go on.' }]);
    const result = await crm.call<JudgeResult>(JONAS, 'records.judge', { objectId: 'leads', propertyId: 'buyingIntent', ids: [lead] });
    expect(result.judged[0]).toMatchObject({ value: null });
    expect((await value()) ?? null).toBeNull();
  });
});
