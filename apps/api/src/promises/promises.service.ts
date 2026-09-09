import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { isPromiseBroken } from '@debt-copilot/domain';
import { customers, promises, type Db } from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';

export type PromiseGroup = 'today' | 'upcoming' | 'broken';

@Injectable()
export class PromisesService {
  private readonly db: Db;

  constructor(@Inject(DbService) dbService: DbService) {
    this.db = dbService.db;
  }

  async board(today: string, orgId: string, group?: string) {
    await requireOrg(this.db, orgId);
    const rows = await this.db
      .select({
        id: promises.id,
        customerId: promises.customerId,
        customerName: customers.name,
        amountMinor: promises.amountMinor,
        currency: promises.currency,
        promisedDate: promises.promisedDate,
        status: promises.status,
      })
      .from(promises)
      .innerJoin(customers, and(eq(customers.id, promises.customerId), eq(customers.organizationId, orgId)))
      .where(eq(promises.organizationId, orgId));
    const out: Array<{
      id: string;
      customerId: string;
      customerName: string;
      amount: { minor: string; currency: string };
      promisedDate: string;
      group: PromiseGroup;
    }> = [];
    for (const p of rows) {
      if (p.status !== 'OPEN') continue;
      const broken = isPromiseBroken(
        {
          id: p.id,
          organizationId: orgId,
          customerId: p.customerId,
          amount: { minor: p.amountMinor, currency: p.currency },
          promisedDate: p.promisedDate,
          status: 'OPEN',
        },
        today,
      );
      const g: PromiseGroup = broken ? 'broken' : p.promisedDate === today ? 'today' : 'upcoming';
      if (group && g !== group) continue;
      out.push({
        id: p.id,
        customerId: p.customerId,
        customerName: p.customerName,
        amount: { minor: p.amountMinor.toString(), currency: p.currency },
        promisedDate: p.promisedDate,
        group: g,
      });
    }
    return out;
  }
}
