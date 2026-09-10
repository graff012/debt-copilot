import { and, eq } from 'drizzle-orm';
import { getOrgToday } from '@debt-copilot/domain';
import { organizations, promises, reminders, type Db } from '@debt-copilot/db';

// ---------------------------------------------------------------------------
// Hourly job: one pending reminder row per OPEN promise due today.
// Dedup is structural: a pending row for (customer, today) suppresses remakes.
// The morning summary reads these rows; sending stays in the bot layer.
// ---------------------------------------------------------------------------

export async function runReminders(db: Db, now: Date): Promise<{ created: number }> {
  const orgs = await db.select().from(organizations);
  let created = 0;
  for (const org of orgs) {
    const today = getOrgToday({ organizationId: org.id, timeZone: org.timeZone, now });
    const due = await db
      .select()
      .from(promises)
      .where(
        and(
          eq(promises.organizationId, org.id),
          eq(promises.status, 'OPEN'),
          eq(promises.promisedDate, today),
        ),
      );
    for (const p of due) {
      const pendingToday = await db
        .select({ id: reminders.id, at: reminders.scheduledAt })
        .from(reminders)
        .where(
          and(
            eq(reminders.organizationId, org.id),
            eq(reminders.customerId, p.customerId),
            eq(reminders.status, 'pending'),
          ),
        );
      const scheduledToday = pendingToday.some((r) => {
        const day = getOrgToday({ organizationId: org.id, timeZone: org.timeZone, now: r.at });
        return day === today;
      });
      if (scheduledToday) continue;
      await db.insert(reminders).values({
        organizationId: org.id,
        customerId: p.customerId,
        receivableId: null,
        type: 'promise-due',
        scheduledAt: now,
        status: 'pending',
      });
      created += 1;
    }
  }
  return { created };
}
