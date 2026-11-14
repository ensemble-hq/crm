import { ArrowRight, type LucideIcon, Search, Sparkles } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useSharedAssistant } from '../assistant/context';
import { objectIcon } from '../ui/icons';
import { ICON, small } from '../ui/styles';
import { useWorkspace } from './workspace';

type Item = { key: string; label: string; hint?: string; group: string; icon: LucideIcon; run: () => void };

const PAGES: Array<{ label: string; to: string }> = [
  { label: 'Today', to: '/' },
  { label: 'Assistant', to: '/assistant' },
  { label: 'Inbox', to: '/inbox' },
  { label: 'Sequences', to: '/sequences' },
  { label: 'Email templates', to: '/sequences?tab=templates' },
  { label: 'Workflows', to: '/workflows' },
  { label: 'Forms', to: '/forms' },
  { label: 'Meetings', to: '/meetings' },
  { label: 'Reports', to: '/reports' },
  { label: 'Import', to: '/import' },
  { label: 'Settings', to: '/settings' },
];

/**
 * Search everything from anywhere: records of every object, the pages of the CRM, and, when
 * nothing fits, the assistant. Arrow keys move, Enter opens, Escape closes.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspace = useWorkspace();
  const assistant = useSharedAssistant();
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setText('');
      setQuery('');
      setActive(0);
      element.showModal();
      input.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);

  // Wait for a pause in typing before searching records.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text]);

  const found = useQuery(
    () => (query.length >= 2 ? Promise.all(workspace.objects.map((object) => api.listRecords({ objectId: object.id, search: query, page: 1, pageSize: 4 }).then((result) => ({ object, result })))) : Promise.resolve(undefined)),
    [query, workspace.objects],
  );

  const items = useMemo<Item[]>(() => {
    const go = (to: string) => () => {
      navigate(to);
      onClose();
    };
    const needle = text.trim().toLowerCase();
    const pages = [...workspace.objects.map((object) => ({ label: object.plural, to: `/${object.id}`, icon: objectIcon(object.icon) })), ...PAGES.map((page) => ({ ...page, icon: ArrowRight as LucideIcon }))]
      .filter((page) => needle === '' || page.label.toLowerCase().includes(needle))
      .slice(0, needle === '' ? 8 : 5)
      .map((page): Item => ({ key: `page:${page.to}`, label: page.label, group: 'Go to', icon: page.icon, run: go(page.to) }));
    const records = (found.data ?? []).flatMap(({ object, result }) =>
      result.records.map((record): Item => {
        const secondary = object.secondaryProperty ? record.properties[object.secondaryProperty] : undefined;
        return {
          key: `record:${record.id}`,
          label: String(record.properties[object.primaryProperty] ?? 'Untitled'),
          hint: typeof secondary === 'string' ? (result.references[secondary]?.label ?? secondary) : undefined,
          group: `${object.plural}${result.total > result.records.length ? ` · ${result.total.toLocaleString('en-US')} match` : ''}`,
          icon: objectIcon(object.icon),
          run: go(`/${object.id}/${record.id}`),
        };
      }),
    );
    const ask: Item[] =
      needle.length >= 3
        ? [
            {
              key: 'ask',
              label: `Ask the assistant: “${text.trim()}”`,
              group: 'Assistant',
              icon: Sparkles,
              run: () => {
                assistant.send(text.trim());
                navigate('/assistant');
                onClose();
              },
            },
          ]
        : [];
    return [...records, ...pages, ...ask];
  }, [text, found.data, workspace.objects, navigate, onClose, assistant]);

  const current = Math.min(active, Math.max(items.length - 1, 0));

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(current + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      items[current]?.run();
    }
  }

  let lastGroup = '';
  return (
    // The library's reset removes the margin that centres a modal dialog; here it sits near the top, like a search bar.
    <dialog ref={dialog} className="m-dialog" data-size="lg" aria-label="Search" onClose={onClose} style={{ margin: '12vh auto auto', padding: 0, gap: 0 }}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: arrow keys and Enter are handled for the whole palette */}
      <div onKeyDown={onKeyDown}>
        <label className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', borderBlockEnd: 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
          <Search size={ICON.nav} strokeWidth={ICON.strokeWidth} aria-hidden style={{ color: 'var(--m-color-fg-subtle)', flexShrink: 0 }} />
          <span className="m-sr-only">Search records and pages</span>
          <input
            ref={input}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setActive(0);
            }}
            placeholder="Search contacts, companies, deals, tasks and pages…"
            autoComplete="off"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[current] ? `palette-${current}` : undefined}
            style={{ all: 'unset', flex: 1, font: 'inherit', fontSize: 'var(--m-font-size-lg)', color: 'var(--m-color-fg-default)' }}
          />
          <kbd className="m-kbd">esc</kbd>
        </label>
        <div id="palette-results" role="listbox" aria-label="Results" className="m-menu" style={{ maxBlockSize: '52vh', overflowY: 'auto', padding: 'var(--m-space-2)' }}>
          {items.map((item, index) => {
            const heading = item.group !== lastGroup ? item.group : undefined;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.key}>
                {heading ? <div className="m-menu-label">{heading}</div> : null}
                <button
                  type="button"
                  id={`palette-${index}`}
                  role="option"
                  aria-selected={index === current}
                  className="m-menu-item"
                  onClick={item.run}
                  onMouseMove={() => setActive(index)}
                  style={index === current ? { background: 'var(--m-color-bg-sunken)' } : undefined}
                >
                  <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap', minInlineSize: 0 }}>
                    <Icon size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden style={{ color: 'var(--m-color-fg-subtle)', flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                  </span>
                  {item.hint ? <span className="m-menu-shortcut">{item.hint}</span> : null}
                </button>
              </div>
            );
          })}
          {items.length === 0 ? <span style={{ ...small, padding: 'var(--m-space-3)' }}>{query.length >= 2 && !found.data ? 'Searching…' : 'Nothing matches. Keep typing to ask the assistant.'}</span> : null}
        </div>
      </div>
    </dialog>
  );
}
