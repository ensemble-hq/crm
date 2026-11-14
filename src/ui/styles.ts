import type { CSSProperties } from 'react';

/**
 * Shared inline styles. They only reference design tokens (`--m-*`), so switching the preset or
 * overriding a token restyles everything; no colour or size literals belong here.
 */

/** Stroke weight and sizes for Lucide icons in the Keel design language. */
export const ICON = { strokeWidth: 2.25, nav: 16, button: 14, inline: 12 } as const;

/** A white toolbar button on a hairline ring (page-header and filter actions). */
export const toolbarButton = {
  '--m-button-secondary-bg': 'var(--m-color-bg-surface)',
  '--m-button-secondary-hover-bg': 'var(--m-color-bg-sunken)',
  '--m-button-secondary-shadow': 'var(--m-shadow-sm)',
  '--m-button-secondary-hover-shadow': 'var(--m-shadow-sm)',
} as CSSProperties;

export const figure: CSSProperties = {
  fontSize: 'var(--m-font-size-xl)',
  fontWeight: 'var(--m-font-weight-medium)',
  letterSpacing: 'var(--m-font-tracking-tight)',
  lineHeight: 'var(--m-font-leading-tight)',
  fontVariantNumeric: 'tabular-nums',
};

export const cardTitle: CSSProperties = {
  fontSize: 'var(--m-font-size-md)',
  fontWeight: 'var(--m-font-weight-medium)',
};

export const muted: CSSProperties = { color: 'var(--m-color-fg-muted)' };

export const small: CSSProperties = { fontSize: 'var(--m-font-size-sm)', color: 'var(--m-color-fg-muted)' };

export const medium: CSSProperties = { fontWeight: 'var(--m-font-weight-medium)' };

export const tabular: CSSProperties = { fontVariantNumeric: 'tabular-nums' };

export const plainList: CSSProperties = { padding: 0, margin: 0, listStyle: 'none' };

export const rowDivider: CSSProperties = {
  borderBlockStart: 'var(--m-border-width-thin) solid var(--m-color-border-muted)',
};

export const link: CSSProperties = { color: 'var(--m-color-accent-text)', textDecoration: 'none' };

export function currency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export function compactCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}
