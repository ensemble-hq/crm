import type { EmailBlock, EmailBlockKind, EmailDesign, EmailTheme } from '../contracts/emailDesign';

/**
 * Turns an email design into what is actually sent: HTML that mail apps render the same way
 * (tables, inline styles, nothing clever) and a plain-text version of the same words. The designer
 * shows blocks with `renderBlock`, and the server sends `renderEmailHtml`, so what is designed is
 * what arrives.
 *
 * Nothing a person or a model types is ever put into the HTML unescaped, and a link that is not a
 * web address, an email address or a merge field goes nowhere.
 */

/** The fields that are filled in per recipient when an email is sent. */
export const MERGE_FIELDS = [
  { token: '{{firstName}}', label: 'Their first name', sample: 'Alex' },
  { token: '{{myName}}', label: 'Your first name', sample: 'Maya' },
] as const;

export type Fill = (text: string) => string;

/** Fills the merge fields from a contact's name and the sender's. */
export function fillFor(contactName: string, senderName: string): Fill {
  const first = (name: string) => name.trim().split(/\s+/)[0] ?? '';
  return (text) => text.replace(/\{\{firstName\}\}/g, first(contactName)).replace(/\{\{myName\}\}/g, first(senderName) || senderName);
}

/** Fills the merge fields with example names, for previews. */
export const sampleFill: Fill = (text) => MERGE_FIELDS.reduce((filled, field) => filled.split(field.token).join(field.sample), text);

const FONTS: Record<EmailTheme['font'], string> = {
  sans: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace",
};
const CARD_RADIUS: Record<EmailTheme['corners'], number> = { square: 0, soft: 10, round: 20 };
const BUTTON_RADIUS: Record<EmailTheme['corners'], number> = { square: 0, soft: 6, round: 999 };
const SPACE = { sm: 12, md: 28, lg: 52 } as const;
const SIDE = 36;
export const EMAIL_WIDTH = 600;

export const fontOf = (theme: EmailTheme) => FONTS[theme.font];

const channels = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));

/** Blends two colours: 0 is all the first, 1 is all the second. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from);
  const b = channels(to);
  return `#${a.map((value, index) => Math.round(value + ((b[index] ?? 0) - value) * amount).toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = channels(hex).map((value) => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black, whichever can be read on the colour. */
export const readableOn = (hex: string) => (luminance(hex) > 0.45 ? '#111827' : '#ffffff');

/** The quieter colours a design needs, worked out from its four. */
export function shades(theme: EmailTheme) {
  return {
    muted: mix(theme.text, theme.surface, 0.42),
    line: mix(theme.text, theme.surface, 0.87),
    tint: mix(theme.accent, theme.surface, 0.9),
    onAccent: readableOn(theme.accent),
    // An accent too pale to read as link text on the surface is darkened until it can be.
    link: Math.abs(luminance(theme.accent) - luminance(theme.surface)) < 0.25 ? mix(theme.accent, theme.text, 0.45) : theme.accent,
    outside: mix(readableOn(theme.background), theme.background, 0.45),
  };
}

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A link is followed only if it is a web address or an email link. */
export function safeUrl(url: string | undefined, fill: Fill = (text) => text): string {
  const filled = fill(url ?? '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(filled)) return escape(filled);
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(filled)) return escape(`https://${filled}`);
  return '#';
}

