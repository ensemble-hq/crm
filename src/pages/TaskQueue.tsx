import { ArrowRight, CalendarClock, Check, ListChecks, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Page } from '../app/Page';
import { useWorkspace } from '../app/workspace';
import type { CrmRecord, Reference } from '../contracts/records';
import { PropertyValue } from '../ui/PropertyValue';
import { ICON, cardTitle, link, medium, small } from '../ui/styles';
import { RecordBrief } from './RecordBrief';

const QUEUE_SIZE = 100;
const DAY = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

/**
 * Work through what is due, one task at a time. Each task is shown with where the record it is
 * about stands, so nothing has to be looked up first; finishing, moving or skipping it brings the
 * next. The list is taken once at the start, so it does not shuffle as tasks are done.
 */
export function TaskQueue() {
  const workspace = useWorkspace();
  const tasks = workspace.objects.find((object) => object.completion);
  const [queue, setQueue] = useState<{ records: CrmRecord[]; references: Record<string, Reference>; total: number }>();
  const [position, setPosition] = useState(0);
  const [tally, setTally] = useState({ done: 0, moved: 0, skipped: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // biome-ignore lint/correctness/useExhaustiveDependencies: the queue is read once, on purpose
  useEffect(() => {
    if (!tasks) return;
    api
      .listRecords({ objectId: tasks.id, viewId: tasks.views[0]?.id, page: 1, pageSize: QUEUE_SIZE })
      .then((result) => setQueue(result))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Your tasks did not load.'));
  }, [tasks?.id]);

  if (!tasks?.completion) return null;
  const completion = tasks.completion;
  const task = queue?.records[position];
  const finished = queue !== undefined && position >= queue.records.length;
  const about = task ? ['deal', 'contact', 'company'].map((id) => task.properties[id]).find((value): value is string => typeof value === 'string') : undefined;
  const aboutReference = about ? queue?.references[about] : undefined;
  const property = (id: string) => tasks.properties.find((item) => item.id === id);

  async function act(kind: 'done' | 'moved' | 'skipped', properties?: CrmRecord['properties']) {
    if (!task) return;
    setBusy(true);
    setError(undefined);
    try {
      if (properties) await api.updateRecord({ id: task.id, properties });
      setTally((previous) => ({ ...previous, [kind]: previous[kind] + 1 }));
      setPosition(position + 1);
      if (properties) workspace.touch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const icon = { size: ICON.button, strokeWidth: ICON.strokeWidth, 'aria-hidden': true } as const;
  return (
    <Page icon={ListChecks} crumbs={[{ label: tasks.plural, to: `/${tasks.id}` }, { label: 'Work through what is due' }]}>
      {error ? (
        <p className="m-field-error" role="alert">
          {error}
        </p>
      ) : null}
      {!queue && !error ? (
        <div style={{ display: 'grid', placeItems: 'center', minBlockSize: 240 }}>
          <span className="m-spinner" role="status" aria-label="Loading your tasks" />
        </div>
      ) : null}
      {finished && queue ? (
        <section className="m-card" style={{ padding: 'var(--m-space-6)', maxInlineSize: 560 }}>
          <div className="m-stack" data-gap="3">
            <h2 style={cardTitle}>{queue.records.length === 0 ? 'Nothing is due' : 'That is all of them'}</h2>
            {queue.records.length > 0 ? (
              <p style={{ margin: 0 }}>
                {tally.done} done, {tally.moved} moved to later, {tally.skipped} skipped.
                {queue.total > queue.records.length ? ` ${(queue.total - queue.records.length).toLocaleString('en-US')} more were due than fit in one go.` : ''}
              </p>
            ) : (
              <p style={{ margin: 0 }}>You are clear for today.</p>
            )}
            <div className="m-cluster" data-gap="2">
              <Link to="/" className="m-button" data-variant="primary" data-size="sm">
                Back to Today
              </Link>
              <Link to={`/${tasks.id}`} className="m-button" data-size="sm">
                All tasks
              </Link>
            </div>
          </div>
        </section>
      ) : null}
      {task && queue ? (
        <div className="m-stack" data-gap="4" style={{ maxInlineSize: 760 }}>
          <div className="m-stack" data-gap="1">
            <span style={small} role="status">
              Task {position + 1} of {queue.records.length}
            </span>
            <progress className="m-progress" value={position} max={queue.records.length} aria-label="How far through the tasks you are" style={{ inlineSize: '100%' }} />
          </div>
          <section className="m-card" aria-label="The task" style={{ padding: 'var(--m-space-5)' }}>
            <div className="m-stack" data-gap="3">
              <div className="m-cluster" data-gap="2">
                {(['type', 'priority'] as const).map((id) => {
                  const definition = property(id);
                  return definition && task.properties[id] ? <PropertyValue key={id} property={definition} value={task.properties[id] ?? null} /> : null;
                })}
                {typeof task.properties.dueDate === 'string' ? (
                  <span className="m-cluster" data-gap="1" style={{ ...small, color: task.properties.dueDate < inDays(0) ? 'var(--m-color-danger-fg)' : undefined }}>
                    {task.properties.dueDate < inDays(0) ? 'Was due' : 'Due'} {new Date(`${task.properties.dueDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ) : null}
                {typeof task.properties.repeat === 'string' ? <span style={small}>Repeats</span> : null}
              </div>
              <h2 style={{ margin: 0, fontSize: 'var(--m-font-size-xl)', fontWeight: 'var(--m-font-weight-medium)' }}>
                <Link to={`/${tasks.id}/${task.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {String(task.properties[tasks.primaryProperty] ?? 'Untitled')}
                </Link>
              </h2>
              {about && aboutReference ? (
                <p style={{ margin: 0 }}>
                  About{' '}
                  <Link to={`/${aboutReference.objectId}/${about}`} style={{ ...link, ...medium }}>
                    {aboutReference.label}
                  </Link>
                </p>
              ) : null}
              <div className="m-cluster" data-gap="2">
                <button type="button" className="m-button" data-variant="primary" data-size="sm" disabled={busy} onClick={() => void act('done', { [completion.property]: completion.done })}>
                  <Check {...icon} /> Done
                </button>
                <button type="button" className="m-button" data-size="sm" disabled={busy} onClick={() => void act('moved', { dueDate: inDays(1) })}>
                  <CalendarClock {...icon} /> Tomorrow
                </button>
                <button type="button" className="m-button" data-size="sm" disabled={busy} onClick={() => void act('moved', { dueDate: inDays(7) })}>
                  <ArrowRight {...icon} /> Next week
                </button>
                <button type="button" className="m-button" data-variant="ghost" data-size="sm" disabled={busy} onClick={() => void act('skipped')}>
                  <SkipForward {...icon} /> Skip
                </button>
              </div>
            </div>
          </section>
          {about ? <RecordBrief recordId={about} /> : null}
        </div>
      ) : null}
    </Page>
  );
}
