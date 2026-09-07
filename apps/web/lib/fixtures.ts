import type { PromiseToPay, Receivable } from '@debt-copilot/domain';

// ---------------------------------------------------------------------------
// Demo fixtures. Fake customers only — never real PII. Live data arrives with
// apps/api (task: db + endpoints). Amounts are whole som/dollars on purpose.
// ---------------------------------------------------------------------------

export const ORG_ID = 'demo-org-tashkent';
export const TIME_ZONE = 'Asia/Tashkent';
/** Fixed demo day so the mock is deterministic. */
export const DEMO_TODAY = '2026-09-06';
/** Noon demo clock: safely mid-day in every timezone we demo. */
export const DEMO_NOW = new Date('2026-09-06T07:00:00Z'); // 12:00 Asia/Tashkent

const UZS = 'UZS';
const USD = 'USD';
const som = (major: number) => ({ minor: BigInt(major) * 100n, currency: UZS });
const dollar = (major: number) => ({ minor: BigInt(major) * 100n, currency: USD });

export interface CustomerMeta {
  readonly name: string;
  readonly assignee: string;
}

export const CUSTOMERS: Record<string, CustomerMeta> = {
  mega: { name: 'Mega Shop', assignee: 'Aziz R.' },
  akbar: { name: 'Akbar Market', assignee: 'Jasur K.' },
  baraka: { name: 'Baraka', assignee: 'Jasur K.' },
  sharq: { name: 'Sharq Distribution', assignee: 'Jasur K.' },
  oazis: { name: 'Oazis Trade', assignee: 'Aziz R.' },
  silk: { name: 'Silk Road Mart', assignee: 'Malika T.' },
  green: { name: 'Green Store', assignee: 'Aziz R.' },
  blue: { name: 'Blue Market', assignee: 'Aziz R.' },
  nurline: { name: 'Nurline Market', assignee: 'Malika T.' },
};

export const CUSTOMER_IDS = Object.keys(CUSTOMERS);

/** Days since last contact. Fixture until activity history exists (task: api). */
export const NO_CONTACT_DAYS: Record<string, number> = {
  mega: 6,
  akbar: 2,
  baraka: 4,
  sharq: 9,
  oazis: 3,
  silk: 1,
  green: 12,
  blue: 21,
  nurline: 5,
};

const r = (
  id: string,
  customerId: string,
  invoiceNumber: string,
  invoiceDate: string,
  dueDate: string,
  originalMajor: number,
  remainingMajor: number,
  currency = UZS,
): Receivable & { invoiceDate: string } => ({
  id,
  organizationId: ORG_ID,
  customerId,
  invoiceNumber,
  invoiceDate,
  dueDate,
  original: currency === UZS ? som(originalMajor) : dollar(originalMajor),
  remaining: currency === UZS ? som(remainingMajor) : dollar(remainingMajor),
});

export type FixtureReceivable = (typeof RECEIVABLES)[number];

export const RECEIVABLES = [
  r('r-mega-115', 'mega', 'INV-115', '2026-08-01', '2026-08-25', 15_000_000, 15_000_000),
  r('r-akbar-102', 'akbar', 'INV-102', '2026-07-20', '2026-09-06', 8_000_000, 3_000_000),
  r('r-baraka-130', 'baraka', 'INV-130', '2026-08-26', '2026-09-09', 6_000_000, 6_000_000),
  r('r-sharq-090', 'sharq', 'INV-090', '2026-08-10', '2026-08-30', 4_200_000, 4_200_000),
  r('r-oazis-094', 'oazis', 'INV-094', '2026-07-28', '2026-08-18', 10_000_000, 9_400_000),
  r('r-silk-141', 'silk', 'INV-141', '2026-08-20', '2026-09-06', 4_500_000, 4_500_000),
  r('r-green-060', 'green', 'INV-060', '2026-05-30', '2026-06-20', 7_000_000, 7_000_000),
  r('r-blue-010', 'blue', 'INV-010', '2026-03-12', '2026-04-01', 11_000_000, 11_000_000),
  r('r-nurline-200', 'nurline', 'INV-200', '2026-07-30', '2026-08-20', 1_200, 1_000, USD),
] as const;

const p = (
  id: string,
  customerId: string,
  major: number,
  promisedDate: string,
): PromiseToPay => ({
  id,
  organizationId: ORG_ID,
  customerId,
  amount: som(major),
  promisedDate,
  status: 'OPEN',
});

export const PROMISES: readonly PromiseToPay[] = [
  p('p-mega-1', 'mega', 10_000_000, '2026-09-04'), // broken
  p('p-mega-2', 'mega', 5_000_000, '2026-09-02'), // broken
  p('p-akbar-1', 'akbar', 3_000_000, '2026-09-06'), // due today
  p('p-silk-1', 'silk', 4_500_000, '2026-09-10'), // upcoming
];

export type NoteKind = 'call' | 'note';

export interface ActivityNote {
  readonly id: string;
  readonly customerId: string;
  readonly day: string;
  readonly kind: NoteKind;
  readonly title: string;
  readonly body: string;
  readonly author: string;
}

/** Human-logged history (fixture until apps/api stores interactions). */
export const ACTIVITY_NOTES: readonly ActivityNote[] = [
  {
    id: 'n-mega-call',
    customerId: 'mega',
    day: '2026-08-30',
    kind: 'call',
    title: 'Direct negotiation with debtor',
    body: 'Spoke with Director Bekzod. Client payments from Samarkand branch are delayed. Agreed 10M UZS on Sep 4, remaining 5M on Sep 10.',
    author: 'Aziz R.',
  },
  {
    id: 'n-mega-note',
    customerId: 'mega',
    day: '2026-09-01',
    kind: 'note',
    title: 'Collector memo',
    body: 'Client usually needs two reminders before month-end settlement.',
    author: 'Aziz R.',
  },
];
