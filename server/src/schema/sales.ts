import { column, defineTable, index, type InferEntity } from '@mariachi/database';

/** What a deal is made of: products from the library, each with a quantity, a price and a discount. */
export const lineItemsTable = defineTable(
  'line_items',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    dealId: column.text().notNull(),
    /** The product it came from. Null for a one-off line typed by hand. */
    productId: column.text(),
    name: column.text().notNull(),
    quantity: column.double().notNull(),
    unitPrice: column.double().notNull(),
    discountPercent: column.double().notNull().default(0),
    position: column.integer().notNull().default(0),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('line_items_deal_idx').on('tenantId', 'dealId', 'position')] },
);
export type LineItemRow = InferEntity<typeof lineItemsTable>;
