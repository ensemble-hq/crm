import { RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api, useQuery } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import { formatDateTime } from '../ui/PropertyValue';
import { ICON, figure, medium, plainList, rowDivider, small } from '../ui/styles';

const PAGE_SIZE = 50;

/** What has been deleted, by object, with a way to bring each record back as it was. */
export function DeletedRecords() {
  const workspace = useWorkspace();
  const [objectId, setObjectId] = useState(workspace.objects[0]?.id ?? 'contacts');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const list = useQuery(() => api.listDeletedRecords({ objectId, page, pageSize: PAGE_SIZE }), [objectId, page, version]);

  if (!workspace.access.manageSettings) return <Navigate to="/settings" replace />;
  const object = workspace.object(objectId);
  const people = new Map(workspace.users.map((user) => [user.id, user.name]));

  async function restore(ids: string[], name: string) {
    setBusy(ids.length === 1 ? ids[0] : 'all');
    setNotice(undefined);
    try {
      const result = await api.restoreRecords(ids);
      const problem = result.skipped[0]?.reason;
      setNotice(result.skipped.length === 0 ? `Restored ${name}.` : result.restored === 0 ? `Not restored. ${problem}` : `Restored ${result.restored}. ${result.skipped.length} could not be: ${problem}`);
      setVersion((value) => value + 1);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'That could not be restored.');
    } finally {
      setBusy(undefined);
    }
  }

  const records = list.data?.records ?? [];
  const total = list.data?.total ?? 0;
  return (
    <Page icon={Trash2} crumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Deleted records' }]}>
      <div className="m-stack" data-gap="4" style={{ maxInlineSize: 760, marginInline: 'auto', padding: 'var(--m-space-4)' }}>
        <div className="m-stack" data-gap="1">
          <h1 style={{ ...figure, margin: 0, fontVariantNumeric: 'normal' }}>Deleted records</h1>
          <p style={{ ...small, margin: 0 }}>A deleted record leaves every list but is kept, with its history. Restoring puts it back exactly as it was and sets off no workflows.</p>
        </div>
        <div className="m-cluster" data-justify="between" data-gap="2">
          <div className="m-cluster" data-gap="1" role="group" aria-label="Kind of record">
            {workspace.objects.map((item) => (
              <button key={item.id} type="button" className="m-button" data-size="sm" data-variant={item.id === objectId ? 'secondary' : 'ghost'} aria-pressed={item.id === objectId} onClick={() => { setObjectId(item.id); setPage(1); setNotice(undefined); }}>
                {item.plural}
              </button>
            ))}
          </div>
          {records.length > 1 ? (
            <button type="button" className="m-button" data-size="sm" disabled={busy !== undefined} onClick={() => void restore(records.map((record) => record.id), `${records.length} ${object?.plural.toLowerCase() ?? 'records'}`)}>
              <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> Restore these {records.length}
            </button>
          ) : null}
        </div>
        {notice ? <p role="status" style={{ ...small, margin: 0 }}>{notice}</p> : null}
        <section className="m-card" aria-label={`Deleted ${object?.plural.toLowerCase() ?? 'records'}`} style={{ padding: 0, overflow: 'hidden' }}>
          {list.loading && !list.data ? (
            <div style={{ padding: 'var(--m-space-5)' }}><span className="m-spinner" role="status" aria-label="Loading" /></div>
          ) : records.length === 0 ? (
            <p style={{ ...small, margin: 0, padding: 'var(--m-space-5)' }}>No deleted {object?.plural.toLowerCase() ?? 'records'}.</p>
          ) : (
            <ul style={plainList}>
              {records.map((record, index) => (
                <li key={record.id} className="m-cluster" data-justify="between" data-gap="3" style={{ flexWrap: 'nowrap', padding: 'var(--m-space-3) var(--m-space-4)', ...(index === 0 ? {} : rowDivider) }}>
                  <span className="m-stack" data-gap="0" style={{ minInlineSize: 0 }}>
                    <span style={{ ...medium, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{record.name}</span>
                    <span style={small}>
                      Deleted {formatDateTime(record.deletedAt)}
                      {record.deletedBy ? ` by ${people.get(record.deletedBy) ?? 'someone who has left'}` : ''}
                    </span>
                  </span>
                  <button type="button" className="m-button" data-size="sm" disabled={busy !== undefined} onClick={() => void restore([record.id], record.name)}>
                    <RotateCcw size={ICON.button} strokeWidth={ICON.strokeWidth} aria-hidden /> {busy === record.id ? 'Restoring…' : 'Restore'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        {total > PAGE_SIZE ? (
          <div className="m-cluster" data-justify="between">
            <span style={small}>{(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {total}</span>
            <div className="m-cluster" data-gap="1">
              <button type="button" className="m-button" data-size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Newer</button>
              <button type="button" className="m-button" data-size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(page + 1)}>Older</button>
            </div>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