/** Bold, italic and links inside a line. The text is escaped first, so only these three become markup. */
function inline(text: string, linkColour: string, fill: Fill): string {
  return escape(fill(text))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => `<a href="${safeUrl(url.replace(/&amp;/g, '&'))}" style="color:${linkColour};text-decoration:underline">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}

/** Paragraphs and lists from text: a blank line starts a new paragraph, `- ` starts a list item. */
function prose(text: string, style: string, linkColour: string, fill: Fill): string {
  const chunks = text.replace(/\r/g, '').split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean);
  return chunks
    .map((chunk, index) => {
      const lines = chunk.split('\n');
      const last = index === chunks.length - 1;
      const margin = `margin:0 0 ${last ? 0 : 16}px 0`;
      if (lines.every((line) => /^[-•]\s+/.test(line))) return `<ul style="${margin};padding:0 0 0 22px;${style}">${lines.map((line) => `<li style="margin:0 0 6px 0">${inline(line.replace(/^[-•]\s+/, ''), linkColour, fill)}</li>`).join('')}</ul>`;
      return `<p style="${margin};${style}">${lines.map((line) => inline(line, linkColour, fill)).join('<br>')}</p>`;
    })
    .join('');
}

function button(label: string, url: string | undefined, theme: EmailTheme, fill: Fill, colours?: { background: string; text: string }): string {
  const background = colours?.background ?? theme.accent;
  const text = colours?.text ?? readableOn(background);
  const radius = BUTTON_RADIUS[theme.corners];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table"><tr><td bgcolor="${background}" style="background:${background};border-radius:${radius}px"><a href="${safeUrl(url, fill)}" style="display:inline-block;padding:13px 26px;font-family:${fontOf(theme)};font-size:15px;font-weight:600;line-height:1.2;color:${text};text-decoration:none;border-radius:${radius}px">${escape(fill(label))}</a></td></tr></table>`;
}

const cell = (content: string, padding: string, extra = '') => `<tr><td class="em-pad" style="padding:${padding};${extra}">${content}</td></tr>`;

