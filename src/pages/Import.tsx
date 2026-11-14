import { ArrowRight, Check, FileSpreadsheet, Plus, TriangleAlert, Undo2, Upload } from 'lucide-react';
import { type CSSProperties, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { ObjectDefinition, PropertyValue } from '../contracts/metadata';
import type { ImportResult } from '../contracts/records';
import { matchColumn } from '../lib/columns';
import { parseCsv } from '../lib/csv';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';

/** A column goes to a property, to a new property made for it, or nowhere. */
const SKIP = '';
const NEW = '__new';

type Column = { header: string; index: number; target: string };
type Source = { name: string; header: string[]; rows: string[][] };
type Step = 'source' | 'map' | 'review' | 'done';

const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'source', label: 'Choose a file' },
  { id: 'map', label: 'Match columns' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
];

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** Each row as property id to text. Several columns on one property are joined ("First name" + "Last name"). */
function buildRows(source: Source, columns: Column[], newIds: Record<string, string> = {}): Array<Record<string, string>> {
  return source.rows.map((cells) => {
    const row: Record<string, string> = {};
    for (const column of columns) {
      const target = column.target === NEW ? newIds[column.header] : column.target;
      if (!target) continue;
      const text = (cells[column.index] ?? '').trim();
      if (text === '') continue;
      row[target] = row[target] ? `${row[target]} ${text}` : text;
    }
    return row;
  });
}

function Stepper({ step }: { step: Step }) {
  const current = STEPS.findIndex((item) => item.id === step);
  return (
    <ol className="m-cluster" data-gap="2" style={{ ...plainList, flexWrap: 'wrap' }}>
      {STEPS.map((item, index) => (
        <li key={item.id} className="m-cluster" data-gap="2" aria-current={index === current ? 'step' : undefined} style={{ color: index <= current ? 'var(--m-color-fg-default)' : 'var(--m-color-fg-subtle)' }}>
          <span
            aria-hidden
            style={{
              display: 'grid',
              placeItems: 'center',
              inlineSize: 20,
              blockSize: 20,
              borderRadius: 'var(--m-radius-full)',
              fontSize: 'var(--m-font-size-xs)',
              background: index <= current ? 'var(--m-color-fg-default)' : 'var(--m-color-bg-sunken)',
              color: index <= current ? 'var(--m-color-bg-canvas)' : 'var(--m-color-fg-muted)',
            }}
          >
            {index < current ? <Check size={12} strokeWidth={3} /> : index + 1}
          </span>
          <span style={index === current ? medium : undefined}>{item.label}</span>
          {index < STEPS.length - 1 ? <span aria-hidden style={{ inlineSize: 24, blockSize: 1, background: 'var(--m-color-border-default)' }} /> : null}
        </li>
      ))}
    </ol>
  );
}

/** A sample in the shape of a HubSpot contact export, with the problems a real file has. */
function sampleFile(existing: { name: string; email: string } | undefined): Source {
  const rows = [
    ['Imani', 'Okoro', 'imani.okoro@fernbrookfoods.example', '+1 (415) 555-0134', 'Head of Operations', 'Lead', 'Austin', 'Referral', 'Teal'],
    ['Lukas', 'Meyer', 'lukas.meyer@steinwerk.example', '+49 30 5550 142', 'Procurement Lead', 'Sales qualified', 'Berlin', 'Event', 'Grey'],
    ['Rosa', 'Delgado', 'rosa@casadelgado.example', '', 'Founder', 'Lead', 'Valencia', 'Website form', ''],
    ['Tomasz', 'Zielinski', 'tomasz.z@nordhaven', '+46 8 555 0177', 'IT Manager', 'Lead', 'Stockholm', 'Outbound', 'Blue'],
    ['Aisha', 'Rahman', 'aisha.rahman@brightquay.example', '+44 20 5550 0119', 'Finance Director', 'Opportunity', 'London', 'Partner', 'Green'],
    ['Lukas', 'Meyer', 'lukas.meyer@steinwerk.example', '+49 30 5550 142', 'Procurement Lead', 'Sales qualified', 'Berlin', 'Event', 'Grey'],
    ['Keiko', 'Morita', 'keiko.morita@harborline.example', '+1 (604) 555-0166', 'VP of Sales', 'Evangelist', 'Vancouver', 'Referral', 'Red'],
    ['Daniel', 'Osei', 'daniel.osei@kestrelworks.example', '+1 (303) 555-0121', 'Operations Manager', 'Customer', 'Denver', 'Website form', 'Orange'],
  ];
  if (existing) {
    const [first = existing.name, ...rest] = existing.name.split(' ');
    rows.push([first, rest.join(' '), existing.email, '+1 (212) 555-0190', 'Chief Operating Officer', 'Customer', 'New York', 'Import', 'Purple']);
  }
  return { name: 'hubspot-contacts-export.csv', header: ['First Name', 'Last Name', 'Email', 'Phone Number', 'Job Title', 'Lifecycle Stage', 'City', 'Original Source', 'Favourite colour'], rows };
}

