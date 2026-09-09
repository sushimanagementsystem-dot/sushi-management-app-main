import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { addDays } from "../../common/date.util.js";

const REQUEST_TYPES = ["KIOSK_ISSUE", "HELP_NEEDED", "FEEDBACK", "URGENT"] as const;
const DEADLINE_SETTING: Record<string, [string, number]> = {
    KIOSK_ISSUE: ["REQUEST_DEADLINE_KIOSK_ISSUE_DAYS", 3],
    HELP_NEEDED: ["REQUEST_DEADLINE_HELP_DAYS", 7],
    FEEDBACK: ["REQUEST_DEADLINE_FEEDBACK_DAYS", 14],
};

type HelpIssuePayload = {
    client_key: string;
    request_type: (typeof REQUEST_TYPES)[number];
    category?: string;
    title: string;
    details: string;
    photo?: { base64: string; mimeType: string; name: string };
    photo_reference?: string;
};

/**
 * Help / Issues — port of backend/forms/FormHelpIssue.js. Unlike every
 * other form, the original staff report is never edited by resubmission
 * — each page load gets its own client_key, so a fresh load always
 * creates a new, permanent report (a genuine retry of the same click is
 * still safe/idempotent via that same key).
 */
@Injectable()
export class HelpIssueProcessor implements SubmissionProcessor<HelpIssuePayload> {
    readonly formType = "HELP_ISSUE";
    readonly tables = [{ model: "request" }, { model: "owner_action", viaSourceSubmission: true }];

    constructor(
        private readonly upload: UploadService,
        private readonly settings: SettingsService,
    ) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<HelpIssuePayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        if (!p.request_type || !REQUEST_TYPES.includes(p.request_type)) return { valid: false, message: "Pick what kind of report this is." };
        if (!String(p.title ?? "").trim()) return { valid: false, message: "Give it a short title." };
        if (!String(p.details ?? "").trim()) return { valid: false, message: "Add details." };
        if (!p.photo?.base64) return { valid: false, message: "A photo or video is required." };
        return { valid: true };
    }

    buildKey(ctx: KeyContext<HelpIssuePayload>): string {
        return `HELP_ISSUE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<HelpIssuePayload> {
        const p = payload as HelpIssuePayload;
        const uploaded = await this.upload.save(p.photo!, kiosk.kiosk_id, "HELP_ISSUE");
        return { ...p, photo_reference: uploaded.url, photo: undefined };
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<HelpIssuePayload>): Promise<void> {
        const p = ctx.payload;
        const priority = p.request_type === "URGENT" ? "URGENT" : "NORMAL";
        const deadlineDays = await this.deadlineDays(p.request_type);
        const dueDate = addDays(ctx.businessDate, deadlineDays);

        await tx.request.create({
            data: {
                submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                user_id: ctx.submission.user_id,
                request_type: p.request_type,
                category: p.category ?? null,
                title: String(p.title).trim(),
                details: String(p.details).trim(),
                photo_reference: p.photo_reference ?? null,
                initial_priority: priority,
                owner_status: "NEW",
                due_date: dueDate,
            },
        });

        // Every request type gets an owner_action, not just URGENT — the
        // other three (KIOSK_ISSUE, HELP_NEEDED, FEEDBACK) were previously
        // written to `request` with a due_date and owner_status:"NEW" but
        // nothing ever queried that table in bulk, so they were invisible
        // in the dashboard forever (found via real E2E testing: a
        // KIOSK_ISSUE report submitted through the actual kiosk form never
        // appeared in the Action Inbox or anywhere else). Same class of
        // bug as Monthly Audit / Audit Correction earlier — a processor
        // that persists the record but never tells the owner about it.
        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "HELP_ISSUE",
                title:
                    (priority === "URGENT" ? "URGENT — " : "") + `${ctx.kiosk.kiosk_id}: ${String(p.title).trim()}`,
                status: "OPEN",
                priority,
                due_date: dueDate,
            },
        });
    }

    private async deadlineDays(requestType: string): Promise<number> {
        if (requestType === "URGENT") return 0;
        const setting = DEADLINE_SETTING[requestType];
        if (!setting) return 0;
        return (await this.settings.getNumber(setting[0])) ?? setting[1];
    }
}
