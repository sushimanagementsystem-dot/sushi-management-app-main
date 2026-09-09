/**
 * InvoiceAI.js — AI extraction + stock-item matching for Delivery Invoices
 * (spec §14.5-14.7). Split out from FormDeliveryInvoice.js since this is a
 * distinct, vendor-specific technical concern — same reasoning as
 * backend/engine/Engine.js being its own file rather than folded into a
 * form processor.
 *
 * Vendor: Claude API (Anthropic), called via UrlFetchApp — GAS has no
 * official SDK, and this project's stack is Apps Script throughout (see
 * Auth.js's UrlFetchApp use for the same reason). Requires a
 * ANTHROPIC_API_KEY Script Property (Project Settings → Script Properties),
 * same pattern as UPLOADS_FOLDER_ID in core/Upload.js.
 */

const AI_MATCH_CONFIDENCE_THRESHOLD = 0.8;
const CLAUDE_MODEL_ = "claude-sonnet-5";
const CLAUDE_API_URL_ = "https://api.anthropic.com/v1/messages";
const CLAUDE_API_VERSION_ = "2023-06-01";

/** Shared Messages API call. payload is the full request body (model,
 * max_tokens, messages, optional output_config). Returns the first text
 * content block's text. Throws on any HTTP error, refusal, or missing
 * text block — callers (extraction/matching) are already wrapped by
 * runInvoiceAIExtraction_'s try/catch, so a thrown error here correctly
 * falls through to the manual-review path (spec §14.7). */
