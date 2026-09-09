import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Source of truth. Rules enforced HERE, not just in app code:
// - every table carries organization_id; every access filters by it
//   (Postgres RLS is a later hardening task; app-layer WHERE is the rule now)
// - money is bigint minor units + strict ^[A-Z]{3}$ currency, never float
// - CHECKs reject negative / over-claim amounts at the storage layer
// - money tables RESTRICT deletes (financial truth is never cascaded away)
// - status vocab is UPPER everywhere, matching packages/domain
// - audit: apps/api must write an interactions row (with before/after)
//   for every remaining_minor mutation; DB shape for that lives here
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    timeZone: varchar('time_zone', { length: 64 }).notNull(),
    baseCurrency: char('base_currency', { length: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check('organizations_currency_chk', sql`${t.baseCurrency} ~ '^[A-Z]{3}$'`)],
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 200 }).notNull(),
    role: text('role').notNull(),
    email: varchar('email', { length: 320 }),
    passwordHash: text('password_hash'),
    telegramUserId: bigint('telegram_user_id', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('users_organization_idx').on(t.organizationId),
    // One Telegram account may own/collect for several orgs: uniqueness is per org.
    uniqueIndex('users_org_telegram_uidx')
      .on(t.organizationId, t.telegramUserId)
      .where(sql`telegram_user_id IS NOT NULL`),
    // Same: one email may exist in several orgs; login is email + org scope.
    uniqueIndex('users_org_email_uidx')
      .on(t.organizationId, t.email)
      .where(sql`email IS NOT NULL`),
    check('users_role_chk', sql`${t.role} IN ('owner','manager','collector')`),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    externalId: varchar('external_id', { length: 200 }),
    name: varchar('name', { length: 300 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    taxId: varchar('tax_id', { length: 16 }),
    assignedUserId: uuid('assigned_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('customers_organization_idx').on(t.organizationId),
    index('customers_org_assignee_idx').on(t.organizationId, t.assignedUserId),
    // Never auto-merge by name: identity is external_id / tax_id per org.
    uniqueIndex('customers_org_external_uidx')
      .on(t.organizationId, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    uniqueIndex('customers_org_tax_uidx')
      .on(t.organizationId, t.taxId)
      .where(sql`tax_id IS NOT NULL`),
  ],
);

export const receivables = pgTable(
  'receivables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    externalId: varchar('external_id', { length: 200 }),
    invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    originalMinor: bigint('original_minor', { mode: 'bigint' }).notNull(),
    remainingMinor: bigint('remaining_minor', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('OPEN'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('receivables_organization_idx').on(t.organizationId),
    index('receivables_org_customer_idx').on(t.organizationId, t.customerId),
    index('receivables_org_due_idx').on(t.organizationId, t.dueDate),
    // Idempotent imports (§24): same file twice = update, not duplicate.
    // Either the natural key or the source external id wins, never both missing silently.
    uniqueIndex('receivables_org_customer_invoice_uidx').on(
      t.organizationId,
      t.customerId,
      t.invoiceNumber,
    ),
    uniqueIndex('receivables_org_external_uidx')
      .on(t.organizationId, t.externalId)
      .where(sql`external_id IS NOT NULL`),
    check('receivables_original_nonneg_chk', sql`original_minor >= 0`),
    check('receivables_remaining_nonneg_chk', sql`remaining_minor >= 0`),
    check('receivables_remaining_lte_original_chk', sql`remaining_minor <= original_minor`),
    check('receivables_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('receivables_status_chk', sql`${t.status} IN ('OPEN','OVERDUE','PAID','VOID')`),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    receivableId: uuid('receivable_id').references(() => receivables.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    paymentDate: date('payment_date').notNull(),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('payments_organization_idx').on(t.organizationId),
    index('payments_org_customer_idx').on(t.organizationId, t.customerId),
    check('payments_amount_nonneg_chk', sql`amount_minor >= 0`),
    check('payments_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
  ],
);

export const promises = pgTable(
  'promises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    promisedDate: date('promised_date').notNull(),
    status: text('status').notNull().default('OPEN'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('promises_organization_idx').on(t.organizationId),
    index('promises_org_status_idx').on(t.organizationId, t.status),
    index('promises_org_customer_idx').on(t.organizationId, t.customerId),
    check('promises_amount_nonneg_chk', sql`amount_minor >= 0`),
    check('promises_currency_chk', sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check('promises_status_chk', sql`${t.status} IN ('OPEN','KEPT','BROKEN','CANCELLED')`),
  ],
);

export const interactions = pgTable(
  'interactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    receivableId: uuid('receivable_id').references(() => receivables.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    note: text('note').notNull().default(''),
    // Audit trail for money movement: apps/api fills these on every
    // remaining_minor mutation. Never silently overwrite balances.
    amountBeforeMinor: bigint('amount_before_minor', { mode: 'bigint' }),
    amountAfterMinor: bigint('amount_after_minor', { mode: 'bigint' }),
    source: text('source').notNull().default('manual'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('interactions_organization_idx').on(t.organizationId),
    index('interactions_org_customer_idx').on(t.organizationId, t.customerId),
    check(
      'interactions_type_chk',
      sql`${t.type} IN ('call','note','reminder','promise','payment','status')`,
    ),
  ],
);

export const reminders = pgTable(
  'reminders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    receivableId: uuid('receivable_id').references(() => receivables.id, { onDelete: 'restrict' }),
    type: text('type').notNull().default('manual'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('reminders_organization_idx').on(t.organizationId),
    index('reminders_org_status_idx').on(t.organizationId, t.status),
    check('reminders_status_chk', sql`${t.status} IN ('pending','sent','cancelled')`),
  ],
);

export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    filename: varchar('filename', { length: 300 }).notNull(),
    status: text('status').notNull().default('pending'),
    importedRows: integer('imported_rows').notNull().default(0),
    rejectedRows: integer('rejected_rows').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('import_jobs_organization_idx').on(t.organizationId),
    check('import_jobs_status_chk', sql`${t.status} IN ('pending','done','failed')`),
  ],
);

// Rotating refresh tokens: only sha256 hashes at rest. Reuse of a spent
// token revokes the family (theft detection). Expired rows are purged
// opportunistically on refresh; spent-but-fresh rows stay as tripwires.
// Deliberately NOT tenant-scoped by column: the user row owns the org, and
// every lookup joins through it. (RLS task may revisit.)
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('refresh_tokens_user_idx').on(t.userId)],
);

// Single-use Telegram link codes (bot runtime arrives later; the code table
// and confirm endpoint are the contract it will implement against).
// Like refresh_tokens: scoped via the user row, not a redundant org column.
export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: char('code_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('telegram_links_user_idx').on(t.userId)],
);
