import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  amountTierFor,
  calculateAging,
  calculatePriority,
  countAging,
  diffDays,
  getOrgToday,
  isPromiseBroken,
  addDays,
} from '@debt-copilot/domain';
import { customers, promises, receivables, users, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';

export interface MoneyDto {
  minor: string;
  currency: string;
}

export interface DashboardDto {
  today: string;
  totals: Record<string, { total: string; overdue: string; buckets: Record<string, { total: string; count: number }> }>;
  dueWeek: Record<string, string>;
  promisedToday: Record<string, string>;
  queue: Array<{
    customerId: string;
    name: string;
    assignee: string;
    invoices: string[];
    outstanding: MoneyDto;
    overdueDays: number;
    broken: number;
    promiseToday: boolean;
    score: number;
  }>;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

@Injectable()
export class DashboardService {
  private readonly db: Db;

  constructor(@Inject(DbService) dbService: DbService) {
    this.db = dbService.db;
  }

  async get(today: string | undefined, orgId: string): Promise<DashboardDto> {
    const org = await requireOrg(this.db, orgId);
    // Default to the org-local day: client clocks lie, and aging is meaningless
    // on server-local dates. Explicit ?today= stays for tests and demos.
    const day =
      today === undefined || today === ''
        ? getOrgToday({ organizationId: orgId, timeZone: org.timeZone, now: new Date() })
        : today;
    if (!DAY_RE.test(day)) {
      throw new BadRequestException('today must be YYYY-MM-DD');
    }
    const recs = await this.db
      .select()
      .from(receivables)
      .where(eq(receivables.organizationId, orgId));
    const proms = await this.db
      .select()
      .from(promises)
      .where(eq(promises.organizationId, orgId));
    const custs = await this.db
      .select({
        id: customers.id,
        name: customers.name,
        assignee: users.name,
      })
      .from(customers)
      .leftJoin(
        users,
        and(eq(users.id, customers.assignedUserId), eq(users.organizationId, orgId)),
      )
      .where(eq(customers.organizationId, orgId));
    const names = new Map(custs.map((c) => [c.id, { name: c.name, assignee: c.assignee ?? 'Unassigned' }] as const));

    const schedule = calculateAging(
      recs.map((r) => ({
        id: r.id,
        organizationId: orgId,
        customerId: r.customerId,
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        original: { minor: r.originalMinor, currency: r.currency },
        remaining: { minor: r.remainingMinor, currency: r.currency },
      })),
      day,
      orgId,
    );

    const totals: DashboardDto['totals'] = {};
    const counts = countAging(
      recs.map((r) => ({
        id: r.id,
        organizationId: orgId,
        customerId: r.customerId,
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        original: { minor: r.originalMinor, currency: r.currency },
        remaining: { minor: r.remainingMinor, currency: r.currency },
      })),
      day,
      orgId,
    );
    for (const [ccy, buckets] of Object.entries(schedule)) {
      let total = 0n;
      let overdue = 0n;
      const out: Record<string, { total: string; count: number }> = {};
      for (const [bucket, minor] of Object.entries(buckets)) {
        total += minor;
        if (bucket !== 'current') overdue += minor;
        out[bucket] = { total: minor.toString(), count: counts[ccy]?.[bucket as keyof typeof buckets] ?? 0 };
      }
      totals[ccy] = { total: total.toString(), overdue: overdue.toString(), buckets: out };
    }

    // One lane per (customer, currency): money is never summed across currencies.
    const byLane = new Map<string, { customerId: string; currency: string; rows: typeof recs }>();
    for (const r of recs) {
      const key = `${r.customerId}|${r.currency}`;
      const lane = byLane.get(key) ?? { customerId: r.customerId, currency: r.currency, rows: [] };
      lane.rows.push(r);
      byLane.set(key, lane);
    }
    const queue: DashboardDto['queue'] = [];
    for (const lane of byLane.values()) {
      const { customerId, currency, rows } = lane;
      let outstanding = 0n;
      let overdueDays = 0;
      for (const r of rows) {
        outstanding += r.remainingMinor;
        if (r.remainingMinor > 0n && r.dueDate < day) {
          const d = diffDays(r.dueDate, day);
          if (d > overdueDays) overdueDays = d;
        }
      }
      let broken = 0;
      let promiseToday = false;
      for (const p of proms) {
        if (p.customerId !== customerId) continue;
        const brokenNow =
          p.status === 'BROKEN' ||
          (p.status === 'OPEN' &&
            isPromiseBroken(
              {
                id: p.id,
                organizationId: orgId,
                customerId,
                amount: { minor: p.amountMinor, currency: p.currency },
                promisedDate: p.promisedDate,
                status: 'OPEN',
              },
              day,
            ));
        if (brokenNow) broken += 1;
        if (p.status === 'OPEN' && p.promisedDate === day) promiseToday = true;
      }
      const score = calculatePriority({
        overdueDays,
        brokenPromises: broken,
        noContactDays: 0, // Interactions feed this in the worker task.
        amountTier: amountTierFor({ minor: outstanding, currency }),
      });
      const who = names.get(customerId) ?? { name: 'Unknown', assignee: 'Unassigned' };
      queue.push({
        customerId,
        name: who.name,
        assignee: who.assignee,
        invoices: rows.map((r) => r.invoiceNumber),
        outstanding: { minor: outstanding.toString(), currency },
        overdueDays,
        broken,
        promiseToday,
        score,
      });
    }
    queue.sort(
      (a, b) => b.score - a.score || b.overdueDays - a.overdueDays || a.name.localeCompare(b.name),
    );

    const dueWeekMinor = new Map<string, bigint>();
    const weekEnd = addDays(day, 7);
    for (const r of recs) {
      if (r.remainingMinor === 0n) continue;
      if (r.dueDate < day || r.dueDate > weekEnd) continue;
      dueWeekMinor.set(r.currency, (dueWeekMinor.get(r.currency) ?? 0n) + r.remainingMinor);
    }
    const promisedMinor = new Map<string, bigint>();
    for (const p of proms) {
      if (p.status !== 'OPEN' || p.promisedDate !== day) continue;
      promisedMinor.set(p.currency, (promisedMinor.get(p.currency) ?? 0n) + p.amountMinor);
    }
    const str = (m: Map<string, bigint>): Record<string, string> =>
      Object.fromEntries([...m].map(([ccy, minor]) => [ccy, minor.toString()]));
    return { today: day, totals, dueWeek: str(dueWeekMinor), promisedToday: str(promisedMinor), queue };
  }
}
