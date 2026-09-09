import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  amountTierFor,
  calculateAging,
  calculatePriority,
  diffDays,
  isPromiseBroken,
} from '@debt-copilot/domain';
import { customers, promises, receivables, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';

export interface MoneyDto {
  minor: string;
  currency: string;
}

export interface DashboardDto {
  today: string;
  totals: Record<string, { total: string; overdue: string; buckets: Record<string, string> }>;
  queue: Array<{
    customerId: string;
    name: string;
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

  async get(today: string, orgId: string): Promise<DashboardDto> {
    if (!DAY_RE.test(today)) {
      throw new BadRequestException('today must be YYYY-MM-DD');
    }
    await requireOrg(this.db, orgId);
    const recs = await this.db
      .select()
      .from(receivables)
      .where(eq(receivables.organizationId, orgId));
    const proms = await this.db
      .select()
      .from(promises)
      .where(eq(promises.organizationId, orgId));
    const custs = await this.db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(eq(customers.organizationId, orgId));
    const names = new Map(custs.map((c) => [c.id, c.name] as const));

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
      today,
      orgId,
    );

    const totals: DashboardDto['totals'] = {};
    for (const [ccy, buckets] of Object.entries(schedule)) {
      let total = 0n;
      let overdue = 0n;
      const out: Record<string, string> = {};
      for (const [bucket, minor] of Object.entries(buckets)) {
        total += minor;
        if (bucket !== 'current') overdue += minor;
        out[bucket] = minor.toString();
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
        if (r.remainingMinor > 0n && r.dueDate < today) {
          const d = diffDays(r.dueDate, today);
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
              today,
            ));
        if (brokenNow) broken += 1;
        if (p.status === 'OPEN' && p.promisedDate === today) promiseToday = true;
      }
      const score = calculatePriority({
        overdueDays,
        brokenPromises: broken,
        noContactDays: 0, // Interactions feed this in the worker task.
        amountTier: amountTierFor({ minor: outstanding, currency }),
      });
      queue.push({
        customerId,
        name: names.get(customerId) ?? 'Unknown',
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
    return { today, totals, queue };
  }
}
