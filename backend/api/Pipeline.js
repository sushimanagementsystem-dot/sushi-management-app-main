/**
 * Pipeline.js — shared submission pipeline for all 12 forms (async inbox).
 *
 * Intake (submitForm): cheap validation -> insert raw payload into
 * `submission` (RECEIVED) -> return immediately. Staff only wait for the save.
 *
 * Processing (processPendingSubmissions): kicked almost immediately via a
 * Vercel serverless relay (frontend/api/process-now.js) that the browser
 * calls fire-and-forget right after a successful submit; that relay calls
 * back into this backend's "process_now" action (see Api.js), which runs
 * server-side on Vercel's infra — reliable even if the browser tab closes
 * immediately after. Also swept by a 10-minute recurring trigger as a
 * safety net for stragglers/retries, or if the relay ever fails (run
 * setup() once to install it). Claims each pending submission atomically,
 * clears core rows of
 * earlier submissions with the same processing_key (resubmission = replace),
 * runs the form's processor, sets the final status. Failures land in
 * `processing_error_log`; setting a submission back to RETRY_REQUIRED makes
 * the sweep retry it.
 */

/**
 * Registry: one entry per form.
 *   tables    — core tables the form writes; used to clear old rows on resubmit
 *   buildKey  — stable identity of the logical event (same across retries and
 *               corrections). Daily forms: FORM|kiosk|date. Many-per-day forms:
 *               FORM|kiosk|client-generated UUID from the payload.
 *   validate  — cheap payload-only check run at intake; throws a message shown
 *               to staff. No sheet lookups here — keep intake fast.
 *   process   — writes core rows; may return a processing_status string
 *               (defaults to "PROCESSED"). Sets ctx.stage as it goes and
 *               ctx.written = true after its first write.
 */
