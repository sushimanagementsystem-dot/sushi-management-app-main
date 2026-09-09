/**
 * Api.js — backend JSON API, called directly by the public static frontend
 * (browser fetch, confirmed CORS-readable — no proxy needed). This
 * deployment executes as the owner (sheet access) and accepts anonymous
 * requests: kiosk-scoped actions are gated by the kiosk token itself
 * (M-01 — never a staff-editable value), same as they always were.
 * API_SECRET is no longer a blanket gate — a public client-side caller
 * can't hold a real secret (page source is visible to anyone), so it now
 * only protects two genuinely privileged, non-browser actions: "redeploy"
 * (via API_SECRET, called exclusively by deploy.sh) and "process_now" (via
 * the separate PROCESS_SECRET, called server-side by the Vercel relay in
 * frontend/api/process-now.js right after a successful submit — never by
 * the browser directly, so the secret never ships to a client).
 *
 * User identity: "login" exchanges a short-lived Google ID token (verified
 * against Google) for our own 30-day-sliding session token — see Auth.js.
 * Every other real action requires that session token, re-verified (and the
 * user's active status re-checked) on every single call, not just at login.
 *
 * Request body: { action, token, sessionToken, ... }
 * Response: JSON { ok, ... } — always 200, errors inside the body.
 */

function doPost(e) {
    // Guards against a stale settings cache leaking in from a previous
    // invocation on a reused warm container — see resetSettingCache_'s
    // doc comment in Util.js. Every real entry point must call this first.
    resetSettingCache_();

    let body;
    try {
        body = JSON.parse(e.postData.contents);
    } catch (err) {
        return jsonOut_({ ok: false, error: "Bad request." });
    }

    try {
        console.log(`API <- action=${body.action}`);
        const out = route_(body);
        console.log(
            `API -> action=${body.action} ok=${out.ok}${out.error ? " error=" + out.error : ""}`,
        );
        return jsonOut_(out);
    } catch (err) {
        console.error("API error:", (err && err.stack) || err);
        return jsonOut_({
            ok: false,
            error: String((err && err.message) || err),
            detail: String((err && err.stack) || "")
                .split("\n")
                .slice(0, 4)
                .join("\n"),
        });
    }
}

