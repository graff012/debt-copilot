import { config } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';

config({ path: '../../.env' });

// ---------------------------------------------------------------------------
// Missing import e2e (companion to import.e2e.ts). Own scratch orgs per case,
// full RESTRICT-order cleanup. Same style: X-Organization-Id header, DAY pin.
// Money asserts: bigint minor units, currencies never mixed.
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
let orgDue = '';
let orgWarn = '';
let orgBlock = '';
let orgDup = '';

const H = (org: string) => ({ 'Content-Type': 'application/json', 'X-Organization-Id': org });
const DAY = '2026-09-06';
// Well-formed v4-shaped UUID that is never inserted (middleware passes, requireOrg 404s).
const UNKNOWN_ORG = '44444444-4444-4444-8444-444444444444';

async function setupOrg(name: string): Promise<string> {
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
  const { customers, importJobs, interactions, payments, promises, receivables, reminders, users } =
    await import('@debt-copilot/db');
  const { eq } = await import('drizzle-orm');
  const { organizations } = await import('@debt-copilot/db');
  // RESTRICT order: children before parents, org last.
  await db.delete(reminders).where(eq(reminders.organizationId, org));
  await db.delete(interactions).where(eq(interactions.organizationId, org));
  await db.delete(payments).where(eq(payments.organizationId, org));
  await db.delete(promises).where(eq(promises.organizationId, org));
  await db.delete(receivables).where(eq(receivables.organizationId, org));
  await db.delete(importJobs).where(eq(importJobs.organizationId, org));
  await db.delete(users).where(eq(users.organizationId, org));
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
  const suffix = Date.now();
  orgDue = await setupOrg(`e2e-extra-due-${suffix}`);
  orgWarn = await setupOrg(`e2e-extra-warn-${suffix}`);
  orgBlock = await setupOrg(`e2e-extra-block-${suffix}`);
  orgDup = await setupOrg(`e2e-extra-dup-${suffix}`);
});

afterAll(async () => {
  await teardownOrg(orgDue);
  await teardownOrg(orgWarn);
  await teardownOrg(orgBlock);
  await teardownOrg(orgDup);
  await app.close();
});

describe('import missing cases', () => {
  it('dueDate-only re-import returns imported:1 and dashboard total unchanged', async () => {
    const row = (dueDate: string) => ({
      rowNumber: 2,
      customerName: 'DueOnly Shop',
      tin: '920000001',
      externalCustomerId: null,
      invoiceNumber: 'DUE-ONLY-1',
      invoiceDate: '2026-08-01',
      dueDate,
      remainingRaw: '1000000',
      currency: 'UZS',
    });
    const first = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgDue),
      body: JSON.stringify({ filename: 'due1.xlsx', rows: [row('2026-08-25')] }),
    });
    expect(first.status).toBe(200);
    const dash1 = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgDue) })
    ).json()) as { totals: { UZS: { total: string } } };
    expect(dash1.totals['UZS']?.total).toBe((1_000_000_00n).toString());

    // Only the due date moves; amount identical → no amount change.
    // Interaction-text assertions are brittle via API, so assert the
    // observable contract: imported:1 and totals stable (bigint minors).
    const second = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgDue),
      body: JSON.stringify({ filename: 'due2.xlsx', rows: [row('2026-08-30')] }),
    });
    expect(second.status).toBe(200);
    const body2 = (await second.json()) as { imported: number; blocked: unknown[] };
    expect(body2.imported).toBe(1);
    expect(body2.blocked).toEqual([]);
    const dash2 = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgDue) })
    ).json()) as { totals: { UZS: { total: string } } };
    expect(dash2.totals['UZS']?.total).toBe((1_000_000_00n).toString());
  });

  it('counts warning rows separately from clean imports (imported vs warned)', async () => {
    const body = {
      filename: 'warned.xlsx',
      rows: [
        {
          rowNumber: 2,
          customerName: 'Warn Shop C',
          tin: '920000011',
          externalCustomerId: null,
          invoiceNumber: 'WARN-1',
          invoiceDate: '2026-08-01',
          dueDate: '2026-08-25',
          remainingRaw: '2000000',
          currency: 'UZS',
        },
        {
          rowNumber: 3,
          customerName: 'Warn Shop W',
          tin: '123',
          externalCustomerId: null,
          invoiceNumber: 'WARN-2',
          invoiceDate: '2026-08-01',
          dueDate: '2026-08-25',
          remainingRaw: '500000',
          currency: 'UZS',
        },
      ],
    };
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgWarn),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { imported: number; warned: number; blocked: unknown[] };
    expect(data.imported).toBe(1);
    expect(data.warned).toBe(1);
    expect(data.blocked).toEqual([]);
    // Both lanes are UZS; totals group per-currency, never mixed.
    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgWarn) })
    ).json()) as { totals: { UZS: { total: string } } };
    expect(dash.totals['UZS']?.total).toBe((2_500_000_00n).toString());
  });

  it('blocks invoiceDate-missing rows with INVALID_INVOICE_DATE', async () => {
    const body = {
      filename: 'noinv.xlsx',
      rows: [
        {
          rowNumber: 2,
          customerName: 'NoInv Shop',
          tin: '920000021',
          externalCustomerId: null,
          invoiceNumber: 'NOINV-1',
          invoiceDate: null,
          dueDate: '2026-08-25',
          remainingRaw: '1000000',
          currency: 'UZS',
        },
      ],
    };
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgBlock),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      imported: number;
      warned: number;
      blocked: Array<{ rowNumber: number; codes: string[] }>;
    };
    expect(data.imported).toBe(0);
    expect(data.warned).toBe(0);
    expect(data.blocked).toHaveLength(1);
    expect(data.blocked[0]?.rowNumber).toBe(2);
    expect(data.blocked[0]?.codes).toContain('INVALID_INVOICE_DATE');
    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgBlock) })
    ).json()) as { totals: Record<string, unknown>; queue: unknown[] };
    expect(dash.totals['UZS']).toBeUndefined();
    expect(dash.queue).toEqual([]);
  });

  it('rejects duplicate rowNumbers in one file with 409 and writes nothing', async () => {
    const mk = (invoiceNumber: string) => ({
      customerName: 'Dup Shop',
      tin: '920000031',
      externalCustomerId: null,
      invoiceNumber,
      invoiceDate: '2026-08-01',
      dueDate: '2026-08-25',
      remainingRaw: '1000000',
      currency: 'UZS',
    });
    const body = {
      filename: 'dup.xlsx',
      rows: [{ ...mk('DUP-1'), rowNumber: 2 }, { ...mk('DUP-2'), rowNumber: 2 }],
    };
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgDup),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);
    const list = (await (
      await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgDup) })
    ).json()) as unknown[];
    expect(list).toEqual([]);
  });

  it('returns 404 (not empty 200) on dashboard for unknown-but-wellformed org UUID', async () => {
    const res = await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(UNKNOWN_ORG) });
    expect(res.status).toBe(404);
  });
});
