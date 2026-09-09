import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { OwnerActionStateService } from "./owner-action-state.service.js";
import { addDays } from "../../common/date.util.js";
import type { AuditAnswer, AuditQuestion } from "@prisma/client";

const ANSWER_DECISIONS = ["ACCEPT", "OVERRIDE_PASS", "OVERRIDE_FAIL", "EVIDENCE_INSUFFICIENT"];

/**
 * Final pass/fail/NA outcome for one audit_answer, given its question. NA
 * questions are excluded from scoring entirely, regardless of decision.
 * OVERRIDE_PASS/OVERRIDE_FAIL are explicit; ACCEPT inherits the staff
 * answer's own pass/fail (compared against pass_answer); no decision yet
 * returns null (not yet reviewed).
 */
export function auditFinalOutcome(answer: Pick<AuditAnswer, "staff_answer" | "owner_decision">, question: Pick<AuditQuestion, "pass_answer">): "PASS" | "FAIL" | "NA" | null {
    if (answer.staff_answer === "NA") return "NA";
    if (!answer.owner_decision) return null;
    if (answer.owner_decision === "OVERRIDE_PASS") return "PASS";
    if (answer.owner_decision === "OVERRIDE_FAIL" || answer.owner_decision === "EVIDENCE_INSUFFICIENT") return "FAIL";
    if (answer.owner_decision === "ACCEPT") {
        // Case-insensitive on purpose — staff_answer is always the
        // uppercase "YES"/"NO" enum from the submit payload, but
        // audit_question.pass_answer is free-text reference data (seeded
        // as "Yes"/"No"). An exact-match compare here meant every single
        // correctly-answered question scored as FAIL, so a fully-compliant
        // audit scored 0% — found via a real audit submitted and reviewed
        // end-to-end through the actual kiosk/dashboard UI.
        return answer.staff_answer.toUpperCase() === String(question.pass_answer).toUpperCase() ? "PASS" : "FAIL";
    }
    return null;
}

