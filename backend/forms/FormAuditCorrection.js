/**
 * FormAuditCorrection.js — Audit Corrections (spec §3.11). Staff reference an
 * open corrective_action (picker, not a typed ID — better UX, same effect),
 * explain the fix, upload replacement evidence. Moves the action to owner
 * review (status -> REPLACEMENT_SUBMITTED) — safe for this processor to do,
 * it's workflow state, not a judgment call. NEVER closes the action; only
 * the owner does that. correction_cycle = prior corrections against this
 * action + 1. Many-per-day (client_key), not resubmission-editable — each
 * correction attempt is its own permanent record (same immutability pattern
 * as Help/Issues).
 */

function getAuditCorrectionData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };

    const questions = {};
    getRows(TABLES.AUDIT_QUESTION).forEach((r) => (questions[r.audit_question_id] = r));

    const actions = getRows(TABLES.CORRECTIVE_ACTION, (r) =>
        r.kiosk_id === kiosk.kiosk_id &&
        (r.status === "OPEN" || r.status === "REPLACEMENT_SUBMITTED"),
    ).map((r) => ({
        id: r.corrective_action_id,
        question: questions[r.audit_question_id] ? questions[r.audit_question_id].question_text : r.audit_question_id,
        status: r.status,
        deadline: asDateStr(r.deadline),
    }));

    return { ok: true, businessDate: today(), actions: actions };
}

function buildAuditCorrectionKey(ctx) {
    return `AUDIT_CORRECTION|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateAuditCorrection(p) {
    if (!p.client_key) throw new Error("Missing form key — reload the page and try again.");
    if (!p.corrective_action_id) throw new Error("Select which action this fixes.");
    if (!String(p.correction_note || "").trim()) throw new Error("Explain what was fixed.");
    if (!p.photo || !p.photo.base64) throw new Error("Replacement evidence photo is required.");
}

/** Runs at intake, synchronously — uploads the photo, swaps it for a URL. */
function prepareAuditCorrectionIntake(payload, kiosk) {
    payload.replacement_photo_reference = saveUpload_(payload.photo, kiosk.kiosk_id, "AUDIT_CORRECTION").url;
    delete payload.photo; // never let raw base64 reach raw_payload
    return payload;
}

function processAuditCorrection(ctx) {
    const p = ctx.payload;

    ctx.stage = "resolve corrective_action";
    const action = getRow(TABLES.CORRECTIVE_ACTION, { corrective_action_id: String(p.corrective_action_id) });

    let validationStatus;
    if (!action) validationStatus = "INVALID_ACTION_NOT_FOUND";
    else if (action.kiosk_id !== ctx.kiosk.kiosk_id) validationStatus = "INVALID_WRONG_KIOSK";
    else if (action.status === "CLOSED") validationStatus = "INVALID_ACTION_CLOSED";
    else validationStatus = "VALID";

    ctx.stage = "write audit_correction";
    const priorCycles = action
        ? getRows(TABLES.AUDIT_CORRECTION, { corrective_action_id: action.corrective_action_id }).length
        : 0;

    insertRow(TABLES.AUDIT_CORRECTION, {
        audit_correction_id: newId(),
        submission_id: ctx.submissionId,
        corrective_action_id: action ? action.corrective_action_id : String(p.corrective_action_id),
        kiosk_id: ctx.kiosk.kiosk_id,
        user_id: ctx.userId || "",
        correction_cycle: priorCycles + 1,
        correction_note: String(p.correction_note).trim(),
        replacement_photo_reference: p.replacement_photo_reference || "",
        validation_status: validationStatus,
    });
    ctx.written = true;

    if (validationStatus !== "VALID") return "REJECTED";

    // Moves to owner review — workflow state only, never auto-closes.
    ctx.stage = "update corrective_action";
    updateRow(TABLES.CORRECTIVE_ACTION, ["corrective_action_id"], {
        corrective_action_id: action.corrective_action_id,
        status: "REPLACEMENT_SUBMITTED",
    });
    return "PROCESSED";
}
