import { Injectable } from "@nestjs/common";
import type { Kiosk, Prisma } from "@prisma/client";
import type { KeyContext, ProcessingContext, SubmissionProcessor, ValidationResult } from "../submission-processor.interface.js";
import { UploadService } from "../../upload/upload.service.js";

type MoveStockLine = { stock_item_id: string; qty: number };
type MoveStockPayload = {
    client_key: string;
    source_kiosk_id?: string;
    destination_kiosk_id?: string;
    reason?: string;
    note?: string;
    lines: MoveStockLine[];
    photo?: { base64: string; mimeType: string; name: string };
    photo_reference?: string;
};

/**
 * Move Stock Between Kiosks — port of backend/forms/FormMoveStock.js.
 * Staff create a transfer REQUEST only (status PENDING) — never moves
 * stock directly. Applying an approved transfer (the balanced OUT+IN
 * stock_movement pair) is an owner-dashboard action, not this processor.
 *
 * A photo is mandatory evidence of what's actually being handed over —
 * same UploadService pattern as Damaged Product: prepareIntake() uploads
 * it and swaps the payload's raw base64 for a `photo_reference` URL before
 * the submission row is even created, so an upload failure throws out of
 * intake() and no submission (and so no stock_transfer row) is ever
 * written. One photo per request, shared by every line it contains — see
 * the schema comment on stock_transfer.photo_reference.
 */
@Injectable()
export class MoveStockProcessor implements SubmissionProcessor<MoveStockPayload> {
    readonly formType = "MOVE_STOCK";
    readonly tables = [{ model: "stock_transfer" }, { model: "owner_action", viaSourceSubmission: true }];

    constructor(private readonly upload: UploadService) {}

    validate(payload: unknown): ValidationResult {
        const p = (payload ?? {}) as Partial<MoveStockPayload>;
        if (!p.client_key) return { valid: false, message: "Missing form key — reload the page and try again." };
        if (!p.source_kiosk_id && !p.destination_kiosk_id) {
            return { valid: false, message: "Select at least one kiosk — where it's coming from, or going to." };
        }
        if (p.source_kiosk_id && p.source_kiosk_id === p.destination_kiosk_id) {
            return { valid: false, message: "Source and destination kiosks must be different." };
        }
        const lines = p.lines ?? [];
        if (!lines.length) return { valid: false, message: "Add at least one item." };
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i]!;
            if (!ln.stock_item_id || !Number.isFinite(ln.qty) || ln.qty <= 0) {
                return { valid: false, message: `Line ${i + 1}: quantity must be a number greater than 0.` };
            }
        }
        if (!p.photo?.base64) return { valid: false, message: "A photo is required." };
        return { valid: true };
    }

    buildKey(ctx: KeyContext<MoveStockPayload>): string {
        return `MOVE_STOCK|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
    }

    async prepareIntake(payload: unknown, kiosk: Kiosk): Promise<MoveStockPayload> {
        const p = payload as MoveStockPayload;
        const uploaded = await this.upload.save(p.photo!, kiosk.kiosk_id, "MOVE_STOCK");
        return { ...p, photo_reference: uploaded.url, photo: undefined };
    }

    async process(tx: Prisma.TransactionClient, ctx: ProcessingContext<MoveStockPayload>): Promise<void> {
        const p = ctx.payload;

        const source = p.source_kiosk_id ? await tx.kiosk.findFirst({ where: { kiosk_id: p.source_kiosk_id, active: true } }) : null;
        if (p.source_kiosk_id && !source) throw new Error("Unknown or inactive source kiosk.");
        const dest = p.destination_kiosk_id ? await tx.kiosk.findFirst({ where: { kiosk_id: p.destination_kiosk_id, active: true } }) : null;
        if (p.destination_kiosk_id && !dest) throw new Error("Unknown or inactive destination kiosk.");
        if (source && dest && source.kiosk_id === dest.kiosk_id) throw new Error("Source and destination kiosks must be different.");

        const lineSummaries: string[] = [];
        for (const line of p.lines) {
            const item = await tx.stockItem.findUnique({ where: { stock_item_id: line.stock_item_id } });
            if (!item) throw new Error(`Unknown stock item "${line.stock_item_id}".`);

            await tx.stockTransfer.create({
                data: {
                    submission_id: ctx.submission.submission_id,
                    source_kiosk_id: source?.kiosk_id,
                    destination_kiosk_id: dest?.kiosk_id,
                    stock_item_id: item.stock_item_id,
                    qty: line.qty,
                    count_unit: item.count_unit,
                    reason: p.reason ?? null,
                    note: String(p.note ?? "").trim() || null,
                    user_id: ctx.submission.user_id,
                    status: "PENDING",
                    photo_reference: p.photo_reference ?? null,
                },
            });
            lineSummaries.push(`${line.qty} ${item.count_unit} ${item.name}`);
        }

        await tx.ownerAction.create({
            data: {
                source_submission_id: ctx.submission.submission_id,
                kiosk_id: ctx.kiosk.kiosk_id,
                category: "TRANSFER_APPROVAL",
                title: `Transfer request: ${lineSummaries.length} item(s) — ${source?.kiosk_id ?? "?"} -> ${dest?.kiosk_id ?? "?"}`,
                status: "OPEN",
                priority: "NORMAL",
                owner_note: lineSummaries.join("; "),
            },
        });
    }
}
