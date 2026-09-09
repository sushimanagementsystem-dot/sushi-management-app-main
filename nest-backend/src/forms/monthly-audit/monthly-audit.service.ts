import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { AuditQuestion, AuditSection, Kiosk } from "@prisma/client";

@Injectable()
export class MonthlyAuditService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData(kiosk: Kiosk) {
        const businessDate = startOfTodayUtc();

        // Fetched together even though the locked branch below doesn't need
        // sections/questions — they're cached (near-free after the first
        // hit) and fetching them speculatively avoids a second sequential
        // round trip on the common (unlocked) path.
        const [existingHeader, allSections, allQuestions] = await Promise.all([
            this.prisma.auditResponse.findFirst({ where: { kiosk_id: kiosk.kiosk_id, audit_date: businessDate } }),
            this.tableCache.getAll<AuditSection>("audit_section"),
            this.tableCache.getAll<AuditQuestion>("audit_question"),
        ]);

        if (existingHeader && existingHeader.review_status !== "PENDING_REVIEW") {
            return {
                businessDate: toDateStr(businessDate),
                locked: true,
                lockedReason: "The owner has already started reviewing today's audit — it can no longer be edited here.",
            };
        }

        const sections = [...allSections].sort((a, b) => a.sort_order - b.sort_order);
        const questions = allQuestions.filter((q) => q.active);

        const existingAnswers: Record<string, { answer: string; evidencePhotoReference: string | null }> = {};
        if (existingHeader) {
            const answers = await this.prisma.auditAnswer.findMany({ where: { audit_response_id: existingHeader.audit_response_id } });
            for (const a of answers) {
                existingAnswers[a.audit_question_id] = { answer: a.staff_answer, evidencePhotoReference: a.evidence_photo_reference };
            }
        }

        return {
            businessDate: toDateStr(businessDate),
            locked: false,
            sections: sections.map((s) => ({ id: s.audit_section_id, name: s.name })),
            questions: questions.map((q) => ({
                id: q.audit_question_id,
                sectionId: q.audit_section_id,
                text: q.question_text,
                naAllowed: q.na_allowed,
                evidenceRequired: q.evidence_required,
                critical: q.critical,
            })),
            existingAnswers,
            alreadySubmitted: !!existingHeader,
        };
    }
}
