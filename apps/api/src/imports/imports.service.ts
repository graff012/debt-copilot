import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { assertDayString, validateImportRow } from '@debt-copilot/domain';
import {
  customers,
  importJobs,
  interactions,
  receivables,
  type Db,
} from '@debt-copilot/db';
import { DbService } from '../db/db.module.js';
import { requireOrg } from '../tenant/require-org.js';
import type { ImportBodyDto } from './import.dto.js';

export interface BlockedRow {
  rowNumber: number;
  codes: string[];
}

export interface ImportResult {
  filename: string;
  imported: number;
  warned: number;
  blocked: BlockedRow[];
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Validated import: domain judges every row, one transaction writes.
 * - blocked rows never touch the DB (reported with codes)
 * - invoiceDate is required: backfilling it from dueDate would falsify history
 * - existing receivables update + audit interaction (before/after minors)
 * - creations also write an opening audit interaction (every mutation = audit)
 * - same file twice = updates, counts stable (idempotent natural keys)
 * - an invoice currency change aborts the batch (mapping error until proven otherwise)
 */
@Injectable()
export class ImportsService {
  private readonly db: Db;

  constructor(@Inject(DbService) dbService: DbService) {
    this.db = dbService.db;
  }

  private async resolveCustomer(
    tx: Tx,
    orgId: string,
    row: { customerName: string; tin: string | null; externalId: string | null },
  ): Promise<string> {
    if (row.tin) {
      const [found] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.taxId, row.tin)));
      if (found) return found.id;
    }
    if (row.externalId) {
      const [found] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.externalId, row.externalId)));
      if (found) return found.id;
    }
    if (!row.tin && !row.externalId) {
      // No stable id: exact-name match within the org only. Different strings
      // never merge (§23); byte-identical re-uploads stay idempotent.
      const [found] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.organizationId, orgId), eq(customers.name, row.customerName)));
      if (found) return found.id;
    }
    // No fuzzy merge by name ever (§23): new row, human-confirmed upstream.
    const [created] = await tx
      .insert(customers)
      .values({
        organizationId: orgId,
        name: row.customerName,
        taxId: row.tin,
        externalId: row.externalId,
      })
      .returning({ id: customers.id });
    if (!created) throw new Error('Customer insert failed');
    return created.id;
  }

  async importFile(body: ImportBodyDto, orgId: string): Promise<ImportResult> {
    await requireOrg(this.db, orgId);
    const seenRows = new Set<number>();
    for (const r of body.rows) {
      if (seenRows.has(r.rowNumber)) {
        throw new ConflictException(`Duplicate rowNumber in file: ${r.rowNumber}`);
      }
      seenRows.add(r.rowNumber);
    }
    const blocked: BlockedRow[] = [];
    // Invoice date is required and real: backfilling it from dueDate would
    // falsify issue history. These rows never reach the domain validator.
    const candidates = body.rows.filter((r) => {
      const inv = (r.invoiceDate ?? '').trim();
      let ok = !!inv;
      if (ok) {
        try {
          assertDayString(inv, 'invoiceDate');
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        blocked.push({ rowNumber: r.rowNumber, codes: ['INVALID_INVOICE_DATE'] });
        return false;
      }
      return true;
    });
    const validated = candidates.map((r) =>
      validateImportRow({
        rowNumber: r.rowNumber,
        customerName: r.customerName ?? null,
        tin: r.tin ?? null,
        externalCustomerId: r.externalCustomerId ?? null,
        invoiceNumber: r.invoiceNumber ?? null,
        invoiceDate: r.invoiceDate ?? null,
        dueDate: r.dueDate ?? null,
        remainingRaw: r.remainingRaw ?? null,
        currency: r.currency,
      }),
    );
    const accepted = validated.filter((v) => {
      if (v.verdict === 'blocked') {
        blocked.push({ rowNumber: v.rowNumber, codes: v.issues.map((i) => i.code) });
        return false;
      }
      return true;
    });

    let imported = 0;
    let warned = 0;
    await this.db.transaction(async (tx) => {
      for (const v of accepted) {
        const src = candidates.find((r) => r.rowNumber === v.rowNumber);
        if (
          !src ||
          !src.customerName ||
          !src.invoiceNumber ||
          !src.invoiceDate ||
          v.amountMinor === null ||
          !v.effectiveDueDate
        ) {
          // Cannot happen post-validation; fail-closed, never partial-write.
          throw new Error(`Row ${v.rowNumber} failed post-validation guards`);
        }
        const tin = (src.tin ?? '').trim() || null;
        const externalId = (src.externalCustomerId ?? '').trim() || null;
        const invoiceNumber = src.invoiceNumber.trim();
        const customerId = await this.resolveCustomer(tx, orgId, {
          customerName: src.customerName.trim(),
          tin,
          externalId,
        });
        const remaining = v.amountMinor;
        const [existing] = await tx
          .select()
          .from(receivables)
          .where(
            and(
              eq(receivables.organizationId, orgId),
              eq(receivables.customerId, customerId),
              eq(receivables.invoiceNumber, invoiceNumber),
            ),
          );
        if (existing) {
          if (existing.currency !== src.currency) {
            // Same invoice, new currency = mapping error until a human says otherwise.
            throw new ConflictException(
              `Row ${v.rowNumber}: currency changed ${existing.currency} → ${src.currency}`,
            );
          }
          const amountChanged = existing.remainingMinor !== remaining;
          const dueChanged = existing.dueDate !== v.effectiveDueDate;
          if (amountChanged || dueChanged) {
            // Snapshot model: the latest file is truth for both figures, so an
            // upward correction also lifts original (keeps remaining<=original CHECK).
            const original =
              remaining > existing.originalMinor ? remaining : existing.originalMinor;
            await tx
              .update(receivables)
              .set({ remainingMinor: remaining, originalMinor: original, dueDate: v.effectiveDueDate })
              .where(
                and(eq(receivables.id, existing.id), eq(receivables.organizationId, orgId)),
              );
            const changes = [
              amountChanged
                ? `remaining ${existing.remainingMinor} → ${remaining}`
                : null,
              dueChanged ? `due ${existing.dueDate} → ${v.effectiveDueDate}` : null,
            ].filter((s): s is string => s !== null);
            await tx.insert(interactions).values({
              organizationId: orgId,
              customerId,
              receivableId: existing.id,
              userId: null, // No actor until task 8/auth.
              type: 'status',
              note: `Import ${body.filename}: ${changes.join(', ')}`,
              amountBeforeMinor: existing.remainingMinor,
              amountAfterMinor: remaining,
              source: `import:${body.filename}`,
            });
          }
        } else {
          const [created] = await tx
            .insert(receivables)
            .values({
              organizationId: orgId,
              customerId,
              invoiceNumber,
              invoiceDate: src.invoiceDate,
              dueDate: v.effectiveDueDate,
              currency: src.currency,
              originalMinor: remaining,
              remainingMinor: remaining,
            })
            .returning({ id: receivables.id });
          if (!created) throw new Error(`Row ${v.rowNumber} insert failed`);
          await tx.insert(interactions).values({
            organizationId: orgId,
            customerId,
            receivableId: created.id,
            userId: null,
            type: 'status',
            note: `Import ${body.filename}: opened with ${remaining}`,
            amountBeforeMinor: null,
            amountAfterMinor: remaining,
            source: `import:${body.filename}`,
          });
        }
        if (v.verdict === 'warning') warned += 1;
        else imported += 1;
      }
      await tx.insert(importJobs).values({
        organizationId: orgId,
        filename: body.filename,
        status: 'done',
        importedRows: imported + warned,
        rejectedRows: blocked.length,
      });
    });
    return { filename: body.filename, imported, warned, blocked };
  }
}
