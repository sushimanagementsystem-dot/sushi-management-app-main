import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import type { Prisma, StockItem } from "@prisma/client";
import { UploadService } from "../upload/upload.service.js";

const MATCH_CONFIDENCE_THRESHOLD = 0.8;
const CLAUDE_MODEL = "claude-sonnet-5";

export type ExtractedLine = { description_raw: string; supplier_item_code: string; qty: number; unit_cost: number; line_total: number };
type MatchResult = { stockItemId: string; confidence: number } | null;
type FileRow = { delivery_file_id: string; drive_file_id: string | null; file_name: string | null; page_sequence: number | null };

/**
 * AI extraction + stock-item matching for Delivery Invoices — port of
 * backend/forms/InvoiceAI.js. Vendor: Claude API, via the official Node
 * SDK (the old system used raw UrlFetchApp since Apps Script has no SDK
 * support — same request/response shape, just a real client here).
 *
 * Never throws — callers get a result object either way, so a vendor
 * network/parse error can never abort the submission (old spec: "do not
 * block the entire delivery system").
 */
@Injectable()
export class InvoiceAiService {
    private readonly logger = new Logger(InvoiceAiService.name);
    private readonly client: Anthropic;

    constructor(
        private readonly config: ConfigService,
        private readonly upload: UploadService,
    ) {
        this.client = new Anthropic({ apiKey: this.config.getOrThrow<string>("ANTHROPIC_API_KEY") });
    }

