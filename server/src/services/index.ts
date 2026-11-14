import type { CommunicationLayer } from '@mariachi/communication';
import type { Context } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { Outbox } from '@mariachi/events/outbox';
import { z } from 'zod';
import { type Operation, operations } from '../../../src/contracts/operations';
import { ActivityRepository } from './activity/activity.repository';
import { ActivityService } from './activity/activity.service';
import { BriefService } from './brief/brief.service';
import type { EmailProvider } from '../email';
import { ConversationsRepository, EmailTemplatesRepository, InboundEmailsRepository, MailCursorsRepository, MessagesRepository } from './inbox/inbox.repository';
import { InboxService } from './inbox/inbox.service';
import { MailService } from './inbox/mail.service';
import { ImportService } from './import/import.service';
import { NotificationsRepository } from './notifications/notifications.repository';
import { NotificationsService } from './notifications/notifications.service';
import { actingContext } from './people/access';
import { PeopleRepository, RolesRepository, TeamsRepository } from './people/people.repository';
import { PeopleService } from './people/people.service';
import { RecordEvents } from './records/records.events';
import { RecordsRepository } from './records/records.repository';
import { RecordsService } from './records/records.service';
import { DashboardsRepository, GoalsRepository, ReportsRepository } from './reports/reports.repository';
import { ReportsService } from './reports/reports.service';
import { LineItemsRepository, SalesService } from './sales/sales.service';
import { EnrollmentsRepository, SequencesRepository } from './sequences/sequences.repository';
import { SequencesService } from './sequences/sequences.service';
import { WorkflowRunner } from './workflows/workflow.runner';
import { WorkflowRunsRepository, WorkflowsRepository } from './workflows/workflows.repository';
import { WorkflowsService } from './workflows/workflows.service';
import { SettingsService } from './workspace/settings.service';
import { ObjectsRepository } from './workspace/workspace.repository';
import { WorkspaceService } from './workspace/workspace.service';

export interface ServiceDeps {
  db: DrizzleDb;
  /** Runs `fn` in one database transaction. */
  transaction: <T>(ctx: Context, fn: () => Promise<T>) => Promise<T>;
  /** The service's name, stamped on the events it records. */
  source: string;
  email: EmailProvider;
}

/** Every service, built once. The API registers them as operations; the worker uses the runner. */
export function createServices(deps: ServiceDeps) {
  const recordsRepository = new RecordsRepository(deps.db);
  const outbox = new Outbox(deps.db, { source: deps.source });
  const events = new RecordEvents(outbox, deps.transaction);
  const people = new PeopleService(new PeopleRepository(deps.db), new TeamsRepository(deps.db), new RolesRepository(deps.db), (ctx, fromId, toId) => recordsRepository.reassign(ctx, fromId, toId));
  const objectsRepository = new ObjectsRepository(deps.db);
  const workspace = new WorkspaceService(objectsRepository, people);
  const settings = new SettingsService(objectsRepository, recordsRepository, deps.transaction);
  const records = new RecordsService(recordsRepository, workspace, events);
  const activityRepository = new ActivityRepository(deps.db);
  const activity = new ActivityService(activityRepository, records);
  const brief = new BriefService(records, activity, workspace);
  const notifications = new NotificationsService(new NotificationsRepository(deps.db), recordsRepository, workspace);
  const workflowsRepository = new WorkflowsRepository(deps.db);
  const runsRepository = new WorkflowRunsRepository(deps.db);
  const workflows = new WorkflowsService(workflowsRepository, runsRepository, records, recordsRepository, workspace);
  const conversations = new ConversationsRepository(deps.db);
  const messages = new MessagesRepository(deps.db);
  const inbound = new InboundEmailsRepository(deps.db);
  const cursors = new MailCursorsRepository(deps.db);
  const templates = new EmailTemplatesRepository(deps.db);
  const mail = new MailService(deps.email, inbound, conversations, messages, cursors, recordsRepository, activityRepository, notifications, outbox, events, deps.transaction);
  const inbox = new InboxService(conversations, messages, templates, inbound, cursors, mail, recordsRepository, activityRepository, people, workspace, deps.transaction);
  const sequences = new SequencesService(new SequencesRepository(deps.db), new EnrollmentsRepository(deps.db), templates, recordsRepository, events, mail, people, workspace, deps.transaction);
  mail.onReply = (ctx, contactId) => sequences.contactReplied(ctx, contactId);
  inbox.templateUsedBy = (ctx, templateId) => sequences.usingTemplate(ctx, templateId);
  const runner = new WorkflowRunner(workflowsRepository, runsRepository, recordsRepository, events, workspace, people, notifications, templates, mail, sequences);
  const reports = new ReportsService(new ReportsRepository(deps.db), new DashboardsRepository(deps.db), new GoalsRepository(deps.db), records, recordsRepository, people, workspace);
  const sales = new SalesService(new LineItemsRepository(deps.db), records, recordsRepository, events, activityRepository, workspace);
  const importer = new ImportService(recordsRepository, events, workspace, people);
  return { people, workspace, records, activity, brief, notifications, workflows, runner, importer, inbox, mail, reports, sequences, settings, sales };
}

