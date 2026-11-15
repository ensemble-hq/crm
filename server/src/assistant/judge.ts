import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { z } from 'zod';
import type { ObjectDefinition, PropertyDefinition, PropertyValue } from '../../../src/contracts/metadata';
import type { Activity, CrmRecord } from '../../../src/contracts/records';

/**
 * Asks the connected model to fill in one field of one record: a score, a category or a sentence.
 * It is given the record's fields and its recent history and nothing else, answers through one
 * tool so the value always fits the field, and must say why, so the number can be argued with.
 */

const BRIEF = [
  'You fill in one field on one record in a CRM, for a team that will act on what you write. You answer only by calling `answer`, once.',
  'Base the value only on the record and the history you are given. Never invent a fact. If there is too little to go on, give null and say what is missing.',
  'The reason is one or two plain sentences naming what in the record led you to the value. No hedging, no preamble.',
].join('\n');

function answerSchema(property: PropertyDefinition) {
  const reason = z.string().describe('One or two sentences: what in the record led to this value.');
  if (property.type === 'number') return z.object({ value: z.number().min(0).max(100).nullable().describe('A whole number from 0 to 100, or null if it cannot be judged.'), reason });
  if (property.type === 'select') return z.object({ value: z.enum((property.options ?? []).map((option) => option.id) as [string, ...string[]]).nullable().describe('The id of one of the choices, or null if it cannot be judged.'), reason });
  return z.object({ value: z.string().max(600).nullable().describe('At most two sentences, or null if there is nothing to say.'), reason });
}

/** The record as the model reads it: labelled fields with choices spelled out, without the field being filled. */
function describe(object: ObjectDefinition, record: CrmRecord, except: string): string {
  return object.properties
    .filter((property) => property.id !== except)
    .flatMap((property) => {
      const value = record.properties[property.id];
      if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return [];
      const label = (item: PropertyValue) => property.options?.find((option) => option.id === item)?.label ?? String(item);
      return [`${property.label}: ${Array.isArray(value) ? value.map(label).join(', ') : label(value)}`];
    })
    .join('\n');
}

export async function judge(
  model: { adapter: AIAdapter; model: string },
  input: { object: ObjectDefinition; property: PropertyDefinition; record: CrmRecord; activities: Activity[]; today: string },
): Promise<{ value: PropertyValue; reason: string; inputTokens: number; outputTokens: number }> {
  const schema = answerSchema(input.property);
  const kind = input.property.type === 'number' ? 'a score from 0 to 100' : input.property.type === 'select' ? `one of: ${(input.property.options ?? []).map((option) => `${option.id} (${option.label})`).join(', ')}` : 'a sentence or two';
  const history = input.activities.slice(0, 15).map((activity) => `- ${activity.occurredAt.slice(0, 10)} ${activity.kind}: ${activity.title}${activity.body ? `. ${activity.body.replace(/\s+/g, ' ').slice(0, 400)}` : ''}`);
  const messages: AIMessage[] = [
    { role: 'system', content: BRIEF },
    {
      role: 'user',
      content: [`Today is ${input.today}.`, `The field is "${input.property.label}" on a ${input.object.singular.toLowerCase()}. It holds ${kind}.`, `What the team wants it to say: ${input.property.judged}`, `The ${input.object.singular.toLowerCase()}:\n${describe(input.object, input.record, input.property.id) || '(nothing filled in)'}`, `Its recent history, newest first:\n${history.join('\n') || '(none)'}`].join('\n\n'),
    },
  ];
  const tools = [{ name: 'answer', description: 'Gives the value for the field and the reason for it.', schema, handler: async () => undefined }];
  const used = { inputTokens: 0, outputTokens: 0 };
  let problem = 'The model gave no answer.';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await model.adapter.generate(messages, { model: model.model, tools });
    used.inputTokens += response.usage.inputTokens;
    used.outputTokens += response.usage.outputTokens;
    const call = (response.toolCalls ?? []).find((item) => item.name === 'answer');
    const parsed = schema.safeParse(call?.arguments);
    if (parsed.success) {
      const value = typeof parsed.data.value === 'number' ? Math.round(parsed.data.value) : parsed.data.value;
      return { value, reason: parsed.data.reason.trim().slice(0, 600), ...used };
    }
    problem = call ? parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : problem;
    messages.push({ role: 'assistant', content: response.content, ...(call ? { toolCalls: [call] } : {}) });
    messages.push(call ? { role: 'tool', content: JSON.stringify({ callId: call.id, toolName: call.name, result: `That did not fit: ${problem}. Call answer again.`, isError: true }) } : { role: 'user', content: 'Answer by calling `answer`.' });
  }
  throw new Error(`The model did not give a value that fits (${problem}).`);
}
