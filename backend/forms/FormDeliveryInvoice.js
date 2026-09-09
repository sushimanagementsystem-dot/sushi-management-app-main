/**
 * FormDeliveryInvoice.js — Delivery Invoices (spec §3.7). One response = one
 * supplier document (invoice, credit note, or delivery docket); all pages of
 * that document belong in the same response. Creates a delivery_header plus
 * one delivery_file row per uploaded page/photo, then runs AI extraction
 * (see InvoiceAI.js) inline before returning — draft invoice_line rows come
 * from that, never from this processor directly. Owner approval (Action
 * Inbox, whole-invoice Confirm/Decline) is still required before any line
 * or stock_movement becomes real — extraction only ever produces DRAFT rows.
 */

function getDeliveryInvoiceData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    return {
        ok: true,
        businessDate: today(),
        suppliers: getRows(TABLES.SUPPLIER).map((r) => ({
            id: r.supplier_id,
            name: r.name,
        })),
        documentTypes: getEnumOptions("document_type"),
    };
}

function buildDeliveryInvoiceKey(ctx) {
    return `DELIVERY_INVOICE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateDeliveryInvoice(p) {
    if (!p.client_key) throw new Error("Missing form key — reload the page and try again.");
    if (!p.supplier_id) throw new Error("Select the supplier.");
    if (!p.document_type) throw new Error("Select the document type.");
    const files = p.files || [];
    if (!files.length) throw new Error("Upload at least one page/photo.");
    files.forEach((f, i) => {
        if (!f.base64) throw new Error(`File ${i + 1}: upload didn't complete, try again.`);
    });
}

/**
 * Cascade: delete lines+files of superseded headers before the headers
 * themselves. Blocks the resubmit entirely (throws) once the owner has
 * already acted — extraction has run and/or lines may already be approved
 * with real stock_movement rows posted; a resubmit clearing the header
 * behind them would orphan those movements. Runs before def.process() (see
 * Pipeline.js's processSubmission_), so this is the only place this guard
 * can catch a resubmit before real rows are deleted.
 */
function clearDeliveryInvoiceExtra(oldIds, ctx) {
    const oldHeaders = getRows(TABLES.DELIVERY_HEADER, (r) =>
        oldIds.includes(r.submission_id),
    );
    const blocked = oldHeaders.find((h) => h.status !== "RECEIVED");
    if (blocked) {
        throw new Error(
            "This delivery has already been reviewed by the owner — it can no longer be resubmitted. Contact the owner if a correction is needed.",
        );
    }
    const oldHeaderIds = oldHeaders.map((h) => h.delivery_header_id);
    if (!oldHeaderIds.length) return;
    if (deleteRows(TABLES.INVOICE_LINE, (r) => oldHeaderIds.includes(r.delivery_header_id)) > 0) ctx.written = true;
    if (deleteRows(TABLES.DELIVERY_FILE, (r) => oldHeaderIds.includes(r.delivery_header_id)) > 0) ctx.written = true;
}

/** Runs at intake, synchronously — uploads every page, swaps them for URLs. */
function prepareDeliveryInvoiceIntake(payload, kiosk) {
    payload.uploadedFiles = (payload.files || []).map((f, i) => {
        const saved = saveUpload_(f, kiosk.kiosk_id, "DELIVERY_INVOICE");
        return { id: saved.id, url: saved.url, name: saved.name, page: i + 1 };
    });
    delete payload.files; // never let raw base64 reach raw_payload
    return payload;
}

function processDeliveryInvoice(ctx) {
    const p = ctx.payload;

    ctx.stage = "resolve supplier";
    const supplier = getRow(TABLES.SUPPLIER, { supplier_id: String(p.supplier_id) });

    ctx.stage = "write delivery_header";
    const headerId = newId();
    insertRow(TABLES.DELIVERY_HEADER, {
        delivery_header_id: headerId,
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        delivery_date: ctx.businessDate,
        supplier_id: supplier ? supplier.supplier_id : "",
        document_type: p.document_type,
        as_expected: p.as_expected === true,
        staff_invoice_number: String(p.staff_invoice_number || "").trim(),
        delivery_note: String(p.delivery_note || "").trim(),
        status: "RECEIVED",
    });
    ctx.written = true;

    ctx.stage = "write delivery_file";
    const insertedFileRows = (p.uploadedFiles || []).map((f) => {
        const row = {
            delivery_file_id: newId(),
            delivery_header_id: headerId,
            drive_file_id: f.id,
            file_name: f.name,
            file_url: f.url,
            page_sequence: f.page,
            ai_status: "PENDING",
            ai_error: "",
        };
        insertRow(TABLES.DELIVERY_FILE, row);
        return row;
    });

    ctx.stage = "AI extraction";
    const ai = runInvoiceAIExtraction_(headerId, insertedFileRows, supplier ? supplier.supplier_id : "");

    ctx.stage = "advance header + write owner_action";
    updateRow(TABLES.DELIVERY_HEADER, ["delivery_header_id"], {
        delivery_header_id: headerId,
        status: "IN_REVIEW",
    });
    insertRow(TABLES.OWNER_ACTION, {
        owner_action_id: newId(),
        source_submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        category: "INVOICE_REVIEW",
        title:
            ai.ranOk && ai.lineCount > 0
                ? `Invoice review: ${ai.lineCount} line(s) extracted, ready for review`
                : ai.ranOk
                  ? `Invoice review: AI found no lines — manual entry needed`
                  : `Invoice review: AI extraction failed — manual entry needed`,
        owner_note: ai.ranOk ? "" : ai.errorSummary,
        status: "OPEN",
        priority: "NORMAL",
        created_at: nowStamp(),
    });

    return supplier ? "PROCESSED" : "UNMATCHED";
}
