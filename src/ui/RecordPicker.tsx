import { Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import { ICON, small } from './styles';

/**
 * Choose a record of one object by searching for it: the control for a property that links to
 * another record (a deal's company, a task's contact). Shows the current choice with a way to
 * clear it; typing searches by name, email, website or phone.
 */
export function RecordPicker({ id, objectId, value, onChange }: { id: string; objectId: string; value: string | null; onChange: (recordId: string | null) => void }) {
  const { object: findObject } = useWorkspace();
  const object = findObject(objectId);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const current = useQuery(() => (value ? api.getRecord(value) : Promise.resolve(undefined)), [value]);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 200);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery(() => (query.length >= 2 ? api.listRecords({ objectId, search: query, page: 1, pageSize: 6 }) : Promise.resolve(undefined)), [objectId, query]);
  if (!object) return null;
  const nameOf = (properties: Record<string, unknown>) => String(properties[object.primaryProperty] ?? 'Untitled');

  if (value) {
    return (
      <span className="m-badge" style={{ gap: 'var(--m-space-1)', maxInlineSize: '100%' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.data ? nameOf(current.data.record.properties) : '…'}</span>
        <button type="button" id={id} aria-label={`Remove this ${object.singular.toLowerCase()}`} onClick={() => onChange(null)} style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex' }}>
          <X size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      </span>
    );
  }

  return (
    <div className="m-stack" data-gap="1" style={{ inlineSize: '100%', textAlign: 'start' }}>
      <span style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span aria-hidden style={{ position: 'absolute', insetInlineStart: 'var(--m-space-2)', display: 'inline-flex', color: 'var(--m-color-fg-subtle)' }}>
          <Search size={ICON.button} strokeWidth={ICON.strokeWidth} />
        </span>
        <input className="m-input" data-size="sm" id={id} type="search" autoComplete="off" placeholder={`Search ${object.plural.toLowerCase()}`} value={text} onChange={(event) => setText(event.target.value)} style={{ paddingInlineStart: 'calc(var(--m-space-2) * 2 + 14px)', inlineSize: '100%' }} />
      </span>
      {query.length >= 2 ? (
        <div className="m-menu" role="listbox" aria-label={`${object.plural} matching “${query}”`} style={{ border: 'var(--m-border-width-thin) solid var(--m-color-border-muted)', borderRadius: 'var(--m-radius-md)' }}>
          {results.data?.records.map((record) => {
            const secondary = object.secondaryProperty ? record.properties[object.secondaryProperty] : undefined;
            return (
              <button key={record.id} type="button" role="option" aria-selected="false" className="m-menu-item" onClick={() => onChange(record.id)}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(record.properties)}</span>
                {typeof secondary === 'string' && !results.data?.references[secondary] ? <span className="m-menu-shortcut">{secondary}</span> : null}
              </button>
            );
          })}
          {results.data && results.data.records.length === 0 ? <span style={{ ...small, padding: 'var(--m-space-2)' }}>No {object.plural.toLowerCase()} match.</span> : null}
          {!results.data ? <span style={{ ...small, padding: 'var(--m-space-2)' }}>Searching…</span> : null}
        </div>
      ) : null}
    </div>
  );
}
