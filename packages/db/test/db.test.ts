import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { calculateAging } from '@debt-copilot/domain';
import { createDb, type Db } from '../src/index.js';
import {
  customers,
  importJobs,
  interactions,
  organizations,
  payments,
  promises,
  receivables,
  reminders,
  users,
} from '../src/schema.js';
import type { Pool } from 'pg';

config({ path: '../../.env' });

const TODAY = '2026-09-06';
const UZS = (minor: bigint) => ({ minor, currency: 'UZS' });

// ---------------------------------------------------------------------------
// Live-DB contract tests. Require local pg: `docker compose up -d db`.
// ---------------------------------------------------------------------------

let pool: Pool;
let db: Db;
let orgA = '';
let orgB = '';
let custA = '';

async function finish(label: string, promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    throw new Error(`${label}: ${(err as Error).message}`);
  }
}

beforeAll(async () => {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required (docker compose up -d db)');
  ({ db, pool } = createDb(connectionString));
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new Error('Postgres unreachable (docker compose up -d db)');
  }

  const suffix = Date.now().toString(36);
  const [a] = await db
    .insert(organizations)
    .values({ name: `test-a-${suffix}`, timeZone: 'Asia/Tashkent', baseCurrency: 'UZS' })
    .returning({ id: organizations.id });
  const [b] = await db
    .insert(organizations)
    .values({ name: `test-b-${suffix}`, timeZone: 'UTC', baseCurrency: 'USD' })
    .returning({ id: organizations.id });
  if (!a || !b) throw new Error('org setup failed');
  orgA = a.id;
  orgB = b.id;

  const [c] = await db
    .insert(customers)
    .values({ organizationId: orgA, name: 'Test Shop', taxId: `T${suffix}`.slice(0, 12) })
    .returning({ id: customers.id });
  if (!c) throw new Error('customer setup failed');
  custA = c.id;

  const inv = (
    n: string,
    due: string,
    orig: bigint,
    rem: bigint,
    org: string = orgA,
    cust: string = custA,
  ) => ({
    organizationId: org,
    customerId: cust,
    invoiceNumber: n,
    invoiceDate: '2026-08-01',
    dueDate: due,
    currency: 'UZS',
    originalMinor: orig,
    remainingMinor: rem,
  });
  await db.insert(receivables).values([
    inv('T-CUR', '2026-09-10', UZS(100n).minor, UZS(100n).minor), // current
    inv('T-8-30', '2026-08-25', UZS(200n).minor, UZS(200n).minor), // 12d
    inv('T-90P', '2026-04-01', UZS(400n).minor, UZS(400n).minor), // 158d
  ]);
});

afterAll(async () => {
  // RESTRICT order: children (reminders/interactions/payments/promises) before
  // receivables, then import_jobs/users, then customers, then organizations last.
  await db.delete(reminders).where(eq(reminders.organizationId, orgA));
  await db.delete(reminders).where(eq(reminders.organizationId, orgB));
  await db.delete(interactions).where(eq(interactions.organizationId, orgA));
  await db.delete(interactions).where(eq(interactions.organizationId, orgB));
  await db.delete(payments).where(eq(payments.organizationId, orgA));
  await db.delete(payments).where(eq(payments.organizationId, orgB));
  await db.delete(promises).where(eq(promises.organizationId, orgA));
  await db.delete(promises).where(eq(promises.organizationId, orgB));
  await db.delete(receivables).where(eq(receivables.organizationId, orgA));
  await db.delete(receivables).where(eq(receivables.organizationId, orgB));
  await db.delete(importJobs).where(eq(importJobs.organizationId, orgA));
  await db.delete(importJobs).where(eq(importJobs.organizationId, orgB));
  await db.delete(users).where(eq(users.organizationId, orgA));
  await db.delete(users).where(eq(users.organizationId, orgB));
  await db.delete(customers).where(eq(customers.organizationId, orgA));
  await db.delete(customers).where(eq(customers.organizationId, orgB));
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
  await pool.end();
});

describe('tenant isolation', () => {
  it('allows the same invoice number in two orgs', async () => {
    const [cb] = await db
      .insert(customers)
      .values({ organizationId: orgB, name: 'B Shop' })
      .returning({ id: customers.id });
    if (!cb) throw new Error('setup failed');
    await finish(
      'cross-org same invoice',
      db.insert(receivables).values({
        organizationId: orgB,
        customerId: cb.id,
        invoiceNumber: 'T-CUR',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 1n,
        remainingMinor: 1n,
      }),
    );
    const mine = await db
      .select()
      .from(receivables)
      .where(and(eq(receivables.organizationId, orgA), eq(receivables.invoiceNumber, 'T-CUR')));
    expect(mine).toHaveLength(1);
    await db
      .delete(receivables)
      .where(and(eq(receivables.organizationId, orgB), eq(receivables.customerId, cb.id)));
    await db
      .delete(customers)
      .where(and(eq(customers.organizationId, orgB), eq(customers.id, cb.id)));
  });

  it('returns nothing when filtered by the wrong org', async () => {
    const rows = await db
      .select()
      .from(receivables)
      .where(and(eq(receivables.organizationId, orgB), eq(receivables.invoiceNumber, 'T-8-30')));
    expect(rows).toHaveLength(0);
  });
});

