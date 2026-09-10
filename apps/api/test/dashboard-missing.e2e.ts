import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { getOrgToday } from '@debt-copilot/domain';
import { bearer as H, bootApp, signupOrg, teardownOrg, type Creds } from './setup.js';

// ---------------------------------------------------------------------------
// Dashboard missing cases (companion to import.e2e.ts). Same harness style:
// boot once, scratch orgs via signup, RESTRICT-order teardown, Bearer auth.
// Money asserts: bigint minor units, currencies never mixed.
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
let A: Creds;
let B: Creds;

const DAY = '2026-09-06';

beforeAll(async () => {
  ({ app, base } = await bootApp());
  A = await signupOrg(base, 'dashmiss-a');
  B = await signupOrg(base, 'dashmiss-b');
});

afterAll(async () => {
  await teardownOrg(A.orgId);
  await teardownOrg(B.orgId);
  await app.close();
});

const importRow = (over: Record<string, unknown>) => ({
  rowNumber: 2,
  customerName: 'Cross Shop',
  tin: '930000001',
  externalCustomerId: null,
  invoiceNumber: 'CROSS-1',
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-25',
  remainingRaw: '1000000',
  currency: 'UZS',
  ...over,
});

describe('dashboard missing cases', () => {
  it('cross-org assignee shows Unassigned, never the foreign name', async () => {
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(A.access),
      body: JSON.stringify({ filename: 'cross.xlsx', rows: [importRow({})] }),
    });
    expect(res.status).toBe(200);

    // Poison assignedUserId directly via db to another org's user id,
    // bypassing any app-layer guard — dashboard join must not follow it.
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { customers } = await import('@debt-copilot/db');
    const { eq } = await import('drizzle-orm');
    await db
      .update(customers)
      .set({ assignedUserId: B.userId })
      .where(eq(customers.organizationId, A.orgId));
    await pool.end();

    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(A.access) })
    ).json()) as {
      queue: Array<{ name: string; assignee: string; outstanding: { minor: string; currency: string } }>;
    };
    const row = dash.queue.find((q) => q.name === 'Cross Shop');
    expect(row).toBeDefined();
    // Join guards on users.organization_id = orgId, so foreign id misses.
    expect(row?.assignee).toBe('Unassigned');
    expect(row?.assignee).not.toBe('E2E Owner');
    // Money still exact, single-currency lane.
    expect(row?.outstanding).toEqual({ minor: (1_000_000_00n).toString(), currency: 'UZS' });
  });

  it('queue rows carry invoiceNumbers (one lane, all invoices)', async () => {
    const body = {
      filename: 'invnums.xlsx',
      rows: [
        importRow({
          customerName: 'InvNum Shop',
          tin: '930000002',
          invoiceNumber: 'INVNUM-1',
          remainingRaw: '1000000',
          rowNumber: 2,
        }),
        importRow({
          customerName: 'InvNum Shop',
          tin: '930000002',
          invoiceNumber: 'INVNUM-2',
          remainingRaw: '2000000',
          rowNumber: 3,
        }),
      ],
    };
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(A.access),
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);

    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(A.access) })
    ).json()) as {
      queue: Array<{ name: string; invoices: string[]; outstanding: { minor: string; currency: string } }>;
    };
    const row = dash.queue.find((q) => q.name === 'InvNum Shop');
    expect(row).toBeDefined();
    expect([...(row?.invoices ?? [])].sort()).toEqual(['INVNUM-1', 'INVNUM-2']);
    // UZS lane only, bigint sum, never mixed.
    expect(row?.outstanding).toEqual({ minor: (3_000_000_00n).toString(), currency: 'UZS' });
  });

  it('default-today (no ?today=) returns the org-local day', async () => {
    // NOTE: small skew risk near midnight — expected is computed from the
    // same org clock (Asia/Tashkent + Date.now) just before the request.
    // If the org-local day flips between compute and serve, retry.
    const expected = getOrgToday({
      organizationId: A.orgId,
      timeZone: 'Asia/Tashkent',
      now: new Date(Date.now()),
    });
    const res = await fetch(`${base}/dashboard`, { headers: H(A.access) });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { today: string };
    expect(data.today).toBe(expected);
  });

  it("signup with timeZone 'Mars/Olympus' → 400, never 500", async () => {
    const res = await fetch(`${base}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationName: 'e2e bad tz',
        timeZone: 'Mars/Olympus',
        name: 'E2E Owner',
        email: `e2e-badtz-${Date.now()}@t.uz`,
        password: 'Test1234!!',
      }),
    });
    expect(res.status).toBe(400);
  });
});
