import type { CommunicationLayer } from '@mariachi/communication';
import type { Context } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { Outbox } from '@mariachi/events/outbox';
import { z } from 'zod';
import { type Operation, operations } from '../../../src/contracts/operations';
import { createEncryption } from '@mariachi/encryption';
import { AssistantService, AssistantSettingsRepository, AssistantTurnsRepository, type Push } from '../assistant/assistant.service';
import { TENANT_ID } from '../config';
import { conversationChanged, settingsChanged } from '../events';
import { AuditService } from './audit/audit.service';
import { ActivityRepository } from './activity/activity.repository';
import { ActivityService } from './activity/activity.service';
import { BriefService } from './brief/brief.service';
import type { EmailProvider } from '../email';
import { ConversationsRepository, EmailTemplatesRepository, InboundEmailsRepository, MailCursorsRepository, MessagesRepository } from './inbox/inbox.repository';
import { EmailRules } from './inbox/email-rules.service';
import { InboxService } from './inbox/inbox.service';
import { MailService } from './inbox/mail.service';
import { BookingPagesRepository, CaptureService, FormsRepository, MeetingsRepository, SubmissionsRepository } from './capture/capture.service';
import { ImportService } from './import/import.service';
import { NotificationsRepository } from './notifications/notifications.repository';
import { NotificationsService } from './notifications/notifications.service';
import { actingContext, assertAgentMay } from './people/access';
import { AgentsService } from './people/agents.service';
import { PeopleRepository, RolesRepository, TeamsRepository } from './people/people.repository';
import { PeopleService } from './people/people.service';
import { RecordEvents } from './records/records.events';
import { RecordsRepository } from './records/records.repository';
import { RecordsService } from './records/records.service';
import { DashboardsRepository, GoalsRepository, ReportsRepository } from './reports/reports.repository';
import { ReportsService } from './reports/reports.service';
import { DealPeopleRepository, LineItemsRepository, SalesService } from './sales/sales.service';
import { EnrollmentsRepository, SequencesRepository } from './sequences/sequences.repository';
import { SequencesService } from './sequences/sequences.service';
import { PrivacyService } from './privacy/privacy.service';
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
  /** Encrypts secrets the CRM stores. */
  secretsKey: string;
  /** Where people reach the app, for links in email. */
  appOrigin: string;
  /** Sends something to one person's open browsers. Absent where there is no live connection. */
  push?: Push;
}

