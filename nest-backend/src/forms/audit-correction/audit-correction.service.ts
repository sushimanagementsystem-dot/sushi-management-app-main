import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Kiosk } from "@prisma/client";

@Injectable()
export class AuditCorrectionService {
    constructor(private readonly prisma: PrismaService) {}

    async getBootstrapData(kiosk: Kiosk) {
        const actions = await this.prisma.correctiveAction.findMany({
            where: { kiosk_id: kiosk.kiosk_id, status: { in: ["OPEN", "REPLACEMENT_SUBMITTED"] } },
            include: { audit_question: true },
        });

        return {
            businessDate: toDateStr(startOfTodayUtc()),
            actions: actions.map((a) => ({
                id: a.corrective_action_id,
                question: a.audit_question?.question_text ?? a.audit_question_id,
                status: a.status,
                deadline: a.deadline ? toDateStr(a.deadline) : null,
            })),
        };
    }
}
