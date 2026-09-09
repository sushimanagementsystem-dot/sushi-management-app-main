import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";
import { toDateStr } from "../../common/date.util.js";

type AuditAnswerInput = { answer: "YES" | "NO" | "NA"; photo?: { base64: string; mimeType: string; name: string }; evidence_photo_reference?: string };
type MonthlyAuditPayload = { answers: Record<string, AuditAnswerInput> };

/**
 * Monthly Audit — port of backend/forms/FormMonthlyAudit.js. Writes one
 * audit_response (PENDING_REVIEW, score/rating deliberately left blank —
 * the owner's call, never computed here) plus one audit_answer per
 * question. A resubmit is blocked entirely once the owner starts
 * reviewing (review_status past PENDING_REVIEW) — checked both here and
 * again in process(), in case reviewing started between page load and
 * submit.
 */
@Injectable()
export class MonthlyAuditProcessor implements SubmissionProcessor<MonthlyAuditPayload> {
    readonly formType = "MONTHLY_AUDIT";
    readonly tables = [{ model: "audit_response" }];

    constructor(private readonly upload: UploadService) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<MonthlyAuditPayload>;
        const answers = p.answers ?? {};
        if (!Object.keys(answers).length) return { valid: false, message: "No answers submitted." };
        for (const [qid, a] of Object.entries(answers)) {
            if (!a || !["YES", "NO", "NA"].includes(a.answer)) return { valid: false, message: `Question "${qid}": pick an answer.` };
        }
        return { valid: true };
    }

    buildKey(ctx: KeyContext<MonthlyAuditPayload>): string {
        return `MONTHLY_AUDIT|${ctx.kiosk.kiosk_id}|${toDateStr(ctx.businessDate)}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<MonthlyAuditPayload> {
        const p = payload as MonthlyAuditPayload;
        for (const [qid, a] of Object.entries(p.answers)) {
            if (a.photo?.base64) {
                const uploaded = await this.upload.save(a.photo, kiosk.kiosk_id, "MONTHLY_AUDIT");
                p.answers[qid] = { ...a, evidence_photo_reference: uploaded.url, photo: undefined };
            }
        }
        return p;
    }

    async clearExtra(tx: Prisma.TransactionClient, oldSubmissionIds: string[]): Promise<void> {
        const oldResponses = await tx.auditResponse.findMany({ where: { submission_id: { in: oldSubmissionIds } } });
        const responseIds = oldResponses.map((r) => r.audit_response_id);
        if (responseIds.length) {
            await tx.auditAnswer.deleteMany({ where: { audit_response_id: { in: responseIds } } });
        }
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<MonthlyAuditPayload>): Promise<void> {
        const answers = ctx.payload.answers;

        const existing = await tx.auditResponse.findFirst({ where: { kiosk_id: ctx.kiosk.kiosk_id, audit_date: ctx.businessDate } });
        if (existing && existing.review_status !== "PENDING_REVIEW") {
            throw new Error("The owner has already started reviewing this audit — it can no longer be edited.");
        }

        const response = await tx.auditResponse.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                audit_date: ctx.businessDate,
                review_status: "PENDING_REVIEW",
            },
        });

        // One findMany + one createMany, not one findUnique + one create()
        // per question in a loop — a real audit has enough questions
        // (59 in this dataset) that sequential round trips inside this
        // transaction would hit the same 5s interactive-transaction
        // timeout confirmed live for the structurally identical bug in
        // weekly-stocktake.processor.ts and fridge-count.processor.ts.
        const questions = await tx.auditQuestion.findMany({ where: { audit_question_id: { in: Object.keys(answers) } } });
        const questionById = new Map(questions.map((q) => [q.audit_question_id, q]));

        const answerRows = Object.entries(answers).map(([qid, a]) => {
            const question = questionById.get(qid);
            if (!question) throw new Error(`Unknown audit question "${qid}".`);
            if (a.answer === "NA" && !question.na_allowed) throw new Error(`"${question.question_text}" does not allow N/A.`);
            if (question.evidence_required && a.answer !== "NA" && !a.evidence_photo_reference) {
                throw new Error(`"${question.question_text}" requires a photo.`);
            }
            return {
                audit_response_id: response.audit_response_id,
                audit_question_id: qid,
                staff_answer: a.answer,
                evidence_photo_reference: a.evidence_photo_reference ?? null,
            };
        });
        if (answerRows.length) await tx.auditAnswer.createMany({ data: answerRows });

        // Without this, a submitted audit had no way to ever reach the
        // owner — nothing else creates an AUDIT_REVIEW owner_action, so
        // audit_response rows just sat at PENDING_REVIEW forever with no
        // Action Inbox card pointing at them. Every other form that needs
        // owner review creates its own owner_action in its own processor
        // (see weekly-stocktake.processor.ts's STOCKTAKE_REVIEW); this one
        // just never did.
        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "AUDIT_REVIEW",
                title: `Monthly audit review — ${ctx.kiosk.kiosk_id} — ${toDateStr(ctx.businessDate)}`,
                status: "OPEN",
                priority: "NORMAL",
            },
        });
    }
}
