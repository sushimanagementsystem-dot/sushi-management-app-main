import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma, StockItem } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { UploadService } from "../upload/upload.service.js";
import { loadStocktakeItems } from "../common/stocktake-items.util.js";
import { AnthropicConfigService } from "./anthropic-config.service.js";

/** Non-streaming ceiling that stays under HTTP timeouts. Adaptive thinking spends from the same
 * budget as the JSON answer, so the old 4096 could run out before a long invoice's JSON finished. */
const EXTRACT_MAX_TOKENS = 16000;
const IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // Claude's per-image limit

export type ExtractedLine = { description_raw: string; supplier_item_code: string; qty: number; unit_cost: number; line_total: number };
export type ResolvedLine = ExtractedLine & { stock_item_id: string | null };
/** One uploaded page — `url` is the /uploads/<id> path stored on delivery_file.drive_file_id. */
export type InvoiceFileRef = { url: string; page: number | null };
export type ExtractionResult = { ok: true; lines: ResolvedLine[] } | { ok: false; error: string };
export type ExtractionSummary = { ranOk: boolean; lineCount: number; errorSummary: string };

const NOT_SET_UP = "AI extraction is not set up yet: an owner needs to add the Anthropic API key under Dashboard → Site Configuration → AI (Claude). Enter this invoice manually, then use Re-run AI extraction once the key is added.";

/** A failure whose message is already written for the owner — passed through as-is. */
class InvoiceAiError extends Error {}

/** Text the system itself writes into owner_note / ai_error when AI fails — never something an owner typed. */
export const AUTO_AI_NOTE = /authentication_error|x-api-key|Claude response|Claude declined|AI extraction is|AI service|reach the AI|AI returned|can't be read by AI|no longer on the server/i;

/**
 * AI extraction + stock-item matching for Delivery Invoices — port of
 * backend/forms/InvoiceAI.js. Vendor: Claude API, via the official Node SDK.
 *
 * Split in two on purpose: extract() is pure network I/O (can take 10-40s)
 * and touches the database only through plain reads, so it runs BEFORE the
 * pipeline's transaction opens (see SubmissionProcessor.prepare) — Prisma's
 * interactive transactions expire after 5s, so a vision call inside one
 * would kill the whole submission. persist() is then just quick writes.
 *
 * extract() never throws — a vendor/network/parse error comes back as
 * { ok: false, error } in words an owner can act on, so it can never abort
 * the submission (old spec: "do not block the entire delivery system").
 */
@Injectable()
export class InvoiceAiService {
    private readonly logger = new Logger(InvoiceAiService.name);
    private api: Anthropic | null = null;
    private apiKey: string | null = null;

    constructor(
        private readonly aiConfig: AnthropicConfigService,
        private readonly upload: UploadService,
        private readonly prisma: PrismaService,
    ) {}

    /** The client + model to use right now. The key comes from Site Configuration (or the environment) at call
     * time, not boot time — so an owner saving a new key applies to the very next invoice, no restart. */
    private async claude(): Promise<{ api: Anthropic; model: string }> {
        const { apiKey, model } = await this.aiConfig.resolve();
        if (!apiKey) throw new InvoiceAiError(NOT_SET_UP);
        if (!this.api || this.apiKey !== apiKey) {
            this.api = this.aiConfig.createClient(apiKey);
            this.apiKey = apiKey;
        }
        return { api: this.api, model };
    }

    /** Reads every page with Claude, then resolves each line to a stock item. No transaction needed. */
    async extract(files: InvoiceFileRef[], supplierId: string | null): Promise<ExtractionResult> {
        try {
            const extracted = await this.extractLines(files);
            const lines = await this.resolveStockItems(extracted, supplierId);
            return { ok: true, lines };
        } catch (err) {
            const error = describeError(err);
            this.logger.warn(`Invoice extraction failed: ${error}`);
            return { ok: false, error };
        }
    }

