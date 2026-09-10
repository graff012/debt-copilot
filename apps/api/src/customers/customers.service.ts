import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { addDays, diffDays, getOrgToday, isOverdue, isPromiseBroken } from '@debt-copilot/domain';
import { customers, interactions, promises, receivables, users, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function defaultDay(today: string | undefined, timeZone: string, orgId: string): string {
  // Omitted ?today= means the org-local day (client clocks lie). Explicit
  // values stay for tests and demos. Unifies dashboard/customers/promises.
  const day =
    today === undefined || today === ''
      ? getOrgToday({ organizationId: orgId, timeZone, now: new Date() })
      : today;
  if (!DAY_RE.test(day)) throw new BadRequestException('today must be YYYY-MM-DD');
  return day;
}

export interface CustomerDetailDto {
  customer: { id: string; name: string; phone: string | null; taxId: string | null; assignee: string };
  /** One lane per currency: exposure is never summed across currencies. */
  totals: Array<{ minor: string; currency: string }>;
  overdueDays: number;
  broken: number;
  invoices: Array<{
    invoiceNumber: string;
    dueDate: string;
    remaining: { minor: string; currency: string };
    overdueDays: number;
  }>;
  promises: Array<{
    id: string;
    amount: { minor: string; currency: string };
    promisedDate: string;
    state: string;
  }>;
  timeline: Array<{ day: string; kind: string; title: string; body: string; author: string }>;
}

@Injectable()
export class CustomersService {
  private readonly db: Db;

  constructor(@Inject(DbService) dbService: DbService) {
    this.db = dbService.db;
  }

  async list(today: string | undefined, orgId: string) {
    const org = await requireOrg(this.db, orgId);
    const day = defaultDay(today, org.timeZone, orgId);
    const recs = await this.db
      .select()
      .from(receivables)
      .where(eq(receivables.organizationId, orgId));
    const custs = await this.db
      .select({ id: customers.id, name: customers.name, assignee: users.name })
      .from(customers)
      .leftJoin(
        users,
        and(eq(users.id, customers.assignedUserId), eq(users.organizationId, orgId)),
      )
      .where(eq(customers.organizationId, orgId));
    const proms = await this.db
      .select()
      .from(promises)
      .where(eq(promises.organizationId, orgId));
    return custs.map((c) => {
      const mine = recs.filter((r) => r.customerId === c.id);
      // One lane per currency: exposure is never summed across currencies.
      const lanes = new Map<string, { minor: bigint; overdue: number }>();
      for (const r of mine) {
        const lane = lanes.get(r.currency) ?? { minor: 0n, overdue: 0 };
        lane.minor += r.remainingMinor;
        if (r.remainingMinor > 0n && r.dueDate < day) {
          const d = diffDays(r.dueDate, day);
          if (d > lane.overdue) lane.overdue = d;
        }
        lanes.set(r.currency, lane);
      }
      const totals = [...lanes]
        .map(([currency, lane]) => ({ minor: lane.minor.toString(), currency }))
        .sort((a, b) => a.currency.localeCompare(b.currency));
      const overdueDays = Math.max(0, ...[...lanes.values()].map((l) => l.overdue));
      let broken = 0;
      let promiseToday = false;
      for (const p of proms) {
        if (p.customerId !== c.id) continue;
        if (p.status === 'BROKEN') broken += 1;
        else if (
          p.status === 'OPEN' &&
          isPromiseBroken(
            {
              id: p.id,
              organizationId: orgId,
              customerId: c.id,
              amount: { minor: p.amountMinor, currency: p.currency },
              promisedDate: p.promisedDate,
              status: 'OPEN',
            },
            day,
          )
        ) {
          broken += 1;
        }
        if (p.status === 'OPEN' && p.promisedDate === day) promiseToday = true;
      }
      return {
        id: c.id,
        name: c.name,
        assignee: c.assignee ?? 'Unassigned',
        totals,
        overdueDays,
        broken,
        promiseToday,
      };
    });
  }

  async detail(id: string, today: string | undefined, orgId: string): Promise<CustomerDetailDto> {
    const org = await requireOrg(this.db, orgId);
    const day = defaultDay(today, org.timeZone, orgId);
    const [c] = await this.db
      .select({ id: customers.id, name: customers.name, phone: customers.phone, taxId: customers.taxId, assignee: users.name })
      .from(customers)
      .leftJoin(
        users,
        and(eq(users.id, customers.assignedUserId), eq(users.organizationId, orgId)),
      )
      .where(and(eq(customers.organizationId, orgId), eq(customers.id, id)));
    if (!c) throw new NotFoundException('Customer not found');
    const recs = await this.db
      .select()
      .from(receivables)
      .where(and(eq(receivables.organizationId, orgId), eq(receivables.customerId, id)));
    const proms = await this.db
      .select()
      .from(promises)
      .where(and(eq(promises.organizationId, orgId), eq(promises.customerId, id)));
    const notes = await this.db
      .select()
      .from(interactions)
      .where(and(eq(interactions.organizationId, orgId), eq(interactions.customerId, id)));

    const lanes = new Map<string, bigint>();
    let overdueDays = 0;
    const invoices: CustomerDetailDto['invoices'] = [];
    const timeline: CustomerDetailDto['timeline'] = [];
    for (const r of recs) {
      lanes.set(r.currency, (lanes.get(r.currency) ?? 0n) + r.remainingMinor);
      const overdue = isOverdue(
        {
          id: r.id,
          organizationId: orgId,
          customerId: id,
          invoiceNumber: r.invoiceNumber,
          dueDate: r.dueDate,
          original: { minor: r.originalMinor, currency: r.currency },
          remaining: { minor: r.remainingMinor, currency: r.currency },
        },
        day,
      );
      const d = overdue ? diffDays(r.dueDate, day) : 0;
      if (d > overdueDays) overdueDays = d;
      invoices.push({
        invoiceNumber: r.invoiceNumber,
        dueDate: r.dueDate,
        remaining: { minor: r.remainingMinor.toString(), currency: r.currency },
        overdueDays: d,
      });
      timeline.push({ day: r.invoiceDate, kind: 'invoice', title: `Invoice ${r.invoiceNumber} issued`, body: '', author: '' });
      if (overdue) {
        timeline.push({
          day: addDays(r.dueDate, 1),
          kind: 'overdue',
          title: `Invoice ${r.invoiceNumber} flipped to overdue`,
          body: '',
          author: 'System',
        });
      }
    }
    let broken = 0;
    const promiseViews: CustomerDetailDto['promises'] = [];
    for (const p of proms) {
      const state =
        p.status === 'OPEN'
          ? isPromiseBroken(
              {
                id: p.id,
                organizationId: orgId,
                customerId: id,
                amount: { minor: p.amountMinor, currency: p.currency },
                promisedDate: p.promisedDate,
                status: 'OPEN',
              },
              day,
            )
            ? 'broken'
            : p.promisedDate === day
              ? 'due-day'
              : 'upcoming'
          : p.status.toLowerCase();
      if (state === 'broken') broken += 1;
      promiseViews.push({
        id: p.id,
        amount: { minor: p.amountMinor.toString(), currency: p.currency },
        promisedDate: p.promisedDate,
        state,
      });
      timeline.push({ day: p.promisedDate, kind: 'promise', title: `Promise ${p.id}`, body: '', author: '' });
    }
    // Interaction timestamps render on the org calendar, never server UTC.
    const dayFor = (at: Date): string =>
      getOrgToday({ organizationId: orgId, timeZone: org.timeZone, now: at });
    for (const n of notes) {
      const day = dayFor(n.createdAt);
      timeline.push({ day, kind: n.type, title: n.note.slice(0, 80), body: n.note, author: '' });
    }
    timeline.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.kind.localeCompare(b.kind)));
    const totals = [...lanes]
      .map(([currency, minor]) => ({ minor: minor.toString(), currency }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    return {
      customer: { id: c.id, name: c.name, phone: c.phone, taxId: c.taxId, assignee: c.assignee ?? 'Unassigned' },
      totals,
      overdueDays,
      broken,
      invoices,
      promises: promiseViews,
      timeline,
    };
  }
}
