import { describe, it, expect, vi } from "vitest";
import { AuditReviewService } from "./audit-review.service.js";

type Answer = { audit_answer_id: string; audit_response_id: string; audit_question_id: string; staff_answer: string; owner_decision: string | null };

function build(opts: { responseStatus?: string; answers: Answer[]; question?: { pass_answer: string; critical?: boolean } }) {
    const responseStatus = opts.responseStatus ?? "PENDING_REVIEW";
    const question = { audit_question_id: "Q1", pass_answer: "Yes", critical: false, weight: 1, ...opts.question };
    const answers = opts.answers;

    const updates: Record<string, unknown>[] = [];
    const correctionsCreated: Record<string, unknown>[] = [];
    const responseUpdates: Record<string, unknown>[] = [];
    const errorLogs: Record<string, unknown>[] = [];

    const tx = {
        auditAnswer: {
            update: vi.fn(async ({ where, data }: { where: { audit_answer_id: string }; data: Record<string, unknown> }) => {
                updates.push({ where, data });
                const a = answers.find((x) => x.audit_answer_id === where.audit_answer_id)!;
                a.owner_decision = data.owner_decision as string;
            }),
            findMany: async () => answers,
        },
        correctiveAction: {
            findFirst: async () => null,
            create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void correctionsCreated.push(data)),
        },
        auditQuestion: { findMany: async () => [question] },
        auditResponse: {
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void responseUpdates.push(data)),
        },
    };

    const prisma = {
        auditAnswer: { findUnique: async ({ where }: { where: { audit_answer_id: string } }) => answers.find((a) => a.audit_answer_id === where.audit_answer_id) ?? null },
        auditQuestion: { findUnique: async () => question },
        auditResponse: { findUnique: async () => ({ audit_response_id: "R1", kiosk_id: "K1", submission_id: "S1", review_status: responseStatus }) },
        processingErrorLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void errorLogs.push(data)) },
        $transaction: async (fn: (t: typeof tx) => Promise<boolean>) => fn(tx),
    };

    const settings = { getNumber: async () => null };
    const ownerActionState = { findOwnerAction: async () => null, advanceOwnerActionOnAction: vi.fn(async () => {}) };
    const auditReportEmail = { sendAuditReportEmail: vi.fn(async () => {}) };

    const svc = new AuditReviewService(prisma as never, settings as never, ownerActionState as never, auditReportEmail as never);
    return { svc, answers, responseUpdates, correctionsCreated, errorLogs, auditReportEmail };
}

describe("AuditReviewService.reviewAnswer — report email gating", () => {
    it("does not send the report email until every answer on the response has a decision", async () => {
        const { svc, auditReportEmail } = build({
            answers: [
                { audit_answer_id: "A1", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: null },
                { audit_answer_id: "A2", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: null },
            ],
        });
        await svc.reviewAnswer("A1", "ACCEPT", undefined, "owner1");
        expect(auditReportEmail.sendAuditReportEmail).not.toHaveBeenCalled();
    });

    it("sends the report email exactly once, the moment the last answer is decided", async () => {
        const { svc, auditReportEmail, responseUpdates } = build({
            answers: [
                { audit_answer_id: "A1", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: "ACCEPT" },
                { audit_answer_id: "A2", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: null },
            ],
        });
        await svc.reviewAnswer("A2", "ACCEPT", undefined, "owner1");
        expect(auditReportEmail.sendAuditReportEmail).toHaveBeenCalledTimes(1);
        expect(auditReportEmail.sendAuditReportEmail).toHaveBeenCalledWith("R1", "K1");
        expect(responseUpdates.at(-1)).toMatchObject({ review_status: "FULLY_REVIEWED" });
    });

    it("never re-sends the report email when an already fully-reviewed answer is re-decided", async () => {
        const { svc, auditReportEmail } = build({
            responseStatus: "FULLY_REVIEWED",
            answers: [{ audit_answer_id: "A1", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: "ACCEPT" }],
        });
        await svc.reviewAnswer("A1", "OVERRIDE_FAIL", "correcting an earlier decision", "owner1");
        expect(auditReportEmail.sendAuditReportEmail).not.toHaveBeenCalled();
    });

    it("records a failed send to processing_error_log without throwing, and still leaves the review recorded", async () => {
        const { svc, errorLogs, responseUpdates, auditReportEmail } = build({
            answers: [{ audit_answer_id: "A1", audit_response_id: "R1", audit_question_id: "Q1", staff_answer: "YES", owner_decision: null }],
        });
        auditReportEmail.sendAuditReportEmail.mockRejectedValueOnce(new Error("Kiosk has no production_email."));
        await expect(svc.reviewAnswer("A1", "ACCEPT", undefined, "owner1")).resolves.toBeUndefined();
        expect(responseUpdates.at(-1)).toMatchObject({ review_status: "FULLY_REVIEWED" });
        expect(errorLogs).toHaveLength(1);
        expect(errorLogs[0]).toMatchObject({ stage: "send audit report email", kiosk_id: "K1" });
    });
});