// Built lazily (first actual call), not as a top-level const — GAS
// executes each file's top-level code in alphabetical order by file name
// (folder-prefixed, e.g. "api/Pipeline" before "core/Config"), so a
// top-level object literal evaluating TABLES.X eagerly would break the
// instant a folder rename shifted that order — as it did here when this
// file moved into api/. Deferring construction to first use sidesteps the
// whole ordering question: by the time anything actually calls
// getProcessors_(), every file has long since finished loading.
let _PROCESSORS = null;
function getProcessors_() {
    if (_PROCESSORS) return _PROCESSORS;
    _PROCESSORS = {
        MORNING_WASTE: {
            tables: [TABLES.PRODUCT_MOVEMENT],
            buildKey: (ctx) => buildMorningWasteKey(ctx),
            validate: (p) => validateMorningWaste(p),
            process: (ctx) => processMorningWaste(ctx),
        },
        FRIDGE_COUNT: {
            tables: [TABLES.FRIDGE_COUNT, TABLES.PRODUCTION_PLAN],
            buildKey: (ctx) => buildFridgeCountKey(ctx),
            validate: (p) => validateFridgeCount(p),
            process: (ctx) => processFridgeCount(ctx),
        },
        STAFF_FOOD: {
            tables: [TABLES.STAFF_FOOD, TABLES.PRODUCT_MOVEMENT],
            buildKey: (ctx) => buildStaffFoodKey(ctx),
            validate: (p) => validateStaffFood(p),
            process: (ctx) => processStaffFood(ctx),
        },
        WEEKLY_STOCKTAKE: {
            tables: [TABLES.STOCKTAKE_HEADER, TABLES.OWNER_ACTION],
            clearExtra: (oldIds, ctx) => clearStocktakeExtra(oldIds, ctx),
            buildKey: (ctx) => buildStocktakeKey(ctx),
            validate: (p) => validateStocktake(p),
            process: (ctx) => processStocktake(ctx),
        },
        FOOD_WASTE: {
            tables: [TABLES.STOCK_MOVEMENT],
            buildKey: (ctx) => buildFoodWasteKey(ctx),
            validate: (p) => validateFoodWaste(p),
            process: (ctx) => processFoodWaste(ctx),
        },
        HELP_ISSUE: {
            tables: [TABLES.REQUEST, TABLES.OWNER_ACTION],
            buildKey: (ctx) => buildHelpIssueKey(ctx),
            validate: (p) => validateHelpIssue(p),
            prepareIntake: (payload, kiosk) => prepareHelpIssueIntake(payload, kiosk),
            process: (ctx) => processHelpIssue(ctx),
        },
        MOVE_STOCK: {
            tables: [TABLES.STOCK_TRANSFER, TABLES.OWNER_ACTION],
            buildKey: (ctx) => buildMoveStockKey(ctx),
            validate: (p) => validateMoveStock(p),
            process: (ctx) => processMoveStock(ctx),
        },
        DAMAGED_PRODUCT: {
            tables: [TABLES.PRODUCT_MOVEMENT],
            buildKey: (ctx) => buildDamagedProductKey(ctx),
            validate: (p) => validateDamagedProduct(p),
            prepareIntake: (payload, kiosk) =>
                prepareDamagedProductIntake(payload, kiosk),
            process: (ctx) => processDamagedProduct(ctx),
        },
        DELIVERY_INVOICE: {
            // DELIVERY_FILE (and INVOICE_LINE) are no longer listed here —
            // clearDeliveryInvoiceExtra handles both explicitly, since
            // neither has a submission_id column of its own (same
            // one-level-removed shape delivery_file already had).
            tables: [TABLES.DELIVERY_HEADER],
            clearExtra: (oldIds, ctx) => clearDeliveryInvoiceExtra(oldIds, ctx),
            buildKey: (ctx) => buildDeliveryInvoiceKey(ctx),
            validate: (p) => validateDeliveryInvoice(p),
            prepareIntake: (payload, kiosk) => prepareDeliveryInvoiceIntake(payload, kiosk),
            process: (ctx) => processDeliveryInvoice(ctx),
        },
        MONTHLY_AUDIT: {
            tables: [TABLES.AUDIT_RESPONSE],
            clearExtra: (oldIds, ctx) => clearMonthlyAuditExtra(oldIds, ctx),
            buildKey: (ctx) => buildMonthlyAuditKey(ctx),
            validate: (p) => validateMonthlyAudit(p),
            prepareIntake: (payload, kiosk) => prepareMonthlyAuditIntake(payload, kiosk),
            process: (ctx) => processMonthlyAudit(ctx),
        },
        AUDIT_CORRECTION: {
            tables: [TABLES.AUDIT_CORRECTION],
            buildKey: (ctx) => buildAuditCorrectionKey(ctx),
            validate: (p) => validateAuditCorrection(p),
            prepareIntake: (payload, kiosk) => prepareAuditCorrectionIntake(payload, kiosk),
            process: (ctx) => processAuditCorrection(ctx),
        },
    };
    return _PROCESSORS;
}

/**
 * Fast intake, called directly from the page (fetch, via the API route).
 * email is the caller's Google email, already verified server-side in
 * Api.js's route_() (verifyIdToken_ + user allowlist) before this runs.
 */
function submitForm(token, formType, payload, email) {
    try {
        return submitForm_(token, formType, payload || {}, email || "");
    } catch (err) {
        return { ok: false, error: `Submission failed: ${err.message}` };
    }
}

