import type { Context } from '@mariachi/core';
import type { Brief } from '../../../../src/contracts/brief';
import type { ActivityService } from '../activity/activity.service';
import type { RecordsService } from '../records/records.service';
import type { WorkspaceService } from '../workspace/workspace.service';

/**
 * The brief at the top of a record page. The facts (last activity, next step, risks) are worked out
 * here from the record; the sentence is assembled from them. When the assistant runs on a model, it
 * writes the sentence from these same facts.
 */

const DAY = 86_400_000;
/** An open record nobody has touched for this long is going cold. */
const QUIET_DAYS = 14;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
}

function ago(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export class BriefService {
  constructor(
    private readonly records: RecordsService,
    private readonly activities: ActivityService,
    private readonly workspace: WorkspaceService,
  ) {}

  async get(ctx: Context, recordId: string): Promise<Brief | null> {
    const record = await this.records.find(ctx, recordId);
    const objects = await this.workspace.definitions(ctx);
    const object = objects.find((item) => item.id === record.objectId);
    if (!object || object.completion || object.navigation === 'search') return null;
    const [activity, related] = await Promise.all([this.activities.list(ctx, recordId), this.records.related(ctx, recordId)]);
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const one = object.singular.toLowerCase();
    const value = (id: string) => record.properties[id];

    // A stage with a good or bad ending (won, lost, qualified, unqualified) means the work is over.
    const stageProperty = object.board ? object.properties.find((property) => property.id === object.board?.groupBy) : undefined;
    const stage = stageProperty?.options?.find((option) => option.id === value(stageProperty.id));
    const closed = stage?.tone === 'success' || stage?.tone === 'danger';

    const past = activity
      .filter((item) => item.kind !== 'change' && item.occurredAt <= now)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const last = past[0];
    const happened = last ? { title: last.title, detail: last.body, occurredAt: last.occurredAt, daysAgo: daysBetween(last.occurredAt, now) } : null;

    // The next step is the earliest open task linked to the record.
    const tasks = related
      .flatMap((group) => {
        const completion = objects.find((item) => item.id === group.objectId)?.completion;
        return completion ? group.records.filter((task) => task.properties[completion.property] === completion.open) : [];
      })
      .sort((a, b) => String(a.properties.dueDate ?? '9999').localeCompare(String(b.properties.dueDate ?? '9999')));
    const task = tasks[0];
    const due = task && typeof task.properties.dueDate === 'string' ? task.properties.dueDate : null;
    const next = task ? { title: String(task.properties.name ?? 'Task'), date: due, daysAway: due ? daysBetween(today, due) : null, recordId: task.id, objectId: task.objectId } : null;

    const risks: Brief['risks'] = [];
    if (!closed) {
      const closeDate = value('closeDate');
      if (typeof closeDate === 'string' && closeDate < today) risks.push({ tone: 'danger', text: `The close date passed ${ago(daysBetween(closeDate, today))}.` });
      if (next?.daysAway !== null && next?.daysAway !== undefined && next.daysAway < 0) risks.push({ tone: 'danger', text: `The next step is ${-next.daysAway} ${next.daysAway === -1 ? 'day' : 'days'} overdue.` });
      if (happened && happened.daysAgo >= QUIET_DAYS) risks.push({ tone: 'warning', text: `Nobody has been in touch for ${happened.daysAgo} days.` });
      if (!happened) risks.push({ tone: 'warning', text: 'Nothing has been logged yet.' });
      if (!next && object.board) risks.push({ tone: 'warning', text: 'There is no next step planned.' });
      if (object.properties.some((property) => property.id === 'owner') && typeof value('owner') !== 'string') risks.push({ tone: 'warning', text: 'Nobody owns it.' });
      if (object.id === 'deals' && typeof value('contact') !== 'string') risks.push({ tone: 'warning', text: 'There is no contact on the deal.' });
    }

    const suggestion = closed || next ? null : happened && happened.daysAgo >= QUIET_DAYS ? 'Check in by email' : last?.kind === 'meeting' || last?.kind === 'call' ? 'Send a follow-up' : 'Plan the next step';

    const sentences: string[] = [];
    if (closed && stage) sentences.push(`This ${one} is ${stage.label}.`);
    else if (stage) sentences.push(`This ${one} is in ${stage.label}.`);
    if (happened) sentences.push(`The last thing logged was ${last?.kind === 'note' ? 'a note' : `“${happened.title.replace(/\.$/, '')}”`}, ${ago(happened.daysAgo)}.`);
    // Only records that move through stages are expected to always have a next step.
    if (!closed && (next || object.board)) sentences.push(next ? `Next: ${next.title.replace(/\.$/, '').toLowerCase()}${next.daysAway === null ? '' : next.daysAway < 0 ? ', which is overdue' : next.daysAway === 0 ? ', due today' : `, due in ${next.daysAway} ${next.daysAway === 1 ? 'day' : 'days'}`}.` : 'Nothing is planned next.');

    return { summary: sentences.join(' '), happened, next: closed ? null : next, risks, suggestion };
  }
}
