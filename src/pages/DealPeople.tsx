import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useQuery } from '../api';
import { useWorkspace } from '../app/workspace';
import type { CrmRecord } from '../contracts/records';
import { DEAL_ROLES, type DealPerson } from '../contracts/sales';
import { RecordPicker } from '../ui/RecordPicker';
import { ICON, cardTitle, link, plainList, rowDivider, small } from '../ui/styles';

/**
 * Who is involved in a deal beyond its main contact, and the part each plays: the decision maker,
 * the champion, the person who can block it. Each change saves at once.
 */
export function DealPeople({ deal, onSaved }: { deal: CrmRecord; onSaved: () => void }) {
  const { revision } = useWorkspace();
  const saved = useQuery(() => api.listDealPeople(deal.id), [deal.id, revision]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const people = saved.data?.people ?? [];

  async function save(next: DealPerson[]) {
    setBusy(true);
    setError(undefined);
    try {
      await api.saveDealPeople({ dealId: deal.id, people: next });
      setAdding(false);
      saved.reload();
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The people on this deal could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card" aria-label="People on this deal" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="m-cluster" data-justify="between" style={{ padding: 'var(--m-space-3) var(--m-space-4)' }}>
        <h2 style={cardTitle}>
          People <span style={small}>{people.length > 0 ? people.length : ''}</span>
        </h2>
        <button type="button" className="m-button" data-size="sm" onClick={() => setAdding(true)}>
          <Plus size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Person
        </button>
      </div>
      {people.length > 0 ? (
        <ul style={{ ...plainList, opacity: busy ? 0.6 : 1 }}>
          {people.map((person) => {
            const name = saved.data?.references[person.contactId]?.label ?? 'Contact';
            return (
              <li key={person.contactId} className="m-cluster" data-justify="between" style={{ ...rowDivider, padding: 'var(--m-space-2) var(--m-space-4)', flexWrap: 'nowrap', gap: 'var(--m-space-3)' }}>
                <Link to={`/contacts/${person.contactId}`} style={{ ...link, minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {name}
                </Link>
                <span className="m-cluster" data-gap="1" style={{ flexWrap: 'nowrap', flexShrink: 0 }}>
                  <select className="m-select" data-size="sm" aria-label={`The part ${name} plays`} value={person.role} disabled={busy} onChange={(event) => void save(people.map((item) => (item.contactId === person.contactId ? { ...item, role: event.target.value as DealPerson['role'] } : item)))} style={{ inlineSize: 190 }}>
                    {DEAL_ROLES.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="m-button" data-variant="ghost" data-size="sm" data-icon-only aria-label={`Take ${name} off this deal`} disabled={busy} onClick={() => void save(people.filter((item) => item.contactId !== person.contactId))}>
                    <Trash2 size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : adding ? null : (
        <p style={{ ...small, margin: 0, padding: '0 var(--m-space-4) var(--m-space-3)' }}>Add the people involved and the part each plays: who decides, who is on your side, who could block it.</p>
      )}
      {adding ? (
        <div className="m-stack" data-gap="2" style={{ ...rowDivider, padding: 'var(--m-space-3) var(--m-space-4)' }}>
          <label className="m-field-label" htmlFor="deal-person">
            Find a contact
          </label>
          <RecordPicker id="deal-person" objectId="contacts" value={null} onChange={(contactId) => (contactId ? void save([...people, { contactId, role: 'influencer' }]) : undefined)} />
          <div>
            <button type="button" className="m-button" data-variant="ghost" data-size="sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="m-field-error" role="alert" style={{ margin: 0, padding: '0 var(--m-space-4) var(--m-space-3)' }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
