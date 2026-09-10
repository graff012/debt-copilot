import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, customers, interactions, organizations, promises, receivables, reminders, users, type Db } from '@debt-copilot/db';
import type { Pool } from 'pg';
import { runNightly } from '../src/jobs/nightly.js';
import { runReminders } from '../src/jobs/reminders.js';
import { runMorningSummary } from '../src/jobs/summary.js';
import type { Sender } from '../src/sender.js';

config({ path: '../../.env' });

// Jobs e2e against local pg + redis-adjacent logic (queues themselves are
// covered by registration test in main wiring; handlers are tested here).

let pool: Pool;
let db: Db;
let org = '';
let cust = '';
let collector = '';

const NOW = new Date('2026-09-06T07:00:00Z'); // 12:00 Tashkent → org day 2026-09-06

beforeAll(async () => {
  const cs = process.env['DATABASE_URL'];
  if (!cs) throw new Error('DATABASE_URL required (docker compose up -d db)');
  ({ db, pool } = createDb(cs));
  try {
    await pool.query('SELECT 1');
  } catch {
    throw new Error('Postgres unreachable (docker compose up -d db)');
  }
  const suffix = Date.now().toString(36);
  const [o] = await db
    .insert(organizations)
    .values({ name: `wjob-${suffix}`, timeZone: 'Asia/Tashkent', baseCurrency: 'UZS' })
    .returning({ id: organizations.id });
  if (!o) throw new Error('setup failed');
  org = o.id;
  const [u] = await db
    .insert(users)
    .values({ organizationId: org, name: 'Night Collector', role: 'collector', telegramUserId: 998_900_000_001n })
    .returning({ id: users.id });
  if (!u) throw new Error('setup failed');
  collector = u.id;
  const [c] = await db
    .insert(customers)
    .values({ organizationId: org, name: 'Job Shop', taxId: `J${suffix}`.slice(0, 12), assignedUserId: collector })
    .returning({ id: customers.id });
  if (!c) throw new Error('setup failed');
  cust = c.id;
  await db.insert(receivables).values([
    {
      organizationId: org, customerId: cust, invoiceNumber: 'W-OPEN-PAST',
      invoiceDate: '2026-08-01', dueDate: '2026-08-25',
      currency: 'UZS', originalMinor: 100n, remainingMinor: 100n, status: 'OPEN',
    },
    {
      organizationId: org, customerId: cust, invoiceNumber: 'W-OPEN-FUTURE',
      invoiceDate: '2026-09-01', dueDate: '2026-09-20',
      currency: 'UZS', originalMinor: 200n, remainingMinor: 200n, status: 'OPEN',
    },
  ]);
  await db.insert(promises).values({
    organizationId: org, customerId: cust, amountMinor: 50n, currency: 'UZS',
    promisedDate: '2026-09-06', status: 'OPEN',
  });
});

afterAll(async () => {
  await db.delete(reminders).where(eq(reminders.organizationId, org));
  await db.delete(interactions).where(eq(interactions.organizationId, org));
  await db.delete(promises).where(eq(promises.organizationId, org));
  await db.delete(receivables).where(eq(receivables.organizationId, org));
  await db.delete(users).where(eq(users.organizationId, org));
  await db.delete(customers).where(eq(customers.organizationId, org));
  await db.delete(organizations).where(eq(organizations.id, org));
  await pool.end();
});

describe('runNightly', () => {
  it('flips past-due OPEN rows + audits, leaves the rest, reruns clean', async () => {
    // Global counters are meaningless on a shared DB (parallel suites own
    // rows too): assert OUR rows and OUR audits, nothing else.
    const own = async () =>
      db.select().from(receivables).where(and(eq(receivables.organizationId, org), eq(receivables.customerId, cust)));
    const ownAudits = async () =>
      db
        .select()
        .from(interactions)
        .where(and(eq(interactions.organizationId, org), eq(interactions.customerId, cust)));

    await runNightly(db, NOW);
    const rows = await own();
    expect(rows.find((r) => r.invoiceNumber === 'W-OPEN-PAST')?.status).toBe('OVERDUE');
    expect(rows.find((r) => r.invoiceNumber === 'W-OPEN-FUTURE')?.status).toBe('OPEN');
    const auditsBefore = await ownAudits();
    expect(auditsBefore.length).toBeGreaterThanOrEqual(1);
    expect(auditsBefore[0]?.source).toBe('job:nightly-states');

    await runNightly(db, NOW);
    const rowsAfter = await own();
    expect(rowsAfter.find((r) => r.invoiceNumber === 'W-OPEN-PAST')?.status).toBe('OVERDUE');
    expect((await ownAudits()).length).toBe(auditsBefore.length); // rerun writes nothing new
  });
});

