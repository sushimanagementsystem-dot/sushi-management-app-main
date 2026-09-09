import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUBMISSION_PROCESSORS, type SubmissionProcessor } from "./submission-processor.interface.js";
import type { Kiosk, Submission } from "@prisma/client";

/**
 * Fast intake half of the async pipeline — direct port of
 * backend/api/Pipeline.js's submitForm_: validate -> optional prepareIntake
 * -> resolve business date -> build the processing_key -> insert a
 * `submission` row as RECEIVED -> return. The slow half (actually writing
 * the operational rows) happens later in PipelineService's sweep.
 */
@Injectable()
export class SubmissionService {
    private readonly processorsByType: Map<string, SubmissionProcessor>;

    constructor(
        private readonly prisma: PrismaService,
        @Inject(SUBMISSION_PROCESSORS) processors: SubmissionProcessor[],
    ) {
        this.processorsByType = new Map(processors.map((p) => [p.formType, p]));
    }

    async intake(params: {
        kiosk: Kiosk;
        formType: string;
        rawPayload: unknown;
        userId: string | null;
        email: string;
    }): Promise<Submission> {
        const processor = this.processorsByType.get(params.formType);
        if (!processor) {
            throw new BadRequestException(`Unknown form type: ${params.formType}`);
        }

        const validation = processor.validate(params.rawPayload);
        if (!validation.valid) {
            throw new BadRequestException(validation.message);
        }

        const payload = processor.prepareIntake
            ? await processor.prepareIntake(params.rawPayload, params.kiosk)
            : params.rawPayload;

        const businessDate = extractBusinessDate(payload) ?? startOfTodayUtc();

        const key = processor.buildKey({
            kiosk: params.kiosk,
            payload,
            businessDate,
            userId: params.userId,
        });

        return this.prisma.submission.create({
            data: {
                kiosk_id: params.kiosk.kiosk_id,
                form_type: params.formType,
                user_id: params.userId,
                submitted_by_email: params.email,
                business_date: businessDate,
                raw_payload: payload as never,
                processing_key: key,
                processing_status: "RECEIVED",
            },
        });
    }
}

function extractBusinessDate(payload: unknown): Date | null {
    if (payload && typeof payload === "object" && "business_date" in payload) {
        const v = (payload as { business_date?: unknown }).business_date;
        if (typeof v === "string" || v instanceof Date) {
            const d = new Date(v);
            return Number.isNaN(d.getTime()) ? null : d;
        }
    }
    return null;
}

// UTC-anchored "today" — deliberately not `new Date()` truncated in local
// time, to avoid the exact off-by-one-day class of bug found in the Excel
// import pipeline's date parsing (see that audit's date-timezone finding).
function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
