import { describe, it, expect, vi } from "vitest";
import { MonthlyAuditProcessor } from "./monthly-audit.processor.js";

function build(opts: { responses?: unknown[]; ownerActions?: unknown[] } = {}) {
    const calls: string[] = [];
    const tx = {
        auditResponse: { findMany: vi.fn(async () => opts.responses ?? []) },
        auditAnswer: { deleteMany: vi.fn(async (a: { where: { audit_response_id: { in: string[] } } }) => (calls.push("answers -> " + a.where.audit_response_id.in.join(",")), {})) },
        ownerAction: {
            findMany: vi.fn(async () => opts.ownerActions ?? []),
            deleteMany: vi.fn(async (a: { where: { owner_action_id: { in: string[] } } }) => (calls.push("ownerAction -> " + a.where.owner_action_id.in.join(",")), {})),
        },
        activityLog: { deleteMany: vi.fn(async (a: { where: { owner_action_id: { in: string[] } } }) => (calls.push("activityLog -> " + a.where.owner_action_id.in.join(",")), {})) },
    };
    const processor = new MonthlyAuditProcessor({} as never);
    return { processor, tx, calls };
}

describe("MonthlyAuditProcessor.clearExtra", () => {
    it("removes the prior attempt's answers AND its stale AUDIT_REVIEW owner_action card", async () => {
        const { processor, tx, calls } = build({
            responses: [{ audit_response_id: "R1", submission_id: "S1" }],
            ownerActions: [{ owner_action_id: "OA1", category: "AUDIT_REVIEW", source_submission_id: "S1" }],
        });
        await processor.clearExtra(tx as never, ["S1"]);
        expect(tx.ownerAction.findMany).toHaveBeenCalledWith({ where: { category: "AUDIT_REVIEW", source_submission_id: { in: ["S1"] } } });
        expect(calls).toEqual(["answers -> R1", "activityLog -> OA1", "ownerAction -> OA1"]);
    });

    it("does nothing extra when the prior attempt never got an owner_action (e.g. it errored before creating one)", async () => {
        const { processor, tx, calls } = build({ responses: [{ audit_response_id: "R1", submission_id: "S1" }], ownerActions: [] });
        await processor.clearExtra(tx as never, ["S1"]);
        expect(tx.activityLog.deleteMany).not.toHaveBeenCalled();
        expect(tx.ownerAction.deleteMany).not.toHaveBeenCalled();
        expect(calls).toEqual(["answers -> R1"]);
    });

    it("is a no-op when there was no prior attempt at all", async () => {
        const { processor, tx, calls } = build({ responses: [], ownerActions: [] });
        await processor.clearExtra(tx as never, ["S1"]);
        expect(tx.auditAnswer.deleteMany).not.toHaveBeenCalled();
        expect(calls).toEqual([]);
    });
});
