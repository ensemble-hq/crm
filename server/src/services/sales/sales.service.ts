import { ConflictError, type Context, ValidationError } from '@mariachi/core';
import { type DrizzleDb, DrizzleRepository } from '@mariachi/database-postgres';
import { randomUUID } from 'node:crypto';
import type { ObjectDefinition, PropertyValue } from '../../../../src/contracts/metadata';
import type { CrmRecord } from '../../../../src/contracts/records';
import type { ConvertLead, LineItem } from '../../../../src/contracts/sales';
import { type LineItemRow, lineItemsTable } from '../../schema';
import type { ActivityRepository } from '../activity/activity.repository';
import { actorOf, assertCan } from '../people/access';
import type { RecordEvents } from '../records/records.events';
import type { RecordsRepository } from '../records/records.repository';
import type { RecordsService } from '../records/records.service';
import type { WorkspaceService } from '../workspace/workspace.service';

const id = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const DAY = 86_400_000;

export class LineItemsRepository extends DrizzleRepository<LineItemRow> {
  constructor(db: DrizzleDb) {
    super(lineItemsTable, db);
  }
}

function lineTotal(item: Pick<LineItem, 'quantity' | 'unitPrice' | 'discountPercent'>): number {
  return Math.round(item.quantity * item.unitPrice * (1 - item.discountPercent / 100) * 100) / 100;
}

/** Selling: what is on a deal, and turning a lead into the records the team works with. */
export class SalesService {
  constructor(
    private readonly lineItems: LineItemsRepository,
    private readonly records: RecordsService,
    private readonly recordRows: RecordsRepository,
    private readonly events: RecordEvents,
    private readonly activities: ActivityRepository,
    private readonly workspace: WorkspaceService,
  ) {}

  async listLineItems(ctx: Context, dealId: string): Promise<LineItem[]> {
    await this.records.find(ctx, dealId);
    const rows = await this.lineItems.findMany(ctx, { dealId }, { sort: { field: 'position', direction: 'asc' }, limit: 500 });
    return rows.map((row) => ({ id: row.id, productId: row.productId, name: row.name, quantity: row.quantity, unitPrice: row.unitPrice, discountPercent: row.discountPercent }));
  }

  /** Replaces a deal's line items. With `setAmount`, the deal's amount becomes their total, in the same step. */
  async saveLineItems(ctx: Context, input: { dealId: string; items: LineItem[]; setAmount: boolean }): Promise<{ items: LineItem[]; total: number }> {
    const deal = await this.records.find(ctx, input.dealId);
    assertCan(actorOf(ctx), 'edit', deal, 'deal');
    const items = input.items.filter((item) => item.name.trim() !== '');
    const total = items.reduce((sum, item) => sum + lineTotal(item), 0);
    await this.events.transaction(ctx, async () => {
      await this.lineItems.deleteWhere(ctx, { dealId: deal.id });
      for (const [position, item] of items.entries()) await this.lineItems.create(ctx, { id: id('li'), dealId: deal.id, productId: item.productId, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, discountPercent: item.discountPercent, position });
      if (input.setAmount) await this.records.update(ctx, { id: deal.id, properties: { amount: Math.round(total) } });
    });
    return { items: await this.listLineItems(ctx, deal.id), total };
  }

  /** Adds a record made as part of a larger step, announcing it like any other. Only the fields the object really has are kept. */
  private async add(ctx: Context, object: ObjectDefinition, wanted: Record<string, PropertyValue>): Promise<CrmRecord> {
    const properties = Object.fromEntries(Object.entries({ ...wanted, createdAt: new Date().toISOString().slice(0, 10) }).filter(([key, value]) => value !== undefined && object.properties.some((property) => property.id === key)));
    const record = await this.recordRows.insert(ctx, { id: id(object.id.slice(0, 3)), objectId: object.id, properties });
    await this.events.created(ctx, record);
    return record;
  }