function callClaudeMessages_(payload) {
    const apiKey =
        PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set as a Script Property.");

    const res = UrlFetchApp.fetch(CLAUDE_API_URL_, {
        method: "post",
        contentType: "application/json",
        headers: {
            "x-api-key": apiKey,
            "anthropic-version": CLAUDE_API_VERSION_,
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true,
    });

    const code = res.getResponseCode();
    const text = res.getContentText();
    if (code !== 200) throw new Error(`Claude API error ${code}: ${text.slice(0, 300)}`);

    const data = JSON.parse(text);
    if (data.stop_reason === "refusal") throw new Error("Claude declined the request.");

    const block = (data.content || []).find((b) => b.type === "text");
    if (!block) throw new Error("Claude response had no text content.");
    return block.text;
}

/**
 * files: delivery_file rows for one delivery_header. Returns
 * {ok:true, lines:[{description_raw, qty, unit_cost, line_total, supplier_item_code}]}
 * or {ok:false, error}.
 *
 * Sends every page as an image/document content block (in page_sequence
 * order) in one request, with output_config.format constraining the
 * response to valid JSON — no free-text parsing to get wrong.
 */
function extractInvoiceLinesWithAI_(files) {
    const sorted = files
        .slice()
        .sort((a, b) => (a.page_sequence || 0) - (b.page_sequence || 0));

    const content = sorted.map((f) => {
        const blob = DriveApp.getFileById(f.drive_file_id).getBlob();
        const mediaType = blob.getContentType();
        const data = Utilities.base64Encode(blob.getBytes());
        return mediaType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: mediaType, data } }
            : { type: "image", source: { type: "base64", media_type: mediaType, data } };
    });
    content.push({
        type: "text",
        text:
            "Extract every line item from this delivery invoice. For each line, give the raw description exactly as printed, the supplier's own item code if one is printed (empty string if none), quantity, unit cost, and line total. If a numeric value is not printed or not legible, use 0 rather than guessing. Do not include tax, subtotal, or total summary rows as line items.",
    });

    const text = callClaudeMessages_({
        model: CLAUDE_MODEL_,
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
                                required: [
                                    "description_raw",
                                    "supplier_item_code",
                                    "qty",
                                    "unit_cost",
                                    "line_total",
                                ],
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

    return { ok: true, lines: JSON.parse(text).lines || [] };
}

/** Tier 1: exact/normalized match against supplier_item_map for this
 * invoice's supplier. Cheap, deterministic, zero AI cost — supplier_code/
 * supplier_description already exist in the schema for exactly this. */
function matchViaSupplierItemMap_(line, supplierId) {
    const norm = (s) => String(s || "").trim().toLowerCase();
    const maps = getRows(TABLES.SUPPLIER_ITEM_MAP, (r) => r.supplier_id === supplierId && r.active === true);
    const byCode = maps.find((m) => norm(m.supplier_code) === norm(line.supplier_item_code) && norm(line.supplier_item_code));
    if (byCode) return { stockItemId: byCode.stock_item_id, confidence: 1 };
    const byDesc = maps.find((m) => norm(m.supplier_description) === norm(line.description_raw) && norm(line.description_raw));
    return byDesc ? { stockItemId: byDesc.stock_item_id, confidence: 0.95 } : null;
}

/**
 * Tier 2: simple fuzzy text match against stock_item.name (and, as a
 * second pass, supplier_item_map.supplier_description for this supplier) —
 * normalized substring containment either direction. Deliberately simple
 * (no external library — GAS has none available); returns null rather than
 * a weak guess when nothing contains the other.
 */
function matchViaFuzzyText_(line, stockItems) {
    const desc = String(line.description_raw || "").trim().toLowerCase();
    if (!desc) return null;
    const hit = stockItems.find((it) => {
        const name = String(it.name || "").trim().toLowerCase();
        return name && (desc.includes(name) || name.includes(desc));
    });
    return hit ? { stockItemId: hit.stock_item_id, confidence: 0.6 } : null;
}

/**
 * Tier 3: AI fallback, one call per still-unmatched line, given the line
 * plus the full active stock_item list. Returns
 * {stockItemId: "" | id, confidence: 0..1}.
 *
 * output_config.format constrains stock_item_id to the enum of actually-
 * valid ids plus "NONE" — Claude cannot return a hallucinated id that
 * happens to look plausible; it can only pick a real one or say no match.
 */
function matchExtractedLineToStockItem_(line, stockItems) {
    const catalog = stockItems
        .map((it) => `${it.stock_item_id}: ${it.name} (${it.count_unit})`)
        .join("\n");
    const validIds = stockItems.map((it) => it.stock_item_id).concat(["NONE"]);

    const text = callClaudeMessages_({
        model: CLAUDE_MODEL_,
        max_tokens: 64,
        messages: [
            {
                role: "user",
                content:
                    `An invoice line reads: "${line.description_raw}"` +
                    (line.supplier_item_code
                        ? ` (supplier code: ${line.supplier_item_code})`
                        : "") +
                    `.\n\nActive stock item catalog (id: name (unit)):\n${catalog}\n\n` +
                    `Which stock_item_id does this line most likely refer to? If nothing is a confident match, say so.`,
            },
        ],
        output_config: {
            format: {
                type: "json_schema",
                schema: {
                    type: "object",
                    properties: {
                        stock_item_id: { type: "string", enum: validIds },
                    },
                    required: ["stock_item_id"],
                    additionalProperties: false,
                },
            },
        },
    });

    const matchedId = JSON.parse(text).stock_item_id;
    return matchedId && matchedId !== "NONE"
        ? { stockItemId: matchedId, confidence: 0.85 }
        : { stockItemId: "", confidence: 0 };
}

/** Orchestrator — runs the 3-tier match per line, in order, stopping at
 * the first confident hit. */
function matchLine_(line, supplierId, stockItems) {
    const m1 = matchViaSupplierItemMap_(line, supplierId);
    if (m1) return m1;
    const m2 = matchViaFuzzyText_(line, stockItems);
    if (m2) return m2;
    return matchExtractedLineToStockItem_(line, stockItems);
}

/**
 * Called once from processDeliveryInvoice, after delivery_header +
 * delivery_file rows are already written. Never throws — catches anything
 * from the extraction/matching calls and converts to the failure branch,
 * so a future vendor's network/parse error can never abort the submission
 * (spec §14.7: "do not block the entire delivery system"). Does not write
 * delivery_header or owner_action itself — returns a summary the caller
 * uses to phrase both.
 */
function runInvoiceAIExtraction_(headerId, fileRows, supplierId) {
    let result;
    try {
        result = extractInvoiceLinesWithAI_(fileRows);
    } catch (err) {
        result = { ok: false, error: String((err && err.message) || err) };
    }

    withLock(() => {
        if (result.ok) {
            const stockItems = getRows(TABLES.STOCK_ITEM, (r) => r.active === true);
            (result.lines || []).forEach((line) => {
                let match = null;
                try {
                    match = matchLine_(line, supplierId, stockItems);
                } catch (e) {
                    /* matching failure != extraction failure; leave unmatched */
                }
                insertRow_(TABLES.INVOICE_LINE, {
                    invoice_line_id: newId(),
                    delivery_header_id: headerId,
                    stock_item_id: match && match.confidence >= AI_MATCH_CONFIDENCE_THRESHOLD ? match.stockItemId : "",
                    supplier_item_code: line.supplier_item_code || "",
                    description_raw: line.description_raw || "",
                    qty: line.qty || "",
                    unit_cost: line.unit_cost || "",
                    line_total: line.line_total || "",
                    source: "AI_EXTRACTED",
                    status: "DRAFT",
                    approved_at: "",
                    approved_by: "",
                });
            });
            fileRows.forEach((f) =>
                updateRow_(TABLES.DELIVERY_FILE, ["delivery_file_id"], {
                    delivery_file_id: f.delivery_file_id,
                    ai_status: "SUCCESS",
                    ai_error: "",
                }),
            );
        } else {
            fileRows.forEach((f) =>
                updateRow_(TABLES.DELIVERY_FILE, ["delivery_file_id"], {
                    delivery_file_id: f.delivery_file_id,
                    ai_status: "FAILED",
                    ai_error: String(result.error || "").slice(0, 500),
                }),
            );
        }
    });

    return {
        ranOk: !!result.ok,
        lineCount: result.ok ? (result.lines || []).length : 0,
        errorSummary: result.ok ? "" : String(result.error || "").slice(0, 200),
    };
}
