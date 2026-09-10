import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { diffDays, getOrgToday, isPromiseBroken } from '@debt-copilot/domain';
import { customers, organizations, promises, receivables, users, type Db } from '@debt-copilot/db';
import { encodeCallback } from '@debt-copilot/telegram';
import type { BotButton, Sender } from '../sender.js';

// ---------------------------------------------------------------------------
// 08:55 job: per-collector morning briefings. Pure composer (tested) + thin
// sender. Only linked users (telegram_user_id NOT NULL) get messages; the
// rest count as skipped — Telegram forbids initiating, so this is a rule.
// Every row read is org-scoped through the staff member's own org.
// ---------------------------------------------------------------------------

export interface CollectorBriefing {
  userId: string;
  telegramUserId: bigint;
  today: string;
  totals: Array<{ minor: bigint; currency: string }>;
  promisesDueToday: number;
  brokenCount: number;
  topDebtors: Array<{ customerId: string; name: string; minor: bigint; currency: string; overdueDays: number }>;
}

export interface SummaryRun {
  sent: number;
  skipped: number;
}

export interface ComposedBriefing {
  text: string;
  buttons: BotButton[];
}

export function composeBriefing(b: CollectorBriefing): ComposedBriefing {
  const lines = [`Good morning. Collection brief for ${b.today}.`];
  if (b.totals.length === 0) {
    lines.push('Nothing overdue on your book.');
  }
  for (const t of b.totals) {
    lines.push(`Overdue: ${t.minor.toString()} ${t.currency} minor units.`);
  }
  lines.push(`Promises due today: ${b.promisesDueToday}. Broken promises: ${b.brokenCount}.`);
  const buttons: BotButton[] = [];
  for (const d of b.topDebtors.slice(0, 5)) {
    lines.push(`- ${d.name}: ${d.minor.toString()} ${d.currency}, ${d.overdueDays}d overdue`);
    buttons.push({ label: `Called ${d.name}`, data: encodeCallback('called', d.customerId) });
    buttons.push({ label: `Promise ${d.name}`, data: encodeCallback('promise', d.customerId) });
  }
  return { text: lines.join('\n'), buttons };
}

export async function runMorningSummary(
  db: Db,
  now: Date,
  send: Sender,
): Promise<SummaryRun> {
  // Day resolves per org: a single UTC trigger would mis-day half the planet.
  const orgs = await db.select().from(organizations);
  let sent = 0;
  let skipped = 0;
  for (const org of orgs) {
    const today = getOrgToday({ organizationId: org.id, timeZone: org.timeZone, now });
    // Unlinked staff count as skipped (Telegram forbids initiating to strangers).
    const unlinked = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.organizationId, org.id), isNull(users.telegramUserId)));
    skipped += unlinked.length;
    const staff = await db
      .select()
      .from(users)
      .where(and(eq(users.organizationId, org.id), isNotNull(users.telegramUserId)));
    for (const u of staff) {
      if (u.telegramUserId === null) {
        skipped += 1;
        continue;
      }
    const assigned = await db
      .select()
      .from(customers)
      .where(
        and(eq(customers.assignedUserId, u.id), eq(customers.organizationId, u.organizationId)),
      );
    let promisesDueToday = 0;
    let brokenCount = 0;
    const debtors: CollectorBriefing['topDebtors'] = [];
    for (const c of assigned) {
      const recs = await db
        .select()
        .from(receivables)
        .where(
          and(eq(receivables.customerId, c.id), eq(receivables.organizationId, u.organizationId)),
        );
      for (const r of recs) {
        if (r.remainingMinor > 0n && r.dueDate < today) {
          debtors.push({
            customerId: c.id,
            name: c.name,
            minor: r.remainingMinor,
            currency: r.currency,
            overdueDays: diffDays(r.dueDate, today),
          });
        }
      }
      const proms = await db
        .select()
        .from(promises)
        .where(and(eq(promises.customerId, c.id), eq(promises.organizationId, u.organizationId)));
      for (const p of proms) {
        if (p.status !== 'OPEN') continue;
        if (p.promisedDate === today) promisesDueToday += 1;
        if (
          isPromiseBroken(
            {
              id: p.id,
              organizationId: p.organizationId,
              customerId: c.id,
              amount: { minor: p.amountMinor, currency: p.currency },
              promisedDate: p.promisedDate,
              status: 'OPEN',
            },
            today,
          )
        ) {
          brokenCount += 1;
        }
      }
    }
    debtors.sort((a, b) => (a.minor === b.minor ? a.name.localeCompare(b.name) : a.minor < b.minor ? 1 : -1));
    // Per-currency lanes: exposure is never summed across currencies.
    const laneTotals = new Map<string, bigint>();
    for (const d of debtors) {
      laneTotals.set(d.currency, (laneTotals.get(d.currency) ?? 0n) + d.minor);
    }
    const totals = [...laneTotals]
      .map(([currency, minor]) => ({ minor, currency }))
      .sort((a, b) => a.currency.localeCompare(b.currency));
    const composed = composeBriefing({
      userId: u.id,
      telegramUserId: u.telegramUserId,
      today,
      totals,
      promisesDueToday,
      brokenCount,
      topDebtors: debtors,
    });
    await send(u.telegramUserId, composed.text, composed.buttons);
    sent += 1;
    }
  }
  return { sent, skipped };
}
