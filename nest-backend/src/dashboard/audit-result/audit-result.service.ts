import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { auditFinalOutcome } from "../action-inbox/audit-review.service.js";
import { toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

/**
 * Final Audit Result — the durable, shareable view of one completed audit:
 * score, rating, every photo, and the corrective actions it produced. Not
 * tied to the Action Inbox's open/resolved lifecycle (that action closes
 * once review finishes, but the audit itself should still be reachable and
 * printable/exportable afterward) — reached by audit_response_id directly.
 * Reuses AuditReviewService's own auditFinalOutcome so a PASS/FAIL shown
 * here is computed identically to what closed out the review, never a
 * second, differently-derived number.
 */
@Injectable()
export class AuditResultService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async bootstrap(auditResponseId: string) {
        const response = await this.prisma.auditResponse.findUnique({ where: { audit_response_id: auditResponseId } });
        if (!response) throw new NotFoundException("Audit not found.");

        const [answers, correctiveActions, kiosks] = await Promise.all([
            this.prisma.auditAnswer.findMany({ where: { audit_response_id: auditResponseId } }),
            this.prisma.correctiveAction.findMany({ where: { audit_response_id: auditResponseId } }),
            this.tableCache.getAll<Kiosk>("kiosk"),
        ]);

        const questions = await this.prisma.auditQuestion.findMany({
            where: { audit_question_id: { in: answers.map((a) => a.audit_question_id) } },
        });
        const sectionIds = [...new Set(questions.map((q) => q.audit_section_id).filter((id): id is string => !!id))];
        const sections = sectionIds.length ? await this.prisma.auditSection.findMany({ where: { audit_section_id: { in: sectionIds } } }) : [];

        const questionById = new Map(questions.map((q) => [q.audit_question_id, q]));
        const sectionById = new Map(sections.map((s) => [s.audit_section_id, s]));
        const kioskName = kiosks.find((k) => k.kiosk_id === response.kiosk_id)?.name ?? response.kiosk_id;

        // Every photo, not just failed ones — "photos properly displayed"
        // means the full evidence trail, not a filtered subset.
        const photos = answers
            .filter((a) => !!a.evidence_photo_reference)
            .map((a) => {
                const q = questionById.get(a.audit_question_id);
                const outcome = q ? auditFinalOutcome(a, q) : null;
                return {
                    auditAnswerId: a.audit_answer_id,
                    url: a.evidence_photo_reference!,
                    questionText: q?.question_text ?? "",
                    sectionName: q?.audit_section_id ? sectionById.get(q.audit_section_id)?.name ?? "" : "",
                    outcome,
                };
            });

        // Only questions with a FAIL outcome, mirroring exactly which ones
        // AuditReviewService.reviewAnswer would have generated a
        // corrective_action for — "applicable corrections" the request
        // asked for, not the full pass/fail breakdown.
        const failedAnswers = answers
            .map((a) => ({ answer: a, question: questionById.get(a.audit_question_id) }))
            .filter((x): x is { answer: (typeof answers)[number]; question: NonNullable<(typeof x)["question"]> } => !!x.question)
            .filter((x) => auditFinalOutcome(x.answer, x.question) === "FAIL");

        const correctionByQuestionId = new Map(correctiveActions.map((ca) => [ca.audit_question_id, ca]));
        const corrections = failedAnswers.map(({ answer, question }) => {
            const ca = correctionByQuestionId.get(question.audit_question_id);
            return {
                questionText: question.question_text,
                sectionName: question.audit_section_id ? sectionById.get(question.audit_section_id)?.name ?? "" : "",
                critical: question.critical === true,
                ownerNote: answer.owner_note ?? "",
                status: ca?.status ?? null,
                deadline: ca?.deadline ? toDateStr(ca.deadline) : null,
                closedAt: ca?.closed_at ? toDateStr(ca.closed_at) : null,
            };
        });

        return {
            auditResponseId: response.audit_response_id,
            kioskName,
            auditDate: toDateStr(response.audit_date),
            reviewStatus: response.review_status,
            finalScore: response.final_score === null ? null : Number(response.final_score),
            finalRating: response.final_rating,
            photos,
            corrections,
        };
    }
}
