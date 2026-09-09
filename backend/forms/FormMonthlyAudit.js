/**
 * FormMonthlyAudit.js — Monthly Audit (spec §3.10). Staff answer every active
 * audit_question (grouped by audit_section), N/A only where na_allowed,
 * evidence photo where evidence_required. Writes one audit_response
 * (review_status PENDING_REVIEW, final_score/final_rating left blank — the
 * 90/80% thresholds are the OWNER's call, never computed here) plus one
 * audit_answer per question. corrective_action rows are NOT created here —
 * spec: "owner-confirmed failures create corrective actions" — that's
 * owner-dashboard work once built, not staff-submission work.
 *
 * Daily key (kiosk|date), same delete+rewrite resubmission as Stocktake —
 * BUT blocked once the owner has started reviewing (review_status past
 * PENDING_REVIEW), so a resubmit can never destroy real review decisions.
 */

function getMonthlyAuditData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    const bizDate = today();

    const sections = getRows(TABLES.AUDIT_SECTION, (r) => r.active !== false)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((r) => ({ id: r.audit_section_id, name: r.name }));

    const questions = getRows(TABLES.AUDIT_QUESTION, (r) => r.active === true).map((r) => ({
        id: r.audit_question_id,
        sectionId: r.audit_section_id,
        text: r.question_text,
        naAllowed: r.na_allowed === true,
        evidenceRequired: r.evidence_required === true,
        critical: r.critical === true,
    }));

    const existingHeader = getRow(TABLES.AUDIT_RESPONSE, (r) =>
        r.kiosk_id === kiosk.kiosk_id && asDateStr(r.audit_date) === bizDate,
    );
    if (existingHeader && existingHeader.review_status !== "PENDING_REVIEW") {
        return {
            ok: true,
            businessDate: bizDate,
            locked: true,
            lockedReason: "The owner has already started reviewing today's audit — it can no longer be edited here.",
        };
    }

    const existingAnswers = {};
    if (existingHeader) {
        getRows(TABLES.AUDIT_ANSWER, { audit_response_id: existingHeader.audit_response_id }).forEach(
            (r) =>
                (existingAnswers[r.audit_question_id] = {
                    answer: r.staff_answer,
                    evidencePhotoReference: r.evidence_photo_reference || "",
                }),
        );
    }

    return {
        ok: true,
        businessDate: bizDate,
        locked: false,
        sections: sections,
        questions: questions,
        existingAnswers: existingAnswers,
        alreadySubmitted: !!existingHeader,
    };
}

function buildMonthlyAuditKey(ctx) {
    return `MONTHLY_AUDIT|${ctx.kiosk.kiosk_id}|${ctx.businessDate}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateMonthlyAudit(p) {
    const answers = p.answers || {};
    if (!Object.keys(answers).length) throw new Error("No answers submitted.");
    Object.keys(answers).forEach((qid) => {
        const a = answers[qid];
        if (!a || !["YES", "NO", "NA"].includes(a.answer))
            throw new Error(`Question "${qid}": pick an answer.`);
    });
}

/** Runs at intake, synchronously — uploads any evidence photos, swaps for URLs. */
function prepareMonthlyAuditIntake(payload, kiosk) {
    const answers = payload.answers || {};
    Object.keys(answers).forEach((qid) => {
        const a = answers[qid];
        if (a.photo && a.photo.base64) {
            a.evidence_photo_reference = saveUpload_(a.photo, kiosk.kiosk_id, "MONTHLY_AUDIT").url;
            delete a.photo; // never let raw base64 reach raw_payload
        }
    });
    return payload;
}

/** Cascade: delete answers of a superseded response before the response itself. */
function clearMonthlyAuditExtra(oldIds, ctx) {
    const oldResponseIds = getRows(TABLES.AUDIT_RESPONSE, (r) =>
        oldIds.includes(r.submission_id),
    ).map((r) => r.audit_response_id);
    if (oldResponseIds.length) {
        const n = deleteRows(TABLES.AUDIT_ANSWER, (r) =>
            oldResponseIds.includes(r.audit_response_id),
        );
        if (n > 0) ctx.written = true;
    }
}

function processMonthlyAudit(ctx) {
    const answers = ctx.payload.answers || {};

    // Guard against a resubmit destroying an in-progress/finished owner
    // review — re-checked here (not just at bootstrap) in case the owner
    // started reviewing between page load and submit.
    ctx.stage = "check review lock";
    const existing = getRow(TABLES.AUDIT_RESPONSE, (r) =>
        r.kiosk_id === ctx.kiosk.kiosk_id && asDateStr(r.audit_date) === ctx.businessDate,
    );
    if (existing && existing.review_status !== "PENDING_REVIEW")
        throw new Error("The owner has already started reviewing this audit — it can no longer be edited.");

    ctx.stage = "resolve questions";
    const questions = {};
    getRows(TABLES.AUDIT_QUESTION).forEach((r) => (questions[r.audit_question_id] = r));

    ctx.stage = "write audit_response";
    const responseId = newId();
    insertRow(TABLES.AUDIT_RESPONSE, {
        audit_response_id: responseId,
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        audit_date: ctx.businessDate,
        review_status: "PENDING_REVIEW",
        final_score: "",
        final_rating: "",
    });
    ctx.written = true;

    ctx.stage = "write audit_answer";
    Object.keys(answers).forEach((qid) => {
        const q = questions[qid];
        const a = answers[qid];
        if (!q) throw new Error(`Unknown audit question "${qid}".`);
        if (a.answer === "NA" && q.na_allowed !== true)
            throw new Error(`"${q.question_text}" does not allow N/A.`);
        if (q.evidence_required === true && a.answer !== "NA" && !a.evidence_photo_reference)
            throw new Error(`"${q.question_text}" requires a photo.`);

        insertRow(TABLES.AUDIT_ANSWER, {
            audit_answer_id: newId(),
            audit_response_id: responseId,
            audit_question_id: qid,
            staff_answer: a.answer,
            evidence_photo_reference: a.evidence_photo_reference || "",
            owner_decision: "",
            owner_note: "",
        });
    });
}