    /**
     * Called after delivery_header + delivery_file rows are already
     * written. Writes invoice_line rows (DRAFT) and updates each
     * delivery_file's ai_status/ai_error; returns a summary the caller
     * uses to phrase the owner_action title/note.
     */
    async runExtraction(
        tx: Prisma.TransactionClient,
        headerId: string,
        fileRows: FileRow[],
        supplierId: string | null,
    ): Promise<{ ranOk: boolean; lineCount: number; errorSummary: string }> {
        let result: { ok: true; lines: ExtractedLine[] } | { ok: false; error: string };
        try {
            const lines = await this.extractLines(fileRows);
            result = { ok: true, lines };
        } catch (err) {
            result = { ok: false, error: err instanceof Error ? err.message : String(err) };
        }

        if (result.ok) {
            const stockItems = await tx.stockItem.findMany({ where: { active: true } });
            for (const line of result.lines) {
                let match: MatchResult = null;
                try {
                    match = await this.matchLine(tx, line, supplierId, stockItems);
                } catch (e) {
                    this.logger.warn(`Invoice line matching failed (leaving unmatched): ${e instanceof Error ? e.message : e}`);
                }
                await tx.invoiceLine.create({
                    data: {
                        delivery_header_id: headerId,
                        stock_item_id: match && match.confidence >= MATCH_CONFIDENCE_THRESHOLD ? match.stockItemId : null,
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
            await tx.deliveryFile.updateMany({
                where: { delivery_file_id: { in: fileRows.map((f) => f.delivery_file_id) } },
                data: { ai_status: "SUCCESS", ai_error: null },
            });
        } else {
            await tx.deliveryFile.updateMany({
                where: { delivery_file_id: { in: fileRows.map((f) => f.delivery_file_id) } },
                data: { ai_status: "FAILED", ai_error: result.error.slice(0, 500) },
            });
        }

        return {
            ranOk: result.ok,
            lineCount: result.ok ? result.lines.length : 0,
            errorSummary: result.ok ? "" : result.error.slice(0, 200),
        };
    }

    /** Sends every page as an image/document content block (page order), one
     * request, output_config.format constraining the response to valid JSON. */
    private async extractLines(fileRows: FileRow[]): Promise<ExtractedLine[]> {
        const sorted = [...fileRows].sort((a, b) => (a.page_sequence ?? 0) - (b.page_sequence ?? 0));

        const content: Anthropic.Messages.ContentBlockParam[] = [];
        for (const f of sorted) {
            if (!f.drive_file_id) continue;
            const { buffer, mimeType } = await this.upload.read(f.drive_file_id);
            const data = buffer.toString("base64");
            content.push(
                mimeType === "application/pdf"
                    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
                    : { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data } },
            );
        }
        content.push({
            type: "text",
            text: "Extract every line item from this delivery invoice. For each line, give the raw description exactly as printed, the supplier's own item code if one is printed (empty string if none), quantity, unit cost, and line total. If a numeric value is not printed or not legible, use 0 rather than guessing. Do not include tax, subtotal, or total summary rows as line items.",
        });

        const message = await this.client.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 4096,
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
        } as Anthropic.Messages.MessageCreateParamsNonStreaming);

        if (message.stop_reason === "refusal") throw new Error("Claude declined the request.");
        const block = message.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") throw new Error("Claude response had no text content.");
        return (JSON.parse(block.text).lines ?? []) as ExtractedLine[];
    }

    /** Orchestrator — 3-tier match per line, stopping at the first confident hit. */
    private async matchLine(tx: Prisma.TransactionClient, line: ExtractedLine, supplierId: string | null, stockItems: StockItem[]): Promise<MatchResult> {
        const tier1 = await this.matchViaSupplierItemMap(tx, line, supplierId);
        if (tier1) return tier1;
        const tier2 = this.matchViaFuzzyText(line, stockItems);
        if (tier2) return tier2;
        return this.matchViaAi(line, stockItems);
    }

    /** Tier 1: exact/normalized match against supplier_item_map — cheap, deterministic, zero AI cost. */
    private async matchViaSupplierItemMap(tx: Prisma.TransactionClient, line: ExtractedLine, supplierId: string | null): Promise<MatchResult> {
        if (!supplierId) return null;
        const norm = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();
        const maps = await tx.supplierItemMap.findMany({ where: { supplier_id: supplierId, active: true } });

        const codeNorm = norm(line.supplier_item_code);
        const byCode = codeNorm ? maps.find((m) => norm(m.supplier_code) === codeNorm) : undefined;
        if (byCode) return { stockItemId: byCode.stock_item_id, confidence: 1 };

        const descNorm = norm(line.description_raw);
        const byDesc = descNorm ? maps.find((m) => norm(m.supplier_description) === descNorm) : undefined;
        return byDesc ? { stockItemId: byDesc.stock_item_id, confidence: 0.95 } : null;
    }

    /** Tier 2: simple fuzzy text match — normalized substring containment either direction. */
    private matchViaFuzzyText(line: ExtractedLine, stockItems: StockItem[]): MatchResult {
        const desc = String(line.description_raw ?? "").trim().toLowerCase();
        if (!desc) return null;
        const hit = stockItems.find((it) => {
            const name = it.name.trim().toLowerCase();
            return name && (desc.includes(name) || name.includes(desc));
        });
        return hit ? { stockItemId: hit.stock_item_id, confidence: 0.6 } : null;
    }

    /** Tier 3: AI fallback — output_config constrains stock_item_id to the enum
     * of actually-valid ids plus "NONE", so Claude can't hallucinate a plausible-looking id. */
    private async matchViaAi(line: ExtractedLine, stockItems: StockItem[]): Promise<MatchResult> {
        const catalog = stockItems.map((it) => `${it.stock_item_id}: ${it.name} (${it.count_unit})`).join("\n");
        const validIds = [...stockItems.map((it) => it.stock_item_id), "NONE"];

        const message = await this.client.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 64,
            messages: [
                {
                    role: "user",
                    content:
                        `An invoice line reads: "${line.description_raw}"` +
                        (line.supplier_item_code ? ` (supplier code: ${line.supplier_item_code})` : "") +
                        `.\n\nActive stock item catalog (id: name (unit)):\n${catalog}\n\n` +
                        `Which stock_item_id does this line most likely refer to? If nothing is a confident match, say so.`,
                },
            ],
            output_config: {
                format: {
                    type: "json_schema",
                    schema: {
                        type: "object",
                        properties: { stock_item_id: { type: "string", enum: validIds } },
                        required: ["stock_item_id"],
                        additionalProperties: false,
                    },
                },
            },
        } as Anthropic.Messages.MessageCreateParamsNonStreaming);

        const block = message.content.find((b) => b.type === "text");
        if (!block || block.type !== "text") return { stockItemId: "", confidence: 0 };
        const matchedId = (JSON.parse(block.text) as { stock_item_id: string }).stock_item_id;
        return matchedId && matchedId !== "NONE" ? { stockItemId: matchedId, confidence: 0.85 } : { stockItemId: "", confidence: 0 };
    }
}
