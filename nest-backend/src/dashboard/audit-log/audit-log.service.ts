import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { delegateFor } from "../../common/prisma-delegate.util.js";

export type AuditSnapshot = {
    target: { table: string; row: Record<string, unknown> };
    /** Only non-empty for a Force delete — one entry per table whose rows were cascade-deleted alongside the target. */
    cascaded: { table: string; rows: Record<string, unknown>[] }[];
};

/**
 * The undo trail for Data Tables hard deletes — see DataTablesService.deleteTableRow/cascadeDeleteRow, the only
 * callers of record(). One row per delete, holding a full JSON snapshot of everything that was removed, so undo()
 * can recreate it exactly instead of guessing at defaults.
 */
@Injectable()
export class AuditLogService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    /** Writes the snapshot inside the SAME transaction as the delete it describes — a delete that commits with no
     * matching audit_log row (or vice versa) would make undo lie about what actually happened. */
    async record(tx: Prisma.TransactionClient, tableName: string, action: "DELETE" | "FORCE_DELETE", snapshot: AuditSnapshot, performedBy?: string): Promise<string> {
        const row = await tx.auditLog.create({
            data: { table_name: tableName, action, snapshot: snapshot as unknown as Prisma.InputJsonValue, performed_by: performedBy ?? null },
        });
        return row.audit_log_id;
    }

    /** Recreates the target row, then every cascade-deleted row, in one transaction — all or nothing, same as the
     * delete it's reversing. Refuses a second undo of the same entry (and a non-existent one) rather than silently
     * recreating duplicates. */
    async undo(auditLogId: string, userId?: string): Promise<void> {
        const entry = await this.prisma.auditLog.findUnique({ where: { audit_log_id: auditLogId } });
        if (!entry) throw new NotFoundException("Nothing to undo — this record no longer exists.");
        if (entry.undone_at) throw new BadRequestException("This was already undone.");

        const snapshot = entry.snapshot as unknown as AuditSnapshot;
        await this.prisma.$transaction(async (tx) => {
            await delegateFor(tx, snapshot.target.table).create({ data: snapshot.target.row });
            for (const c of snapshot.cascaded) {
                if (c.rows.length) await delegateFor(tx, c.table).createMany({ data: c.rows });
            }
            await tx.auditLog.update({ where: { audit_log_id: auditLogId }, data: { undone_at: new Date(), undone_by: userId ?? null } });
        });

        this.tableCache.invalidate(snapshot.target.table);
        for (const c of snapshot.cascaded) this.tableCache.invalidate(c.table);
    }
}