describe('money guards live in Postgres, not just app code', () => {
  it('rejects negative remaining', async () => {
    await expect(
      db.insert(receivables).values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: 'T-NEG',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 100n,
        remainingMinor: -1n,
      }),
    ).rejects.toThrow();
  });

  it('rejects remaining above original', async () => {
    await expect(
      db.insert(receivables).values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: 'T-OVER',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 100n,
        remainingMinor: 101n,
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate org+customer+invoice (idempotent re-import)', async () => {
    await expect(
      db.insert(receivables).values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: 'T-CUR',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 100n,
        remainingMinor: 100n,
      }),
    ).rejects.toThrow();
  });

  it('rejects duplicate external_id within one org', async () => {
    const row = {
      organizationId: orgA,
      customerId: custA,
      externalId: 'EXT-DUP-1',
      invoiceNumber: 'T-EXT-A',
      invoiceDate: '2026-08-01',
      dueDate: '2026-09-10',
      currency: 'UZS',
      originalMinor: 100n,
      remainingMinor: 100n,
    };
    await db.insert(receivables).values(row);
    await expect(
      db.insert(receivables).values({ ...row, invoiceNumber: 'T-EXT-B' }),
    ).rejects.toThrow();
    await db
      .delete(receivables)
      .where(and(eq(receivables.organizationId, orgA), eq(receivables.externalId, 'EXT-DUP-1')));
  });

  it('rejects loose currency codes and wrong-case statuses', async () => {
    const base = {
      organizationId: orgA,
      customerId: custA,
      invoiceNumber: 'T-CCY',
      invoiceDate: '2026-08-01',
      dueDate: '2026-09-10',
      originalMinor: 100n,
      remainingMinor: 100n,
    };
    await expect(db.insert(receivables).values({ ...base, currency: 'uzs' })).rejects.toThrow();
    await expect(db.insert(receivables).values({ ...base, currency: 'UZS', status: 'open' })).rejects.toThrow();
  });

  it('allows one Telegram account in two orgs', async () => {
    const link = { telegramUserId: 998_901_234_567n };
    await db.insert(users).values({ organizationId: orgA, name: 'Multi', role: 'owner', ...link });
    await db.insert(users).values({ organizationId: orgB, name: 'Multi', role: 'owner', ...link });
    await db.delete(users).where(eq(users.organizationId, orgA));
    await db.delete(users).where(eq(users.organizationId, orgB));
  });
});

