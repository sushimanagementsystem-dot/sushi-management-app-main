import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service.js";
import { SUBMISSION_PROCESSORS, type ProcessingContext, type SubmissionProcessor } from "./submission-processor.interface.js";
import { toModelName } from "../common/model-name.util.js";
import { MailerService } from "../mailer/mailer.service.js";
import type { Prisma, Submission } from "@prisma/client";

/**
 * The slow half of the pipeline — port of backend/api/Pipeline.js's
 * processPendingSubmissions/processSubmission_. Triggered two ways,
 * matching the old system: the relay-called `process_now` action right
 * after a real submit (see PipelineController), and this cron as the
 * fallback if that nudge is ever missed.
 */
@Injectable()
export class PipelineService {
    private readonly logger = new Logger(PipelineService.name);
    private readonly processorsByType: Map<string, SubmissionProcessor>;

    constructor(
        private readonly prisma: PrismaService,
        private readonly mailer: MailerService,
        @Inject(SUBMISSION_PROCESSORS) processors: SubmissionProcessor[],
    ) {
        this.processorsByType = new Map(processors.map((p) => [p.formType, p]));
    }

    @Cron(CronExpression.EVERY_10_MINUTES)
    async scheduledSweep() {
        await this.sweep();
    }

    async sweep(): Promise<{ processed: number }> {
        const pending = await this.prisma.submission.findMany({
            where: { processing_status: { in: ["RECEIVED", "RETRY_REQUIRED"] } },
            orderBy: { submitted_at: "asc" },
        });
        this.logger.log(`Sweep: ${pending.length} pending submission(s)`);

        let processed = 0;
        for (const submission of pending) {
            const claimed = await this.claim(submission.submission_id);
            if (!claimed) {
                this.logger.log(`Sweep: ${submission.submission_id} already claimed, skipping`);
                continue;
            }
            await this.processOne(submission);
            processed++;
        }
        return { processed };
    }

    /** Atomic RECEIVED/RETRY_REQUIRED -> PROCESSING flip (double-run guard). */
    private async claim(submissionId: string): Promise<boolean> {
        const result = await this.prisma.submission.updateMany({
            where: { submission_id: submissionId, processing_status: { in: ["RECEIVED", "RETRY_REQUIRED"] } },
            data: { processing_status: "PROCESSING" },
        });
        return result.count === 1;
    }

    private async processOne(submission: Submission): Promise<void> {
        const processor = this.processorsByType.get(submission.form_type);
        let stage = "init";

        try {
            if (!processor) throw new Error(`No processor for form type "${submission.form_type}"`);

            const kiosk = await this.prisma.kiosk.findUnique({ where: { kiosk_id: submission.kiosk_id } });
            if (!kiosk) throw new Error(`Unknown kiosk "${submission.kiosk_id}"`);

            let written = false;
            const ctx: ProcessingContext = {
                submission,
                kiosk,
                payload: submission.raw_payload,
                businessDate: submission.business_date ?? new Date(),
                stage,
                extra: {},
            };

            let status = await this.prisma.$transaction(async (tx) => {
                stage = "clear previous rows";
                ctx.stage = stage;
                written = (await this.clearPriorAttempts(tx, processor, submission)) || written;

                stage = "process";
                ctx.stage = stage;
                const result = await processor.process(tx, ctx);
                return result || "PROCESSED";
            });

            // Deliberately outside the transaction — real I/O (email) must
            // never hold a DB transaction open. The data write above has
            // already committed either way, so a failure here can only
            // downgrade the status, never roll anything back or flip to
            // ERROR (see afterCommit's own doc).
            if (processor.afterCommit) {
                ctx.stage = "afterCommit";
                const override = await processor.afterCommit(ctx);
                if (override?.status) status = override.status;
            }

            await this.prisma.submission.update({
                where: { submission_id: submission.submission_id },
                data: { processing_status: status },
            });
            this.logger.log(`Processed ${submission.form_type} ${submission.submission_id} -> ${status}`);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Processing FAILED ${submission.form_type} ${submission.submission_id} at stage "${stage}": ${message}`);
            await this.logFailure(submission, stage, message);
        }
    }

    /**
     * A resubmit shares the same processing_key as its earlier attempt(s) —
     * clear whatever those wrote before this attempt writes fresh rows.
     * Mirrors processSubmission_'s oldIds lookup + per-table delete.
     */
    private async clearPriorAttempts(
        tx: Prisma.TransactionClient,
        processor: SubmissionProcessor,
        submission: Submission,
    ): Promise<boolean> {
        if (!submission.processing_key) return false;

        const priorSubmissions = await tx.submission.findMany({
            where: { processing_key: submission.processing_key, submission_id: { not: submission.submission_id } },
            select: { submission_id: true },
        });
        if (priorSubmissions.length === 0) return false;
        const oldIds = priorSubmissions.map((s) => s.submission_id);

        if (processor.clearExtra) {
            await processor.clearExtra(tx, oldIds); // may throw to block the resubmit entirely
        }

        let anyDeleted = false;
        for (const table of processor.tables) {
            const delegate = (tx as unknown as Record<string, { deleteMany: (args: unknown) => Promise<{ count: number }> }>)[
                toModelName(table.model)
            ];
            const where = table.viaSourceSubmission
                ? { source_submission_id: { in: oldIds } }
                : { submission_id: { in: oldIds } };
            const result = await delegate.deleteMany({ where });
            if (result.count > 0) anyDeleted = true;
        }
        return anyDeleted;
    }

    /** Developer-facing only — records the failure for manual retry, never surfaced to staff/owner. */
    private async logFailure(submission: Submission, stage: string, message: string): Promise<void> {
        await this.prisma.submission.update({
            where: { submission_id: submission.submission_id },
            data: { processing_status: "ERROR" },
        });
        const errorLog = await this.prisma.processingErrorLog.create({
            data: {
                kiosk_id: submission.kiosk_id,
                form_type: submission.form_type,
                submission_id: submission.submission_id,
                processing_key: submission.processing_key,
                stage,
                error_message: message,
                recommended_action: "Fix the cause, then set processing_status to RETRY_REQUIRED (or resubmit the form).",
                retry_status: "PENDING",
            },
        });

        await this.notifyDevelopers(
            `[Sushi Kiosk] Processing failed — ${submission.form_type} — ${submission.kiosk_id}`,
            `error_id: ${errorLog.error_id}\n` +
                `submission_id: ${submission.submission_id}\n` +
                `form_type: ${submission.form_type}\n` +
                `stage: ${stage}\n\n` +
                message,
        );
    }

    /** Plain-text alert to active DEVELOPER-role users — port of
     * backend/api/Pipeline.js's notifyDevelopers_. Best-effort, never throws
     * (a notification failure must never turn a logged, already-recorded
     * processing failure into an unhandled exception). */
    private async notifyDevelopers(subject: string, body: string): Promise<void> {
        try {
            const devs = await this.prisma.user.findMany({
                where: { active: true, role: "DEVELOPER" },
                select: { email: true },
            });
            const emails = devs.map((d) => d.email).filter(Boolean);
            if (!emails.length) {
                this.logger.warn(`No active DEVELOPER user to notify: ${subject}`);
                return;
            }
            await this.mailer.sendMail({
                to: emails.join(","),
                subject,
                html: `<pre style="font-family:monospace;white-space:pre-wrap">${body.replace(/</g, "&lt;")}</pre>`,
            });
        } catch (err) {
            this.logger.error(`Failed to notify developers: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
