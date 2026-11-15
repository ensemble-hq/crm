import { describe, expect, it } from 'vitest';
import { emailDesignSchema } from '../contracts/emailDesign';
import { LOOKS, STARTERS, designFromText, fillFor, readableOn, renderEmailHtml, renderEmailText, safeUrl } from './emailDesign';

const theme = LOOKS[0]!.theme;

describe('an email design', () => {
  it('turns into HTML with the words escaped, so nothing typed can become markup', () => {
    const html = renderEmailHtml({ theme, blocks: [{ id: 'a', kind: 'text', text: 'Hi <script>alert(1)</script> & "you"', align: 'left' }] });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;you&quot;');
  });

  it('follows only web and email links', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,x')).toBe('#');
    expect(safeUrl('https://example.com/a?b=1&c=2')).toBe('https://example.com/a?b=1&amp;c=2');
    expect(safeUrl('example.com/pricing')).toBe('https://example.com/pricing');
    expect(safeUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    const html = renderEmailHtml({ theme, blocks: [{ id: 'a', kind: 'text', text: '[click](javascript:alert(1))', align: 'left' }, { id: 'b', kind: 'button', label: 'Go', url: 'javascript:alert(1)', align: 'left' }] });
    expect(html).not.toContain('javascript:');
  });

  it('understands bold, italic, links, lists and paragraphs', () => {
    const html = renderEmailHtml({ theme, blocks: [{ id: 'a', kind: 'text', text: 'One **bold** and *soft* and [here](https://example.com).\n\n- first\n- second', align: 'left' }] });
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>soft</em>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toMatch(/<ul[^>]*><li[^>]*>first<\/li><li[^>]*>second<\/li><\/ul>/);
  });

  it('fills the merge fields per recipient, in the HTML and in the plain text', () => {
    const design = { theme, blocks: [{ id: 'a', kind: 'text' as const, text: 'Hi {{firstName}},', align: 'left' as const }, { id: 'b', kind: 'signature' as const, text: 'Best,\n{{myName}}' }] };
    const fill = fillFor('Ada Lovelace', 'Maya Okafor');
    expect(renderEmailHtml(design, { fill })).toContain('Hi Ada,');
    expect(renderEmailText(design, fill)).toBe('Hi Ada,\n\nBest,\nMaya');
  });

  it('says the same thing as plain text, with links and buttons written out', () => {
    const text = renderEmailText({ theme, blocks: [{ id: 'h', kind: 'hero', heading: 'News', text: 'It is here.', buttonLabel: 'See it', buttonUrl: 'https://example.com' }, { id: 't', kind: 'text', text: 'Read **this** [now](https://example.com/now).', align: 'left' }, { id: 'd', kind: 'divider' }] });
    expect(text).toBe('News\n\nIt is here.\n\nSee it: https://example.com\n\nRead this now (https://example.com/now).\n\n---');
  });

  it('puts the way out under an automated email, and nothing under another', () => {
    const design = STARTERS[0]!.build();
    expect(renderEmailHtml(design)).not.toContain('Stop getting these emails');
    const html = renderEmailHtml(design, { footer: { organization: 'Northwind', postalAddress: '1 Main St\nSpringfield', unsubscribeUrl: 'https://crm.test/u/abc' } });
    expect(html).toContain('Stop getting these emails');
    expect(html).toContain('https://crm.test/u/abc');
    expect(html).toContain('1 Main St<br>Springfield');
  });

  it('picks button lettering that can be read on the button', () => {
    expect(readableOn('#111827')).toBe('#ffffff');
    expect(readableOn('#FDE68A')).toBe('#111827');
  });

  it('has starters and looks that all fit the format', () => {
    for (const starter of STARTERS) expect(emailDesignSchema.safeParse(starter.build()).success, starter.id).toBe(true);
    expect(new Set(STARTERS.flatMap((starter) => starter.build().blocks.map((block) => block.id))).size).toBeGreaterThan(10);
  });

  it('lays a plain saved email out as a letter with its sign-off', () => {
    const design = designFromText('Hi {{firstName}},\n\nThanks for this.\n\nBest,\n{{myName}}');
    expect(design.blocks.map((block) => block.kind)).toEqual(['text', 'signature']);
    expect(renderEmailText(design)).toBe('Hi {{firstName}},\n\nThanks for this.\n\nBest,\n{{myName}}');
  });
});
