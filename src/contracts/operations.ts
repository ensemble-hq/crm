import { z } from 'zod';
import { briefSchema } from './brief';
import { objectDefinitionSchema, userSchema } from './metadata';
import { activitySchema, createActivitySchema, createRecordSchema, listQuerySchema, listResultSchema, recordDetailSchema, recordSchema, relatedGroupSchema, summaryQuerySchema, summaryRowSchema, updateRecordSchema, type CrmApi } from './records';
import { accessSchema } from './team';

/**
 * Every operation of the CRM, defined once. The server runs each as a procedure; the HTTP API the
 * web app calls, the MCP server an outside agent connects to, and the built-in assistant's tools are
 * all generated from this list. So anything a person can do on screen, an agent can do too.
 *
 * `description` is written for an agent choosing a tool: say what it does and when to use it.
 */

/** What running it does, so a client can ask a person before the risky ones. */
export type Effect = 'read' | 'write' | 'destructive' | 'send';

export type Operation = {
  /** `domain.action`: the procedure name, the HTTP path and the MCP tool name (with `_` for `.`). */
  name: string;
  /** The `CrmApi` method the web app calls for it. */
  method: keyof CrmApi;
  title: string;
  description: string;
  input: z.ZodTypeAny;
  output: z.ZodTypeAny;
  effect: Effect;
};

export const workspaceSchema = z.object({
  name: z.string(),
  objects: z.array(objectDefinitionSchema),
  users: z.array(userSchema),
  currentUserId: z.string(),
  access: accessSchema,
});

const none = z.undefined();
const recordId = z.string().describe('A record id, such as the `id` of a record returned by records.list.');

export const operations: Operation[] = [
  {
    name: 'workspace.get',
    method: 'getWorkspace',
    title: 'Get the workspace',
    description:
      'Start here. Returns every object (contacts, companies, deals, tasks and any custom ones) with its properties, select options, saved views and pipeline stages, plus the people in the CRM and who you are acting as. Property ids, option ids and user ids from here are what every other operation takes.',
    input: none,
    output: workspaceSchema,
    effect: 'read',
  },
  {
    name: 'records.list',
    method: 'listRecords',
    title: 'List records',
    description:
      'Lists records of one object, a page at a time, with a total. Narrow with a saved view, filters on property ids, or a search of names, emails, domains and phone numbers. Filter values may be the tokens $me, $today, $tomorrow, $monthStart, $monthEnd. References to other records come back resolved to names in `references`.',
    input: listQuerySchema,
    output: listResultSchema,
    effect: 'read',
  },
  {
    name: 'records.summarize',
    method: 'summarize',
    title: 'Count and total records by group',
    description: 'Groups the records matching a query by one property and returns the count, and the sum of a number property, for each group. Use it for "how many deals in each stage" or "pipeline value by owner" without listing every record.',
    input: summaryQuerySchema,
    output: z.array(summaryRowSchema),
    effect: 'read',
  },
  {
    name: 'records.get',
    method: 'getRecord',
    title: 'Get a record',
    description: 'Returns one record with all its properties, and the names of the records it links to.',
    input: recordId,
    output: recordDetailSchema,
    effect: 'read',
  },
  {
    name: 'records.related',
    method: 'listRelated',
    title: 'List related records',
    description: "Returns the records linked to a record, grouped by object: a company's contacts and deals, a deal's tasks, and so on.",
    input: recordId,
    output: z.array(relatedGroupSchema),
    effect: 'read',
  },
  {
    name: 'records.create',
    method: 'createRecord',
    title: 'Create a record',
    description: "Creates a record of any object. `properties` is keyed by property id; the object's primary property and any required ones must be set. Select values are option ids, people are user ids, and links to other records are record ids.",
    input: createRecordSchema,
    output: recordSchema,
    effect: 'write',
  },
  {
    name: 'records.update',
    method: 'updateRecord',
    title: 'Update a record',
    description: 'Changes some properties of a record and leaves the rest as they are. Set a property to null to clear it. Moving a deal to another stage is an update of its stage property.',
    input: updateRecordSchema,
    output: recordSchema,
    effect: 'write',
  },
  {
    name: 'records.delete',
    method: 'deleteRecords',
    title: 'Delete records',
    description: 'Deletes records by id. They leave every list and can be restored by an administrator.',
    input: z.array(z.string()).min(1).max(500),
    output: z.object({ deleted: z.number().int() }),
    effect: 'destructive',
  },
  {
    name: 'activity.list',
    method: 'listActivity',
    title: "List a record's activity",
    description: 'Returns the notes, emails, calls, meetings and changes logged on a record, newest first.',
    input: recordId,
    output: z.array(activitySchema),
    effect: 'read',
  },
  {
    name: 'activity.create',
    method: 'createActivity',
    title: 'Log activity on a record',
    description: 'Adds a note, or logs a call, meeting or email, on a record. It records what happened; it does not send anything.',
    input: createActivitySchema,
    output: activitySchema,
    effect: 'write',
  },
  {
    name: 'brief.get',
    method: 'getBrief',
    title: 'Get where a record stands',
    description: 'Returns a short brief for a lead, contact, company or deal: where it stands, the last thing that happened, the next planned step, and what is at risk. Null for records with no story, such as tasks and products.',
    input: recordId,
    output: briefSchema.nullable(),
    effect: 'read',
  },
];
