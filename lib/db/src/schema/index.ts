import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uuid, date, numeric } from "drizzle-orm/pg-core";

export const owners = pgTable("owners", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  phone: text("phone"),
});

export const properties = pgTable("properties", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const flats = pgTable("flats", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  propertyId: uuid("property_id").references(() => properties.id).notNull(),
  flatNo: text("flat_no").notNull(),
  tenantName: text("tenant_name").notNull(),
  workplace: text("workplace").notNull(),
  govtId: text("govt_id").notNull(),
  moveInDate: date("move_in_date").notNull(),
  deposit: numeric("deposit", { precision: 12, scale: 2 }).notNull(),
  rent: numeric("rent", { precision: 12, scale: 2 }).notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  flatId: uuid("flat_id").references(() => flats.id).notNull(),
  paymentDate: date("payment_date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
});

export const insertOwnerSchema = createInsertSchema(owners);
export const insertPropertySchema = createInsertSchema(properties);
export const insertFlatSchema = createInsertSchema(flats);
export const insertPaymentSchema = createInsertSchema(payments);

export type Owner = typeof owners.$inferSelect;
export type Property = typeof properties.$inferSelect;
export type Flat = typeof flats.$inferSelect;
export type Payment = typeof payments.$inferSelect;