/** One block as a table row. `first` and `last` give the top and bottom of the email their breathing room. */
export function renderBlock(block: EmailBlock, theme: EmailTheme, options: { fill?: Fill; first?: boolean; last?: boolean } = {}): string {
  const fill = options.fill ?? ((text: string) => text);
  const font = fontOf(theme);
  const tone = shades(theme);
  const top = options.first ? 36 : 12;
  const bottom = options.last ? 36 : 12;
  const body = `font-family:${font};font-size:16px;line-height:1.6;color:${theme.text}`;

  switch (block.kind) {
    case 'header': {
      const logo = block.logoUrl && safeUrl(block.logoUrl, fill) !== '#' ? `<img src="${safeUrl(block.logoUrl, fill)}" alt="${escape(fill(block.text))}" height="32" style="display:block;height:32px;width:auto;border:0">` : `<span style="font-family:${font};font-size:17px;font-weight:700;letter-spacing:-0.01em;color:${theme.text}">${escape(fill(block.text))}</span>`;
      return cell(logo, `${options.first ? 28 : 12}px ${SIDE}px ${bottom}px ${SIDE}px`);
    }
    case 'hero': {
      const action = block.buttonLabel ? `<div style="padding-top:24px">${button(block.buttonLabel, block.buttonUrl, theme, fill, { background: tone.onAccent, text: theme.accent })}</div>` : '';
      const lead = block.text.trim() ? prose(block.text, `font-family:${font};font-size:17px;line-height:1.55;color:${tone.onAccent};opacity:0.9`, tone.onAccent, fill) : '';
      return `<tr><td class="em-pad" bgcolor="${theme.accent}" style="background:${theme.accent};padding:44px ${SIDE}px"><h1 style="margin:0 0 ${lead ? 12 : 0}px 0;font-family:${font};font-size:30px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:${tone.onAccent}">${inline(block.heading, tone.onAccent, fill)}</h1>${lead}${action}</td></tr>`;
    }
    case 'heading': {
      const size = block.size === 'lg' ? 26 : 19;
      return cell(`<h2 style="margin:0;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:${theme.text};text-align:${block.align}">${inline(block.text, tone.link, fill)}</h2>`, `${options.first ? 36 : 16}px ${SIDE}px ${options.last ? 36 : 4}px ${SIDE}px`);
    }
    case 'text':
      return cell(prose(block.text, `${body};text-align:${block.align}`, tone.link, fill), `${top}px ${SIDE}px ${bottom}px ${SIDE}px`);
    case 'button':
      return cell(button(block.label, block.url, theme, fill), `${top + 4}px ${SIDE}px ${bottom + 4}px ${SIDE}px`, `text-align:${block.align}`);
    case 'image': {
      const source = safeUrl(block.url, fill);
      const image = source === '#' ? `<div style="padding:36px 0;background:${tone.tint};border-radius:${CARD_RADIUS[theme.corners] / 2}px;font-family:${font};font-size:14px;color:${tone.muted};text-align:center">Add a picture's web address</div>` : `<img src="${source}" alt="${escape(fill(block.alt))}" width="${EMAIL_WIDTH - SIDE * 2}" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:${CARD_RADIUS[theme.corners] / 2}px">`;
      return cell(block.link && source !== '#' ? `<a href="${safeUrl(block.link, fill)}" style="text-decoration:none">${image}</a>` : image, `${top}px ${SIDE}px ${bottom}px ${SIDE}px`);
    }
    case 'columns': {
      const width = Math.floor(100 / block.items.length);
      const cells = block.items
        .map((item, index) => {
          const picture = item.imageUrl && safeUrl(item.imageUrl, fill) !== '#' ? `<img src="${safeUrl(item.imageUrl, fill)}" alt="" style="display:block;width:100%;height:auto;border:0;border-radius:${CARD_RADIUS[theme.corners] / 2}px;margin:0 0 12px 0">` : '';
          const more = item.linkLabel ? `<p style="margin:10px 0 0 0;font-family:${font};font-size:14px;font-weight:600"><a href="${safeUrl(item.linkUrl, fill)}" style="color:${tone.link};text-decoration:none">${escape(fill(item.linkLabel))} &rarr;</a></p>` : '';
          const gap = index === block.items.length - 1 ? 0 : 20;
          return `<td class="em-col" width="${width}%" valign="top" style="width:${width}%;vertical-align:top;padding:0 ${gap}px 0 0">${picture}<h3 style="margin:0 0 6px 0;font-family:${font};font-size:16px;line-height:1.3;font-weight:700;color:${theme.text}">${inline(item.heading, tone.link, fill)}</h3>${prose(item.text, `font-family:${font};font-size:14px;line-height:1.55;color:${tone.muted}`, tone.link, fill)}${more}</td>`;
        })
        .join('');
      return cell(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`, `${top + 4}px ${SIDE}px ${bottom + 4}px ${SIDE}px`);
    }
    case 'callout':
      return cell(`<div style="padding:18px 20px;background:${tone.tint};border-left:3px solid ${theme.accent};border-radius:${CARD_RADIUS[theme.corners] / 2}px">${prose(block.text, `font-family:${font};font-size:15px;line-height:1.55;color:${theme.text}`, tone.link, fill)}</div>`, `${top}px ${SIDE}px ${bottom}px ${SIDE}px`);
    case 'divider':
      return cell(`<div style="height:1px;line-height:1px;font-size:1px;background:${tone.line}">&nbsp;</div>`, `${top + 6}px ${SIDE}px ${bottom + 6}px ${SIDE}px`);
    case 'spacer':
      return `<tr><td style="height:${SPACE[block.size]}px;line-height:${SPACE[block.size]}px;font-size:1px">&nbsp;</td></tr>`;
    case 'signature':
      return cell(prose(block.text, `font-family:${font};font-size:15px;line-height:1.5;color:${tone.muted}`, tone.link, fill), `${top + 4}px ${SIDE}px ${bottom}px ${SIDE}px`);
  }
}

/** The email's rows, without the page around them. */
export function renderRows(design: EmailDesign, fill?: Fill): string {
  return design.blocks.map((block, index) => renderBlock(block, design.theme, { fill, first: index === 0, last: index === design.blocks.length - 1 })).join('');
}

/** What goes under an automated email: who sent it, and the way out. */
export type EmailFooter = { organization: string; postalAddress?: string; unsubscribeUrl?: string };

/** The whole email as HTML, ready to send. */
export function renderEmailHtml(design: EmailDesign, options: { subject?: string; fill?: Fill; footer?: EmailFooter } = {}): string {
  const { theme } = design;
  const tone = shades(theme);
  const fill = options.fill ?? ((text: string) => text);
  const radius = CARD_RADIUS[theme.corners];
  const footer = options.footer
    ? `<table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${EMAIL_WIDTH}px"><tr><td style="padding:20px ${SIDE}px 0 ${SIDE}px;font-family:${fontOf(theme)};font-size:12px;line-height:1.6;color:${tone.outside};text-align:center">${escape(options.footer.organization)}${options.footer.postalAddress ? `<br>${escape(options.footer.postalAddress).replace(/\n/g, '<br>')}` : ''}${options.footer.unsubscribeUrl ? `<br><a href="${safeUrl(options.footer.unsubscribeUrl)}" style="color:${tone.outside};text-decoration:underline">Stop getting these emails</a>` : ''}</td></tr></table>`
    : '';
  const preheader = design.preheader?.trim() ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(fill(design.preheader))}</div>` : '';
  return [
    '<!doctype html>',
    `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>${escape(fill(options.subject ?? ''))}</title>`,
    '<style>@media (max-width:520px){.em-col{display:block!important;width:100%!important;padding:0 0 22px 0!important}.em-pad{padding-left:22px!important;padding-right:22px!important}.em-outer{padding:0!important}}</style></head>',
    `<body style="margin:0;padding:0;background:${theme.background}">${preheader}`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.background}" style="background:${theme.background}"><tr><td class="em-outer" align="center" style="padding:32px 12px">`,
    `<table role="presentation" width="${EMAIL_WIDTH}" cellpadding="0" cellspacing="0" border="0" bgcolor="${theme.surface}" style="width:100%;max-width:${EMAIL_WIDTH}px;background:${theme.surface};border-radius:${radius}px;overflow:hidden;text-align:left">${renderRows(design, fill)}</table>`,
    footer,
    '</td></tr></table></body></html>',
  ].join('');
}

const plain = (text: string) => text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');

/** The same email as plain text: what a mail app shows when it will not show HTML, and what the inbox keeps. */
export function renderEmailText(design: EmailDesign, fill: Fill = (text) => text): string {
  const parts = design.blocks.map((block) => {
    switch (block.kind) {
      case 'header':
      case 'divider':
      case 'spacer':
        return block.kind === 'divider' ? '---' : '';
      case 'hero':
        return [block.heading, block.text, block.buttonLabel ? `${block.buttonLabel}: ${block.buttonUrl ?? ''}` : ''].filter(Boolean).join('\n\n');
      case 'heading':
      case 'text':
      case 'callout':
      case 'signature':
        return block.text;
      case 'button':
        return `${block.label}: ${block.url}`;
      case 'image':
        return block.alt ? `[${block.alt}]` : '';
      case 'columns':
        return block.items.map((item) => [item.heading, item.text, item.linkLabel ? `${item.linkLabel}: ${item.linkUrl ?? ''}` : ''].filter(Boolean).join('\n')).join('\n\n');
    }
  });
  return fill(plain(parts.filter((part) => part.trim()).join('\n\n'))).trim();
}

/** Ready-made looks. Each is only four colours, a typeface and a corner. */
export const LOOKS: Array<{ id: string; name: string; theme: EmailTheme }> = [
  { id: 'clean', name: 'Clean', theme: { accent: '#2563EB', background: '#F3F4F6', surface: '#FFFFFF', text: '#111827', font: 'sans', corners: 'soft' } },
  { id: 'ink', name: 'Ink', theme: { accent: '#18181B', background: '#F4F4F2', surface: '#FFFFFF', text: '#1C1917', font: 'serif', corners: 'square' } },
  { id: 'warm', name: 'Warm', theme: { accent: '#C2410C', background: '#FAF1E6', surface: '#FFFDF9', text: '#3B2A1F', font: 'serif', corners: 'soft' } },
  { id: 'forest', name: 'Forest', theme: { accent: '#166534', background: '#ECF3EE', surface: '#FFFFFF', text: '#14261B', font: 'sans', corners: 'round' } },
  { id: 'plum', name: 'Plum', theme: { accent: '#7E22CE', background: '#F5F0FA', surface: '#FFFFFF', text: '#231431', font: 'sans', corners: 'round' } },
  { id: 'midnight', name: 'Midnight', theme: { accent: '#A78BFA', background: '#0B1020', surface: '#161C30', text: '#E7E9F1', font: 'sans', corners: 'round' } },
  { id: 'letter', name: 'Letter', theme: { accent: '#2563EB', background: '#FFFFFF', surface: '#FFFFFF', text: '#111827', font: 'sans', corners: 'square' } },
];
const look = (id: string): EmailTheme => ({ ...(LOOKS.find((item) => item.id === id) ?? LOOKS[0])!.theme });

export const BLOCK_NAMES: Record<EmailBlockKind, string> = { header: 'Name or logo', hero: 'Banner', heading: 'Heading', text: 'Text', button: 'Button', image: 'Picture', columns: 'Columns', callout: 'Highlight', divider: 'Line', spacer: 'Space', signature: 'Sign-off' };

let counter = 0;
export const blockId = () => `b_${Date.now().toString(36)}${(counter++).toString(36)}`;

/** A new block of a kind, with words to replace. */
export function newBlock(kind: EmailBlockKind): EmailBlock {
  const id = blockId();
  switch (kind) {
    case 'header':
      return { id, kind, text: 'Your company' };
    case 'hero':
      return { id, kind, heading: 'Say the main thing here', text: 'One line that makes them want to read on.', buttonLabel: 'Find out more', buttonUrl: 'https://' };
    case 'heading':
      return { id, kind, text: 'A heading', size: 'md', align: 'left' };
    case 'text':
      return { id, kind, text: 'Hi {{firstName}},\n\nWrite what you want to say.', align: 'left' };
    case 'button':
      return { id, kind, label: 'Book a call', url: 'https://', align: 'left' };
    case 'image':
      return { id, kind, url: '', alt: '' };
    case 'columns':
      return { id, kind, items: [{ heading: 'First point', text: 'A sentence or two about it.' }, { heading: 'Second point', text: 'A sentence or two about it.' }] };
    case 'callout':
      return { id, kind, text: '**Worth knowing:** the one thing you do not want them to miss.' };
    case 'divider':
      return { id, kind };
    case 'spacer':
      return { id, kind, size: 'md' };
    case 'signature':
      return { id, kind, text: 'Best,\n{{myName}}' };
  }
}

type Draft = EmailBlock extends infer Block ? (Block extends EmailBlock ? Omit<Block, 'id'> : never) : never;
const withIds = (blocks: Draft[]): EmailBlock[] => blocks.map((block) => ({ ...block, id: blockId() }) as EmailBlock);

/** Starting points, so nobody faces an empty page. */
export const STARTERS: Array<{ id: string; name: string; hint: string; build: () => EmailDesign }> = [
  {
    id: 'note',
    name: 'Personal note',
    hint: 'Reads like you wrote it yourself.',
    build: () => ({ theme: look('letter'), blocks: withIds([{ kind: 'text', text: 'Hi {{firstName}},\n\nI wanted to follow up on our conversation. Is there anything I can help with before you decide?\n\nHappy to jump on a quick call if that is easier.', align: 'left' }, { kind: 'signature', text: 'Best,\n{{myName}}' }]) }),
  },
  {
    id: 'announcement',
    name: 'Announcement',
    hint: 'One piece of news and one thing to do.',
    build: () => ({
      theme: look('clean'),
      preheader: 'Something new we think you will like.',
      blocks: withIds([
        { kind: 'header', text: 'Your company' },
        { kind: 'hero', heading: 'Something new is here', text: 'A short line about why it matters to them.', buttonLabel: 'Take a look', buttonUrl: 'https://' },
        { kind: 'text', text: 'Hi {{firstName}},\n\nTell them what changed and what it means for them, in two or three sentences.', align: 'left' },
        { kind: 'columns', items: [{ heading: 'Faster', text: 'What got quicker, in a sentence.' }, { heading: 'Simpler', text: 'What got easier, in a sentence.' }, { heading: 'Yours', text: 'What they can now make their own.' }] },
        { kind: 'signature', text: 'Thanks,\n{{myName}}' },
      ]),
    }),
  },
  {
    id: 'followup',
    name: 'Follow-up',
    hint: 'After a meeting: the summary and the next step.',
    build: () => ({
      theme: look('forest'),
      blocks: withIds([
        { kind: 'header', text: 'Your company' },
        { kind: 'heading', text: 'Thanks for your time today', size: 'lg', align: 'left' },
        { kind: 'text', text: 'Hi {{firstName}},\n\nIt was good to talk. Here is what we covered:\n\n- The first thing you agreed\n- The second thing you agreed\n- What happens next', align: 'left' },
        { kind: 'callout', text: '**Next step:** say what it is, who does it, and by when.' },
        { kind: 'button', label: 'Pick a time to continue', url: 'https://', align: 'left' },
        { kind: 'signature', text: 'Best,\n{{myName}}' },
      ]),
    }),
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    hint: 'A few stories, each with a link.',
    build: () => ({
      theme: look('warm'),
      preheader: 'This month: three things worth your time.',
      blocks: withIds([
        { kind: 'header', text: 'Your company' },
        { kind: 'heading', text: 'This month', size: 'lg', align: 'left' },
        { kind: 'text', text: 'Hi {{firstName}}, here is what we have been up to.', align: 'left' },
        { kind: 'divider' },
        { kind: 'heading', text: 'The main story', size: 'md', align: 'left' },
        { kind: 'text', text: 'A short paragraph that says what happened and why they should care. [Read the whole thing](https://)', align: 'left' },
        { kind: 'divider' },
        { kind: 'columns', items: [{ heading: 'Also new', text: 'A sentence about it.', linkLabel: 'Read more', linkUrl: 'https://' }, { heading: 'Coming up', text: 'A sentence about it.', linkLabel: 'Save the date', linkUrl: 'https://' }] },
        { kind: 'signature', text: 'Until next month,\n{{myName}}' },
      ]),
    }),
  },
  {
    id: 'invitation',
    name: 'Invitation',
    hint: 'An event, when and where, and a way to say yes.',
    build: () => ({
      theme: look('plum'),
      blocks: withIds([
        { kind: 'hero', heading: 'You are invited', text: 'The name of the event, in a line.', buttonLabel: 'Save my place', buttonUrl: 'https://' },
        { kind: 'text', text: 'Hi {{firstName}},\n\nWe would love you to join us. Say in a sentence what they will get from coming.', align: 'left' },
        { kind: 'columns', items: [{ heading: 'When', text: 'The day and the time.' }, { heading: 'Where', text: 'The place, or that it is online.' }] },
        { kind: 'signature', text: 'Hope to see you there,\n{{myName}}' },
      ]),
    }),
  },
];

/** A plain saved email as a design, so it can be opened in the designer. A closing line or two becomes the sign-off. */
export function designFromText(body: string): EmailDesign {
  const paragraphs = body.replace(/\r/g, '').trim().split(/\n{2,}/);
  const last = paragraphs[paragraphs.length - 1] ?? '';
  const signed = paragraphs.length > 1 && last.split('\n').length <= 3 && last.length < 80;
  const text = (signed ? paragraphs.slice(0, -1) : paragraphs).join('\n\n');
  return { theme: look('letter'), blocks: withIds([{ kind: 'text', text, align: 'left' }, ...(signed ? [{ kind: 'signature' as const, text: last }] : [])]) };
}
