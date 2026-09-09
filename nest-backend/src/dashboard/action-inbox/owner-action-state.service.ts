import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import type { Prisma } from "@prisma/client";

export const RESOLVED_STATUSES = ["RESOLVED", "CLOSED", "NOT_PROCEEDING"];

/**
 * Shared plumbing every category's approval flow calls — port of the
 * bottom section of backend/dashboard/ActionInbox.js (logActivity_,
 * advanceOwnerActionOnAction_, findOwnerAction_). Composed into the
 * category services via DI, not inheritance — see StocktakeReviewService
 * etc.
 */
@Injectable()
export class OwnerActionStateService {
    constructor(private readonly prisma: PrismaService) {}

    /** Matches the live activity_log schema exactly. */
    async logActivity(
        tx: Prisma.TransactionClient,
        ownerActionId: string,
        changedBy: string | null,
        fieldChanged: string,
        oldValue: unknown,
        newValue: unknown,
        note?: string,
    ): Promise<void> {
        await tx.activityLog.create({
            data: {
                owner_action_id: ownerActionId,
                changed_by: changedBy,
                field_changed: fieldChanged,
                old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
                new_value: newValue === null || newValue === undefined ? null : String(newValue),
                note: note || null,
            },
        });
    }

    /**
     * Auto-progression: OPEN -> IN_PROGRESS the first time a real owner
     * approval action touches this action; -> RESOLVED (stamps resolved_at)
     * once complete is true — but only while still OPEN/IN_PROGRESS, so
     * this never overrides a manual WAITING_FOR_OWNER/CLOSED/
     * NOT_PROCEEDING. Caller's own write is already inside a transaction.
     */
    async advanceOwnerActionOnAction(tx: Prisma.TransactionClient, ownerActionId: string, opts: { complete: boolean; note: string }): Promise<void> {
        const action = await tx.ownerAction.findUnique({ where: { owner_action_id: ownerActionId } });
        if (!action) return;

        if (action.status === "OPEN") {
            await tx.ownerAction.update({ where: { owner_action_id: ownerActionId }, data: { status: "IN_PROGRESS" } });
            await this.logActivity(tx, ownerActionId, "system", "status", "OPEN", "IN_PROGRESS", `auto: ${opts.note}`);
        }
        if (opts.complete && (action.status === "OPEN" || action.status === "IN_PROGRESS")) {
            await tx.ownerAction.update({ where: { owner_action_id: ownerActionId }, data: { status: "RESOLVED", resolved_at: new Date() } });
            await this.logActivity(tx, ownerActionId, "system", "status", action.status, "RESOLVED", `auto: ${opts.note}`);
        }
    }

    /** Shared lookup used by every category's approval function to find the
     * owner_action tied to a given submission + category. */
    async findOwnerAction(tx: Prisma.TransactionClient, sourceSubmissionId: string | null, category: string) {
        if (!sourceSubmissionId) return null;
        return tx.ownerAction.findFirst({ where: { source_submission_id: sourceSubmissionId, category } });
    }

    isResolvedStatus(status: string): boolean {
        return RESOLVED_STATUSES.includes(status);
    }
}