  /**
   * Turns a lead into a contact (matched on email), their company (matched on name) and, if asked,
   * a deal. The lead is kept, marked qualified and linked to what it became. One transaction: a
   * lead is never left half converted.
   */
  async convertLead(ctx: Context, input: ConvertLead): Promise<{ contactId: string; companyId: string | null; dealId: string | null }> {
    const lead = await this.records.find(ctx, input.leadId);
    assertCan(actorOf(ctx), 'edit', lead, 'lead');
    if (typeof lead.properties.contact === 'string') throw new ConflictError('This lead has already been converted.');
    const email = lead.properties.email;
    if (typeof email !== 'string' || email === '') throw new ValidationError('Add an email address first, so the lead can become a contact.');
    const objects = await this.workspace.definitions(ctx);
    const object = (objectId: string) => {
      const found = objects.find((item) => item.id === objectId);
      if (!found) throw new ConflictError(`This CRM has no ${objectId} to convert a lead into.`);
      return found;
    };
    const owner = lead.properties.owner ?? null;
    const companyName = typeof lead.properties.companyName === 'string' ? lead.properties.companyName.trim() : '';

    return this.events.transaction(ctx, async () => {
      const company = companyName ? ((await this.recordRows.byText(ctx, 'companies', 'name', companyName)) ?? (await this.add(ctx, object('companies'), { name: companyName, owner }))) : undefined;
      const existing = await this.recordRows.byText(ctx, 'contacts', 'email', email);
      const stage = input.createDeal ? 'opportunity' : 'sql';
      let contact: CrmRecord;
      if (existing) {
        // Someone already known keeps what is on their record; only gaps are filled, and their stage moves forward.
        const fill: Record<string, PropertyValue> = { lifecycleStage: stage, leadStatus: 'connected' };
        for (const [key, value] of Object.entries({ phone: lead.properties.phone, jobTitle: lead.properties.jobTitle, company: company?.id, owner })) {
          const current = existing.properties[key];
          if ((current === null || current === undefined || current === '') && value !== null && value !== undefined && value !== '') fill[key] = value;
        }
        const changes = Object.fromEntries(Object.entries(fill).filter(([key]) => object('contacts').properties.some((property) => property.id === key)));
        contact = (await this.recordRows.patch(ctx, existing.id, changes)) ?? existing;
        await this.events.changed(ctx, contact, changes);
      } else {
        contact = await this.add(ctx, object('contacts'), { name: lead.properties.name ?? email, email, phone: lead.properties.phone ?? null, jobTitle: lead.properties.jobTitle ?? null, company: company?.id ?? null, owner, source: lead.properties.source ?? null, lifecycleStage: stage, leadStatus: 'connected' });
      }
      const deal = input.createDeal
        ? await this.add(ctx, object('deals'), {
            name: input.dealName?.trim() || `${companyName || String(lead.properties.name)}: new deal`,
            amount: input.amount ?? (typeof lead.properties.estimatedValue === 'number' ? lead.properties.estimatedValue : null),
            stage: 'qualified',
            forecast: 'pipeline',
            probability: 10,
            closeDate: new Date(Date.now() + 45 * DAY).toISOString().slice(0, 10),
            owner,
            company: company?.id ?? null,
            contact: contact.id,
            priority: 'medium',
            source: lead.properties.source ?? null,
          })
        : undefined;
      const changes = { status: 'qualified', contact: contact.id, deal: deal?.id ?? null };
      const updated = await this.recordRows.patch(ctx, lead.id, changes);
      if (updated) await this.events.changed(ctx, updated, changes);
      await this.activities.create(ctx, { id: id('act'), recordId: contact.id, kind: 'note', title: 'Converted from a lead', body: `Was the lead "${String(lead.properties.name)}"${deal ? ', with a new deal opened' : ''}.`, actorId: ctx.userId ?? 'system' });
      return { contactId: contact.id, companyId: company?.id ?? null, dealId: deal?.id ?? null };
    });
  }
}
