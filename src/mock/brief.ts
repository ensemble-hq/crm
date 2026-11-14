import type { Brief, BriefApi } from '../contracts/brief';
import type { ObjectDefinition } from '../contracts/metadata';
import type { Activity, CrmRecord, RelatedGroup } from '../contracts/records';
import { MOCK_NOW, MOCK_TODAY } from './definitions';

/**
 * The brief at the top of a record page, worked out from real data in the mock. The backend will
 * hand the same facts to the model to write the summary; the facts themselves stay computed.
 */

const DAY = 86_400_000;
/** An open record nobody has touched for this long is going cold. */
const QUIET_DAYS = 14;

export type BriefDeps = {
  respond: <T>(compute: () => T) => Promise<T>;
  get: (recordId: string) => CrmRecord;
  definition: (objectId: string) => ObjectDefinition;
  related: (recordId: string) => RelatedGroup[];
  activity: (recordId: string) => Activity[];
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY);
}

function ago(days: number): string {
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

export function createBriefApi(deps: BriefDeps): BriefApi {
  return {
    getBrief: (recordId) =>
      deps.respond((): Brief | null => {
        const record = deps.get(recordId);
        const object = deps.definition(record.objectId);
        if (object.completion || object.navigation === 'search') return null;
        const one = object.singular.toLowerCase();
        const value = (id: string) => record.properties[id];

        // A stage with a good or bad ending (won, lost, qualified, unqualified) means the work is over.
        const stageProperty = object.board ? object.properties.find((property) => property.id === object.board?.groupBy) : undefined;
        const stage = stageProperty?.options?.find((option) => option.id === value(stageProperty.id));
        const closed = stage?.tone === 'success' || stage?.tone === 'danger';

        const past = deps
          .activity(recordId)
          .filter((item) => item.kind !== 'change' && item.occurredAt <= MOCK_NOW)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
        const last = past[0];
        const happened = last ? { title: last.title, detail: last.body, occurredAt: last.occurredAt, daysAgo: daysBetween(last.occurredAt, MOCK_NOW) } : null;

        // The next step is the earliest open task linked to the record.
        const tasks = deps
          .related(recordId)
          .flatMap((group) => {
            const completion = deps.definition(group.objectId).completion;
            return completion ? group.records.filter((task) => task.properties[completion.property] === completion.open) : [];
          })
          .sort((a, b) => String(a.properties.dueDate ?? '9999').localeCompare(String(b.properties.dueDate ?? '9999')));
        const task = tasks[0];
        const due = task && typeof task.properties.dueDate === 'string' ? task.properties.dueDate : null;
        const next = task ? { title: String(task.properties.name ?? 'Task'), date: due, daysAway: due ? daysBetween(MOCK_TODAY, due) : null, recordId: task.id, objectId: task.objectId } : null;

        const risks: Brief['risks'] = [];
        if (!closed) {
          const closeDate = value('closeDate');
          if (typeof closeDate === 'string' && closeDate < MOCK_TODAY) risks.push({ tone: 'danger', text: `The close date passed ${ago(daysBetween(closeDate, MOCK_TODAY))}.` });
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
      }),
  };
}