@Injectable()
export class AuditReviewService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly settings: SettingsService,
        private readonly ownerActionState: OwnerActionStateService,
    ) {}

    /**
     * Owner reviews one audit_answer. Per spec §18.1, each owner-confirmed
     * failure automatically creates one corrective_action (deadline from the
     * AUDIT_CRITICAL_CORRECTION_DAYS/AUDIT_CORRECTION_DAYS settings, default
     * 2 days if the question is critical, else 7) — idempotent, checked by
     * existing audit_response_id+audit_question_id pair. Once every answer
     * on the response has a decision, computes final_score/final_rating
     * (weighted % of PASS questions, NA excluded) against the
     * AUDIT_PASS_PCT/AUDIT_ATTENTION_PCT settings (default 90%/80%) and
     * resolves the AUDIT_REVIEW action; otherwise just fires the
     * IN_PROGRESS transition.
     */
    async reviewAnswer(auditAnswerId: string, decision: string, note: string | undefined, reviewedBy: string): Promise<void> {
        if (!ANSWER_DECISIONS.includes(decision)) throw new BadRequestException("Unknown decision.");
        if ((decision === "OVERRIDE_FAIL" || decision === "EVIDENCE_INSUFFICIENT") && !String(note || "").trim()) {
            throw new BadRequestException("A note is required when overriding to fail or marking evidence insufficient.");
        }

        const answer = await this.prisma.auditAnswer.findUnique({ where: { audit_answer_id: auditAnswerId } });
        if (!answer) throw new NotFoundException("Answer not found.");
        const question = await this.prisma.auditQuestion.findUnique({ where: { audit_question_id: answer.audit_question_id } });
        if (!question) throw new NotFoundException("Question not found.");
        const response = await this.prisma.auditResponse.findUnique({ where: { audit_response_id: answer.audit_response_id } });
        if (!response) throw new NotFoundException("Audit response not found.");

        const [criticalDays, defaultDays, passPct, attentionPct] = await Promise.all([
            this.settings.getNumber("AUDIT_CRITICAL_CORRECTION_DAYS"),
            this.settings.getNumber("AUDIT_CORRECTION_DAYS"),
            this.settings.getNumber("AUDIT_PASS_PCT"),
            this.settings.getNumber("AUDIT_ATTENTION_PCT"),
        ]);

        await this.prisma.$transaction(async (tx) => {
            await tx.auditAnswer.update({ where: { audit_answer_id: auditAnswerId }, data: { owner_decision: decision, owner_note: note || null } });

            const decidedAnswer = { ...answer, owner_decision: decision };
            if (auditFinalOutcome(decidedAnswer, question) === "FAIL") {
                const already = await tx.correctiveAction.findFirst({
                    where: { audit_response_id: answer.audit_response_id, audit_question_id: answer.audit_question_id },
                });
                if (!already) {
                    await tx.correctiveAction.create({
                        data: {
                            audit_response_id: answer.audit_response_id,
                            audit_question_id: answer.audit_question_id,
                            kiosk_id: response.kiosk_id,
                            status: "OPEN",
                            deadline: addDays(new Date(), question.critical ? (criticalDays ?? 2) : (defaultDays ?? 7)),
                        },
                    });
                }
            }

            const questions = await tx.auditQuestion.findMany();
            const questionsById = new Map(questions.map((q) => [q.audit_question_id, q]));
            const allAnswers = await tx.auditAnswer.findMany({ where: { audit_response_id: answer.audit_response_id } });
            const allDecided = allAnswers.every((a) => (a.audit_answer_id === auditAnswerId ? true : !!a.owner_decision));

            const action = await this.ownerActionState.findOwnerAction(tx, response.submission_id, "AUDIT_REVIEW");

            if (allDecided) {
                let passWeight = 0;
                let totalWeight = 0;
                for (const a of allAnswers) {
                    const effective = a.audit_answer_id === auditAnswerId ? decidedAnswer : a;
                    const q = questionsById.get(a.audit_question_id);
                    if (!q) continue;
                    const outcome = auditFinalOutcome(effective, q);
                    if (outcome === "NA" || !outcome) continue;
                    const w = Number(q.weight) || 1;
                    totalWeight += w;
                    if (outcome === "PASS") passWeight += w;
                }
                const scorePct = totalWeight > 0 ? Math.round((passWeight / totalWeight) * 10000) / 100 : 0;
                const rating = scorePct >= (passPct ?? 90) ? "PASS" : scorePct >= (attentionPct ?? 80) ? "ATTENTION" : "ACTION_REQUIRED";
                await tx.auditResponse.update({
                    where: { audit_response_id: response.audit_response_id },
                    data: { review_status: "FULLY_REVIEWED", final_score: scorePct, final_rating: rating },
                });
                if (action) await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: true, note: "audit fully reviewed" });
            } else {
                await tx.auditResponse.update({ where: { audit_response_id: response.audit_response_id }, data: { review_status: "PARTIALLY_REVIEWED" } });
                if (action) await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, { complete: false, note: "audit answer reviewed" });
            }
        });
    }

    /**
     * Owner reviews replacement evidence for one corrective_action. Accept
     * closes it for good; Reject leaves it OPEN so the kiosk must resubmit
     * — that next audit_correction submission's own correction_cycle
     * increments automatically (unrelated to this call), and a new
     * AUDIT_CORRECTION_REVIEW action is what continues the loop, not this
     * one staying open indefinitely.
     */
    async reviewCorrection(auditCorrectionId: string, decision: string, reviewedBy: string): Promise<void> {
        if (decision !== "ACCEPT" && decision !== "REJECT") throw new BadRequestException("Unknown decision.");

        const correction = await this.prisma.auditCorrection.findUnique({ where: { audit_correction_id: auditCorrectionId } });
        if (!correction) throw new NotFoundException("Correction not found.");

        await this.prisma.$transaction(async (tx) => {
            await tx.correctiveAction.update({
                where: { corrective_action_id: correction.corrective_action_id },
                data: { status: decision === "ACCEPT" ? "CLOSED" : "OPEN", closed_at: decision === "ACCEPT" ? new Date() : null },
            });

            const action = await this.ownerActionState.findOwnerAction(tx, correction.submission_id, "AUDIT_CORRECTION_REVIEW");
            if (action) {
                await this.ownerActionState.logActivity(
                    tx,
                    action.owner_action_id,
                    reviewedBy,
                    "corrective_action.status",
                    "REPLACEMENT_SUBMITTED",
                    decision === "ACCEPT" ? "CLOSED" : "OPEN",
                );
                await this.ownerActionState.advanceOwnerActionOnAction(tx, action.owner_action_id, {
                    complete: true,
                    note: `audit correction ${decision.toLowerCase()}d`,
                });
            }
        });
    }
}
