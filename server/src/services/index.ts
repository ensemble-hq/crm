import type { CommunicationLayer } from '@mariachi/communication';
import type { Context } from '@mariachi/core';
import type { DrizzleDb } from '@mariachi/database-postgres';
import { type Operation, operations } from '../../../src/contracts/operations';
import { ActivityRepository } from './activity/activity.repository';
import { ActivityService } from './activity/activity.service';
import { BriefService } from './brief/brief.service';
import { RecordsRepository } from './records/records.repository';
import { RecordsService } from './records/records.service';
import { actingContext } from './people/access';
import { PeopleRepository, RolesRepository, TeamsRepository } from './people/people.repository';
import { PeopleService } from './people/people.service';
import { ObjectsRepository } from './workspace/workspace.repository';
import { WorkspaceService } from './workspace/workspace.service';

export interface ServiceDeps {
  db: DrizzleDb;
}

// biome-ignore lint/suspicious/noExplicitAny: each handler's input is checked against its operation's schema before it runs
type Handler = (ctx: Context, input: any) => Promise<unknown>;

/**
 * Builds the services and registers one procedure per operation in the shared list. An operation
 * that has no handler yet is left out of what the server offers.
 */
export function registerServices(communication: CommunicationLayer, deps: ServiceDeps): Operation[] {
  const recordsRepository = new RecordsRepository(deps.db);
  const people = new PeopleService(new PeopleRepository(deps.db), new TeamsRepository(deps.db), new RolesRepository(deps.db), (ctx, fromId, toId) => recordsRepository.reassign(ctx, fromId, toId));
  const workspace = new WorkspaceService(new ObjectsRepository(deps.db), people);
  const records = new RecordsService(recordsRepository, workspace);
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
  return served;
}
