import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { getOrgToday } from '@debt-copilot/domain';
import { bearer as H, bootApp, signupOrg, teardownOrg, type Creds } from './setup.js';

// ---------------------------------------------------------------------------
// Dashboard contract pins (companion to dashboard-missing.e2e.ts, no overlap):
// - default-today shape + parity with explicit ?today= (org clock, not server)
// - same-org assignee surfaces (guarded join follows same-org users)
// - queue invoices[] non-empty for a single imported invoice
// Harness: boot once, scratch orgs via signup, RESTRICT-order teardown.
// Money asserts: bigint minor units, currencies never mixed.
// ---------------------------------------------------------------------------

let app: INestApplication;
let base = '';
let orgDay: Creds;
let orgAssign: Creds;
let orgInv: Creds;

const DAY = '2026-09-06';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

beforeAll(async () => {
  ({ app, base } = await bootApp());
  orgDay = await signupOrg(base, 'contract-day');
  orgAssign = await signupOrg(base, 'contract-assign');
  orgInv = await signupOrg(base, 'contract-inv');
});

afterAll(async () => {
  await teardownOrg(orgDay.orgId);
  await teardownOrg(orgAssign.orgId);
  await teardownOrg(orgInv.orgId);
  await app.close();
});

describe('dashboard contract pins', () => {
  it('default-today (no ?today=) is org-shaped and matches explicit ?today=', async () => {
    // Compute the real current org day in-test via domain clock; small skew
    // risk near midnight (same as dashboard-missing) — parity between the
    // two requests is the stable assertion, regex pins the shape.
    const expected = getOrgToday({
      organizationId: orgDay.orgId,
      timeZone: 'Asia/Tashkent',
      now: new Date(Date.now()),
    });
    expect(expected).toMatch(DAY_RE);

    const def = await fetch(`${base}/dashboard`, { headers: H(orgDay.access) });
    expect(def.status).toBe(200);
    const defBody = (await def.json()) as { today: string };
    expect(defBody.today).toMatch(DAY_RE);

    const exp = await fetch(`${base}/dashboard?today=${expected}`, { headers: H(orgDay.access) });
    expect(exp.status).toBe(200);
    const expBody = (await exp.json()) as { today: string };
    expect(expBody.today).toBe(expected);
    expect(defBody.today).toBe(expBody.today);
  });

  it('assignee shown for assigned customer (same-org user via db)', async () => {
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgAssign.access),
      body: JSON.stringify({
        filename: 'assigned.xlsx',
        rows: [
          {
            rowNumber: 2,
            customerName: 'Assigned Shop',
            tin: '940000001',
            externalCustomerId: null,
            invoiceNumber: 'ASSIGN-1',
            invoiceDate: '2026-08-01',
            dueDate: '2026-08-25',
            remainingRaw: '1000000',
            currency: 'UZS',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    // Scratch orgs have only the signup owner: create a same-org collector
    // directly via db, then point the customer at them.
    const { createDb } = await import('@debt-copilot/db');
    const cs = process.env['DATABASE_URL'];
    if (!cs) throw new Error('DATABASE_URL required');
    const { db, pool } = createDb(cs);
    const { customers, users } = await import('@debt-copilot/db');
    const { eq } = await import('drizzle-orm');
    const [rep] = await db
      .insert(users)
      .values({ organizationId: orgAssign.orgId, name: 'Amina Rep', role: 'collector' })
      .returning({ id: users.id });
    if (!rep) throw new Error('setup failed: user insert');
    await db
      .update(customers)
      .set({ assignedUserId: rep.id })
      .where(eq(customers.organizationId, orgAssign.orgId));
    await pool.end();

    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgAssign.access) })
    ).json()) as {
      queue: Array<{ name: string; assignee: string; outstanding: { minor: string; currency: string } }>;
    };
    const row = dash.queue.find((q) => q.name === 'Assigned Shop');
    expect(row).toBeDefined();
    expect(row?.assignee).toBe('Amina Rep');
    expect(row?.outstanding).toEqual({ minor: (1_000_000_00n).toString(), currency: 'UZS' });

    const list = (await (
      await fetch(`${base}/customers?today=${DAY}`, { headers: H(orgAssign.access) })
    ).json()) as Array<{ id: string; name: string; assignee: string }>;
    const listed = list.find((c) => c.name === 'Assigned Shop');
    expect(listed?.assignee).toBe('Amina Rep');

    const detail = (await (
      await fetch(`${base}/customers/${listed?.id}?today=${DAY}`, { headers: H(orgAssign.access) })
    ).json()) as { customer: { assignee: string } };
    expect(detail.customer.assignee).toBe('Amina Rep');
  });

  it('queue invoices[] non-empty for a single imported invoice', async () => {
    const res = await fetch(`${base}/imports`, {
      method: 'POST',
      headers: H(orgInv.access),
      body: JSON.stringify({
        filename: 'single.xlsx',
        rows: [
          {
            rowNumber: 2,
            customerName: 'SingleInv Shop',
            tin: '940000002',
            externalCustomerId: null,
            invoiceNumber: 'SINGLE-1',
            invoiceDate: '2026-08-01',
            dueDate: '2026-08-25',
            remainingRaw: '500000',
            currency: 'UZS',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const dash = (await (
      await fetch(`${base}/dashboard?today=${DAY}`, { headers: H(orgInv.access) })
    ).json()) as {
      queue: Array<{ name: string; invoices: string[]; outstanding: { minor: string; currency: string } }>;
    };
    const row = dash.queue.find((q) => q.name === 'SingleInv Shop');
    expect(row).toBeDefined();
    expect(row?.invoices).toEqual(['SINGLE-1']);
    expect(row?.outstanding).toEqual({ minor: (500_000_00n).toString(), currency: 'UZS' });
  });
});
