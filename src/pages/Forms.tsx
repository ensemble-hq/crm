import { ArrowDown, ArrowUp, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import { type CSSProperties, type FormEvent, type ReactNode, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { FormSettings } from '../contracts/capture';
import type { ObjectDefinition } from '../contracts/metadata';
import { Modal } from '../ui/Modal';
import { PropertyInput } from '../ui/PropertyInput';
import { formatDateTime } from '../ui/PropertyValue';
import { ICON, cardTitle, figure, medium, plainList, rowDivider, small } from '../ui/styles';

/** Types a visitor can sensibly fill in on a public form. */
const FORM_TYPES = new Set(['text', 'email', 'phone', 'url', 'number', 'select', 'boolean', 'date']);

/** A page with no navigation, for people outside the team: a form, a booking page. */
export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minBlockSize: '100vh', display: 'grid', placeItems: 'start center', padding: 'var(--m-space-10) var(--m-space-4)', background: 'var(--m-color-bg-sunken)' }}>
      <div className="m-card" style={{ inlineSize: 'min(480px, 100%)' }}>
        <div className="m-card-body m-stack" data-gap="4">
          {children}
        </div>
      </div>
    </div>
  );
}

/** The form itself, as a visitor sees it. Used on the public page and as the builder's live preview. */
export function FormView({ form, formId, contacts, onSubmitted }: { form: FormSettings; formId: string | undefined; contacts: Pick<ObjectDefinition, 'properties'>; onSubmitted?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!formId) {
      setError('Save the form first, then it can take submissions.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.submitForm({ formId, values });
      setDone(true);
      setValues({});
      onSubmitted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="m-stack" data-gap="3">
        <h1 style={{ fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>{form.heading}</h1>
        <output className="m-alert" data-tone="success">
          <div className="m-alert-content">
            <p className="m-alert-body">{form.thanks}</p>
          </div>
        </output>
        <button type="button" className="m-button" data-variant="ghost" data-size="sm" style={{ inlineSize: 'fit-content' }} onClick={() => setDone(false)}>
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form className="m-stack" data-gap="3" onSubmit={submit}>
      <h1 style={{ fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)', margin: 0 }}>{form.heading}</h1>
      {form.fields.map((field) => {
        const property = contacts.properties.find((item) => item.id === field.property);
        if (!property) return null;
        const id = `form-field-${field.property}`;
        return (
          <div key={field.property} className="m-field" data-layout={property.type === 'boolean' ? 'inline' : undefined}>
            <label className="m-field-label" htmlFor={id}>
              {field.label || property.label}
              {field.required ? ' *' : ''}
            </label>
            <PropertyInput id={id} property={property} value={values[field.property] ?? null} required={field.required} onChange={(value) => setValues((previous) => ({ ...previous, [field.property]: value === null ? '' : String(value) }))} />
          </div>
        );
      })}
      {form.consentText ? (
        // Not required and not ticked for them: agreement only counts if it is freely given.
        <label className="m-field" data-layout="inline">
          <input className="m-checkbox" type="checkbox" checked={values.__consent === 'yes'} onChange={(event) => setValues((previous) => ({ ...previous, __consent: event.target.checked ? 'yes' : '' }))} />
          {form.consentText}
        </label>
      ) : null}
      {error ? (
        <p className="m-field-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" className="m-button" data-variant="primary" disabled={busy}>
        {busy ? 'Sending…' : form.submitLabel}
      </button>
    </form>
  );
}

/** The public page a form lives on: `/f/<id>`. */
export function PublicForm() {
  const { formId = '' } = useParams();
  // A visitor is not signed in, so the page asks only for what it needs to draw the form.
  const detail = useQuery(() => api.getPublicForm(formId), [formId]);
  return (
    <PublicPage>
      {detail.error ? <p style={{ margin: 0 }}>{/not found/i.test(detail.error.message) ? 'This form is no longer available.' : `This form could not be loaded. ${detail.error.message}`}</p> : null}
      {detail.data ? <FormView form={detail.data.form} formId={formId} contacts={{ properties: detail.data.fields }} /> : null}
      {!detail.data && !detail.error ? <span className="m-spinner" role="status" aria-label="Loading the form" /> : null}
    </PublicPage>
  );
}

/** Start a form from what it is for. */
function NewFormDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function create() {
    setBusy(true);
    setError(undefined);
    try {
      const text = purpose.toLowerCase();
      // Scripted: a few shapes by keyword. The real assistant picks the fields for the purpose.
      const newsletter = /newsletter|subscribe|updates|mailing/.test(text);
      const name = `${purpose.trim().slice(0, 1).toUpperCase()}${purpose.trim().slice(1, 50)}`.replace(/[.!?]+$/, '') || 'New form';
      const created = await api.saveForm(
        newsletter
          ? { name, heading: 'Stay in the loop', fields: [{ property: 'email', required: true }, { property: 'name', label: 'First name', required: false }], submitLabel: 'Subscribe', thanks: 'You are on the list.' }
          : {
              name,
              heading: /demo/.test(text) ? 'See it in action' : /quote|pricing/.test(text) ? 'Get a quote' : 'Get in touch',
              fields: [
                { property: 'name', label: 'Your name', required: true },
                { property: 'email', label: 'Work email', required: true },
                { property: 'jobTitle', required: false },
                { property: 'phone', required: false },
              ],
              submitLabel: /demo/.test(text) ? 'Request a demo' : 'Send',
              thanks: 'Thanks. Someone from the team will be in touch within one working day.',
            },
      );
      onCreated(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The form could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="New form" description="Say what the form is for. The assistant picks the fields, and you change them before it goes anywhere." submitLabel="Draft the form" busy={busy} error={error} onClose={onClose} onSubmit={create}>
      <div className="m-field">
        <label className="m-field-label" htmlFor="form-purpose">
          What is it for?
        </label>
        <input className="m-input" id="form-purpose" placeholder="Pricing enquiries from the website" value={purpose} onChange={(event) => setPurpose(event.target.value)} required />
      </div>
    </Modal>
  );
}

/** Every form, with how many times it has been submitted. */
export function Forms() {
  const navigate = useNavigate();
  const { revision } = useWorkspace();
  const forms = useQuery(() => api.listForms(), [revision]);
  const [creating, setCreating] = useState(false);
  return (
    <Page
      icon={FileText}
      crumbs={[{ label: 'Forms' }]}
      actions={
        <button type="button" className="m-button" data-variant="primary" data-size="sm" onClick={() => setCreating(true)}>
          <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Form
        </button>
      }
    >
      <div className="m-stack" data-gap="4">
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Forms</h1>
          <p style={{ color: 'var(--m-color-fg-muted)', margin: 0 }}>Pages and embeds where people outside the team give you their details. Each submission creates a contact, or updates the one with that email.</p>
        </div>
        <section className="m-card" aria-label="Forms" style={{ padding: 0, overflow: 'hidden' }}>
          <ul style={plainList}>
            {(forms.data ?? []).map((form, index) => (
              <li key={form.id} className="m-cluster" data-gap="4" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                <Link to={`/forms/${form.id}`} className="m-stack" data-gap="0" style={{ flex: 1, minInlineSize: 0, color: 'inherit', textDecoration: 'none' }}>
                  <span style={medium}>{form.name}</span>
                  <span style={small}>
                    {form.fields.length} {form.fields.length === 1 ? 'field' : 'fields'} · “{form.heading}”
                  </span>
                </Link>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {form.submissions.toLocaleString('en-US')} {form.submissions === 1 ? 'submission' : 'submissions'}
                </span>
                <a href={`/f/${form.id}`} target="_blank" rel="noreferrer" className="m-button" data-variant="ghost" data-size="sm">
                  <ExternalLink size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Open
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {creating ? <NewFormDialog onClose={() => setCreating(false)} onCreated={(id) => navigate(`/forms/${id}`)} /> : null}
    </Page>
  );
}

/** Build a form: its fields on the left, the form as visitors will see it on the right. The preview really submits. */
export function FormBuilder() {
  const { formId = '' } = useParams();
  const navigate = useNavigate();
  const workspace = useWorkspace();
  const [version, setVersion] = useState(0);
  const detail = useQuery(() => api.getForm(formId), [formId, version]);
  const [draft, setDraft] = useState<FormSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const contacts = workspace.object('contacts');

  if (detail.error) return <Navigate to="/forms" replace />;
  const saved = detail.data?.form.id === formId ? detail.data.form : undefined;
  if (!saved || !detail.data || !contacts) {
    return (
      <Page icon={FileText} crumbs={[{ label: 'Forms', to: '/forms' }, { label: 'Form' }]}>
        <span className="m-spinner" role="status" aria-label="Loading the form" />
      </Page>
    );
  }

  const form: FormSettings = draft ?? saved;
  const set = (changes: Partial<FormSettings>) => setDraft({ name: form.name, heading: form.heading, fields: form.fields, submitLabel: form.submitLabel, thanks: form.thanks, consentText: form.consentText, ...changes });
  const available = contacts.properties.filter((property) => FORM_TYPES.has(property.type) && !property.system && !form.fields.some((field) => field.property === property.id));
  const setField = (property: string, changes: Partial<FormSettings['fields'][number]>) => set({ fields: form.fields.map((field) => (field.property === property ? { ...field, ...changes } : field)) });

  function move(index: number, by: number) {
    const next = [...form.fields];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(index + by, 0, moved);
    set({ fields: next });
  }

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveForm({ ...form, id: formId });
      setDraft(undefined);
      setVersion((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The form could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api.deleteForm(formId);
      navigate('/forms');
    } finally {
      setBusy(false);
    }
  }

  const embed = `<script src="https://your-crm.example/forms.js" data-form="${formId}"></script>`;

  return (
    <Page
      icon={FileText}
      crumbs={[{ label: 'Forms', to: '/forms' }, { label: saved.name }]}
      wide
      actions={
        <>
          <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setConfirming(true)}>
            <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Delete
          </button>
          <a href={`/f/${formId}`} target="_blank" rel="noreferrer" className="m-button" data-size="sm">
            <ExternalLink size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Open the page
          </a>
          <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy || !draft} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <div className="m-grid" style={{ '--m-layout-grid-min': '400px', alignItems: 'start' } as CSSProperties}>
        <div className="m-stack" data-gap="4">
          <section className="m-card" aria-label="Form settings">
            <div className="m-card-body m-stack" data-gap="3">
              <div className="m-field">
                <label className="m-field-label" htmlFor="form-name">
                  Name (only the team sees this)
                </label>
                <input className="m-input" id="form-name" value={form.name} onChange={(event) => set({ name: event.target.value })} />
              </div>
              <div className="m-field">
                <label className="m-field-label" htmlFor="form-heading">
                  Heading
                </label>
                <input className="m-input" id="form-heading" value={form.heading} onChange={(event) => set({ heading: event.target.value })} />
              </div>
              <fieldset className="m-stack" data-gap="2" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="m-field-label">Fields</legend>
                {form.fields.map((field, index) => {
                  const property = contacts.properties.find((item) => item.id === field.property);
                  return (
                    <div key={field.property} className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                      <input className="m-input" data-size="sm" aria-label={`Label for ${property?.label ?? field.property}`} placeholder={property?.label} value={field.label ?? ''} onChange={(event) => setField(field.property, { label: event.target.value || undefined })} style={{ flex: 1, minInlineSize: 0 }} />
                      <span style={{ ...small, inlineSize: 88, flexShrink: 0 }}>→ {property?.label ?? field.property}</span>
                      <label className="m-cluster" data-gap="1" style={{ ...small, flexShrink: 0 }}>
                        <input className="m-checkbox" type="checkbox" checked={field.required} onChange={(event) => setField(field.property, { required: event.target.checked })} /> Required
                      </label>
                      <span className="m-cluster" data-gap="0" style={{ flexWrap: 'nowrap' }}>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move ${property?.label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Move ${property?.label} down`} disabled={index === form.fields.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                        <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Remove ${property?.label}`} disabled={form.fields.length === 1} onClick={() => set({ fields: form.fields.filter((item) => item.property !== field.property) })}>
                          <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {available.length > 0 ? (
                  <select className="m-select" data-size="sm" aria-label="Add a field" value="" onChange={(event) => event.target.value && set({ fields: [...form.fields, { property: event.target.value, required: false }] })} style={{ inlineSize: 220 }}>
                    <option value="">Add a field…</option>
                    {available.map((property) => (
                      <option key={property.id} value={property.id}>
                        {property.label}
                      </option>
                    ))}
                  </select>
                ) : null}
              </fieldset>
              <div className="m-field">
                <label className="m-field-label" htmlFor="form-submit">
                  Button
                </label>
                <input className="m-input" id="form-submit" value={form.submitLabel} onChange={(event) => set({ submitLabel: event.target.value })} />
              </div>
              <div className="m-field">
                <label className="m-field-label" htmlFor="form-thanks">
                  Message after submitting
                </label>
                <textarea className="m-input" id="form-thanks" rows={2} value={form.thanks} onChange={(event) => set({ thanks: event.target.value })} />
              </div>
              <div className="m-field">
                <label className="m-field-label" htmlFor="form-consent">
                  Ask for agreement to be emailed
                </label>
                <textarea className="m-input" id="form-consent" rows={2} placeholder="Yes, email me news and offers. I can unsubscribe at any time." value={form.consentText ?? ''} onChange={(event) => set({ consentText: event.target.value || undefined })} />
                <p className="m-field-hint">Leave empty for no tick box. When someone ticks it, these exact words are kept with the date as their consent.</p>
              </div>
              {error ? (
                <p className="m-field-error" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              ) : null}
            </div>
          </section>
          <section className="m-card" aria-label="Put it on your website">
            <div className="m-card-body m-stack" data-gap="2">
              <h2 style={cardTitle}>Put it on your website</h2>
              <p style={{ ...small, margin: 0 }}>Paste this where the form should appear. In this mock the address is a placeholder; the hosted page above works.</p>
              <pre className="m-code" tabIndex={0} style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <code>{embed}</code>
              </pre>
            </div>
          </section>
        </div>

        <div className="m-stack" data-gap="4">
          <section className="m-card" aria-label="Preview">
            <div className="m-card-body m-stack" data-gap="3">
              <span style={small}>Preview. {draft ? 'Save your changes before trying it.' : 'It works: submitting creates a real contact.'}</span>
              <FormView key={JSON.stringify(form.fields)} form={form} formId={draft ? undefined : formId} contacts={contacts} onSubmitted={() => {
                setVersion((value) => value + 1);
                workspace.touch();
              }} />
            </div>
          </section>
          <section className="m-card" aria-label="Recent submissions">
            <div className="m-card-body m-stack" data-gap="1">
              <h2 style={cardTitle}>
                Recent submissions <span style={{ ...small, fontVariantNumeric: 'tabular-nums' }}>{saved.submissions.toLocaleString('en-US')} in all</span>
              </h2>
              <ul className="m-stack" data-gap="0" style={plainList}>
                {detail.data.recent.slice(0, 8).map((submission, index) => (
                  <li key={submission.id} className="m-cluster" data-justify="between" data-gap="3" style={{ flexWrap: 'nowrap', paddingBlock: 'var(--m-space-2)', ...(index === 0 ? {} : rowDivider) }}>
                    <Link to={`/contacts/${submission.contactId}`} style={{ ...medium, color: 'inherit', textDecoration: 'none' }}>
                      {detail.data?.references[submission.contactId]?.label ?? 'A contact'}
                    </Link>
                    <span className="m-cluster" data-gap="2" style={{ flexWrap: 'nowrap' }}>
                      {submission.isNew ? (
                        <span className="m-badge" data-tone="info">
                          New contact
                        </span>
                      ) : null}
                      <span style={{ ...small, whiteSpace: 'nowrap' }}>{formatDateTime(submission.submittedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>
      <Modal open={confirming} size="sm" tone="danger" title={`Delete "${saved.name}"?`} description="The page and any embeds stop working. Contacts it created are kept. This can't be undone." submitLabel="Delete form" busy={busy} onClose={() => setConfirming(false)} onSubmit={remove} />
    </Page>
  );
}
