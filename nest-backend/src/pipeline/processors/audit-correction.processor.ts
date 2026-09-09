import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";

type AuditCorrectionPayload = {
    client_key: string;
    corrective_action_id: string;
    correction_note: string;
    photo?: { base64: string; mimeType: string; name: string };
    replacement_photo_reference?: string;
};

/**
 * Audit Corrections — port of backend/forms/FormAuditCorrection.js. Moves
 * a corrective_action to owner review (status -> REPLACEMENT_SUBMITTED) —
 * workflow state, not a judgment call; NEVER closes the action, only the
 * owner does. Each attempt is its own permanent record (client_key, not
 * resubmission-editable, same as Help/Issues).
 *
 * NOTE: the old system's column is corrective_action's/audit_correction's
 * `user_id` — this schema currently names the equivalent FK
 * `staff_member_id`. Using the schema's real field name below; flagging
 * the rename (to match the source data exactly, per this schema's own
 * stated snake_case-mirrors-Excel principle) as a decision for you.
 */
@Injectable()
export class AuditCorrectionProcessor implements SubmissionProcessor<AuditCorrectionPayload> {
    readonly formType = "AUDIT_CORRECTION";
    readonly tables = [{ model: "audit_correction" }];

    constructor(private readonly upload: UploadService) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<AuditCorrectionPayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        if (!p.corrective_action_id) return { valid: false, message: "Select which action this fixes." };
        if (!String(p.correction_note ?? "").trim()) return { valid: false, message: "Explain what was fixed." };
        if (!p.photo?.base64) return { valid: false, message: "Replacement evidence photo is required." };
        return { valid: true };
    }

    buildKey(ctx: KeyContext<AuditCorrectionPayload>): string {
        return `AUDIT_CORRECTION|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<AuditCorrectionPayload> {
        const p = payload as AuditCorrectionPayload;
        const uploaded = await this.upload.save(p.photo!, kiosk.kiosk_id, "AUDIT_CORRECTION");
        return { ...p, replacement_photo_reference: uploaded.url, photo: undefined };
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<AuditCorrectionPayload>): Promise<string> {
        const p = ctx.payload;
        const action = await tx.correctiveAction.findUnique({ where: { corrective_action_id: p.corrective_action_id } });

        let validationStatus: string;
        if (!action) validationStatus = "INVALID_ACTION_NOT_FOUND";
        else if (action.kiosk_id !== ctx.kiosk.kiosk_id) validationStatus = "INVALID_WRONG_KIOSK";
        else if (action.status === "CLOSED") validationStatus = "INVALID_ACTION_CLOSED";
        else validationStatus = "VALID";

        const priorCycles = action ? await tx.auditCorrection.count({ where: { corrective_action_id: action.corrective_action_id } }) : 0;

        await tx.auditCorrection.create({
            data: {
                submission_id: ctx.submission.submission_id,
                corrective_action_id: action?.corrective_action_id ?? p.corrective_action_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                staff_member_id: ctx.submission.user_id,
                correction_cycle: priorCycles + 1,
                correction_note: String(p.correction_note).trim(),
                replacement_photo_reference: p.replacement_photo_reference ?? null,
                validation_status: validationStatus,
            },
        });

        if (validationStatus !== "VALID" || !action) return "REJECTED";

        await tx.correctiveAction.update({
            where: { corrective_action_id: action.corrective_action_id },
            data: { status: "REPLACEMENT_SUBMITTED" },
        });

        // Without this, a validly-submitted correction had nowhere for the
        // owner to see it — AuditReviewService.reviewCorrection() looks up
        // an AUDIT_CORRECTION_REVIEW owner_action by this exact submission's
        // id, but nothing ever created one, so replacement evidence
        // silently vanished into REPLACEMENT_SUBMITTED with no way to
        // review/accept/reject it. Every other reviewable form (stock
        // transfer, delivery invoice, damage, help/issue) creates its
        // owner_action here in its own processor; this one just never did.
        const question = await tx.auditQuestion.findUnique({ where: { audit_question_id: action.audit_question_id } });
        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "AUDIT_CORRECTION_REVIEW",
                title: `Audit correction — ${ctx.kiosk.kiosk_id} — ${question?.question_text ?? action.audit_question_id}`,
                status: "OPEN",
                priority: "NORMAL",
            },
        });

        return "PROCESSED";
    }
}
