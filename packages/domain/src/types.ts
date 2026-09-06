// Shared domain types. Money is always { minor: bigint, currency }.
// minor = integer minor units (tiyin/cents). Never float, never number math.

export type Currency = string;

export interface Money {
  readonly minor: bigint;
  readonly currency: Currency;
}

export interface Receivable {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly invoiceNumber: string;
  /** YYYY-MM-DD on the organization's local calendar. */
  readonly dueDate: string;
  readonly original: Money;
  readonly remaining: Money;
}

export type PromiseStatus = 'OPEN' | 'KEPT' | 'BROKEN' | 'CANCELLED';

export interface PromiseToPay {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly amount: Money;
  /** YYYY-MM-DD on the organization's local calendar. */
  readonly promisedDate: string;
  readonly status: PromiseStatus;
}

export interface OrgContext {
  readonly organizationId: string;
  /** IANA timezone, e.g. "Asia/Tashkent". */
  readonly timeZone: string;
  /** Injected clock. Production code must never call Date.now() directly. */
  readonly now: Date;
}
