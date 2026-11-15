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

/** The people involved in a deal beyond its main contact, and the part each plays. */
export const dealPeopleTable = defineTable(
  'deal_people',
  {
    id: column.text().primaryKey(),
    tenantId: column.text().notNull(),
    dealId: column.text().notNull(),
    contactId: column.text().notNull(),
    role: column.text().notNull(),
    position: column.integer().notNull().default(0),
    createdAt: column.timestamp().notNull().defaultNow(),
    updatedAt: column.timestamp().notNull().defaultNow(),
  },
  { indexes: [index('deal_people_deal_idx').on('tenantId', 'dealId', 'contactId').unique(), index('deal_people_contact_idx').on('tenantId', 'contactId')] },
);
export type DealPersonRow = InferEntity<typeof dealPeopleTable>;
