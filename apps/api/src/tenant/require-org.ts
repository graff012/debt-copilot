import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { organizations, type Db } from '@debt-copilot/db';

/** Unknown orgs 404 (UUIDs are unguessable; no oracle concern at this scale). */
export async function requireOrg(db: Db, orgId: string) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new NotFoundException('Organization not found');
  return org;
}
