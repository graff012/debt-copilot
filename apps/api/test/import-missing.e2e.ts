import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { bearer as H, bootApp, signupOrg, teardownOrg, type Creds } from './setup.js';

// ---------------------------------------------------------------------------
// Missing import e2e (companion to import.e2e.ts). Own scratch orgs per case
// via signup, full RESTRICT-order cleanup. Bearer tokens, DAY pin.
// Money asserts: bigint minor units, currencies never mixed.
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
let orgDue: Creds;
let orgWarn: Creds;
let orgBlock: Creds;
let orgDup: Creds;

const DAY = '2026-09-06';

beforeAll(async () => {
  ({ app, base } = await bootApp());
  orgDue = await signupOrg(base, 'extra-due');
  orgWarn = await signupOrg(base, 'extra-warn');
  orgBlock = await signupOrg(base, 'extra-block');
  orgDup = await signupOrg(base, 'extra-dup');
});

afterAll(async () => {
  await teardownOrg(orgDue.orgId);
  await teardownOrg(orgWarn.orgId);
  await teardownOrg(orgBlock.orgId);
  await teardownOrg(orgDup.orgId);
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
      headers: H(orgDue.access),
      body: JSON.stringify({ filename: 'due1.xlsx', rows: [row('2026-08-25')] }),
    });
    expect(first.status).toBe(200);
    const dash1 = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgDue.access) })
    ).json()) as { totals: { UZS: { total: string } } };
    expect(dash1.totals['UZS']?.total).toBe((1_000_000_00n).toString());

    // Only the due date moves; amount identical → no amount change.
    // Interaction-text assertions are brittle via API, so assert the
    // observable contract: imported:1 and totals stable (bigint minors).
    const second = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgDue.access),
      body: JSON.stringify({ filename: 'due2.xlsx', rows: [row('2026-08-30')] }),
    });
    expect(second.status).toBe(200);
    const body2 = (await second.json()) as { imported: number; blocked: unknown[] };
    expect(body2.imported).toBe(1);
    expect(body2.blocked).toEqual([]);
    const dash2 = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgDue.access) })
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
      headers: H(orgWarn.access),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { imported: number; warned: number; blocked: unknown[] };
    expect(data.imported).toBe(1);
    expect(data.warned).toBe(1);
    expect(data.blocked).toEqual([]);
    // Both lanes are UZS; totals group per-currency, never mixed.
    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgWarn.access) })
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
      headers: H(orgBlock.access),
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
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgBlock.access) })
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
      headers: H(orgDup.access),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(409);
    const list = (await (
      await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgDup.access) })
    ).json()) as unknown[];
    expect(list).toEqual([]);
  });

  it('returns 404 (not empty 200) when the token org no longer exists', async () => {
    const tmp = await signupOrg(base, 'ghost');
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { organizations, users } = await import('@debt-copilot/db');
    const { eq } = await import('drizzle-orm');
    await db.delete(users).where(eq(users.organizationId, tmp.orgId));
    await db.delete(organizations).where(eq(organizations.id, tmp.orgId));
    await pool.end();
    // Valid signature, deleted org: 404, never empty-200 data.
    const res = await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(tmp.access) });
    expect(res.status).toBe(404);
  });
});
