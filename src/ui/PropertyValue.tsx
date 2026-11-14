import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useWorkspace } from '../app/workspace';
import type { Option, PropertyDefinition, PropertyValue as Value } from '../contracts/metadata';
import type { Reference } from '../contracts/records';
import { currency, initials, link } from './styles';

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatDate(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : dateFormat.format(time);
}

export function formatDateTime(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : dateTimeFormat.format(time);
}

const empty = <span style={{ color: 'var(--m-color-fg-subtle)' }}>—</span>;

export function OptionBadge({ option }: { option: Option }) {
  if (!option.tone || option.tone === 'neutral') return <span className="m-badge">{option.label}</span>;
  return (
    <span className="m-badge" data-tone={option.tone} data-variant="solid">
      {option.label}
    </span>
  );
}

export function UserChip({ userId }: { userId: string }) {
  const { user } = useWorkspace();
  const found = user(userId);
  if (!found) return empty;
  return (
    <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
      <span className="m-avatar" data-size="sm" style={{ '--m-avatar-size-sm': '20px', fontSize: 'var(--m-font-size-xs)' } as CSSProperties}>
        {initials(found.name)}
      </span>
      {found.name}
    </span>
  );
}

/** Shows one property of a record the way its type calls for. Every list and record page uses this. */
export function PropertyValue({
  property,
  value,
  references,
}: {
  property: PropertyDefinition;
  value: Value | undefined;
  references?: Record<string, Reference>;
}) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return empty;

  switch (property.type) {
    case 'email':
      return (
        <a href={`mailto:${String(value)}`} style={link}>
          {String(value)}
        </a>
      );
    case 'url':
      return (
        <a href={`https://${String(value)}`} target="_blank" rel="noreferrer" style={link}>
          {String(value)}
        </a>
      );
    case 'currency':
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? currency(value) : String(value)}</span>;
    case 'number':
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? value.toLocaleString('en-US') : String(value)}</span>;
    case 'date':
      return <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDate(String(value))}</span>;
    case 'datetime':
      return <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{formatDateTime(String(value))}</span>;
    case 'boolean':
      return <span>{value ? 'Yes' : 'No'}</span>;
    case 'select': {
      const option = property.options?.find((item) => item.id === value);
      return option ? <OptionBadge option={option} /> : <span>{String(value)}</span>;
    }
    case 'multiselect': {
      const ids = Array.isArray(value) ? value : [String(value)];
      return (
        <span className="m-cluster" data-gap="1">
          {ids.map((id) => {
            const option = property.options?.find((item) => item.id === id);
            return <OptionBadge key={id} option={option ?? { id, label: id }} />;
          })}
        </span>
      );
    }
    case 'user':
      return <UserChip userId={String(value)} />;
    case 'reference': {
      const reference = references?.[String(value)];
      if (!reference) return <span>{String(value)}</span>;
      return (
        <Link to={`/${reference.objectId}/${String(value)}`} style={{ color: 'inherit', textDecorationColor: 'var(--m-color-border-strong)', textUnderlineOffset: '0.25em' }}>
          {reference.label}
        </Link>
      );
    }
    default:
      return <span>{String(value)}</span>;
  }
}
