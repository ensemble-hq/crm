import type { CommunicationLayer } from '@mariachi/communication';
import type { Context } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { type Operation, operations } from '../../../src/contracts/operations';
import { ActivityRepository } from './activity/activity.repository';
import { ActivityService } from './activity/activity.service';
import { BriefService } from './brief/brief.service';
import { RecordsRepository } from './records/records.repository';
import { RecordsService } from './records/records.service';
import { ObjectsRepository, PeopleRepository } from './workspace/workspace.repository';
import { WorkspaceService } from './workspace/workspace.service';

export interface ServiceDeps {
  db: DrizzleDb;
}

// biome-ignore lint/suspicious/noExplicitAny: each handler's input is checked against its operation's schema before it runs
type Handler = (ctx: Context, input: any) => Promise<unknown>;

/**
 * Builds the services and registers one procedure per operation in the shared list. An operation
 * with no handler here stops the server from starting, so the list can never promise something the
 * server cannot do.
 */
export function registerServices(communication: CommunicationLayer, deps: ServiceDeps): Operation[] {
  const workspace = new WorkspaceService(new ObjectsRepository(deps.db), new PeopleRepository(deps.db));
  const records = new RecordsService(new RecordsRepository(deps.db), workspace);
  const activity = new ActivityService(new ActivityRepository(deps.db), records);
  const brief = new BriefService(records, activity, workspace);

  const handlers: Record<string, Handler> = {
    'workspace.get': (ctx) => workspace.get(ctx),
    'records.list': (ctx, input) => records.list(ctx, input),
    'records.summarize': (ctx, input) => records.summarize(ctx, input),
    'records.get': (ctx, input) => records.get(ctx, input),
    'records.related': (ctx, input) => records.related(ctx, input),
    'records.create': (ctx, input) => records.create(ctx, input),
    'records.update': (ctx, input) => records.update(ctx, input),
    'records.delete': (ctx, input) => records.remove(ctx, input),
    'activity.list': (ctx, input) => activity.list(ctx, input),
    'activity.create': (ctx, input) => activity.create(ctx, input),
    'brief.get': (ctx, input) => brief.get(ctx, input),
  };

  // The list in the contract covers the whole CRM; the server serves the ones it has built so far.
  const served = operations.filter((operation) => handlers[operation.name]);
  for (const operation of served) {
    const handler = handlers[operation.name] as Handler;
    communication.register(operation.name, { schema: { input: operation.input, output: operation.output }, handler });
  }
  return served;
}
