import { z } from 'zod';
import { briefSchema } from './brief';
import { conversationDetailSchema, conversationListSchema, conversationQuerySchema, conversationSchema, emailHealthSchema, emailTemplateSchema, inboxCountsSchema, messageSchema, updateConversationSchema } from './inbox';
import { filterSchema, objectDefinitionSchema, userSchema } from './metadata';
import { activitySchema, createActivitySchema, importRequestSchema, importResultSchema, notificationSchema, referenceSchema, createRecordSchema, listQuerySchema, listResultSchema, recordDetailSchema, recordSchema, relatedGroupSchema, summaryQuerySchema, summaryRowSchema, updateRecordSchema, type CrmApi } from './records';
import { workflowDetailSchema, workflowSchema, workflowSettingsSchema } from './workflows';
import { accessSchema, deactivateMemberSchema, directorySchema, inviteMemberSchema, memberSchema, roleSchema, saveRoleSchema, saveTeamSchema, teamSchema, updateMemberSchema } from './team';

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
  /** Takes a whole file's worth of data, so the server allows a larger request than usual. */
  large?: boolean;
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
    name: 'records.import',
    method: 'importRecords',
    title: 'Import rows as records',
    description:
      'Creates or updates many records of one object from rows of text, as from a spreadsheet. Each row maps property ids to the text in that cell; the server turns text into each property\'s type (a choice by its label, a person by name or email, a linked record by its name, dates and numbers by parsing). Give `matchOn` (usually email for contacts, domain for companies) so rows that are already in the CRM are skipped or updated and no duplicates are made. Always call it first with `dryRun: true`: nothing is written and the result says what would be created, updated and skipped, and why.',
    input: importRequestSchema,
    output: importResultSchema,
    effect: 'write',
    large: true,
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
  {
    name: 'people.directory',
    method: 'getDirectory',
    title: 'List people, teams and roles',
    description: 'Returns everyone in the CRM with their role, team and status, plus the teams and the roles with what each role allows.',
    input: none,
    output: directorySchema,
    effect: 'read',
  },
  {
    name: 'people.invite',
    method: 'inviteMember',
    title: 'Invite a person',
    description: 'Adds a person to the CRM with a role and, optionally, a team. They show as invited until they first sign in. Needs permission to manage people.',
    input: inviteMemberSchema,
    output: memberSchema,
    effect: 'write',
  },
  {
    name: 'people.update',
    method: 'updateMember',
    title: "Change a person's role or team",
    description: "Changes a person's role, their team, or both. Set teamId to null for no team. The CRM always keeps at least one admin.",
    input: updateMemberSchema,
    output: memberSchema,
    effect: 'write',
  },
  {
    name: 'people.deactivate',
    method: 'deactivateMember',
    title: 'Deactivate a person',
    description: 'Takes away a person\'s access and hands every record they own to another person. Their past activity keeps their name. Returns how many records were handed over.',
    input: deactivateMemberSchema,
    output: z.object({ reassigned: z.number().int() }),
    effect: 'destructive',
  },
  {
    name: 'people.reactivate',
    method: 'reactivateMember',
    title: 'Reactivate a person',
    description: 'Gives a deactivated person their access back. Records handed to someone else stay where they are.',
    input: z.string().describe('The person\'s id.'),
    output: memberSchema,
    effect: 'write',
  },
  {
    name: 'teams.save',
    method: 'saveTeam',
    title: 'Create or rename a team',
    description: 'Creates a team, or renames one when `id` is given.',
    input: saveTeamSchema,
    output: teamSchema,
    effect: 'write',
  },
  {
    name: 'teams.delete',
    method: 'deleteTeam',
    title: 'Delete a team',
    description: 'Deletes a team that has no active people in it.',
    input: z.string().describe('The team\'s id.'),
    output: z.void(),
    effect: 'destructive',
  },
  {
    name: 'roles.save',
    method: 'saveRole',
    title: 'Create or change a role',
    description: 'Creates a role, or replaces one when `id` is given. A role sets how far its people can view, edit and delete records (none, own, team or all) and whether they can manage settings, manage people and export. The Admin role cannot be changed.',
    input: saveRoleSchema,
    output: roleSchema,
    effect: 'write',
  },
  {
    name: 'roles.delete',
    method: 'deleteRole',
    title: 'Delete a role',
    description: 'Deletes a role that nobody has. The roles that come with the CRM cannot be deleted.',
    input: z.string().describe('The role\'s id.'),
    output: z.void(),
    effect: 'destructive',
  },
  {
    name: 'people.viewAs',
    method: 'viewAs',
    title: 'View the CRM as someone else',
    description: 'From now on, every operation you run sees and can change exactly what that person can, until you pass null to go back to yourself. Admins only. Useful for checking what a role allows.',
    input: z.string().nullable().describe('The person to view as, or null to stop.'),
    output: z.void(),
    effect: 'write',
  },
  {
    name: 'workflows.list',
    method: 'listWorkflows',
    title: 'List workflows',
    description: 'Returns every workflow: what sets it off, its conditions, its actions, whether it is on, and how many times it has run.',
    input: none,
    output: z.array(workflowSchema),
    effect: 'read',
  },
  {
    name: 'workflows.get',
    method: 'getWorkflow',
    title: 'Get a workflow and its recent runs',
    description: 'Returns one workflow with its 25 most recent runs: which record each ran on, whether it finished, and what each action did in words.',
    input: z.string().describe('The workflow\'s id.'),
    output: workflowDetailSchema,
    effect: 'read',
  },
  {
    name: 'workflows.save',
    method: 'saveWorkflow',
    title: 'Create or change a workflow',
    description:
      'Creates a workflow, or replaces one when `id` is given. A workflow runs when a record of its object is created, or when one property changes (optionally to one value), and the record passes the conditions. Its actions run in order: set a property, create a task for the owner, notify the owner, give the record to the next person in turn, or post it to a webhook. Create it with `on: false` and check it with workflows.countMatches before switching it on.',
    input: workflowSettingsSchema.extend({ id: z.string().optional() }),
    output: workflowSchema,
    effect: 'write',
  },
  {
    name: 'workflows.delete',
    method: 'deleteWorkflow',
    title: 'Delete a workflow',
    description: 'Deletes a workflow. It stops running at once; its past runs are kept.',
    input: z.string().describe('The workflow\'s id.'),
    output: z.void(),
    effect: 'destructive',
  },
  {
    name: 'workflows.countMatches',
    method: 'countWorkflowMatches',
    title: 'Count records that pass conditions',
    description: 'Says how many records of an object pass a set of conditions right now, out of how many there are. Use it to check a workflow\'s conditions before switching it on.',
    input: z.object({ objectId: z.string(), conditions: z.array(filterSchema) }),
    output: z.object({ matching: z.number().int(), total: z.number().int() }),
    effect: 'read',
  },
  {
    name: 'notifications.list',
    method: 'listNotifications',
    title: 'List your notifications',
    description: 'Returns the notifications addressed to you, newest first, with the names of the records they are about.',
    input: none,
    output: z.object({ notifications: z.array(notificationSchema), references: z.record(referenceSchema) }),
    effect: 'read',
  },
  {
    name: 'notifications.markRead',
    method: 'markNotificationsRead',
    title: 'Mark notifications read',
    description: 'Marks one of your notifications read, or all of them when no id is given.',
    input: z.string().optional().describe('A notification id, or leave out for all.'),
    output: z.void(),
    effect: 'write',
  },
  {
    name: 'inbox.list',
    method: 'listConversations',
    title: 'List email conversations',
    description: 'Lists email threads with contacts, newest first, from one folder: `mine` (open and assigned to you), `unassigned` (open, nobody has taken it), `open` or `closed`. Search covers the subject, the latest message and the contact\'s name.',
    input: conversationQuerySchema,
    output: conversationListSchema,
    effect: 'read',
  },
  {
    name: 'inbox.get',
    method: 'getConversation',
    title: 'Read a conversation',
    description: 'Returns one email thread with every message in order. Outgoing messages say whether they are queued, sent or failed, and why if they failed.',
    input: z.string().describe('The conversation\'s id.'),
    output: conversationDetailSchema,
    effect: 'read',
  },
  {
    name: 'inbox.update',
    method: 'updateConversation',
    title: 'Assign, close or mark a conversation',
    description: 'Assigns a conversation to a person (or to nobody with null), closes or reopens it, or marks it read or unread.',
    input: updateConversationSchema,
    output: conversationSchema,
    effect: 'write',
  },
  {
    name: 'inbox.reply',
    method: 'sendReply',
    title: 'Send a reply by email',
    description: 'Sends an email to the conversation\'s contact, from you, on the same thread. This really sends: ask the person before calling it, and show them the text. The message is queued and sent within seconds; inbox.get shows whether it went.',
    input: z.object({ conversationId: z.string(), body: z.string() }),
    output: messageSchema,
    effect: 'send',
  },
  {
    name: 'inbox.counts',
    method: 'inboxCounts',
    title: 'Count conversations by folder',
    description: 'Returns how many open conversations are yours, how many of those are unread, how many are unassigned, and how many are open in total.',
    input: none,
    output: inboxCountsSchema,
    effect: 'read',
  },
  {
    name: 'inbox.health',
    method: 'getEmailHealth',
    title: 'Check that email is flowing',
    description: 'Returns how many outgoing messages are waiting or failed, how many incoming messages are waiting to be filed or failed, and when the server last checked the email service for anything missed. All of these should be zero or small.',
    input: none,
    output: emailHealthSchema,
    effect: 'read',
  },
  {
    name: 'templates.list',
    method: 'listEmailTemplates',
    title: 'List saved emails',
    description: 'Returns the team\'s saved email templates. A body may contain {{firstName}} and {{myName}}, filled in when the template is used.',
    input: none,
    output: z.array(emailTemplateSchema),
    effect: 'read',
  },
  {
    name: 'templates.save',
    method: 'saveEmailTemplate',
    title: 'Create or change a saved email',
    description: 'Creates an email template, or replaces one when `id` is given.',
    input: z.object({ id: z.string().optional(), name: z.string(), subject: z.string(), body: z.string() }),
    output: emailTemplateSchema,
    effect: 'write',
  },
  {
    name: 'templates.delete',
    method: 'deleteEmailTemplate',
    title: 'Delete a saved email',
    description: 'Deletes an email template. Workflows and sequences that use it will stop at that step.',
    input: z.string().describe('The template\'s id.'),
    output: z.void(),
    effect: 'destructive',
  },
];
