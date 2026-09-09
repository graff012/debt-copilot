import { config } from 'dotenv';
import { createDb } from './index.js';
import { customers, organizations, promises, receivables, users } from './schema.js';

config({ path: '../../.env' });

// ---------------------------------------------------------------------------
// Demo seed mirroring apps/web fixtures (same customers, invoices, promises).
// Fixed ids + insert-or-skip = rerunnable without duplicates.
// ---------------------------------------------------------------------------

const ORG = '11111111-1111-4111-8111-111111111111';
const AZIZ = '22222222-2222-4222-8222-222222222222';
const JASUR = '33333333-3333-4333-8333-333333333333';

const C: Record<string, string> = {
  mega: 'a1a1a1a1-1111-4111-8111-111111111111',
  akbar: 'a2a2a2a2-2222-4222-8222-222222222222',
  baraka: 'a3a3a3a3-3333-4333-8333-333333333333',
  sharq: 'a4a4a4a4-4444-4444-8444-444444444444',
  oazis: 'a5a5a5a5-5555-4555-8555-555555555555',
  silk: 'a6a6a6a6-6666-4666-8666-666666666666',
  green: 'a7a7a7a7-7777-4777-8777-777777777777',
  blue: 'a8a8a8a8-8888-4888-8888-888888888888',
  nurline: 'a9a9a9a9-9999-4999-8999-999999999999',
};

const som = (major: number): bigint => BigInt(major) * 100n;

async function main(): Promise<void> {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const { db, pool } = createDb(connectionString);

  await db.insert(organizations).values({
    id: ORG, name: 'Demo Wholesale', timeZone: 'Asia/Tashkent', baseCurrency: 'UZS',
  }).onConflictDoNothing();

  await db.insert(users).values([
    { id: AZIZ, organizationId: ORG, name: 'Aziz R.', role: 'manager' },
    { id: JASUR, organizationId: ORG, name: 'Jasur K.', role: 'collector' },
  ]).onConflictDoNothing();

  const customerRows = [
    { id: C['mega'], name: 'Mega Shop', tin: '304819201', assignee: AZIZ },
    { id: C['akbar'], name: 'Akbar Market', tin: '201884455', assignee: JASUR },
    { id: C['baraka'], name: 'Baraka', tin: '302771234', assignee: JASUR },
    { id: C['sharq'], name: 'Sharq Distribution', tin: '303330011', assignee: JASUR },
    { id: C['oazis'], name: 'Oazis Trade', tin: '306610029', assignee: AZIZ },
    { id: C['silk'], name: 'Silk Road Mart', tin: '305552223', assignee: AZIZ },
    { id: C['green'], name: 'Green Store', tin: '307710087', assignee: AZIZ },
    { id: C['blue'], name: 'Blue Market', tin: '301109876', assignee: AZIZ },
    { id: C['nurline'], name: 'Nurline Market', tin: null, assignee: AZIZ },
  ];
  for (const c of customerRows) {
    const id = c.id;
    if (!id) throw new Error('seed customer without id');
    await db.insert(customers).values({
      id, organizationId: ORG, name: c.name, taxId: c.tin, assignedUserId: c.assignee,
    }).onConflictDoNothing();
  }

  const invoice = (
    id: string, customer: string, n: string, inv: string, due: string, orig: bigint, rem: bigint, ccy = 'UZS',
  ) => ({ id, organizationId: ORG, customerId: customer, invoiceNumber: n, invoiceDate: inv, dueDate: due, currency: ccy, originalMinor: orig, remainingMinor: rem });
  await db.insert(receivables).values([
    invoice('b1b1b1b1-1111-4111-8111-111111111111', C['mega'] ?? '', 'INV-115', '2026-08-01', '2026-08-25', som(15_000_000), som(15_000_000)),
    invoice('b2b2b2b2-2222-4222-8222-222222222222', C['akbar'] ?? '', 'INV-102', '2026-07-20', '2026-09-06', som(8_000_000), som(3_000_000)),
    invoice('b3b3b3b3-3333-4333-8333-333333333333', C['baraka'] ?? '', 'INV-130', '2026-08-26', '2026-09-09', som(6_000_000), som(6_000_000)),
    invoice('b4b4b4b4-4444-4444-8444-444444444444', C['sharq'] ?? '', 'INV-090', '2026-08-10', '2026-08-30', som(4_200_000), som(4_200_000)),
    invoice('b5b5b5b5-5555-4555-8555-555555555555', C['oazis'] ?? '', 'INV-094', '2026-07-28', '2026-08-18', som(10_000_000), som(9_400_000)),
    invoice('b6b6b6b6-6666-4666-8666-666666666666', C['silk'] ?? '', 'INV-141', '2026-08-20', '2026-09-06', som(4_500_000), som(4_500_000)),
    invoice('b7b7b7b7-7777-4777-8777-777777777777', C['green'] ?? '', 'INV-060', '2026-05-30', '2026-06-20', som(7_000_000), som(7_000_000)),
    invoice('b8b8b8b8-8888-4888-8888-888888888888', C['blue'] ?? '', 'INV-010', '2026-03-12', '2026-04-01', som(11_000_000), som(11_000_000)),
    invoice('b9b9b9b9-9999-4999-8999-999999999999', C['nurline'] ?? '', 'INV-200', '2026-07-30', '2026-08-20', 120_000n, 100_000n, 'USD'),
  ]).onConflictDoNothing();

  await db.insert(promises).values([
    { id: 'c1c1c1c1-1111-4111-8111-111111111111', organizationId: ORG, customerId: C['mega'] ?? '', amountMinor: som(10_000_000), currency: 'UZS', promisedDate: '2026-09-04', status: 'OPEN', createdByUserId: AZIZ, source: 'call' },
    { id: 'c2c2c2c2-2222-4222-8222-222222222222', organizationId: ORG, customerId: C['mega'] ?? '', amountMinor: som(5_000_000), currency: 'UZS', promisedDate: '2026-09-02', status: 'OPEN', createdByUserId: AZIZ, source: 'call' },
    { id: 'c3c3c3c3-3333-4333-8333-333333333333', organizationId: ORG, customerId: C['akbar'] ?? '', amountMinor: som(3_000_000), currency: 'UZS', promisedDate: '2026-09-06', status: 'OPEN', createdByUserId: JASUR, source: 'call' },
    { id: 'c4c4c4c4-4444-4444-8444-444444444444', organizationId: ORG, customerId: C['silk'] ?? '', amountMinor: som(4_500_000), currency: 'UZS', promisedDate: '2026-09-10', status: 'OPEN', createdByUserId: AZIZ, source: 'bot' },
  ]).onConflictDoNothing();

  await pool.end();
  console.log('seeded');
}

await main();