/** Every service, built once. The API registers them as operations; the worker uses the runner. */
export function createServices(deps: ServiceDeps) {
  const recordsRepository = new RecordsRepository(deps.db);
  const outbox = new Outbox(deps.db, { source: deps.source });
  const events = new RecordEvents(outbox, deps.transaction);
  const peopleRepository = new PeopleRepository(deps.db);
  const teamsRepository = new TeamsRepository(deps.db);
  const rolesRepository = new RolesRepository(deps.db);
  const agents = new AgentsService(deps.db, peopleRepository, teamsRepository, rolesRepository);
  const audit = new AuditService(deps.db, peopleRepository);
  const people = new PeopleService(peopleRepository, teamsRepository, rolesRepository, (ctx, fromId, toId) => recordsRepository.reassign(ctx, fromId, toId));
  const objectsRepository = new ObjectsRepository(deps.db);
  const workspace = new WorkspaceService(objectsRepository, people);
  const settings = new SettingsService(objectsRepository, recordsRepository, deps.transaction, async (ctx, objectId) => void (await outbox.add(ctx, settingsChanged, { objectId })));
  const records = new RecordsService(recordsRepository, workspace, events);
  const activityRepository = new ActivityRepository(deps.db);
  const activity = new ActivityService(activityRepository, records);
  const brief = new BriefService(records, activity, workspace);
  const notifications = new NotificationsService(new NotificationsRepository(deps.db), recordsRepository, workspace);
  const workflowsRepository = new WorkflowsRepository(deps.db);
  const runsRepository = new WorkflowRunsRepository(deps.db);
  const workflows = new WorkflowsService(workflowsRepository, runsRepository, records, recordsRepository, workspace, deps.secretsKey, deps.appOrigin);
  const conversations = new ConversationsRepository(deps.db);
  const messages = new MessagesRepository(deps.db);
  const inbound = new InboundEmailsRepository(deps.db);
  const cursors = new MailCursorsRepository(deps.db);
  const templates = new EmailTemplatesRepository(deps.db);
  const rules = new EmailRules(deps.db, deps.secretsKey, deps.appOrigin, 'Northwind');
  const mail = new MailService(deps.email, inbound, conversations, messages, cursors, recordsRepository, activityRepository, notifications, outbox, events, deps.transaction, rules);
  const inbox = new InboxService(conversations, messages, templates, inbound, cursors, mail, recordsRepository, activityRepository, people, workspace, deps.transaction);
  const sequences = new SequencesService(new SequencesRepository(deps.db), new EnrollmentsRepository(deps.db), templates, recordsRepository, events, mail, people, workspace, deps.transaction, rules);
  mail.onReply = (ctx, contactId) => sequences.contactReplied(ctx, contactId);
  inbox.changed = async (ctx, conversationId) => void (await outbox.add(ctx, conversationChanged, { conversationId }));
  inbox.templateUsedBy = (ctx, templateId) => sequences.usingTemplate(ctx, templateId);
  const runner = new WorkflowRunner(workflowsRepository, runsRepository, recordsRepository, events, workspace, people, notifications, templates, mail, sequences, deps.secretsKey);
  const reports = new ReportsService(new ReportsRepository(deps.db), new DashboardsRepository(deps.db), new GoalsRepository(deps.db), records, recordsRepository, people, workspace, deps.email, notifications, deps.appOrigin);
  const sales = new SalesService(new LineItemsRepository(deps.db), records, recordsRepository, events, activityRepository, workspace, new DealPeopleRepository(deps.db));
  const capture = new CaptureService(new FormsRepository(deps.db), new SubmissionsRepository(deps.db), new BookingPagesRepository(deps.db), new MeetingsRepository(deps.db), recordsRepository, events, activityRepository, people, workspace, rules);
  const privacy = new PrivacyService(deps.db, recordsRepository, events, workspace);
  const importer = new ImportService(recordsRepository, events, workspace, people);
  return { people, workspace, records, activity, brief, notifications, workflows, runner, importer, inbox, mail, reports, sequences, settings, sales, capture, agents, audit, rules, privacy };
}

/** How long a slow operation, such as a turn of the assistant on a model, may run. */
const SLOW_MS = 240_000;

// biome-ignore lint/suspicious/noExplicitAny: each handler's input is checked against its operation's schema before it runs
type Handler = (ctx: Context, input: any) => Promise<unknown>;

/**
 * Registers one procedure per operation in the shared list. An operation that has no handler yet
 * is left out of what the server offers.
 */