    /**
     * Writes an extraction result — DRAFT invoice_line rows plus each file's
     * ai_status/ai_error. Only quick database writes, safe inside a
     * transaction; returns what the caller needs to phrase the owner_action.
     */
    async persist(tx: Prisma.TransactionClient, headerId: string, deliveryFileIds: string[], result: ExtractionResult): Promise<ExtractionSummary> {
        if (result.ok) {
            for (const line of result.lines) {
                await tx.invoiceLine.create({
                    data: {
                        delivery_header_id: headerId,
                        stock_item_id: line.stock_item_id,
                        supplier_item_code: line.supplier_item_code || null,
                        description_raw: line.description_raw || null,
                        qty: line.qty || 0,
                        unit_cost: line.unit_cost || null,
                        line_total: line.line_total || null,
                        source: "AI_EXTRACTED",
                        status: "DRAFT",
                    },
                });
            }
            await tx.deliveryFile.updateMany({ where: { delivery_file_id: { in: deliveryFileIds } }, data: { ai_status: "SUCCESS", ai_error: null } });
        } else {
            await tx.deliveryFile.updateMany({
                where: { delivery_file_id: { in: deliveryFileIds } },
                data: { ai_status: "FAILED", ai_error: result.error.slice(0, 500) },
            });
        }
        return { ranOk: result.ok, lineCount: result.ok ? result.lines.length : 0, errorSummary: result.ok ? "" : result.error.slice(0, 200) };
    }

    /**
     * Owner-triggered re-run for an invoice still IN_REVIEW — the fix for
     * invoices whose first attempt failed (bad key, outage): the AI is run
     * again on the files already stored, replacing only the untouched AI
     * draft lines. Lines the owner typed or corrected, and anything already
     * approved, are never touched.
     */
    async reextract(deliveryHeaderId: string): Promise<{ aiOk: boolean; lineCount: number; aiError: string }> {
        const header = await this.prisma.deliveryHeader.findUnique({ where: { delivery_header_id: deliveryHeaderId } });
        if (!header) throw new NotFoundException("Delivery not found.");
        if (header.status !== "IN_REVIEW") throw new BadRequestException("This invoice has already been reviewed, so AI can't be re-run on it.");

        const fileRows = await this.prisma.deliveryFile.findMany({ where: { delivery_header_id: deliveryHeaderId } });
        const refs = fileRows.filter((f) => f.drive_file_id).map((f) => ({ url: f.drive_file_id!, page: f.page_sequence }));

        const result = await this.extract(refs, header.supplier_id);

        await this.prisma.$transaction(async (tx) => {
            if (result.ok) {
                await tx.invoiceLine.deleteMany({ where: { delivery_header_id: deliveryHeaderId, source: "AI_EXTRACTED", status: "DRAFT" } });
            }
            const summary = await this.persist(tx, deliveryHeaderId, fileRows.map((f) => f.delivery_file_id), result);

            const action = header.submission_id ? await tx.ownerAction.findFirst({ where: { source_submission_id: header.submission_id, category: "INVOICE_REVIEW" } }) : null;
            if (action) {
                const remaining = await tx.invoiceLine.count({ where: { delivery_header_id: deliveryHeaderId, status: "DRAFT" } });
                await tx.ownerAction.update({
                    where: { owner_action_id: action.owner_action_id },
                    data: {
                        title: invoiceReviewTitle(summary.ranOk, remaining),
                        // Only ever clears the system's own error text — a note the owner typed is left alone.
                        ...(result.ok && action.owner_note && AUTO_AI_NOTE.test(action.owner_note) ? { owner_note: null } : {}),
                    },
                });
            }
        });

        // aiOk, not ok: the response envelope owns `ok` (request succeeded); this says whether the AI read the invoice.
        return result.ok ? { aiOk: true, lineCount: result.lines.length, aiError: "" } : { aiOk: false, lineCount: 0, aiError: result.error };
    }