// biome-ignore lint/suspicious/noExplicitAny: each handler's input is checked against its operation's schema before it runs
type Handler = (ctx: Context, input: any) => Promise<unknown>;

/**
 * Registers one procedure per operation in the shared list. An operation that has no handler yet
 * is left out of what the server offers.
 */
export function registerServices(communication: CommunicationLayer, deps: ServiceDeps): Operation[] {
  const { people, workspace, records, activity, brief, notifications, workflows, importer, inbox, mail, reports, sequences, settings, sales } = createServices(deps);

  const handlers: Record<string, Handler> = {
    'workspace.get': (ctx) => workspace.get(ctx),
    'records.list': (ctx, input) => records.list(ctx, input),
    'records.summarize': (ctx, input) => records.summarize(ctx, input),
    'records.get': (ctx, input) => records.get(ctx, input),
    'records.related': (ctx, input) => records.related(ctx, input),
    'records.create': (ctx, input) => records.create(ctx, input),
    'records.update': (ctx, input) => records.update(ctx, input),
    'records.delete': (ctx, input) => records.remove(ctx, input),
    'records.import': (ctx, input) => importer.run(ctx, input),
    'activity.list': (ctx, input) => activity.list(ctx, input),
    'activity.create': (ctx, input) => activity.create(ctx, input),
    'brief.get': (ctx, input) => brief.get(ctx, input),
    'people.directory': (ctx) => people.directory(ctx),
    'people.invite': (ctx, input) => people.invite(ctx, input),
    'people.update': (ctx, input) => people.update(ctx, input),
    'people.deactivate': (ctx, input) => people.deactivate(ctx, input),
    'people.reactivate': (ctx, input) => people.reactivate(ctx, input),
    'teams.save': (ctx, input) => people.saveTeam(ctx, input),
    'teams.delete': (ctx, input) => people.deleteTeam(ctx, input),
    'roles.save': (ctx, input) => people.saveRole(ctx, input),
    'roles.delete': (ctx, input) => people.deleteRole(ctx, input),
    'people.viewAs': (ctx, input) => people.viewAs(ctx, input),
    'workflows.list': (ctx) => workflows.list(ctx),
    'workflows.get': (ctx, input) => workflows.get(ctx, input),
    'workflows.save': (ctx, input) => workflows.save(ctx, input),
    'workflows.delete': (ctx, input) => workflows.remove(ctx, input),
    'workflows.countMatches': (ctx, input) => workflows.countMatches(ctx, input),
    'notifications.list': (ctx) => notifications.list(ctx),
    'notifications.markRead': (ctx, input) => notifications.markRead(ctx, input),
    'inbox.list': (ctx, input) => inbox.list(ctx, input),
    'inbox.get': (ctx, input) => inbox.get(ctx, input),
    'inbox.update': (ctx, input) => inbox.update(ctx, input),
    'inbox.reply': (ctx, input) => inbox.reply(ctx, input),
    'inbox.counts': (ctx) => inbox.counts(ctx),
    'inbox.health': (ctx) => inbox.health(ctx),
    'templates.list': (ctx) => inbox.listTemplates(ctx),
    'templates.save': (ctx, input) => inbox.saveTemplate(ctx, input),
    'templates.delete': (ctx, input) => inbox.deleteTemplate(ctx, input),
    'records.merge': async (ctx, input) => {
      const other = await records.find(ctx, input.mergeId);
      const kept = await records.merge(ctx, input);
      const primary = (await workspace.definition(ctx, kept.objectId)).primaryProperty;
      await activity.create(ctx, { recordId: kept.id, kind: 'change', title: `Merged with ${String(other.properties[primary] ?? 'another record')}` });
      return kept;
    },
    'lineItems.list': (ctx, input) => sales.listLineItems(ctx, input),
    'lineItems.save': (ctx, input) => sales.saveLineItems(ctx, input),
    'leads.convert': (ctx, input) => sales.convertLead(ctx, input),
    'objects.create': (ctx, input) => settings.createObject(ctx, input),
    'properties.create': (ctx, input) => settings.createProperty(ctx, input),
    'properties.update': (ctx, input) => settings.updateProperty(ctx, input),
    'properties.delete': (ctx, input) => settings.deleteProperty(ctx, input),
    'views.save': (ctx, input) => settings.saveView(ctx, input),
    'views.delete': (ctx, input) => settings.deleteView(ctx, input),
    'sequences.list': (ctx) => sequences.list(ctx),
    'sequences.get': (ctx, input) => sequences.get(ctx, input),
    'sequences.save': (ctx, input) => sequences.save(ctx, input),
    'sequences.delete': (ctx, input) => sequences.remove(ctx, input),
    'sequences.enroll': (ctx, input) => sequences.enroll(ctx, input),
    'sequences.stopEnrollment': (ctx, input) => sequences.stop(ctx, input),
    'reports.list': (ctx) => reports.list(ctx),
    'reports.run': (ctx, input) => reports.run(ctx, input),
    'reports.save': (ctx, input) => reports.save(ctx, input),
    'reports.delete': (ctx, input) => reports.remove(ctx, input),
    'dashboards.list': (ctx) => reports.listDashboards(ctx),
    'dashboards.save': (ctx, input) => reports.saveDashboard(ctx, input),
    'forecast.get': (ctx) => reports.forecast(ctx),
    'forecast.setGoal': (ctx, input) => reports.setGoal(ctx, input),
  };

  // The list in the contract covers the whole CRM; the server serves the ones it has built so far.
  const served = operations.filter((operation) => handlers[operation.name]);
  for (const operation of served) {
    const handler = handlers[operation.name] as Handler;
    communication.register(operation.name, {
      schema: { input: operation.input, output: operation.output },
      // Every operation starts by working out who it runs as; nothing below this line can skip it.
      handler: async (ctx, input) => handler(actingContext(ctx, await people.actor(ctx)), input),
    });
  }

  // Not an operation a person or an agent runs: this is how an email provider hands over mail. It
  // has no signed-in person, so it is registered apart from the operations and only the inbound
  // route, which checks the provider's signature, calls it.
  communication.register(RECEIVE_EMAIL, {
    schema: { input: receiveEmailInput, output: z.object({ status: z.enum(['stored', 'duplicate']) }) },
    handler: async (ctx, input) => ({ status: await mail.receive(ctx, input.provider, input.providerMessageId, input.payload) }),
  });
  return served;
}

export const RECEIVE_EMAIL = 'mail.receive';

export const receiveEmailInput = z.object({
  provider: z.string(),
  providerMessageId: z.string().min(1),
  payload: z.object({
    fromEmail: z.string().email(),
    fromName: z.string().optional(),
    toEmail: z.string().optional(),
    subject: z.string(),
    text: z.string(),
    messageId: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
    receivedAt: z.string().optional(),
  }),
});
