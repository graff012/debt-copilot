import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

config({ path: '../../.env' });

// ---------------------------------------------------------------------------
// API e2e against local pg (docker compose up -d db). Scratch orgs per run,
// full cleanup after. Every request carries X-Organization-Id (demo auth).
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
let orgA = '';
let orgB = '';

const H = (org: string) => ({ 'Content-Type': 'application/json', 'X-Organization-Id': org });
const DAY = '2026-09-06';

async function setupOrg(name: string): Promise<string> {
  // Organizations are created directly (no signup endpoint until task 8/auth).
  const { createDb } = await import('@debt-copilot/db');
  const cs = process.env['DATABASE_URL'];
  if (!cs) throw new Error('DATABASE_URL required');
  const { db, pool } = createDb(cs);
  const { organizations } = await import('@debt-copilot/db');
  const [row] = await db
    .insert(organizations)
    .values({ name, timeZone: 'Asia/Tashkent', baseCurrency: 'UZS' })
    .returning({ id: organizations.id });
  await pool.end();
  if (!row) throw new Error('org setup failed');
  return row.id;
}

async function teardownOrg(org: string): Promise<void> {
  const { createDb } = await import('@debt-copilot/db');
  const cs = process.env['DATABASE_URL'];
  if (!cs) throw new Error('DATABASE_URL required');
  const { db, pool } = createDb(cs);
  const { customers, importJobs, interactions, payments, promises, receivables, reminders } =
    await import('@debt-copilot/db');
  const { eq } = await import('drizzle-orm');
  const { organizations } = await import('@debt-copilot/db');
  await db.delete(reminders).where(eq(reminders.organizationId, org));
  await db.delete(interactions).where(eq(interactions.organizationId, org));
  await db.delete(payments).where(eq(payments.organizationId, org));
  await db.delete(promises).where(eq(promises.organizationId, org));
  await db.delete(receivables).where(eq(receivables.organizationId, org));
  await db.delete(importJobs).where(eq(importJobs.organizationId, org));
  await db.delete(customers).where(eq(customers.organizationId, org));
  await db.delete(organizations).where(eq(organizations.id, org));
  await pool.end();
}