    /** Sends every page as an image/document content block (page order), one
     * request, output_config.format constraining the response to valid JSON. */
    private async extractLines(files: InvoiceFileRef[]): Promise<ExtractedLine[]> {
        const sorted = [...files].sort((a, b) => (a.page ?? 0) - (b.page ?? 0));

        const content: Anthropic.Messages.ContentBlockParam[] = [];
        for (const [i, f] of sorted.entries()) {
            const label = `Page ${f.page ?? i + 1}`;
            let file;
            try {
                file = await this.upload.read(f.url);
            } catch (err) {
                if (err instanceof NotFoundException) throw new InvoiceAiError(`${label}: the uploaded file is no longer on the server, so AI can't read it. Enter this invoice manually.`);
                throw err;
            }
            const data = file.buffer.toString("base64");
            if (file.mimeType === "application/pdf") {
                content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
            } else if ((IMAGE_MEDIA_TYPES as readonly string[]).includes(file.mimeType)) {
                if (file.buffer.length > MAX_IMAGE_BYTES) throw new InvoiceAiError(`${label}: the photo is over 5 MB, too large for AI to read. Enter this invoice manually.`);
                content.push({ type: "image", source: { type: "base64", media_type: file.mimeType as ImageMediaType, data } });
            } else {
                throw new InvoiceAiError(`${label}: ${file.mimeType || "this file type"} can't be read by AI (photos and PDFs only).`);
            }
        }
        if (!content.length) throw new InvoiceAiError("No uploaded pages to read.");

        content.push({
            type: "text",
            text: "Extract every line item from this delivery invoice or delivery note. The pages may be phone photos (tilted, creased, in shadow) and belong to ONE document in page order — do not repeat a line that continues across pages. For each line, give the raw description exactly as printed, the supplier's own item code if one is printed (empty string if none), quantity, unit cost, and line total. If a numeric value is not printed or not legible, use 0 rather than guessing. Do not include tax, subtotal, or total summary rows as line items.",
        });

        const { api, model } = await this.claude();
        const message = await api.messages.create({
            model,
            max_tokens: EXTRACT_MAX_TOKENS,
            messages: [{ role: "user", content }],
            output_config: {
                format: {
                    type: "json_schema",
                    schema: {
                        type: "object",
                        properties: {
                            lines: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        description_raw: { type: "string" },
                                        supplier_item_code: { type: "string" },
                                        qty: { type: "number" },
                                        unit_cost: { type: "number" },
                                        line_total: { type: "number" },
                                    },
                                    required: ["description_raw", "supplier_item_code", "qty", "unit_cost", "line_total"],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ["lines"],
                        additionalProperties: false,
                    },
                },
            },
        });

        if (message.stop_reason === "refusal") throw new InvoiceAiError("AI declined to read this document. Enter it manually.");
        if (message.stop_reason === "max_tokens") throw new InvoiceAiError("AI ran out of room reading this invoice (it is very long). Enter it manually, or split it into smaller uploads.");
        const block = message.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new InvoiceAiError("AI returned an unreadable answer. Use Re-run AI extraction, or enter the invoice manually.");

        let parsed: { lines?: unknown };
        try {
            parsed = JSON.parse(block.text);
        } catch {
            throw new InvoiceAiError("AI returned an unreadable answer. Use Re-run AI extraction, or enter the invoice manually.");
        }
        const raw = Array.isArray(parsed.lines) ? parsed.lines : [];
        // The schema guarantees shape; this only guards numbers against NaN/negative garbage so a bad read can't poison the draft.
        return raw.map((l: Partial<Record<keyof ExtractedLine, unknown>>) => ({
            description_raw: String(l.description_raw ?? "").trim(),
            supplier_item_code: String(l.supplier_item_code ?? "").trim(),
            qty: nonNegative(l.qty),
            unit_cost: nonNegative(l.unit_cost),
            line_total: nonNegative(l.line_total),
        }));
    }

    /**
     * Decides each line's stock item. Cheap deterministic tiers first
     * (supplier's own code/description map, then an exact name match); only
     * the lines still unresolved go to Claude, together in ONE request — the
     * stock catalog is sent once per invoice, not once per line.
     */
    private async resolveStockItems(lines: ExtractedLine[], supplierId: string | null): Promise<ResolvedLine[]> {
        if (!lines.length) return [];
        // Only the Stock Take list: a Food Waste (per 100g) "Salmon" must never win a match for an invoice line.
        const stockItems = await loadStocktakeItems(this.prisma);
        const maps = supplierId ? await this.prisma.supplierItemMap.findMany({ where: { supplier_id: supplierId, active: true } }) : [];

        const resolved: ResolvedLine[] = lines.map((line) => ({ ...line, stock_item_id: this.matchDeterministic(line, maps, stockItems) }));

        const unresolved = resolved.map((line, index) => ({ line, index })).filter((r) => r.line.stock_item_id === null && r.line.description_raw);
        if (unresolved.length && stockItems.length) {
            try {
                const answers = await this.matchViaAi(unresolved.map((r) => r.line), stockItems);
                unresolved.forEach((r, i) => {
                    r.line.stock_item_id = answers[i] ?? null;
                });
            } catch (e) {
                // Matching is a convenience — the owner can pick a stock item by hand — so it must never lose the extracted lines.
                this.logger.warn(`AI stock matching failed (lines left unmatched): ${e instanceof Error ? e.message : e}`);
            }
        }
        return resolved;
    }