/**
 * Bring records in from a spreadsheet, in four steps: choose the file, check how its columns were
 * matched, review exactly what will happen (nothing is written until you say), and a result you
 * can undo.
 */
export function ImportPage() {
  const workspace = useWorkspace();
  const [params, setParams] = useSearchParams();
  const importable = workspace.objects.filter((object) => !object.completion);
  const object = importable.find((item) => item.id === params.get('object')) ?? importable[0];
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<Source>();
  const [columns, setColumns] = useState<Column[]>([]);
  const [matchOn, setMatchOn] = useState('');
  const [onMatch, setOnMatch] = useState<'skip' | 'update'>('skip');
  const [assignToMe, setAssignToMe] = useState(true);
  const [preview, setPreview] = useState<ImportResult>();
  const [result, setResult] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [undone, setUndone] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  // One contact that is already in the CRM, so the sample file shows a real match.
  const existing = useQuery(() => api.listRecords({ objectId: 'contacts', viewId: 'customers', page: 1, pageSize: 1 }), []);

  if (!object) return null;

  const noun = object.plural.toLowerCase();
  const mapped = columns.filter((column) => column.target !== SKIP);
  const hasOwner = object.properties.some((property) => property.id === 'owner');
  const ownerMapped = columns.some((column) => column.target === 'owner');
  const matchable = object.properties.filter((property) => property.unique && columns.some((column) => column.target === property.id));

  function start(next: Source, target: ObjectDefinition = object as ObjectDefinition) {
    const matched = next.header.map((header, index) => ({ header, index, target: matchColumn(header, target) ?? SKIP }));
    setSource(next);
    setColumns(matched);
    setMatchOn(target.properties.find((property) => property.unique && matched.some((column) => column.target === property.id))?.id ?? '');
    setPreview(undefined);
    setResult(undefined);
    setUndone(false);
    setError(undefined);
    setStep('map');
  }

  async function pick(picked: File | undefined) {
    if (!picked) return;
    const rows = parseCsv(await picked.text());
    const [header, ...rest] = rows;
    if (!header || rest.length === 0) {
      setError(`${picked.name} has no rows. The file needs a header row and at least one row of data.`);
      return;
    }
    start({ name: picked.name, header, rows: rest });
  }

  function request(dryRun: boolean, newIds: Record<string, string> = {}) {
    const defaults: Record<string, PropertyValue> = {};
    if (hasOwner && !ownerMapped && assignToMe) defaults.owner = workspace.currentUser.id;
    return api.importRecords({ objectId: (object as ObjectDefinition).id, rows: buildRows(source as Source, columns, newIds), matchOn: matchOn || undefined, onMatch, defaults, dryRun });
  }

  async function review() {
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await request(true));
      setStep('review');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The file could not be checked.');
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!source || !object) return;
    setBusy(true);
    setError(undefined);
    try {
      // Columns marked "new property" get one made first, so their values have somewhere to go.
      const newIds: Record<string, string> = {};
      for (const column of columns.filter((item) => item.target === NEW)) {
        const updated = await api.createProperty({ objectId: object.id, label: column.header, type: 'text', group: object.properties[0]?.group ?? 'About' });
        const created = updated.properties.find((property) => property.label === column.header);
        if (created) newIds[column.header] = created.id;
      }
      if (Object.keys(newIds).length > 0) await workspace.reload();
      setResult(await request(false, newIds));
      workspace.touch();
      setStep('done');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The import did not finish.');
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!result) return;
    setBusy(true);
    try {
      await api.deleteRecords(result.created);
      workspace.touch();
      setUndone(true);
    } finally {
      setBusy(false);
    }
  }

  const setTarget = (index: number, target: string) => setColumns((previous) => previous.map((column) => (column.index === index ? { ...column, target } : column)));

  return (
    <Page icon={Upload} crumbs={[{ label: object.plural, to: `/${object.id}` }, { label: 'Import' }]}>
      <div className="m-stack" data-gap="5">
        <div className="m-stack" data-gap="3">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Import {noun}</h1>
          <Stepper step={step} />
        </div>
        {error ? (
          <div className="m-alert" data-tone="danger" role="alert">
            <div className="m-alert-content">
              <p className="m-alert-body">{error}</p>
            </div>
          </div>
        ) : null}

        {step === 'source' ? (
          <div className="m-stack" data-gap="4">
            <div className="m-field" style={{ maxInlineSize: 280 }}>
              <label className="m-field-label" htmlFor="import-object">
                What are you importing?
              </label>
              <select className="m-select" id="import-object" value={object.id} onChange={(event) => setParams({ object: event.target.value }, { replace: true })}>
                {importable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.plural}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-grid" style={{ '--m-layout-grid-min': '280px' } as CSSProperties}>
              <section className="m-card">
                <div className="m-card-body m-stack" data-gap="3">
                  <FileSpreadsheet size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
                  <div className="m-stack" data-gap="1">
                    <h2 style={cardTitle}>A spreadsheet</h2>
                    <p style={{ ...small, margin: 0 }}>A CSV file with a header row. Exports from HubSpot, Salesforce, Pipedrive and Excel all work.</p>
                  </div>
                  <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(event) => void pick(event.target.files?.[0])} />
                  <div className="m-cluster" data-gap="2">
                    <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => file.current?.click()}>
                      <Upload size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Choose a file
                    </button>
                    {object.id === 'contacts' ? (
                      <button
                        type="button"
                        className="m-button"
                        data-size="sm"
                        onClick={() => {
                          const first = existing.data?.records[0];
                          start(sampleFile(first ? { name: String(first.properties.name), email: String(first.properties.email) } : undefined));
                        }}
                      >
                        Try a sample file
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
              <section className="m-card">
                <div className="m-card-body m-stack" data-gap="3">
                  <ArrowRight size={22} strokeWidth={ICON.strokeWidth} aria-hidden />
                  <div className="m-stack" data-gap="1">
                    <h2 style={cardTitle}>
                      Straight from HubSpot <span className="m-badge">Planned</span>
                    </h2>
                    <p style={{ ...small, margin: 0 }}>Connect your HubSpot account and bring everything at once: records, properties, pipelines, activity history, lists, templates and consent status, with a report of anything that cannot come across.</p>
                  </div>
                  <button type="button" className="m-button" data-size="sm" disabled style={{ inlineSize: 'fit-content' }}>
                    Connect HubSpot
                  </button>
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {step === 'map' && source ? (
          <div className="m-stack" data-gap="4">
            <p style={{ margin: 0, color: 'var(--m-color-fg-muted)' }}>
              <span style={medium}>{source.name}</span> has {plural(source.rows.length, 'row')} and {plural(source.header.length, 'column')}. {mapped.length} of the columns were matched to {object.singular.toLowerCase()} properties. Check each one, and choose
              what to do with the rest.
            </p>
            <section className="m-card" aria-label="Columns" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="m-table-wrap" style={{ '--m-table-wrap-shadow': 'none', '--m-table-wrap-radius': '0' } as CSSProperties}>
                <table className="m-table">
                  <thead>
                    <tr>
                      <th scope="col">Column in the file</th>
                      <th scope="col">Goes to</th>
                      <th scope="col">First values</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columns.map((column) => (
                      <tr key={column.index}>
                        <td style={medium}>{column.header}</td>
                        <td>
                          <label className="m-sr-only" htmlFor={`column-${column.index}`}>
                            Where “{column.header}” goes
                          </label>
                          <select className="m-select" data-size="sm" id={`column-${column.index}`} value={column.target} onChange={(event) => setTarget(column.index, event.target.value)} style={{ inlineSize: 220 }}>
                            <option value={SKIP}>Don't import</option>
                            <option value={NEW}>New property “{column.header}”</option>
                            {object.properties
                              .filter((property) => !property.system)
                              .map((property) => (
                                <option key={property.id} value={property.id}>
                                  {property.label}
                                </option>
                              ))}
                          </select>
                          {column.target === SKIP ? (
                            <span className="m-badge" data-tone="warning" style={{ marginInlineStart: 'var(--m-space-2)' }}>
                              Left out
                            </span>
                          ) : null}
                          {column.target === NEW ? (
                            <span className="m-badge" data-tone="info" style={{ marginInlineStart: 'var(--m-space-2)' }}>
                              <Plus size={ICON.inline} strokeWidth={ICON.strokeWidth} aria-hidden /> New
                            </span>
                          ) : null}
                        </td>
                        <td style={{ color: 'var(--m-color-fg-muted)' }}>
                          {source.rows
                            .slice(0, 3)
                            .map((cells) => cells[column.index])
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="m-card">
              <div className="m-card-body m-stack" data-gap="3">
                <h2 style={cardTitle}>Duplicates and ownership</h2>
                <div className="m-cluster" data-gap="4" data-align="end">
                  <div className="m-field">
                    <label className="m-field-label" htmlFor="import-match">
                      Recognise existing {noun} by
                    </label>
                    <select className="m-select" id="import-match" value={matchOn} onChange={(event) => setMatchOn(event.target.value)} style={{ inlineSize: 220 }}>
                      <option value="">Nothing: every row is new</option>
                      {matchable.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {matchOn ? (
                    <div className="m-field">
                      <label className="m-field-label" htmlFor="import-on-match">
                        When one is already here
                      </label>
                      <select className="m-select" id="import-on-match" value={onMatch} onChange={(event) => setOnMatch(event.target.value as 'skip' | 'update')} style={{ inlineSize: 260 }}>
                        <option value="skip">Leave it alone</option>
                        <option value="update">Update it with the file's values</option>
                      </select>
                    </div>
                  ) : null}
                </div>
                {matchable.length === 0 ? <p style={{ ...small, margin: 0 }}>To catch duplicates, match a column to a property marked unique (for {noun}, that is set in Settings).</p> : null}
                {hasOwner && !ownerMapped ? (
                  <label className="m-field" data-layout="inline">
                    <input className="m-checkbox" type="checkbox" checked={assignToMe} onChange={(event) => setAssignToMe(event.target.checked)} /> Make me the owner of new {noun}
                  </label>
                ) : null}
              </div>
            </section>
            <div className="m-cluster" data-justify="between">
              <button type="button" className="m-button" onClick={() => setStep('source')}>
                Back
              </button>
              <button type="button" className="m-button" data-variant="primary" disabled={busy || mapped.length === 0} onClick={() => void review()}>
                {busy ? 'Checking…' : 'Check the file'}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'review' && source && preview ? (
          <div className="m-stack" data-gap="4">
            <p style={{ margin: 0, color: 'var(--m-color-fg-muted)' }}>This is what will happen. Nothing has been written yet.</p>
            <section className="m-card" aria-label="What will happen" style={{ padding: 0 }}>
              <div className="m-cluster" data-gap="0" style={{ alignItems: 'stretch' }}>
                {[
                  { label: 'New', value: preview.created.length },
                  { label: 'Updated', value: preview.updated },
                  { label: 'Left out', value: preview.skipped.length },
                  { label: 'Values left empty', value: preview.warnings.length },
                ].map((item, index) => (
                  <div key={item.label} className="m-stack" data-gap="1" style={{ flex: '1 1 140px', padding: 'var(--m-space-3) var(--m-space-4)', borderInlineStart: index === 0 ? undefined : 'var(--m-border-width-thin) solid var(--m-color-border-muted)' }}>
                    <span style={{ color: 'var(--m-color-fg-muted)' }}>{item.label}</span>
                    <span style={figure}>{item.value.toLocaleString('en-US')}</span>
                  </div>
                ))}
              </div>
            </section>
            {columns.some((column) => column.target === NEW) ? (
              <p className="m-cluster" data-gap="2" style={{ margin: 0 }}>
                <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                {plural(columns.filter((column) => column.target === NEW).length, 'new property')
                  .replace('propertys', 'properties')}{' '}
                will be added to {noun}:{' '}
                {columns
                  .filter((column) => column.target === NEW)
                  .map((column) => `“${column.header}”`)
                  .join(', ')}
                .
              </p>
            ) : null}
            <Issues title="Rows that will be left out" items={preview.skipped.map((item) => ({ row: item.row, text: item.reason }))} />
            <Issues title="Values that will be left empty" items={preview.warnings.map((item) => ({ row: item.row, text: item.message }))} />
            <div className="m-cluster" data-justify="between">
              <button type="button" className="m-button" onClick={() => setStep('map')}>
                Back
              </button>
              <button type="button" className="m-button" data-variant="primary" disabled={busy || preview.created.length + preview.updated === 0} onClick={() => void run()}>
                {busy ? 'Importing…' : `Import ${plural(preview.created.length + preview.updated, object.singular.toLowerCase())}`}
              </button>
            </div>
          </div>
        ) : null}

        {step === 'done' && result ? (
          <div className="m-stack" data-gap="4">
            <div className="m-alert" data-tone={undone ? 'warning' : 'success'} role="status">
              <div className="m-alert-content">
                <p className="m-alert-title">{undone ? 'Import undone' : 'Import finished'}</p>
                <p className="m-alert-body">
                  {undone
                    ? `The ${plural(result.created.length, object.singular.toLowerCase())} this import created ${result.created.length === 1 ? 'has' : 'have'} been removed.${result.updated > 0 ? ` The ${result.updated} it updated keep their new values.` : ''}`
                    : `${plural(result.created.length, object.singular.toLowerCase())} created, ${result.updated.toLocaleString('en-US')} updated, ${result.skipped.length.toLocaleString('en-US')} left out.`}
                </p>
              </div>
            </div>
            <Issues title="Rows that were left out" items={result.skipped.map((item) => ({ row: item.row, text: item.reason }))} />
            <div className="m-cluster" data-gap="2">
              <Link to={`/${object.id}?sort=createdAt:desc`} className="m-button" data-variant="primary">
                View {noun}
              </Link>
              <button type="button" className="m-button" onClick={() => setStep('source')}>
                Import another file
              </button>
              {!undone && result.created.length > 0 ? (
                <button type="button" className="m-button" data-variant="ghost" disabled={busy} onClick={() => void undo()}>
                  <Undo2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Undo this import
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </Page>
  );
}

function Issues({ title, items }: { title: string; items: Array<{ row: number; text: string }> }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 8);
  return (
    <section className="m-card">
      <div className="m-card-body m-stack" data-gap="1">
        <h2 className="m-cluster" data-gap="2" style={cardTitle}>
          <TriangleAlert size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden style={{ color: 'var(--m-color-warning-fg)' }} />
          {title}
          <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{items.length.toLocaleString('en-US')}</span>
        </h2>
        <ul className="m-stack" data-gap="0" style={plainList}>
          {shown.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row can appear more than once, with different reasons
            <li key={index} className="m-cluster" data-gap="3" data-align="start" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
              <span style={{ ...small, flexShrink: 0, fontVariantNumeric: 'tabular-nums', inlineSize: 56 }}>Row {item.row}</span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        {items.length > shown.length ? <span style={small}>and {(items.length - shown.length).toLocaleString('en-US')} more</span> : null}
      </div>
    </section>
  );
}