export function registerServices(communication: CommunicationLayer, deps: ServiceDeps): Operation[] {
  const { people, workspace, records, activity, brief, notifications, workflows, runner, importer, inbox, mail, reports, sequences, settings, sales, capture, agents, audit, rules, privacy } = createServices(deps);

  // The assistant reaches the CRM the way everything else does: through the operations, as the person asking.
  const assistant = new AssistantService(new AssistantSettingsRepository(deps.db), createEncryption({ adapter: 'local', keys: { primary: deps.secretsKey } }), operations, (ctx, operation, input) => communication.call(ctx, operation, input), new AssistantTurnsRepository(deps.db), deps.push);

  const handlers: Record<string, Handler> = {
    'workspace.get': (ctx) => workspace.get(ctx),
    'records.list': (ctx, input) => records.list(ctx, input),
    'records.summarize': (ctx, input) => records.summarize(ctx, input),
    'records.get': (ctx, input) => records.get(ctx, input),
    'records.related': (ctx, input) => records.related(ctx, input),
    'records.create': (ctx, input) => records.create(ctx, input),
    'records.update': (ctx, input) => records.update(ctx, input),
    'records.label': (ctx, input) => records.label(ctx, input),
    'records.delete': (ctx, input) => records.remove(ctx, input),
    'records.deleted': (ctx, input) => records.listDeleted(ctx, input),
    'records.restore': (ctx, input) => records.restore(ctx, input),
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
    'inbox.cancelScheduled': (ctx, input) => inbox.cancelScheduled(ctx, input),
    'inbox.counts': (ctx) => inbox.counts(ctx),
    'inbox.health': (ctx) => inbox.health(ctx),
    'email.report': (ctx) => inbox.report(ctx),
    'email.preference': (ctx, input) => rules.describe(ctx, input),
    'email.setPreference': (ctx, input) => rules.set(ctx, input),
    'email.settings': (ctx) => rules.getSettings(ctx),
    'email.saveSettings': (ctx, input) => rules.saveSettings(ctx, input),
    'email.unsubscribePage': (ctx, input) => rules.page(ctx, input),
    'email.unsubscribe': (ctx, input) => rules.unsubscribe(ctx, input.token, input.resubscribe === true),
    'templates.list': (ctx) => inbox.listTemplates(ctx),
    'templates.save': (ctx, input) => inbox.saveTemplate(ctx, input),
    'templates.delete': (ctx, input) => inbox.deleteTemplate(ctx, input),
    'templates.design': (ctx, input) => assistant.designEmail(ctx, input),
    'templates.sendTest': (ctx, input) => inbox.sendTest(ctx, input),
    'records.merge': async (ctx, input) => {
      const other = await records.find(ctx, input.mergeId);
      const kept = await records.merge(ctx, input);
      const primary = (await workspace.definition(ctx, kept.objectId)).primaryProperty;
      await activity.create(ctx, { recordId: kept.id, kind: 'change', title: `Merged with ${String(other.properties[primary] ?? 'another record')}` });
      return kept;
    },
    'lineItems.list': (ctx, input) => sales.listLineItems(ctx, input),
    'lineItems.save': (ctx, input) => sales.saveLineItems(ctx, input),
    'dealPeople.list': (ctx, input) => sales.listDealPeople(ctx, input),
    'dealPeople.save': (ctx, input) => sales.saveDealPeople(ctx, input),
    'leads.convert': (ctx, input) => sales.convertLead(ctx, input),
    'objects.create': (ctx, input) => settings.createObject(ctx, input),
    'properties.create': (ctx, input) => settings.createProperty(ctx, input),
    'properties.update': (ctx, input) => settings.updateProperty(ctx, input),
    'properties.delete': (ctx, input) => settings.deleteProperty(ctx, input),
    'pipeline.saveRules': (ctx, input) => settings.saveStageRules(ctx, input),
    'records.duplicates': (ctx, input) => records.duplicates(ctx, input),
    'views.save': (ctx, input) => settings.saveView(ctx, input),
    'views.delete': (ctx, input) => settings.deleteView(ctx, input),
    'audit.list': (ctx, input) => audit.list(ctx, input),
    'audit.check': (ctx) => audit.check(ctx),
    'privacy.export': (ctx, input) => privacy.export(ctx, input),
    'privacy.erase': (ctx, input) => privacy.erase(ctx, input),
    'agents.list': (ctx) => agents.list(ctx),
    'agents.save': (ctx, input) => agents.save(ctx, input),
    'agents.remove': (ctx, input) => agents.remove(ctx, input),
    'agents.createKey': (ctx, input) => agents.createKey(ctx, input),
    'agents.revokeKey': (ctx, input) => agents.revokeKey(ctx, input),
    'assistant.settings': (ctx) => assistant.getSettings(ctx),
    'assistant.saveSettings': (ctx, input) => assistant.saveSettings(ctx, input),
    'assistant.turn': (ctx, input) => assistant.turn(ctx, input),
    'assistant.usage': (ctx) => assistant.usage(ctx),
    'forms.list': (ctx) => capture.listForms(ctx),
    'forms.get': (ctx, input) => capture.getForm(ctx, input),
    'forms.save': (ctx, input) => capture.saveForm(ctx, input),
    'forms.delete': (ctx, input) => capture.deleteForm(ctx, input),
    'forms.public': (ctx, input) => capture.publicForm(ctx, input),
    'forms.submit': (ctx, input) => capture.submit(ctx, input),
    'booking.pages': (ctx) => capture.listPages(ctx),
    'booking.savePage': (ctx, input) => capture.savePage(ctx, input),
    'booking.deletePage': (ctx, input) => capture.deletePage(ctx, input),
    'booking.slots': (ctx, input) => capture.slots(ctx, input),
    'booking.book': (ctx, input) => capture.book(ctx, input),
    'booking.meetings': (ctx) => capture.listMeetings(ctx),
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
      ...(operation.slow ? { timeoutMs: SLOW_MS } : {}),
      // Every operation starts by working out who it runs as; nothing below this line can skip it. The
      // few a visitor's browser calls run as nobody, in this instance's one tenant.
      // Whatever happens, an operation that changes something leaves an entry in the audit log:
      // carried out, refused or failed, with who asked and how the request arrived.
      handler: async (ctx, input) => {
        let actor: Awaited<ReturnType<typeof people.actor>> | undefined;
        try {
          let result: unknown;
          if (operation.public) result = await handler({ ...ctx, tenantId: TENANT_ID, userId: null }, input);
          else {
            actor = await people.actor(ctx);
            // An agent is held to what it was set up to do, on top of what its role reaches.
            assertAgentMay(actor, operation);
            result = await handler(actingContext(ctx, actor), input);
          }
          await audit.record({ ...ctx, tenantId: ctx.tenantId ?? TENANT_ID }, operation, actor, input, { result });
          return result;
        } catch (error) {
          await audit.record({ ...ctx, tenantId: ctx.tenantId ?? TENANT_ID }, operation, actor, input, { error });
          throw error;
        }
      },
    });
  }

  // Not an operation a person or an agent runs: this is how an email provider hands over mail. It
  // has no signed-in person, so it is registered apart from the operations and only the inbound
  // route, which checks the provider's signature, calls it.
  communication.register(RECEIVE_EMAIL, {
    schema: { input: receiveEmailInput, output: z.object({ status: z.enum(['stored', 'duplicate']) }) },
    handler: async (ctx, input) => ({ status: await mail.receive(ctx, input.provider, input.providerMessageId, input.payload) }),
  });
  // And for what the provider reports about mail it accepted: delivered, bounced, marked as spam.
  communication.register(EMAIL_DELIVERY, {
    schema: { input: emailDeliveryInput, output: z.object({ status: z.enum(['recorded', 'unchanged', 'unknown']) }) },
    handler: async (ctx, input) => ({ status: await mail.delivery({ ...ctx, tenantId: TENANT_ID }, input) }),
  });
  // Likewise for another system setting a workflow off: only the hooks route calls this, and the
  // address it was called at is what proves the caller may.
  communication.register(CALL_WORKFLOW, {
    schema: { input: callWorkflowInput, output: z.object({ ran: z.boolean(), reason: z.string().optional() }) },
    handler: (ctx, input) => runner.called({ ...ctx, tenantId: TENANT_ID, userId: null }, input.token, input.body),
  });
  return served;
}

export const RECEIVE_EMAIL = 'mail.receive';
export const CALL_WORKFLOW = 'workflows.called';
export const EMAIL_DELIVERY = 'mail.delivery';

export const emailDeliveryInput = z.object({
  /** The id the provider returned when it accepted the message, or the message's own Message-ID header. One of the two. */
  providerId: z.string().optional(),
  messageId: z.string().optional(),
  type: z.enum(['delivered', 'bounced', 'complained']),
  reason: z.string().optional(),
  at: z.string().optional(),
});

export const callWorkflowInput = z.object({
  token: z.string(),
  body: z.object({ recordId: z.string().optional(), email: z.string().optional(), id: z.string().max(200).optional() }),
});

export const receiveEmailInput = z.object({
  provider: z.string(),
  providerMessageId: z.string().min(1),
  payload: z.object({
    fromEmail: z.string().email(),
    fromName: z.string().optional(),
    toEmail: z.string().optional(),
    subject: z.string(),
    text: z.string(),
    html: z.string().optional(),
    messageId: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.array(z.string()).optional(),
    receivedAt: z.string().optional(),
  }),
});