describe('runReminders', () => {
  it('creates one pending reminder for a due-today promise, never duplicates', async () => {
    // Scope to OUR customer: other orgs (seed included) have their own rows.
    const ownPending = async () =>
      db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.organizationId, org),
            eq(reminders.customerId, cust),
            eq(reminders.status, 'pending'),
          ),
        );
    expect(await ownPending()).toHaveLength(0);
    await runReminders(db, NOW);
    expect(await ownPending()).toHaveLength(1);
    await runReminders(db, NOW);
    expect(await ownPending()).toHaveLength(1);
  });
});

describe('runMorningSummary', () => {
  it('sends to linked collectors only, with computed figures', async () => {
    const sent: Array<{ id: bigint; text: string }> = [];
    const send: Sender = async (id, text) => {
      sent.push({ id, text });
    };
    // Seed an overdue invoice so the briefing is non-empty (isolated customer).
    const [c2] = await db
      .insert(customers)
      .values({ organizationId: org, name: 'Brief Shop', assignedUserId: collector })
      .returning({ id: customers.id });
    if (!c2) throw new Error('setup failed');
    await db.insert(receivables).values({
      organizationId: org, customerId: c2.id, invoiceNumber: 'W-BRIEF',
      invoiceDate: '2026-08-01', dueDate: '2026-08-25',
      currency: 'UZS', originalMinor: 300n, remainingMinor: 300n, status: 'OPEN',
    });
    const run = await runMorningSummary(db, NOW, send);
    expect(run.sent).toBeGreaterThanOrEqual(1);
    const ours = sent.filter((m) => m.text.includes('Brief Shop'));
    expect(ours).toHaveLength(1);
    expect(ours[0]?.id).toBe(998_900_000_001n);
    expect(ours[0]?.text).toContain('2026-09-06');
    await db.delete(receivables).where(eq(receivables.customerId, c2.id));
    await db.delete(customers).where(eq(customers.id, c2.id));
  });
});

describe('runMorningSummary skipped counting', () => {
  it('counts unlinked staff as skipped while briefing the linked collector', async () => {
    // Isolated org: 1 linked + 1 unlinked user. NOW is injected (no Date.now
    // for time logic); Date.now suffix is only for unique names/ids.
    const suffix = Date.now().toString(36);
    const tgId = 998_910_000_000n + BigInt(Date.now() % 100_000);
    const [o] = await db
      .insert(organizations)
      .values({ name: `wskip-${suffix}`, timeZone: 'Asia/Tashkent', baseCurrency: 'UZS' })
      .returning({ id: organizations.id });
    if (!o) throw new Error('setup failed');
    const skipOrg = o.id;
    try {
      const [linked] = await db
        .insert(users)
        .values({ organizationId: skipOrg, name: 'Skip Linked', role: 'collector', telegramUserId: tgId })
        .returning({ id: users.id });
      if (!linked) throw new Error('setup failed');
      await db.insert(users).values({ organizationId: skipOrg, name: 'Skip Unlinked', role: 'collector' });
      const [c] = await db
        .insert(customers)
        .values({ organizationId: skipOrg, name: 'Skip Shop', assignedUserId: linked.id })
        .returning({ id: customers.id });
      if (!c) throw new Error('setup failed');
      await db.insert(receivables).values({
        organizationId: skipOrg, customerId: c.id, invoiceNumber: 'W-SKIP-1',
        invoiceDate: '2026-08-01', dueDate: '2026-08-25',
        currency: 'UZS', originalMinor: 500n, remainingMinor: 500n, status: 'OPEN',
      });
      const sent: Array<{ id: bigint; text: string }> = [];
      const send: Sender = async (id, text) => {
        sent.push({ id, text });
      };
      const run = await runMorningSummary(db, NOW, send);
      // Our linked collector got exactly one briefing with bigint minor units.
      const mine = sent.filter((s) => s.id === tgId);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.text).toContain('2026-09-06');
      expect(mine[0]?.text).toContain('500 UZS');
      // No message can target the unlinked user (no telegram id); the run
      // counts them as skipped. Globals cover other orgs too, so use >=.
      expect(sent.every((s) => typeof s.id === 'bigint')).toBe(true);
      expect(run.sent).toBeGreaterThanOrEqual(1);
      expect(run.skipped).toBeGreaterThanOrEqual(1);
    } finally {
      await db.delete(receivables).where(eq(receivables.organizationId, skipOrg));
      await db.delete(customers).where(eq(customers.organizationId, skipOrg));
      await db.delete(users).where(eq(users.organizationId, skipOrg));
      await db.delete(organizations).where(eq(organizations.id, skipOrg));
    }
  });
});
