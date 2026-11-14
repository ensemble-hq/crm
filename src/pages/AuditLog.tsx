import { Bot, ScrollText, ShieldCheck } from 'lucide-react';
import { type CSSProperties, useState } from 'react';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { AuditCheck, AuditEntry } from '../contracts/audit';
import { ICON, figure, medium, small } from '../ui/styles';

const PAGE_SIZE = 50;
const VIA: Record<AuditEntry['via'], string> = { app: 'In the app', assistant: 'Assistant plan, approved', mcp: 'Agent over MCP', api: 'API', public: 'Public page' };
const when = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Every change made to the CRM: who or what made it, how it arrived, and whether it went through. */
export function AuditLog() {
  const { users, former } = useWorkspace();
  const [actorId, setActorId] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string>();
  const [check, setCheck] = useState<AuditCheck | 'checking'>();
  const log = useQuery(() => api.listAudit({ actorId: actorId || undefined, page, pageSize: PAGE_SIZE }), [actorId, page]);
  const everyone = [...users, ...(former ?? [])];
  const pages = Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE_SIZE));

  return (
    <Page icon={ScrollText} crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Audit log' }]} wide>
      <div className="m-stack" data-gap="4">
        <div className="m-cluster" data-justify="between" data-gap="3">
          <div>
            <h1 style={{ ...figure, fontVariantNumeric: 'normal' }}>Audit log</h1>
            <p style={{ ...small, margin: 'var(--m-space-1) 0 0' }}>Every change made here, by a person, an agent or a visitor. Entries cannot be edited or deleted.</p>
          </div>
          <div className="m-cluster" data-gap="2">
            <label className="m-sr-only" htmlFor="audit-actor">
              Show changes by
            </label>
            <select
              className="m-select"
              id="audit-actor"
              data-size="sm"
              value={actorId}
              onChange={(event) => {
                setActorId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Everyone</option>
              {everyone.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                  {user.kind === 'agent' ? ' (agent)' : ''}
                </option>
              ))}
              <option value="visitor">Visitors</option>
            </select>
            <button
              type="button"
              className="m-button"
              data-size="sm"
              disabled={check === 'checking'}
              onClick={() => {
                setCheck('checking');
                void api.checkAudit().then(setCheck, () => setCheck(undefined));
              }}
            >
              <ShieldCheck size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {check === 'checking' ? 'Checking…' : 'Check it is intact'}
            </button>
          </div>
        </div>
        {check && check !== 'checking' ? (
          <output className="m-alert" data-tone={check.intact ? 'success' : 'danger'}>
            <div className="m-alert-content">
              <p className="m-alert-body">
                {check.intact ? `All ${check.entries.toLocaleString('en-US')} entries are in place and unaltered.` : `The log has been tampered with: ${check.problem ?? 'an entry was removed or altered'}.`}
              </p>
            </div>
          </output>
        ) : null}
        {log.error ? (
          <p className="m-field-error" role="alert">
            {log.error.message}
          </p>
        ) : null}
        <div className="m-table-wrap">
          <table className="m-table">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">How</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {(log.data?.entries ?? []).map((entry) => (
                <tr key={entry.id} onClick={() => setOpen(open === entry.id ? undefined : entry.id)} style={{ cursor: 'pointer' }}>
                  <td style={{ whiteSpace: 'nowrap' } as CSSProperties}>{when.format(new Date(entry.at))}</td>
                  <td>
                    <span className="m-cluster" data-gap="1" style={medium}>
                      {entry.actorKind === 'agent' ? <Bot size={ICON.button} strokeWidth={ICON.strokeWidth} aria-label="Agent" /> : null}
                      {entry.actorName}
                    </span>
                    {entry.signedInAs ? <div style={small}>viewed as, by {entry.signedInAs}</div> : null}
                  </td>
                  <td>
                    {entry.title}
                    {entry.targetId ? <span style={{ ...small, marginInlineStart: 'var(--m-space-2)' }}>{entry.targetId}</span> : null}
                    {open === entry.id ? (
                      <pre style={{ ...small, margin: 'var(--m-space-2) 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.detail}</pre>
                    ) : null}
                  </td>
                  <td style={small}>{VIA[entry.via]}</td>
                  <td>
                    {entry.outcome === 'done' ? (
                      <span className="m-badge" data-tone={entry.effect === 'destructive' ? 'warning' : 'success'}>
                        {entry.effect === 'destructive' ? 'Removed' : entry.effect === 'send' ? 'Sent' : 'Done'}
                      </span>
                    ) : (
                      <>
                        <span className="m-badge" data-tone="danger">
                          {entry.outcome === 'refused' ? 'Refused' : 'Failed'}
                        </span>
                        {entry.problem ? <div style={small}>{entry.problem}</div> : null}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {log.data && log.data.entries.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...small, textAlign: 'center', padding: 'var(--m-space-6)' }}>
                    Nothing has been changed yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="m-cluster" data-justify="between">
            <span style={small}>
              Page {page} of {pages} · {log.data?.total.toLocaleString('en-US')} entries
            </span>
            <span className="m-cluster" data-gap="2">
              <button type="button" className="m-button" data-size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Newer
              </button>
              <button type="button" className="m-button" data-size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Older
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