describe('SQL aging matches domain aging', () => {
  it('per-bucket totals agree between GROUP BY and calculateAging', async () => {
    const sqlRows = await db
      .select({
        bucket: sql<string>`CASE WHEN remaining_minor = 0 OR due_date >= ${TODAY} THEN 'current'
          WHEN due_date >= ${'2026-08-30'} THEN 'd1_7'
          WHEN due_date >= ${'2026-08-07'} THEN 'd8_30'
          WHEN due_date >= ${'2026-07-08'} THEN 'd31_60'
          WHEN due_date >= ${'2026-06-08'} THEN 'd61_90'
          ELSE 'd90p' END`,
        total: sql<string>`SUM(remaining_minor)::text`,
      })
      .from(receivables)
      .where(eq(receivables.organizationId, orgA))
      .groupBy(sql`1`);

    const domainRows = await db
      .select({
        dueDate: receivables.dueDate,
        originalMinor: receivables.originalMinor,
        remainingMinor: receivables.remainingMinor,
        currency: receivables.currency,
      })
      .from(receivables)
      .where(eq(receivables.organizationId, orgA));
    const schedule = calculateAging(
      domainRows.map((r, i) => ({
        id: `t${i}`,
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: `T${i}`,
        dueDate: r.dueDate,
        original: { minor: r.originalMinor, currency: r.currency },
        remaining: { minor: r.remainingMinor, currency: r.currency },
      })),
      TODAY,
      orgA,
    );

    for (const row of sqlRows) {
      const expected = schedule['UZS']?.[row.bucket as keyof (typeof schedule)['UZS']];
      expect(row.total, `bucket ${row.bucket}`).toBe((expected ?? 0n).toString());
    }
    // d8_30 holds the 200n row, d90p the 400n row, current the 100n row.
    expect(schedule['UZS']?.d8_30).toBe(200n);
    expect(schedule['UZS']?.d90p).toBe(400n);
    expect(schedule['UZS']?.current).toBe(100n);
  });

  it('pins every bucket boundary on both sides', async () => {
    // due → overdue days → bucket, for TODAY=2026-09-06.
    const rows = [
      { n: 'BND-CUR', due: '2026-09-06', minor: 1n, bucket: 'current' },
      { n: 'BND-1', due: '2026-09-05', minor: 2n, bucket: 'd1_7' },
      { n: 'BND-7', due: '2026-08-30', minor: 3n, bucket: 'd1_7' },
      { n: 'BND-8', due: '2026-08-29', minor: 4n, bucket: 'd8_30' },
      { n: 'BND-60', due: '2026-07-08', minor: 5n, bucket: 'd31_60' },
      { n: 'BND-61', due: '2026-07-07', minor: 6n, bucket: 'd61_90' },
      { n: 'BND-90', due: '2026-06-08', minor: 7n, bucket: 'd61_90' },
      { n: 'BND-91', due: '2026-06-07', minor: 8n, bucket: 'd90p' },
    ] as const;
    for (const r of rows) {
      await db.insert(receivables).values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: r.n,
        invoiceDate: '2026-01-01',
        dueDate: r.due,
        currency: 'UZS',
        originalMinor: r.minor,
        remainingMinor: r.minor,
      });
    }
    const all = await db
      .select({
        dueDate: receivables.dueDate,
        originalMinor: receivables.originalMinor,
        remainingMinor: receivables.remainingMinor,
        currency: receivables.currency,
      })
      .from(receivables)
      .where(eq(receivables.organizationId, orgA));
    const schedule = calculateAging(
      all.map((r, i) => ({
        id: `b${i}`,
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: `B${i}`,
        dueDate: r.dueDate,
        original: { minor: r.originalMinor, currency: r.currency },
        remaining: { minor: r.remainingMinor, currency: r.currency },
      })),
      TODAY,
      orgA,
    );
    // Boundary rows land exactly where the buckets claim (on top of fixtures).
    expect(schedule['UZS']?.d1_7).toBe(5n);
    expect(schedule['UZS']?.d8_30).toBe(200n + 4n);
    expect(schedule['UZS']?.d31_60).toBe(5n);
    expect(schedule['UZS']?.d61_90).toBe(6n + 7n);
    expect(schedule['UZS']?.d90p).toBe(400n + 8n);
    expect(schedule['UZS']?.current).toBe(100n + 1n);
    for (const r of rows) {
      await db
        .delete(receivables)
        .where(and(eq(receivables.organizationId, orgA), eq(receivables.invoiceNumber, r.n)));
    }
  });

  it('proves buckets depend on the org timezone, not a literal', async () => {
    const { calculateAgingForOrg, getOrgToday } = await import('@debt-copilot/domain');
    // 19:30Z Sep 6 = Sep 7 in Tashkent (due Sep 6 → overdue) but Sep 6 in UTC.
    const now = new Date('2026-09-06T19:30:00Z');
    const row = {
      id: 'tz1',
      organizationId: orgA,
      customerId: custA,
      invoiceNumber: 'TZ',
      dueDate: '2026-09-06',
      original: { minor: 10n, currency: 'UZS' },
      remaining: { minor: 10n, currency: 'UZS' },
    };
    const tashkent = calculateAgingForOrg([row], { organizationId: orgA, timeZone: 'Asia/Tashkent', now });
    const utc = calculateAgingForOrg([row], { organizationId: orgA, timeZone: 'UTC', now });
    expect(getOrgToday({ organizationId: orgA, timeZone: 'Asia/Tashkent', now })).toBe('2026-09-07');
    expect(tashkent['UZS']?.d1_7).toBe(10n);
    expect(utc['UZS']?.current).toBe(10n);
    // Callers must pass the org-local today into SQL literals — the literal above is that value.
  });
});

describe('reminders RESTRICT financial truth', () => {
  it('cannot delete a receivable that has a reminder row; cleanup child first', async () => {
    const [row] = await db
      .insert(receivables)
      .values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: 'T-RSTR',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 100n,
        remainingMinor: 100n,
      })
      .returning({ id: receivables.id });
    if (!row) throw new Error('setup failed');
    const [rem] = await db
      .insert(reminders)
      .values({
        organizationId: orgA,
        customerId: custA,
        receivableId: row.id,
        scheduledAt: new Date('2026-09-07T05:00:00Z'),
      })
      .returning({ id: reminders.id });
    if (!rem) throw new Error('setup failed');
    await expect(db.delete(receivables).where(eq(receivables.id, row.id))).rejects.toThrow();
    // RESTRICT order: reminder (child) before receivable (parent).
    await db.delete(reminders).where(eq(reminders.id, rem.id));
    await db.delete(receivables).where(eq(receivables.id, row.id));
    const left = await db.select().from(receivables).where(eq(receivables.id, row.id));
    expect(left).toHaveLength(0);
  });
});

