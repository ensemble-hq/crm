import type { AIAdapter, AIMessage } from '@mariachi/ai';
import { ValidationError } from '@mariachi/core';
import { z } from 'zod';
import { type DesignReply, type DesignRequest, type EmailBlock, type EmailDesign, emailDesignSchema } from '../../../src/contracts/emailDesign';
import { LOOKS, blockId } from '../../../src/lib/emailDesign';

/**
 * Asks the connected model to design an email, or to change one. The model answers by calling one
 * tool whose input is the design itself, so what comes back is checked against the same schema a
 * person's design is, and anything that does not fit is sent back to the model to put right.
 */

const TRIES = 3;

const answerSchema = z.object({
  subject: z.string().describe('The subject line. Under 60 characters, specific, no capitals for emphasis.'),
  note: z.string().describe('One sentence to the person about what you wrote or changed, and anything they should fill in.'),
  design: emailDesignSchema,
});

const BRIEF = [
  'You design emails inside a CRM for a small team that is not technical. You answer only by calling write_email, once.',
  'An email is a theme (accent, background, surface, text colours as #RRGGBB; font sans, serif or mono; corners square, soft or round) and a list of blocks from top to bottom. Every block has a short unique id and a kind:',
  '- header: the sender\'s name at the top (text). Leave logoUrl out unless you were given an address for a logo.',
  '- hero: a banner in the accent colour with a heading, a line of text and optionally a button (buttonLabel, buttonUrl). At most one, near the top.',
  '- heading (text, size lg or md, align), text (text, align), button (label, url, align), callout (text): a tinted box for the one thing not to miss.',
  '- columns: 2 or 3 items side by side, each a heading and a sentence, optionally linkLabel and linkUrl.',
  '- image (url, alt): only when you were given the address of a picture. Never invent one.',
  '- divider, spacer (size sm, md, lg), signature (text): how the sender signs off.',
  'Text may use **bold**, *italic*, [a link](https://…), lines starting with "- " for a list, and blank lines between paragraphs. Greet with {{firstName}} and sign with {{myName}}; these are filled in for each recipient. Use no other placeholders.',
  'Write the actual email, not instructions for writing one: specific, warm, plain words, short sentences, one clear thing to do. A one-to-one sales email is a text block and a signature with no banner; an announcement or newsletter can use the richer blocks. Stay under about 150 words unless asked for more.',
  'Never invent facts, prices, dates or web addresses. Where a link is needed and none was given, use https://example.com and say so in the note.',
  'Choose colours that suit the request and can be read: text must contrast strongly with surface. When changing an existing email, keep its theme and every block you were not asked to change exactly as it is, with the same ids.',
].join('\n');

/** Makes sure every block has an id of its own, whatever the model sent. */
function withIds(design: EmailDesign): EmailDesign {
  const seen = new Set<string>();
  return {
    ...design,
    blocks: design.blocks.map((block) => {
      const id = block.id && !seen.has(block.id) ? block.id : blockId();
      seen.add(id);
      return { ...block, id };
    }),
  };
}

export async function designEmail(
  model: { adapter: AIAdapter; model: string },
  input: DesignRequest,
  about: { organization: string; sender: string },
): Promise<{ reply: DesignReply; inputTokens: number; outputTokens: number; rounds: number }> {
  const current = input.design;
  const target = input.blockId ? current?.blocks.find((block) => block.id === input.blockId) : undefined;
  if (input.blockId && !target) throw new ValidationError('That part of the email is no longer there.');

  const ask = [
    `The email is from ${about.sender} at ${about.organization}.`,
    current ? `The email as it stands:\n${JSON.stringify({ subject: input.subject ?? '', design: current })}` : `There is no email yet. Start one. If you are unsure of a look, this one is a safe start: ${JSON.stringify(LOOKS[0]?.theme)}`,
    target ? `Change ONLY the block with id "${target.id}" (a ${target.kind}). Return the whole email with every other block untouched.` : '',
    `What they asked for: ${input.prompt}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: AIMessage[] = [
    { role: 'system', content: BRIEF },
    { role: 'user', content: ask },
  ];
  const tools = [{ name: 'write_email', description: 'Gives the finished email: its subject, its design, and a one-sentence note to the person.', schema: answerSchema, handler: async () => undefined }];
  const used = { inputTokens: 0, outputTokens: 0, rounds: 0 };
  let problem = 'The model did not return an email.';

  for (let attempt = 0; attempt < TRIES; attempt += 1) {
    const response = await model.adapter.generate(messages, { model: model.model, tools });
    used.inputTokens += response.usage.inputTokens;
    used.outputTokens += response.usage.outputTokens;
    used.rounds += 1;
    const call = (response.toolCalls ?? []).find((item) => item.name === 'write_email');
    // A model that cannot call tools may still answer with the JSON in its text.
    let given: unknown = call?.arguments;
    if (!call) {
      const json = /\{[\s\S]*\}/.exec(response.content)?.[0];
      try {
        given = json ? JSON.parse(json) : undefined;
      } catch {
        given = undefined;
      }
    }
    const parsed = answerSchema.safeParse(given);
    if (parsed.success && parsed.data.design.blocks.length > 0) {
      let design = withIds(parsed.data.design);
      // Asked to change one block: only that block is taken from the answer, so nothing else can drift.
      if (target && current) {
        const changed: EmailBlock | undefined = design.blocks.find((block) => block.id === target.id) ?? design.blocks[current.blocks.indexOf(target)];
        if (!changed) throw new ValidationError('The model did not return that part of the email. Try again.');
        design = { ...current, blocks: current.blocks.map((block) => (block.id === target.id ? ({ ...changed, id: target.id } as EmailBlock) : block)) };
      }
      return { reply: { subject: target ? (input.subject ?? parsed.data.subject) : parsed.data.subject.trim(), design, note: parsed.data.note.trim() }, ...used };
    }
    problem = parsed.success ? 'The email had nothing in it.' : parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    messages.push({ role: 'assistant', content: response.content, ...(call ? { toolCalls: [call] } : {}) });
    messages.push(call ? { role: 'tool', content: JSON.stringify({ callId: call.id, toolName: call.name, result: `That did not fit: ${problem}. Call write_email again with it put right.`, isError: true }) } : { role: 'user', content: 'Answer by calling write_email with the subject, the note and the design.' });
  }
  throw new ValidationError(`The model could not produce an email that fits (${problem}). Try wording the request differently.`);
}
