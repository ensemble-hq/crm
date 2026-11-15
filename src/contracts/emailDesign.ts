import { z } from 'zod';

/**
 * A designed email: a look (colours, type, corners) and a list of blocks, top to bottom. It is
 * data, not HTML. The HTML that mail apps need is produced from it in one place
 * (`src/lib/emailDesign.ts`), so nobody writes markup, the model cannot produce anything unsafe,
 * and every email also has a plain-text version.
 *
 * Text in a block may use `**bold**`, `*italic*`, `[a link](https://…)`, lines starting with `- `
 * for a list, and the merge fields `{{firstName}}` and `{{myName}}`.
 */

const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is written like #1F6FEB.');
/** A web address, an email link, or a merge field standing in for one. Anything else is not followed. */
const address = z.string().max(2000);
const align = z.enum(['left', 'center']);

export const emailThemeSchema = z.object({
  /** Buttons, links and the banner. */
  accent: colour,
  /** Behind the email. */
  background: colour,
  /** The email itself. */
  surface: colour,
  text: colour,
  font: z.enum(['sans', 'serif', 'mono']),
  corners: z.enum(['square', 'soft', 'round']),
});
export type EmailTheme = z.infer<typeof emailThemeSchema>;

const base = { id: z.string() };

export const emailBlockSchema = z.discriminatedUnion('kind', [
  /** Your name or logo at the top. */
  z.object({ ...base, kind: z.literal('header'), text: z.string(), logoUrl: address.optional() }),
  /** A coloured banner: a headline, a line under it and, if wanted, a button. */
  z.object({ ...base, kind: z.literal('hero'), heading: z.string(), text: z.string(), buttonLabel: z.string().optional(), buttonUrl: address.optional() }),
  z.object({ ...base, kind: z.literal('heading'), text: z.string(), size: z.enum(['lg', 'md']), align }),
  z.object({ ...base, kind: z.literal('text'), text: z.string(), align }),
  z.object({ ...base, kind: z.literal('button'), label: z.string(), url: address, align }),
  z.object({ ...base, kind: z.literal('image'), url: address, alt: z.string(), link: address.optional() }),
  /** Two or three things side by side; they stack on a phone. */
  z.object({ ...base, kind: z.literal('columns'), items: z.array(z.object({ heading: z.string(), text: z.string(), imageUrl: address.optional(), linkLabel: z.string().optional(), linkUrl: address.optional() })).min(2).max(3) }),
  /** A tinted box that makes one point stand out. */
  z.object({ ...base, kind: z.literal('callout'), text: z.string() }),
  z.object({ ...base, kind: z.literal('divider') }),
  z.object({ ...base, kind: z.literal('spacer'), size: z.enum(['sm', 'md', 'lg']) }),
  /** How the sender signs off. */
  z.object({ ...base, kind: z.literal('signature'), text: z.string() }),
]);
export type EmailBlock = z.infer<typeof emailBlockSchema>;
export type EmailBlockKind = EmailBlock['kind'];

export const emailDesignSchema = z.object({
  theme: emailThemeSchema,
  /** The line a mail app shows after the subject, before the email is opened. */
  preheader: z.string().max(200).optional(),
  blocks: z.array(emailBlockSchema).max(60),
});
export type EmailDesign = z.infer<typeof emailDesignSchema>;

/** What someone asks the model for in the designer. */
export const designRequestSchema = z.object({
  /** What they want, in their own words. */
  prompt: z.string().min(1).max(4000),
  /** The email as it stands, when changing one instead of starting one. */
  subject: z.string().optional(),
  design: emailDesignSchema.optional(),
  /** Change only this block and leave the rest alone. */
  blockId: z.string().optional(),
});
export type DesignRequest = z.infer<typeof designRequestSchema>;

export const designReplySchema = z.object({
  subject: z.string(),
  design: emailDesignSchema,
  /** A sentence from the model about what it did. */
  note: z.string(),
});
export type DesignReply = z.infer<typeof designReplySchema>;

export const subjectIdeasSchema = z.object({ subjects: z.array(z.string()).max(6) });
