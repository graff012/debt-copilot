import { and, eq } from 'drizzle-orm';
import { getOrgToday, isOverdue, isPromiseBroken } from '@debt-copilot/domain';
import { interactions, organizations, promises, receivables, type Db } from '@debt-copilot/db';

// ---------------------------------------------------------------------------
// 00:05 job: flip stale OPEN states + one audit interaction per flip.
// Idempotent: re-running finds nothing OPEN-and-past, writes nothing.
// ---------------------------------------------------------------------------

export interface NightlyResult {
  orgs: number;
  flippedReceivables: number;
  flippedPromises: number;
}

export async function runNightly(db: Db, now: Date): Promise<NightlyResult> {
  const orgs = await db.select().from(organizations);
  let flippedReceivables = 0;
  let flippedPromises = 0;
  for (const org of orgs) {
    const today = getOrgToday({ organizationId: org.id, timeZone: org.timeZone, now });
    const openRecs = await db
      .select()
      .from(receivables)
      .where(and(eq(receivables.organizationId, org.id), eq(receivables.status, 'OPEN')));
    for (const r of openRecs) {
      const overdue = isOverdue(
        {
          id: r.id,
          organizationId: org.id,
          customerId: r.customerId,
          invoiceNumber: r.invoiceNumber,
          dueDate: r.dueDate,
          original: { minor: r.originalMinor, currency: r.currency },
          remaining: { minor: r.remainingMinor, currency: r.currency },
        },
        today,
      );
      if (!overdue) continue;
      await db.transaction(async (tx) => {
        await tx
          .update(receivables)
          .set({ status: 'OVERDUE' })
          .where(and(eq(receivables.id, r.id), eq(receivables.organizationId, org.id)));
        await tx.insert(interactions).values({
          organizationId: org.id,
          customerId: r.customerId,
          receivableId: r.id,
          userId: null,
          type: 'status',
          note: `Nightly job: ${r.invoiceNumber} flipped to overdue`,
          amountBeforeMinor: r.remainingMinor,
          amountAfterMinor: r.remainingMinor,
          source: 'job:nightly-states',
        });
      });
      flippedReceivables += 1;
    }
    const openProms = await db
      .select()
      .from(promises)
      .where(and(eq(promises.organizationId, org.id), eq(promises.status, 'OPEN')));
    for (const p of openProms) {
      const broken = isPromiseBroken(
        {
          id: p.id,
          organizationId: org.id,
          customerId: p.customerId,
          amount: { minor: p.amountMinor, currency: p.currency },
          promisedDate: p.promisedDate,
          status: 'OPEN',
        },
        today,
      );
      if (!broken) continue;
      await db.transaction(async (tx) => {
        await tx
          .update(promises)
          .set({ status: 'BROKEN' })
          .where(and(eq(promises.id, p.id), eq(promises.organizationId, org.id)));
        await tx.insert(interactions).values({
          organizationId: org.id,
          customerId: p.customerId,
          receivableId: null,
          userId: null,
          type: 'status',
          note: `Nightly job: promise ${p.id} broke`,
          amountBeforeMinor: p.amountMinor,
          amountAfterMinor: p.amountMinor,
          source: 'job:nightly-states',
        });
      });
      flippedPromises += 1;
    }
  }
  return { orgs: orgs.length, flippedReceivables, flippedPromises };
}
