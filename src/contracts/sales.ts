import { z } from 'zod';

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
  /** Turns a lead into a contact (matched on email) and a company (matched on name), and optionally a deal. */
  convertLead(input: ConvertLead): Promise<{ contactId: string; companyId: string | null; dealId: string | null }>;
  /** This quarter, one row per person the caller may see deals for. */
  getForecast(): Promise<Forecast>;
  setGoal(input: { userId: string; amount: number }): Promise<void>;
}
