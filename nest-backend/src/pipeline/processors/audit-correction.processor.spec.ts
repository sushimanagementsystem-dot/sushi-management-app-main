import { describe, it, expect } from "vitest";
import { AuditCorrectionProcessor } from "./audit-correction.processor.js";

type Ctx = { kiosk: { kiosk_id: string; name: string }; submission: { submission_id: string; user_id: string | null }; payload: Record<string, unknown> };

/** A tiny in-memory database — just the tables process() touches. correctiveActionStatus lets a test simulate
 * the action already being CLOSED (so a submission is rejected as stale). */
function build(opts: { correctiveActionStatus?: string; existingOwnerActions?: Record<string, unknown>[] } = {}) {
    const correctiveAction = { corrective_action_id: "CA1", kiosk_id: "K01", audit_question_id: "Q1", status: opts.correctiveActionStatus ?? "OPEN" };
    const ownerActions: Record<string, unknown>[] = [...(opts.existingOwnerActions ?? [])];
    const corrections: Record<string, unknown>[] = [];
    let ownerActionSeq = ownerActions.length;

    const tx = {
        correctiveAction: {
            findUnique: async () => correctiveAction,
            update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(correctiveAction, data),
        },
        auditCorrection: {
            count: async () => corrections.length,
            create: async ({ data }: { data: Record<string, unknown> }) => void corrections.push(data),
        },
        ownerAction: {
            findFirst: async ({ where }: { where: { kiosk_id: string; category: string; status: { in: string[] } } }) =>
                ownerActions.find((a) => a.kiosk_id === where.kiosk_id && a.category === where.category && where.status.in.includes(a.status as string)) ?? null,
            create: async ({ data }: { data: Record<string, unknown> }) => {
                const row = { owner_action_id: `OA${++ownerActionSeq}`, status: "OPEN", ...data };
                ownerActions.push(row);
                return row;
            },
        },
    };

    const upload = { save: async () => ({ url: "https://files.test/photo.jpg" }) };
    const processor = new AuditCorrectionProcessor(upload as never);
    return { processor, tx, ownerActions, corrections };
}

function ctx(overrides: Partial<Ctx["payload"]> = {}): Ctx {
    return {
        kiosk: { kiosk_id: "K01", name: "Loughrea" },
        submission: { submission_id: "S1", user_id: "U1" },
        payload: { client_key: "k1", corrective_action_id: "CA1", correction_note: "fixed it", ...overrides },
    };
}

describe("AuditCorrectionProcessor: corrections group onto one Action Inbox card per kiosk", () => {
    it("the first valid correction for a kiosk creates a new AUDIT_CORRECTION_REVIEW owner_action", async () => {
        const { processor, tx, ownerActions, corrections } = build();
        const result = await processor.process(tx as never, ctx() as never);

        expect(result).toBe("PROCESSED");
        expect(ownerActions).toHaveLength(1);
        expect(ownerActions[0]).toMatchObject({ kiosk_id: "K01", category: "AUDIT_CORRECTION_REVIEW", status: "OPEN", title: "Audit corrections — Loughrea" });
        expect(corrections[0]).toMatchObject({ owner_action_id: ownerActions[0]!.owner_action_id });
    });

    it("a second correction for the same kiosk while the card is still open reuses it instead of making a new one", async () => {
        const { processor, tx, ownerActions, corrections } = build({ existingOwnerActions: [{ owner_action_id: "OA_EXISTING", kiosk_id: "K01", category: "AUDIT_CORRECTION_REVIEW", status: "OPEN" }] });
        await processor.process(tx as never, ctx() as never);

        expect(ownerActions).toHaveLength(1); // nothing new created
        expect(corrections[0]).toMatchObject({ owner_action_id: "OA_EXISTING" });
    });

    it("a correction for a different kiosk's open card is not grouped onto it", async () => {
        const { processor, tx, ownerActions, corrections } = build({ existingOwnerActions: [{ owner_action_id: "OA_OTHER", kiosk_id: "K02", category: "AUDIT_CORRECTION_REVIEW", status: "OPEN" }] });
        await processor.process(tx as never, ctx() as never);

        expect(ownerActions).toHaveLength(2);
        expect(corrections[0]).not.toMatchObject({ owner_action_id: "OA_OTHER" });
    });

    it("once the kiosk's card is RESOLVED, the next correction starts a fresh one rather than reopening it", async () => {
        const { processor, tx, ownerActions } = build({ existingOwnerActions: [{ owner_action_id: "OA_DONE", kiosk_id: "K01", category: "AUDIT_CORRECTION_REVIEW", status: "RESOLVED" }] });
        await processor.process(tx as never, ctx() as never);

        expect(ownerActions).toHaveLength(2);
        expect(ownerActions.find((a) => a.owner_action_id !== "OA_DONE")).toMatchObject({ status: "OPEN" });
    });

    it("an invalid submission (stale/closed corrective action) is rejected and never creates or joins an owner_action", async () => {
        const { processor, tx, ownerActions, corrections } = build({ correctiveActionStatus: "CLOSED" });
        const result = await processor.process(tx as never, ctx() as never);

        expect(result).toBe("REJECTED");
        expect(ownerActions).toHaveLength(0);
        expect(corrections[0]).toMatchObject({ owner_action_id: null, validation_status: "INVALID_ACTION_CLOSED" });
    });
});
