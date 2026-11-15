import { z } from 'zod';
import { referenceSchema } from './records';

/** Selling: what is on a deal, turning a lead into a customer record, and the forecast against goals. */

export const lineItemSchema = z.object({
  id: z.string(),
  /** The product it came from. Null for a one-off line typed by hand. */
  productId: z.string().nullable(),
  name: z.string(),
  quantity: z.number().min(0),
  unitPrice: z.number(),
  /** 0 to 100. */
  discountPercent: z.number().min(0).max(100),
});
export type LineItem = z.infer<typeof lineItemSchema>;

/** The part someone plays in a deal. */
export const DEAL_ROLES = [
  { id: 'decision-maker', label: 'Decision maker' },
  { id: 'champion', label: 'Champion' },
  { id: 'budget-holder', label: 'Budget holder' },
  { id: 'influencer', label: 'Influencer' },
  { id: 'legal', label: 'Legal or procurement' },
  { id: 'user', label: 'End user' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'other', label: 'Other' },
] as const;
export const dealRoleSchema = z.enum(['decision-maker', 'champion', 'budget-holder', 'influencer', 'legal', 'user', 'blocker', 'other']);

/** One of the people involved in a deal, beyond its main contact, and the part they play. */
export const dealPersonSchema = z.object({ contactId: z.string(), role: dealRoleSchema });
export type DealPerson = z.infer<typeof dealPersonSchema>;
export const dealPeopleSchema = z.object({ people: z.array(dealPersonSchema), references: z.record(referenceSchema) });
export type DealPeople = z.infer<typeof dealPeopleSchema>;

export const convertLeadSchema = z.object({
  leadId: z.string(),
  /** Also open a deal for the new contact. */
  createDeal: z.boolean(),
  dealName: z.string().optional(),
  amount: z.number().optional(),
});
export type ConvertLead = z.infer<typeof convertLeadSchema>;

export const forecastRowSchema = z.object({
  userId: z.string(),
  goal: z.number(),
  /** Closed won in the period. */
  won: z.number(),
  /** Open deals closing in the period, by forecast category. */
  commit: z.number(),
  best: z.number(),
  pipeline: z.number(),
  openDeals: z.number().int(),
});
export type ForecastRow = z.infer<typeof forecastRowSchema>;

export const forecastSchema = z.object({
  /** "Q4 2026" */
  period: z.string(),
  from: z.string(),
  to: z.string(),
  /** How far through the period today is, 0 to 1. */
  elapsed: z.number(),
  rows: z.array(forecastRowSchema),
});
export type Forecast = z.infer<typeof forecastSchema>;

export interface SalesApi {
  listLineItems(dealId: string): Promise<LineItem[]>;
  /** Replaces a deal's line items. With `setAmount`, the deal's amount becomes their total. */
  saveLineItems(input: { dealId: string; items: LineItem[]; setAmount: boolean }): Promise<{ items: LineItem[]; total: number }>;
  /** The people involved in a deal and the part each plays, with their names. */
  listDealPeople(dealId: string): Promise<DealPeople>;
  /** Replaces the people on a deal. A contact appears once. */
  saveDealPeople(input: { dealId: string; people: DealPerson[] }): Promise<DealPeople>;
  /** Turns a lead into a contact (matched on email) and a company (matched on name), and optionally a deal. */
  convertLead(input: ConvertLead): Promise<{ contactId: string; companyId: string | null; dealId: string | null }>;
  /** This quarter, one row per person the caller may see deals for. */
  getForecast(): Promise<Forecast>;
  setGoal(input: { userId: string; amount: number }): Promise<void>;
}