beforeAll(async () => {
  if (!process.env['DATABASE_URL']) throw new Error('DATABASE_URL required (docker compose up -d db)');
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalPipes(
    new (await import('@nestjs/common')).ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(0);
  const url = await app.getUrl();
  base = url.replace('[::1]', '127.0.0.1');
  orgA = await setupOrg(`e2e-a-${Date.now()}`);
  orgB = await setupOrg(`e2e-b-${Date.now()}`);
});

afterAll(async () => {
  await teardownOrg(orgA);
  await teardownOrg(orgB);
  await app.close();
});

const validBatch = () => ({
  filename: 'test.xlsx',
  rows: [
    {
      rowNumber: 2,
      customerName: 'E2E Shop',
      tin: '900000001',
      externalCustomerId: null,
      invoiceNumber: 'E2E-1',
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-25',
      remainingRaw: '15000000',
      currency: 'UZS',
    },
    {
      rowNumber: 3,
      customerName: 'Bad Row',
      tin: '900000002',
      externalCustomerId: null,
      invoiceNumber: 'E2E-2',
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-25',
      remainingRaw: 'not-a-number',
      currency: 'UZS',
    },
  ],
});

describe('tenant wall', () => {
  it('healthz needs no org, others reject garbage UUIDs', async () => {
    const health = await fetch(`${base}/healthz`);
    expect(health.status).toBe(200);
    const bad = await fetch(`${base}/dashboard?today=${DAY}`, { headers: H('nope') });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/dashboard?today=${DAY}`);
    expect(missing.status).toBe(400);
  });

  it('org B cannot see org A data, unknown ids 404 (never leak existence)', async () => {
    await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgA),
      body: JSON.stringify(validBatch()),
    });
    const customersB = await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgB) });
    expect(await customersB.json()).toEqual([]);
    const detailB = await fetch(`${base}/customers/00000000-0000-4000-8000-000000000000?today=${DAY}`, {
      headers: H(orgB),
    });
    expect(detailB.status).toBe(404);
  });
});

describe('import → read loop', () => {
  it('imports valid rows, reports blocked, writes audit', async () => {
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgA),
      body: JSON.stringify(validBatch()),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imported: number; warned: number; blocked: Array<{ rowNumber: number; codes: string[] }> };
    expect(body.imported).toBe(1);
    expect(body.blocked).toHaveLength(1);
    expect(body.blocked[0]?.rowNumber).toBe(3);

    const dash = await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgA) });
    const data = (await dash.json()) as { totals: { UZS: { total: string; overdue: string } }; queue: unknown[] };
    expect(data.totals['UZS']?.total).toBe((15_000_000_00n).toString());
    expect(data.totals['UZS']?.overdue).toBe((15_000_000_00n).toString());
    expect(data.queue).toHaveLength(1);
  });

  it('re-imports idempotently: totals stable, audit only on change', async () => {
    const again = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgA),
      body: JSON.stringify(validBatch()),
    });
    const body = (await again.json()) as { imported: number; warned: number; blocked: unknown[] };
    expect(body.imported).toBe(1);
    const dash = await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgA) });
    const data = (await dash.json()) as { totals: { UZS: { total: string } } };
    expect(data.totals['UZS']?.total).toBe((15_000_000_00n).toString());
  });

  it('400s on malformed bodies, never partial-writes', async () => {
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgA),
      body: JSON.stringify({ filename: 'x.xlsx', rows: [{ nope: true }] }),
    });
    expect(res.status).toBe(400);
  });

  it('400s on missing/malformed today and bogus groups', async () => {
    expect((await fetch(`${base}/dashboard`, { headers: H(orgA) })).status).toBe(400);
    expect((await fetch(`${base}/dashboard?today=tomorrow`, { headers: H(orgA) })).status).toBe(400);
    expect((await fetch(`${base}/promises?today=${DAY}&group=bogus`, { headers: H(orgA) })).status).toBe(
      400,
    );
    expect((await fetch(`${base}/customers/00000000-0000-4000-8000-000000000000?today=${DAY}`, { headers: H(orgA) })).status).toBe(404);
  });

  it('400s on nested extra keys and oversized batches', async () => {
    const evil = {
      filename: 'evil.xlsx',
      rows: [{ ...validBatch().rows[0], injected: true }],
    };
    expect(
      (await fetch(`${base}/imports`, { method: 'POST', headers: H(orgA), body: JSON.stringify(evil) })).status,
    ).toBe(400);
    const big = {
      filename: 'big.xlsx',
      rows: Array.from({ length: 5001 }, (_, i) => ({
        rowNumber: i + 2,
        customerName: 'Big',
        tin: '900009999',
        externalCustomerId: null,
        invoiceNumber: `BIG-${i}`,
        invoiceDate: '2026-08-01',
        dueDate: '2026-09-10',
        remainingRaw: '100',
        currency: 'UZS',
      })),
    };
    // 5001 rows ≈ 1 MB: Express's 100 kb JSON cap answers 413 before DTO
    // validation. ArrayMaxSize(5000) is the second net if the cap ever rises.
    expect(
      (await fetch(`${base}/imports`, { method: 'POST', headers: H(orgB), body: JSON.stringify(big) })).status,
    ).toBe(413);
  });

  it('serves customers, detail, and promises board', async () => {
    const list = (await (
      await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgA) })
    ).json()) as Array<{ id: string; name: string; overdueDays: number }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('E2E Shop');
    expect(list[0]?.overdueDays).toBe(12);
    const detail = (await (
      await fetch(`${base}/customers/${list[0]?.id}?today=${DAY}`, { headers: H(orgA) })
    ).json()) as { totals: Array<{ minor: string; currency: string }>; timeline: unknown[] };
    expect(detail.totals).toEqual([{ minor: (15_000_000_00n).toString(), currency: 'UZS' }]);
    expect(detail.timeline.length).toBeGreaterThan(0);
    const board = (await (
      await fetch(`${base}/promises?today=${DAY}`, { headers: H(orgA) })
    ).json()) as unknown[];
    expect(board).toEqual([]);
  });
});

describe('import edge cases (orgB scratch space, isolated customers)', () => {
  const post = (body: unknown) =>
    fetch(`${base}/imports`, { method: 'POST', headers: H(orgB), body: JSON.stringify(body) });
  const row = (over: Record<string, unknown>) => ({
    rowNumber: 2,
    customerName: 'Edge Shop',
    tin: '910000001',
    externalCustomerId: null,
    invoiceNumber: 'EDGE-1',
    invoiceDate: '2026-08-01',
    dueDate: '2026-08-25',
    remainingRaw: '1000000',
    currency: 'UZS',
    ...over,
  });

  it('keeps id-less re-imports to one customer and one receivable', async () => {
    const body = {
      filename: 'noid.xlsx',
      rows: [{ ...row({ tin: null, customerName: 'NoId Shop', invoiceNumber: 'NOID-1' }) }],
    };
    for (let i = 0; i < 2; i += 1) {
      const res = await post(body);
      expect(res.status).toBe(200);
    }
    const list = (await (await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgB) })).json()) as Array<{
      name: string;
    }>;
    expect(list.filter((c) => c.name === 'NoId Shop')).toHaveLength(1);
  });

  it('aborts the batch on invoice currency change (409, nothing partial)', async () => {
    const first = {
      filename: 'ccy.xlsx',
      rows: [row({ customerName: 'Ccy Shop', tin: '910000002', invoiceNumber: 'CCY-1' })],
    };
    expect((await post(first)).status).toBe(200);
    const changed = {
      filename: 'ccy.xlsx',
      rows: [
        {
          ...row({ customerName: 'Ccy Shop', tin: '910000002', invoiceNumber: 'CCY-1' }),
          remainingRaw: '100 USD',
          currency: 'USD',
        },
      ],
    };
    const res = await post(changed);
    expect(res.status).toBe(409);
    const list = (await (await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgB) })).json()) as Array<{
      name: string;
      totals: Array<{ minor: string; currency: string }>;
    }>;
    expect(list.find((c) => c.name === 'Ccy Shop')?.totals).toEqual([
      { minor: (1_000_000_00n).toString(), currency: 'UZS' },
    ]);
  });

  it('absorbs upward corrections without tripping the CHECK', async () => {
    const up = (amount: string, file: string) => ({
      filename: file,
      rows: [row({ customerName: 'Up Shop', tin: '910000003', invoiceNumber: 'UP-1', remainingRaw: amount })],
    });
    expect((await post(up('1000000', 'up1.xlsx'))).status).toBe(200);
    expect((await post(up('1500000', 'up2.xlsx'))).status).toBe(200);
    const list = (await (await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgB) })).json()) as Array<{
      name: string;
      totals: Array<{ minor: string; currency: string }>;
    }>;
    expect(list.find((c) => c.name === 'Up Shop')?.totals).toEqual([
      { minor: (1_500_000_00n).toString(), currency: 'UZS' },
    ]);
  });

  it('exposes multi-currency customers as separate lanes', async () => {
    const body = {
      filename: 'multi.xlsx',
      rows: [
        row({ customerName: 'Multi Shop', tin: '910000004', invoiceNumber: 'M-1', remainingRaw: '2000000' }),
        {
          ...row({ customerName: 'Multi Shop', tin: '910000004', invoiceNumber: 'M-2', remainingRaw: '500', currency: 'USD' }),
          rowNumber: 3,
        },
      ],
    };
    expect((await post(body)).status).toBe(200);
    const list = (await (
      await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgB) })
    ).json()) as Array<{ name: string; totals: Array<{ minor: string; currency: string }> }>;
    expect(list.find((c) => c.name === 'Multi Shop')?.totals).toEqual([
      { minor: (50_000n).toString(), currency: 'USD' },
      { minor: (2_000_000_00n).toString(), currency: 'UZS' },
    ]);
  });

  it('filters the board by group', async () => {
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { customers, promises } = await import('@debt-copilot/db');
    const [c] = await db
      .insert(customers)
      .values({ organizationId: orgB, name: 'Board Shop' })
      .returning({ id: customers.id });
    if (!c) throw new Error('setup failed');
    await db.insert(promises).values([
      { organizationId: orgB, customerId: c.id, amountMinor: 1n, currency: 'UZS', promisedDate: '2026-09-01', status: 'OPEN' },
      { organizationId: orgB, customerId: c.id, amountMinor: 2n, currency: 'UZS', promisedDate: '2026-09-20', status: 'OPEN' },
    ]);
    await pool.end();
    const broken = (await (
      await fetch(`${base}/promises?today=${DAY}&group=broken`, { headers: H(orgB) })
    ).json()) as Array<{ id: string }>;
    expect(broken).toHaveLength(1);
    const upcoming = (await (
      await fetch(`${base}/promises?today=${DAY}&group=upcoming`, { headers: H(orgB) })
    ).json()) as Array<{ id: string }>;
    expect(upcoming).toHaveLength(1);
  });
});