function route_(body) {
    if (body.action === "redeploy") {
        const secret =
            PropertiesService.getScriptProperties().getProperty("API_SECRET");
        if (!secret || body.secret !== secret) {
            return { ok: false, error: "Unauthorized." };
        }
        return redeployAll(String(body.label || "unlabelled"));
    }

    if (body.action === "process_now") {
        // Server-to-server only — called by the Vercel relay right after a
        // successful submit (see frontend/api/process-now.js), not the
        // browser. Gated by its own secret, separate from API_SECRET
        // (different caller/trust boundary).
        const secret =
            PropertiesService.getScriptProperties().getProperty("PROCESS_SECRET");
        if (!secret || body.secret !== secret) {
            return { ok: false, error: "Unauthorized." };
        }
        return processPendingSubmissions();
    }

    if (body.action === "kiosk_info") {
        // No identity check — this runs before sign-in even happens
        // (enter.html verifies the kiosk link first, user identity second).
        const k = getKioskByToken(body.token);
        if (!k) return { ok: false, error: "Invalid kiosk link." };
        return { ok: true, kiosk: { kiosk_id: k.kiosk_id, name: k.name } };
    }

    if (body.action === "login") {
        // Exchanges a short-lived Google ID token (verified against Google
        // itself) for our own longer-lived session token — see Auth.js.
        const identity = verifyIdToken_(body.idToken);
        const user = identity ? findUserByEmail(identity.email) : null;
        if (!user) {
            // Genuinely never-seen-before email (not just inactive) gets a
            // blocked STAFF row added automatically, so Evan sees the
            // request in the staff list instead of hearing about it
            // secondhand. An already-known-but-inactive email is left
            // untouched — never duplicated or overwritten.
            if (identity && !findAnyUserByEmail(identity.email)) {
                registerUnknownUser_(identity.email, identity.name);
            }
            return {
                ok: false,
                code: "NOT_SIGNED_IN",
                error: "Please sign in with a registered Google account.",
            };
        }
        return { ok: true, sessionToken: mintSessionToken_(user) };
    }

    // Everything else touches real staff data — require a valid session
    // (see Auth.js: re-checks the user is still active on every call, not
    // just at sign-in) before going any further.
    const user = verifySessionToken_(body.sessionToken);
    if (!user) {
        return {
            ok: false,
            code: "NOT_SIGNED_IN",
            error: "Please sign in with a registered Google account.",
        };
    }
    // Sliding expiry: every successful call refreshes the session, so an
    // active user's 30-day window never actually runs out.
    const refreshedToken = mintSessionToken_(user);

    const out = (() => {
        switch (body.action) {
            case "whoami":
                // Role check for restricted areas (e.g. the dashboard) —
                // no data of its own, just confirms who's signed in.
                return { ok: true, role: user.role, name: user.name };
            case "bootstrap_tables_page":
                // Page's very first load only: tab list + a full
                // bootstrapDataTable for whichever table should be active,
                // in one call instead of two sequential ones. Switching
                // tabs afterward already has the tab list, so it skips
                // straight to bootstrap_data_table/list_table_rows.
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapTablesPage(body.preferredTable || "");
            case "bootstrap_data_table":
                // Dashboard-only: a signed-in STAFF user has a valid
                // session token same as an ADMIN, so this must check role
                // itself — requireRole() on the frontend is UX only.
                // Schema + rows + every referenced table + every enum in
                // one call — used on a table's first load each session;
                // list_table_rows alone covers repeat visits (see
                // tables.html's SCHEMA_CACHE).
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapDataTable(body.table);
            case "list_table_rows":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return listTableRows(body.table);
            case "save_table_row":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return saveTableRow(body.table, !!body.isNew, body.row || {});
            case "delete_table_row":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return deleteTableRow(body.table, body.row || {});
            case "bulk_save_table_rows":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bulkSaveTableRows(body.table, body.changes || []);
            case "bootstrap_action_inbox":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapActionInbox();
            case "bootstrap_kpi_dashboard":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapKpiDashboard(body.kioskId || "", body.startDate || "", body.endDate || "");
            case "bootstrap_kiosk_comparison":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapKioskComparison(body.startDate || "", body.endDate || "");
            case "bootstrap_stock_usage":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapStockUsage(body.kioskId || "", body.openingStocktakeHeaderId || "", body.closingStocktakeHeaderId || "");
            case "bootstrap_settings_page":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return bootstrapSettingsPage();
            case "save_settings":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return saveSettings(body.changes || {});
            case "get_action_detail":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return getActionDetail(body.ownerActionId);
            case "update_owner_action":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                // changed_by is a user_id reference (see activity_log's own
                // convention), never a plain name — resolved via lookup at
                // render time, not stored pre-resolved.
                return updateOwnerAction(body.ownerActionId, body.changes || {}, user.user_id);
            case "update_request":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return updateRequest(body.requestId, body.changes || {}, body.ownerActionId, user.user_id);
            case "save_stocktake_line":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return saveStocktakeLine(body.stocktakeHeaderId, !!body.isNew, body.line || {});
            case "delete_stocktake_line":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return deleteStocktakeLine(body.stocktakeLineId);
            case "confirm_stocktake":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return confirmStocktake(body.stocktakeHeaderId, user.user_id);
            case "decline_stocktake":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return declineStocktake(body.stocktakeHeaderId, user.user_id);
            case "update_stock_transfer":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return updateStockTransfer(body.transferId, body.changes || {});
            case "approve_stock_transfers":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return approveStockTransfers(body.transferIds || [], user.user_id);
            case "decline_stock_transfers":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return declineStockTransfers(body.transferIds || [], user.user_id);
            case "apply_stock_transfers":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return applyStockTransfers(body.transferIds || [], user.user_id);
            case "save_invoice_line":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return saveInvoiceLine(body.deliveryHeaderId, !!body.isNew, body.line || {});
            case "delete_invoice_line":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return deleteInvoiceLine(body.invoiceLineId);
            case "confirm_invoice_review":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return confirmInvoiceReview(body.deliveryHeaderId, user.user_id);
            case "decline_invoice_review":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return declineInvoiceReview(body.deliveryHeaderId, user.user_id);
            case "review_audit_answer":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return reviewAuditAnswer(body.auditAnswerId, body.decision, body.note || "", user.user_id);
            case "review_audit_correction":
                if (!isOwnerRole_(user.role)) {
                    return { ok: false, code: "FORBIDDEN", error: "Not permitted." };
                }
                return reviewAuditCorrection(body.auditCorrectionId, body.decision, user.user_id);
            case "bootstrap_morning_waste":
                return getMorningWasteData(body.token);
            case "bootstrap_fridge_count":
                return getFridgeCountData(body.token);
            case "bootstrap_staff_food":
                return getStaffFoodData(body.token, user.user_id);
            case "bootstrap_stocktake":
                return getStocktakeData(body.token);
            case "bootstrap_food_waste":
                return getFoodWasteData(body.token);
            case "bootstrap_help_issue":
                return getHelpIssueData(body.token);
            case "bootstrap_move_stock":
                return getMoveStockData(body.token);
            case "bootstrap_damaged_product":
                return getDamagedProductData(body.token);
            case "bootstrap_delivery_invoice":
                return getDeliveryInvoiceData(body.token);
            case "bootstrap_monthly_audit":
                return getMonthlyAuditData(body.token);
            case "bootstrap_audit_correction":
                return getAuditCorrectionData(body.token);
            case "submit":
                return submitForm(
                    body.token,
                    body.formType,
                    body.payload || {},
                    user.email,
                );
            default:
                return { ok: false, error: `Unknown action: ${body.action}` };
        }
    })();

    return Object.assign({}, out, { sessionToken: refreshedToken });
}

function jsonOut_(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
        ContentService.MimeType.JSON,
    );
}
