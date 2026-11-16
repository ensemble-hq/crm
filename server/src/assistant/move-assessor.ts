import type { AIAdapter, AIMessage } from '@mariachi/ai';
import type { ObjectDefinition } from '../../../src/contracts/metadata';
import { type AssessmentAnswer, type SurveyItem, assessmentAnswerSchema } from '../../../src/contracts/migration';

/**
 * Has the connected model look at an account that is moving in. The plan for HubSpot's own things
 * (people, pipelines, fields, companies, contacts, deals, tasks, history, custom objects) is fixed
 * and needs no model. This is a layer on top: the model reads what else the account has and puts
 * forward additions. It answers through one tool, so what it proposes always has a shape the
 * importer can act on, and nothing it proposes happens until a person accepts it.
 */

const BRIEF = [
  'A team is moving from HubSpot into another CRM. You are shown what their HubSpot account has beyond the standard things, and what the new CRM has. You answer only by calling `assess`, once.',
  'The standard things are already planned and are not yours to plan: people, deal pipelines and stages, custom fields on contacts, companies and deals, companies, contacts, unsubscribe status, deals, tasks, custom objects, and notes, calls, emails and meetings. Never propose a step for any of these.',
  'For everything else the account has, put forward one of three things:',
  '- kind "step": records or activity that should come across. Give a `spec`. For records: { kind: "records", from: <HubSpot object type>, to: <CRM object id>, fields: [{ from: <HubSpot field>, to: <CRM property id> }], links: [{ from: "contacts" | "companies" | "deals", to: "contact" | "company" | "deal" }] }. If an existing object fits, use its id and only its property ids. If none fits, give `object` (singular and plural names) and set `to` to the plural in lower case with hyphens for spaces; a new object has only the properties "name" and "owner", so map the field that names the record to "name" and leave the rest: custom fields are brought on their own. For activity: { kind: "activities", from: <HubSpot type>, as: "note" | "email" | "call" | "meeting" }.',
  '- kind "setup": something the new CRM can already do that should be set up to match what they had, such as a workflow, a report, a saved view or a form. Give `prompt`: the request to make of the CRM\'s assistant, written as the request itself, specific enough to act on.',
  '- kind "build": something the account relies on that the new CRM does not have. Give `brief`: what to build, what data it holds or shows, and where in the CRM it belongs. Only for things the account plainly uses.',
  'Propose only what the evidence supports. An account with nothing unusual gets no proposals. Each `why` names what you saw. Plain words, no preamble.',
].join('\n');

/** What the new CRM can and cannot do, as far as a move is concerned. */
const CAPABILITIES = [
  'It has: contacts, companies, deals with one pipeline, leads, tasks, products and line items on deals, custom objects and fields, saved views, segments of contacts, workflows (when a record is created or changes, or on a schedule: update records, create tasks, send email, notify, call a web address), email sequences, designed email templates, forms with hosted pages, booking pages, reports and dashboards, a forecast, roles and teams, and an assistant that can do all of this when asked.',
  'It does not have: a help desk (ticket queues, service levels, a knowledge base), quotes a buyer can accept, one-off marketing email sends to a list with open and click results, several deal pipelines, landing pages, chat, or surveys.',
].join('\n');

export type AssessInput = { found: SurveyItem[]; objects: ObjectDefinition[] };

/** What is wrong with an answer that parsed, in words the model can act on. Nothing when it is sound. */
function unsound(answer: AssessmentAnswer, objects: ObjectDefinition[]): string | undefined {
  for (const proposal of answer.proposals) {
    if (proposal.kind !== 'step') continue;
    const { spec } = proposal;
    if (spec.kind === 'activities') continue;
    if (spec.kind !== 'records') return `"${proposal.title}": a step proposal must be of kind "records" or "activities", not "${spec.kind}".`;
    if (['contacts', 'companies', 'deals', 'tasks', 'notes', 'calls', 'emails', 'meetings'].includes(spec.from)) return `"${proposal.title}": ${spec.from} are already planned. Do not propose a step for them.`;
    const object = objects.find((item) => item.id === spec.to);
    if (!object && !proposal.object) return `"${proposal.title}": there is no object "${spec.to}". Use an existing object id, or give \`object\` to create one.`;
    const known = object ? object.properties.map((property) => property.id) : ['name', 'owner'];
    const stray = [...(spec.fields ?? []).map((field) => field.to), ...(spec.match ? [spec.match] : [])].find((propertyId) => !known.includes(propertyId));
    if (stray) return `"${proposal.title}": "${stray}" is not a property of ${object ? object.plural.toLowerCase() : 'a new object, which has only "name" and "owner"'}. Map only to: ${known.join(', ')}.`;
  }
  return undefined;
}

export async function assessMove(model: { adapter: AIAdapter; model: string }, input: AssessInput): Promise<{ answer: AssessmentAnswer; inputTokens: number; outputTokens: number; rounds: number }> {
  const objects = input.objects.map((object) => `- ${object.id} (${object.plural}): ${object.properties.filter((property) => !property.system).map((property) => `${property.id} [${property.type}]`).join(', ')}`);
  const found = input.found.map((item) => `- ${item.area} (${item.label}): ${item.count === null ? 'unknown' : `${item.count}${item.more ? ' or more' : ''}`}${item.examples.length > 0 ? `; for example ${item.examples.map((example) => `"${example}"`).join(', ')}` : ''}${item.fields?.length ? `; fields: ${item.fields.join(', ')}` : ''}${item.note ? `; ${item.note}` : ''}`);
  const messages: AIMessage[] = [
    { role: 'system', content: BRIEF },
    { role: 'user', content: [`What the HubSpot account has beyond the standard things:\n${found.join('\n') || '(nothing)'}`, `The new CRM.\n${CAPABILITIES}`, `Its objects and their property ids:\n${objects.join('\n')}`].join('\n\n') },
  ];
  const tools = [{ name: 'assess', description: 'Gives the summary and the proposals for this account.', schema: assessmentAnswerSchema, handler: async () => undefined }];
  const used = { inputTokens: 0, outputTokens: 0, rounds: 0 };
  let problem = 'The model gave no answer.';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await model.adapter.generate(messages, { model: model.model, tools });
    used.inputTokens += response.usage.inputTokens;
    used.outputTokens += response.usage.outputTokens;
    used.rounds += 1;
    const call = (response.toolCalls ?? []).find((item) => item.name === 'assess');
    const parsed = assessmentAnswerSchema.safeParse(call?.arguments);
    const wrong = parsed.success ? unsound(parsed.data, input.objects) : undefined;
    if (parsed.success && !wrong) return { answer: parsed.data, ...used };
    problem = !call ? problem : parsed.success ? (wrong as string) : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    messages.push({ role: 'assistant', content: response.content, ...(call ? { toolCalls: [call] } : {}) });
    messages.push(call ? { role: 'tool', content: JSON.stringify({ callId: call.id, toolName: call.name, result: `That did not fit: ${problem} Call assess again.`, isError: true }) } : { role: 'user', content: 'Answer by calling `assess`.' });
  }
  throw new Error(`The model did not give an assessment that fits (${problem}).`);
}
