/**
 * FormHelpIssue.js — Help / Issues (spec §3.8): four routes, each with a
 * default deadline. "Keep the original staff report immutable" — unlike
 * every other form, this one is never edited via resubmission. Each page
 * load gets its own client_key (same pattern as Staff Food): a genuine
 * retry of the same click is safe (replaces nothing new, no duplicate),
 * but a fresh page load always creates a separate, permanent report.
 * Owner-side fields (owner_priority, assigned_to, owner_status, owner_note,
 * resolution_note) start blank/NEW and are set later by the owner dashboard
 * — this form/processor never touches them again after creation.
 */

// Valid request_type values — checked at intake, so this must stay a plain
// list with no sheet read (validateHelpIssue's own "no sheet reads"
// constraint). Actual deadlines come from the REQUEST_DEADLINE_* settings
// at processing time (helpIssueDeadlineDays_ below, called from
// processHelpIssue) — URGENT has no configurable deadline (0 days is a
// fixed business rule, not a tunable).
const HELP_ISSUE_REQUEST_TYPES = ["KIOSK_ISSUE", "HELP_NEEDED", "FEEDBACK", "URGENT"];

const HELP_ISSUE_DEADLINE_SETTING_ = {
    KIOSK_ISSUE: ["REQUEST_DEADLINE_KIOSK_ISSUE_DAYS", 3],
    HELP_NEEDED: ["REQUEST_DEADLINE_HELP_DAYS", 7],
    FEEDBACK: ["REQUEST_DEADLINE_FEEDBACK_DAYS", 14],
};

function helpIssueDeadlineDays_(requestType) {
    if (requestType === "URGENT") return 0;
    const setting = HELP_ISSUE_DEADLINE_SETTING_[requestType];
    return setting ? getSettingNum(setting[0], setting[1]) : 0;
}

function getHelpIssueData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    return {
        ok: true,
        businessDate: today(),
        categories: getEnumOptions("request_category"),
    };
}

function buildHelpIssueKey(ctx) {
    return `HELP_ISSUE|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateHelpIssue(p) {
    if (!p.client_key)
        throw new Error("Missing form key — reload the page and try again.");
    if (HELP_ISSUE_REQUEST_TYPES.indexOf(p.request_type) === -1)
        throw new Error("Pick what kind of report this is.");
    if (!String(p.title || "").trim())
        throw new Error("Give it a short title.");
    if (!String(p.details || "").trim()) throw new Error("Add details.");
    if (!p.photo || !p.photo.base64)
        throw new Error("A photo or video is required.");
}

/** Runs at intake, synchronously — uploads the photo/video, swaps it for a URL. */
function prepareHelpIssueIntake(payload, kiosk) {
    payload.photo_reference = saveUpload_(
        payload.photo,
        kiosk.kiosk_id,
        "HELP_ISSUE",
    ).url;
    delete payload.photo;
    return payload;
}

function processHelpIssue(ctx) {
    const p = ctx.payload;
    const priority = p.request_type === "URGENT" ? "URGENT" : "NORMAL";
    const dueDate = addDays(
        ctx.businessDate,
        helpIssueDeadlineDays_(p.request_type),
    );

    ctx.stage = "write request";
    insertRow(TABLES.REQUEST, {
        request_id: newId(),
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        user_id: ctx.userId || "",
        request_type: p.request_type,
        category: p.category || "",
        title: String(p.title).trim(),
        details: String(p.details).trim(),
        photo_reference: p.photo_reference || "",
        initial_priority: priority,
        owner_priority: "",
        assigned_to: "",
        owner_status: "NEW",
        due_date: dueDate,
        owner_note: "",
        resolution_note: "",
    });
    ctx.written = true;

    if (p.request_type === "URGENT") {
        insertRow(TABLES.OWNER_ACTION, {
            owner_action_id: newId(),
            source_submission_id: ctx.submissionId,
            kiosk_id: ctx.kiosk.kiosk_id,
            category: "HELP_ISSUE",
            title: `URGENT — ${ctx.kiosk.kiosk_id}: ${String(p.title).trim()}`,
            status: "OPEN",
            priority: "URGENT",
            due_date: dueDate,
            created_at: nowStamp(),
        });
    }
}
