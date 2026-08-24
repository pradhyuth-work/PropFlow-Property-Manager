import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, date, numeric } from "drizzle-orm/pg-core";

export const properties = pgTable("properties", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
});

export const flats = pgTable("flats", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  propertyId: uuid("property_id").references(() => properties.id, { onDelete: "cascade" }).notNull(),
  flatNo: text("flat_no").notNull(),
  tenantName: text("tenant_name").notNull(),
  workplace: text("workplace").notNull(),
  govtId: text("govt_id").notNull(),
  moveInDate: date("move_in_date").notNull(),
  deposit: numeric("deposit", { precision: 12, scale: 2 }).notNull(),
  rent: numeric("rent", { precision: 12, scale: 2 }).notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  flatId: uuid("flat_id").references(() => flats.id, { onDelete: "cascade" }).notNull(),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertPropertySchema = createInsertSchema(properties);
export const insertFlatSchema = createInsertSchema(flats);
export const insertPaymentSchema = createInsertSchema(payments);

export type Property = typeof properties.$inferSelect;
export type Flat = typeof flats.$inferSelect;
export type Payment = typeof payments.$inferSelect;