    private matchDeterministic(line: ExtractedLine, maps: { supplier_code: string | null; supplier_description: string | null; stock_item_id: string }[], stockItems: StockItem[]): string | null {
        const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

        const code = norm(line.supplier_item_code);
        const byCode = code ? maps.find((m) => norm(m.supplier_code) === code) : undefined;
        if (byCode) return byCode.stock_item_id;

        const desc = norm(line.description_raw);
        if (!desc) return null;
        const byDesc = maps.find((m) => norm(m.supplier_description) === desc);
        if (byDesc) return byDesc.stock_item_id;

        // Exact name only. A substring hit ("RICE" inside "RICE PAPER") is a guess, and used to be
        // returned below the confidence bar — which stopped the AI tier from ever running for that line.
        return stockItems.find((it) => norm(it.name) === desc)?.stock_item_id ?? null;
    }

    /** One request for all unresolved lines; output_config constrains each answer to the ids that really
     * exist (plus "NONE"), so Claude can't invent a plausible-looking id. Returns ids aligned to `lines`. */
    private async matchViaAi(lines: ExtractedLine[], stockItems: StockItem[]): Promise<(string | null)[]> {
        const catalog = stockItems.map((it) => `${it.stock_item_id}: ${it.name} (${it.count_unit})`).join("\n");
        const validIds = [...stockItems.map((it) => it.stock_item_id), "NONE"];
        const listed = lines.map((l, i) => `${i}: "${l.description_raw}"${l.supplier_item_code ? ` (supplier code: ${l.supplier_item_code})` : ""}`).join("\n");

        const { api, model } = await this.claude();
        const message = await api.messages.create({
            model,
            max_tokens: 4000 + lines.length * 40,
            messages: [
                {
                    role: "user",
                    content:
                        `These lines were read off a supplier delivery invoice:\n${listed}\n\n` +
                        `Active stock item catalog (id: name (unit)):\n${catalog}\n\n` +
                        `For each line index, give the stock_item_id it most likely refers to, or "NONE" if nothing is a confident match.`,
                },
            ],
            output_config: {
                format: {
                    type: "json_schema",
                    schema: {
                        type: "object",
                        properties: {
                            matches: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: { index: { type: "integer" }, stock_item_id: { type: "string", enum: validIds } },
                                    required: ["index", "stock_item_id"],
                                    additionalProperties: false,
                                },
                            },
                        },
                        required: ["matches"],
                        additionalProperties: false,
                    },
                },
            },
        });

        const block = message.content.find((b) => b.type === "text");
        const out: (string | null)[] = lines.map(() => null);
        if (!block || block.type !== "text" || message.stop_reason === "max_tokens") return out;
        const matches = (JSON.parse(block.text) as { matches?: { index: number; stock_item_id: string }[] }).matches ?? [];
        for (const m of matches) {
            if (Number.isInteger(m.index) && m.index >= 0 && m.index < out.length && m.stock_item_id !== "NONE") out[m.index] = m.stock_item_id;
        }
        return out;
    }
}

/** Title shown on the Action Inbox card — one place so the first run and a re-run word it identically. */
export function invoiceReviewTitle(ranOk: boolean, lineCount: number): string {
    if (ranOk && lineCount > 0) return `Invoice review: ${lineCount} line(s) extracted, ready for review`;
    if (ranOk) return "Invoice review: AI found no lines — manual entry needed";
    return "Invoice review: AI extraction failed — manual entry needed";
}

function nonNegative(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Turns a vendor/SDK failure into a sentence an owner can act on — never the raw JSON body. */
export function describeError(err: unknown): string {
    if (err instanceof InvoiceAiError) return err.message;
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return "AI extraction is switched off: the Anthropic API key is missing, invalid or not allowed. Enter this invoice manually, then have an owner update the key under Dashboard → Site Configuration → AI (Claude) and use Re-run AI extraction.";
    }
    if (err instanceof Anthropic.RateLimitError) return "AI service is busy right now (rate limited). Use Re-run AI extraction in a few minutes.";
    if (err instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Use Re-run AI extraction in a few minutes.";
    if (err instanceof Anthropic.BadRequestError) return `AI service rejected the request: ${String(err.message).slice(0, 200)}`;
    if (err instanceof Anthropic.APIError) return `AI service error${err.status ? ` (${err.status})` : ""}. Use Re-run AI extraction in a few minutes.`;
    return err instanceof Error ? err.message : String(err);
}