function submitForm_(token, formType, payload, email) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid or inactive kiosk link." };

    const def = getProcessors_()[formType];
    if (!def) return { ok: false, error: `Unknown form type: ${formType}` };

    if (def.validate) {
        try {
            def.validate(payload);
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    if (def.prepareIntake) {
        try {
            payload = def.prepareIntake(payload, kiosk) || payload;
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }

    const matched = findUserByEmail(email);
    const businessDate = payload.business_date || today();
    const key = def.buildKey({
        kiosk: kiosk,
        payload: payload,
        businessDate: businessDate,
        userId: matched ? matched.user_id : "",
    });

    insertRow(TABLES.SUBMISSION, {
        submission_id: newId(),
        kiosk_id: kiosk.kiosk_id,
        form_type: formType,
        user_id: matched ? matched.user_id : "",
        submitted_by_email: email,
        submitted_at: nowStamp(),
        business_date: businessDate,
        raw_payload: JSON.stringify(payload),
        processing_key: key,
        processing_status: "RECEIVED",
    });

    console.log(`Intake: queued ${formType} key=${key} by=${email || "-"}`);
    return { ok: true, queued: true };
}

/** Run once by the owner: installs the 10-minute straggler sweep and the
 * weekly purchasing scan (see Purchasing.js). The straggler sweep stays
 * even though submission also kicks processing immediately via the Vercel
 * relay + "process_now" action (see Api.js) — a safety net for anything
 * the relay missed, or a row stuck at RETRY_REQUIRED. */
function setup() {
    const triggers = ScriptApp.getProjectTriggers();

    if (!triggers.some((t) => t.getHandlerFunction() === "processPendingSubmissions"))
        ScriptApp.newTrigger("processPendingSubmissions")
            .timeBased()
            .everyMinutes(10)
            .create();

    if (!triggers.some((t) => t.getHandlerFunction() === "runWeeklyPurchasingScan"))
        ScriptApp.newTrigger("runWeeklyPurchasingScan")
            .timeBased()
            .onWeekDay(ScriptApp.WeekDay.MONDAY)
            .atHour(6)
            .create();
}

/** Processes everything pending, oldest first. Safe to run concurrently. */
function processPendingSubmissions() {
    // Also called directly by the 10-minute time-driven trigger, entirely
    // outside doPost — that trigger runs against HEAD, on whatever
    // container Apps Script happens to reuse, so this needs its own guard
    // against a stale settings cache (see resetSettingCache_ in Util.js).
    // Idempotent/cheap when doPost's own reset already ran this request.
    resetSettingCache_();

    const pending = getRows(
        TABLES.SUBMISSION,
        (r) =>
            r.processing_status === "RECEIVED" ||
            r.processing_status === "RETRY_REQUIRED",
    ).sort((a, b) =>
        String(a.submitted_at).localeCompare(String(b.submitted_at)),
    );

    console.log(`Sweep: ${pending.length} pending submission(s)`);
    pending.forEach((sub) => {
        if (!claimSubmission_(sub.submission_id)) {
            console.log(
                `Sweep: ${sub.submission_id} already claimed, skipping`,
            );
            return;
        }
        processSubmission_(sub);
    });
    return { ok: true, processed: pending.length };
}

/** Atomic RECEIVED/RETRY_REQUIRED -> PROCESSING flip (double-run guard). */
function claimSubmission_(submissionId) {
    return withLock(() => {
        const row = getRow(TABLES.SUBMISSION, { submission_id: submissionId });
        if (
            !row ||
            (row.processing_status !== "RECEIVED" &&
                row.processing_status !== "RETRY_REQUIRED")
        )
            return false;
        updateRow_(TABLES.SUBMISSION, ["submission_id"], {
            submission_id: submissionId,
            processing_status: "PROCESSING",
        });
        return true;
    });
}

function processSubmission_(sub) {
    const def = getProcessors_()[sub.form_type];
    const ctx = {
        kiosk: getRow(TABLES.KIOSK, { kiosk_id: sub.kiosk_id }),
        email: sub.submitted_by_email,
        userId: sub.user_id,
        payload: {},
        businessDate: asDateStr(sub.business_date),
        submissionId: sub.submission_id,
        processingKey: sub.processing_key,
        stage: "init",
        written: false,
    };
    try {
        if (!def)
            throw new Error(`No processor for form type "${sub.form_type}"`);
        if (!ctx.kiosk) throw new Error(`Unknown kiosk "${sub.kiosk_id}"`);
        ctx.payload = JSON.parse(sub.raw_payload);

        ctx.stage = "clear previous rows";
        const oldIds = getRows(
            TABLES.SUBMISSION,
            (r) =>
                r.processing_key === ctx.processingKey &&
                r.submission_id !== ctx.submissionId,
        ).map((r) => r.submission_id);
        if (oldIds.length) {
            if (def.clearExtra) def.clearExtra(oldIds, ctx);
            def.tables.forEach((t) => {
                const n = deleteRows(t, (r) =>
                    oldIds.includes(r.submission_id || r.source_submission_id),
                );
                if (n > 0) ctx.written = true;
            });
        }

        ctx.stage = "process";
        const status = def.process(ctx) || "PROCESSED";

        updateRow(TABLES.SUBMISSION, ["submission_id"], {
            submission_id: ctx.submissionId,
            processing_status: status,
        });
        console.log(
            `Processed ${sub.form_type} ${sub.submission_id} -> ${status}`,
        );
    } catch (err) {
        console.error(
            `Processing FAILED ${sub.form_type} ${sub.submission_id} at stage "${ctx.stage}": ${err.message}`,
        );
        logProcessingError_(ctx, sub.form_type, err);
    }
}

/**
 * Inserts one processing_error_log row — the visible, non-email-dependent
 * trace of a processing failure. Shared by logProcessingError_ below (hard
 * failures, which also flip the submission to ERROR) and by
 * sendProductionEmail_'s own catch in FormFridgeCount.js, for a mail-send
 * failure specifically — there, the submission's real data write already
 * succeeded, so processing_status correctly stays PROCESSED_WITH_WARNING,
 * never ERROR, but the failure still needs to land somewhere a human can
 * see it (previously it only reached console.error — GAS's execution log,
 * which nobody watches — meaning "no kiosk is receiving emails" could go
 * unnoticed indefinitely). Never throws itself. Returns the new error_id,
 * or "" if the write itself failed. */
function recordProcessingErrorLog_(ctx, formType, err) {
    try {
        const errorId = newId();
        insertRow(TABLES.PROCESSING_ERROR_LOG, {
            error_id: errorId,
            error_at: nowStamp(),
            kiosk_id: ctx.kiosk ? ctx.kiosk.kiosk_id : "",
            form_type: formType,
            submission_id: ctx.submissionId,
            processing_key: ctx.processingKey,
            stage: ctx.stage,
            error_message: String((err && err.stack) || err),
            records_written_before_error: ctx.written,
            recommended_action:
                "Fix the cause, then set processing_status to RETRY_REQUIRED (or resubmit the form).",
            retry_status: "PENDING",
        });
        return errorId;
    } catch (logErr) {
        console.error("Failed to write processing_error_log: " + logErr);
        return "";
    }
}

/**
 * Marks the submission ERROR, records the failure for retry, and alerts the
 * developer. Developer-only — never surfaced to the owner/staff; the raw
 * error text (stack traces, column names, sheet internals) is meaningless
 * and alarming to a non-technical reader. The owner-facing signal, if any,
 * is a business-level one raised separately by the form itself, not this.
 */
function logProcessingError_(ctx, formType, err) {
    try {
        updateRow(TABLES.SUBMISSION, ["submission_id"], {
            submission_id: ctx.submissionId,
            processing_status: "ERROR",
        });
    } catch (statusErr) {
        console.error("Failed to mark submission ERROR: " + statusErr);
    }
    const errorId = recordProcessingErrorLog_(ctx, formType, err);

    try {
        notifyDevelopers_(
            `[Sushi Kiosk] Processing failed — ${formType} — ${ctx.kiosk ? ctx.kiosk.kiosk_id : "?"}`,
            `error_id: ${errorId || "(not logged)"}\n` +
                `submission_id: ${ctx.submissionId}\n` +
                `form_type: ${formType}\n` +
                `stage: ${ctx.stage}\n` +
                `records_written_before_error: ${ctx.written}\n\n` +
                String((err && err.stack) || err),
        );
    } catch (mailErr) {
        console.error("Failed to notify developers: " + mailErr);
    }
}

/** Plain-text alert to active DEVELOPER-role users. Best-effort, never throws. */
function notifyDevelopers_(subject, body) {
    const devs = getRows(
        TABLES.USER,
        (r) => r.active === true && r.role === "DEVELOPER",
    )
        .map((r) => r.email)
        .filter((e) => e);
    if (!devs.length) {
        console.error("No active DEVELOPER user to notify:", subject);
        return;
    }
    MailApp.sendEmail({ to: devs.join(","), subject: subject, body: body });
}