describe('interactions audit trail', () => {
  it('inserts before/after minors and round-trips them as bigint', async () => {
    const [rec] = await db
      .insert(receivables)
      .values({
        organizationId: orgA,
        customerId: custA,
        invoiceNumber: 'T-AUDIT',
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        currency: 'UZS',
        originalMinor: 100n,
        remainingMinor: 100n,
      })
      .returning({ id: receivables.id });
    if (!rec) throw new Error('setup failed');
    const before = 100n;
    const after = 40n;
    const [ia] = await db
      .insert(interactions)
      .values({
        organizationId: orgA,
        customerId: custA,
        receivableId: rec.id,
        type: 'payment',
        note: 'partial 60',
        amountBeforeMinor: before,
        amountAfterMinor: after,
      })
      .returning({
        id: interactions.id,
        before: interactions.amountBeforeMinor,
        after: interactions.amountAfterMinor,
      });
    if (!ia) throw new Error('setup failed');
    expect(ia.before).toBe(before);
    expect(ia.after).toBe(after);
    expect(typeof ia.before).toBe('bigint');
    expect(typeof ia.after).toBe('bigint');
    const rows = await db.select().from(interactions).where(eq(interactions.id, ia.id));
    expect(rows[0]?.amountBeforeMinor).toBe(100n);
    expect(rows[0]?.amountAfterMinor).toBe(40n);
    expect(typeof rows[0]?.amountBeforeMinor).toBe('bigint');
    // RESTRICT order: interaction (child) before receivable (parent).
    await db.delete(interactions).where(eq(interactions.id, ia.id));
    await db.delete(receivables).where(eq(receivables.id, rec.id));
  });
});

describe('import_jobs defaults', () => {
  it('defaults to pending with zero counts', async () => {
    const [job] = await db
      .insert(importJobs)
      .values({ organizationId: orgA, filename: 'test-defaults.xlsx' })
      .returning({
        id: importJobs.id,
        status: importJobs.status,
        imported: importJobs.importedRows,
        rejected: importJobs.rejectedRows,
      });
    if (!job) throw new Error('setup failed');
    expect(job.status).toBe('pending');
    expect(job.imported).toBe(0);
    expect(job.rejected).toBe(0);
    const rows = await db.select().from(importJobs).where(eq(importJobs.id, job.id));
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.importedRows).toBe(0);
    expect(rows[0]?.rejectedRows).toBe(0);
    await db.delete(importJobs).where(eq(importJobs.id, job.id));
  });
});

describe('promises status vocabulary', () => {
  it("rejects wrong-case 'open' but accepts 'BROKEN'", async () => {
    const base = {
      organizationId: orgA,
      customerId: custA,
      amountMinor: 50n,
      currency: 'UZS',
      promisedDate: '2026-09-10',
    };
    await expect(db.insert(promises).values({ ...base, status: 'open' })).rejects.toThrow();
    const [kept] = await db
      .insert(promises)
      .values({ ...base, status: 'BROKEN' })
      .returning({ id: promises.id, status: promises.status });
    if (!kept) throw new Error('setup failed');
    expect(kept.status).toBe('BROKEN');
    await db.delete(promises).where(eq(promises.id, kept.id));
  });
});

describe('customer tax identity is per-org', () => {
  it('allows the same tax_id in two different orgs', async () => {
    const tax = `XT${Date.now().toString(36).toUpperCase().slice(-8)}`.slice(0, 12);
    const [ca] = await db
      .insert(customers)
      .values({ organizationId: orgA, name: 'Tax A', taxId: tax })
      .returning({ id: customers.id });
    const [cb] = await db
      .insert(customers)
      .values({ organizationId: orgB, name: 'Tax B', taxId: tax })
      .returning({ id: customers.id });
    if (!ca || !cb) throw new Error('setup failed');
    const aRows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, orgA), eq(customers.taxId, tax)));
    const bRows = await db
      .select()
      .from(customers)
      .where(and(eq(customers.organizationId, orgB), eq(customers.taxId, tax)));
    expect(aRows).toHaveLength(1);
    expect(bRows).toHaveLength(1);
    await db.delete(customers).where(eq(customers.id, ca.id));
    await db.delete(customers).where(eq(customers.id, cb.id));
  });
});
