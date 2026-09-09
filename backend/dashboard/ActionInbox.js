/**
 * ActionInbox.js — owner-facing queue/triage/approval logic for
 * `owner_action`. This file assumes the caller is already role-checked —
 * Api.js's isOwnerRole_ gate runs before every action here, same convention
 * as DataTables.js.
 *
 * Category-specific linked data (getActionDetail) and approval actions are
 * added incrementally, one category at a time, as each is built — see
 * BUILD_PLAN / the Action Inbox plan for the phase order. Only the generic
 * triage path (bootstrap/detail/update) is expected to work end to end in
 * the first phase.
 */

const OWNER_ACTION_RESOLVED_STATUSES = ["RESOLVED", "CLOSED", "NOT_PROCEEDING"];

/**
 * Everything the inbox LIST needs, in one call — every owner_action row,
 * unfiltered (status/category/kiosk/priority filtering is a pure
 * client-side concern, see inbox.html), plus the small single-table lookups
 * shared across every category's detail (kiosks, users, stock items).
 *
 * Deliberately does NOT embed any category-specific linked data or
 * activity_log history anymore — those are real joins across other tables
 * (invoice lines, audit answers, stocktake lines, transfers, ...), and
 * embedding them for every historical owner_action row here made this call
 * get slower forever as history piles up, for data most of which is never
 * opened in a given session. getActionDetail below fetches that, scoped to
 * one action, only when a card is actually clicked open.
 */
function bootstrapActionInbox() {
    const rows = getRows(TABLES.OWNER_ACTION);

    const counts = { byStatus: {}, byCategory: {} };
    rows.forEach((r) => {
        counts.byStatus[r.status] = (counts.byStatus[r.status] || 0) + 1;
        counts.byCategory[r.category] = (counts.byCategory[r.category] || 0) + 1;
    });

    const priorityRank = { URGENT: 0, NORMAL: 1, LOW: 2 };
    rows.sort(
        (a, b) =>
            (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) ||
            String(a.created_at).localeCompare(String(b.created_at)),
    );

    const kioskNames = {};
    getRows(TABLES.KIOSK).forEach((k) => (kioskNames[k.kiosk_id] = k.name));

    // activity_log.changed_by stores a user_id (or the literal "system" for
    // automatic transitions — see advanceOwnerActionOnAction_), never a
    // plain name. Resolved to a display name here via lookup, not stored
    // pre-resolved, so a later name change stays accurate.
    const users = getRows(TABLES.USER).map((u) => ({ id: u.user_id, name: u.name }));

    return {
        ok: true,
        rows: rows.map((r) => Object.assign({}, r, { kioskName: kioskNames[r.kiosk_id] || r.kiosk_id })),
        counts: counts,
        kiosks: getRows(TABLES.KIOSK, (r) => r.active === true).map((k) => ({ id: k.kiosk_id, name: k.name })),
        users: users,
        stockItems: getRows(TABLES.STOCK_ITEM, (s) => s.active === true).map((s) => ({
            id: s.stock_item_id,
            name: s.name,
            unit: s.count_unit,
        })),
    };
}

/**
 * Everything one card's detail modal needs — activity_log history plus
 * category-specific linked data — fetched fresh on every open (see
 * inbox.html's openActionDetail). Scoped to a single owner_action, so this
 * stays cheap and constant-cost regardless of how much history exists
 * elsewhere in the table, unlike embedding it for every row in
 * bootstrapActionInbox above.
 */
function getActionDetail(ownerActionId) {
    const action = getRow(TABLES.OWNER_ACTION, { owner_action_id: ownerActionId });
    if (!action) return { ok: false, error: "Action not found." };

    const activity = getRows(TABLES.ACTIVITY_LOG, { owner_action_id: ownerActionId }).sort((a, b) =>
        String(a.changed_at).localeCompare(String(b.changed_at)),
    );

    const out = { ok: true, activity: activity };

    switch (action.category) {
        case "HELP_ISSUE":
            out.request = getRow(TABLES.REQUEST, { submission_id: action.source_submission_id }) || null;
            break;

        case "STOCKTAKE_REVIEW": {
            const header = getRow(TABLES.STOCKTAKE_HEADER, { submission_id: action.source_submission_id });
            out.stocktakeHeader = header || null;
            out.stocktakeLines = header
                ? getRows(TABLES.STOCKTAKE_LINE, { stocktake_header_id: header.stocktake_header_id }).map((l) => {
                      const item = getRow(TABLES.STOCK_ITEM, { stock_item_id: l.stock_item_id });
                      return Object.assign({}, l, { stockItemName: item ? item.name : l.stock_item_id });
                  })
                : [];
            break;
        }

        case "TRANSFER_APPROVAL":
        case "TRANSFER_APPLY":
            // Both categories show the same stock_transfer rows for the
            // submission (Move Stock writes one owner_action per
            // submission but one stock_transfer per line).
            out.transfers = getRows(TABLES.STOCK_TRANSFER, { submission_id: action.source_submission_id }).map((t) => {
                const item = getRow(TABLES.STOCK_ITEM, { stock_item_id: t.stock_item_id });
                return Object.assign({}, t, { stockItemName: item ? item.name : t.stock_item_id });
            });
            break;

        case "INVOICE_REVIEW": {
            const header = getRow(TABLES.DELIVERY_HEADER, { submission_id: action.source_submission_id });
            out.deliveryHeader = header || null;
            if (header) {
                const supplier = getRow(TABLES.SUPPLIER, { supplier_id: header.supplier_id });
                out.supplierName = supplier ? supplier.name : "";
                out.deliveryFiles = getRows(TABLES.DELIVERY_FILE, { delivery_header_id: header.delivery_header_id });
                out.invoiceLines = getRows(TABLES.INVOICE_LINE, { delivery_header_id: header.delivery_header_id }).map((l) => {
                    const item = l.stock_item_id ? getRow(TABLES.STOCK_ITEM, { stock_item_id: l.stock_item_id }) : null;
                    return Object.assign({}, l, { stockItemName: item ? item.name : "" });
                });
            } else {
                out.supplierName = "";
                out.deliveryFiles = [];
                out.invoiceLines = [];
            }
            break;
        }

        case "AUDIT_REVIEW": {
            const response = getRow(TABLES.AUDIT_RESPONSE, { submission_id: action.source_submission_id });
            out.auditResponse = response || null;
            out.auditAnswers = response
                ? getRows(TABLES.AUDIT_ANSWER, { audit_response_id: response.audit_response_id }).map((a) => {
                      const q = getRow(TABLES.AUDIT_QUESTION, { audit_question_id: a.audit_question_id }) || {};
                      const section = q.audit_section_id ? getRow(TABLES.AUDIT_SECTION, { audit_section_id: q.audit_section_id }) : null;
                      return Object.assign({}, a, {
                          questionText: q.question_text || "",
                          sectionName: section ? section.name : "",
                          passAnswer: q.pass_answer || "",
                          critical: q.critical === true,
                          evidenceRequired: q.evidence_required === true,
                          weight: q.weight,
                      });
                  })
                : [];
            break;
        }

        case "AUDIT_CORRECTION_REVIEW": {
            const ac = getRow(TABLES.AUDIT_CORRECTION, { submission_id: action.source_submission_id });
            if (ac) {
                const ca = getRow(TABLES.CORRECTIVE_ACTION, { corrective_action_id: ac.corrective_action_id });
                out.auditCorrection = Object.assign({}, ac, {
                    correctiveAction: ca || null,
                    questionText: ca
                        ? (getRow(TABLES.AUDIT_QUESTION, { audit_question_id: ca.audit_question_id }) || {}).question_text || ""
                        : "",
                });
            } else {
                out.auditCorrection = null;
            }
            break;
        }

        case "DAMAGE_REVIEW": {
            const m = getRow(
                TABLES.PRODUCT_MOVEMENT,
                (r) => r.submission_id === action.source_submission_id && r.movement_type === "DAMAGE",
            );
            out.damageMovement = m
                ? Object.assign({}, m, { productName: (getRow(TABLES.PRODUCT, { product_id: m.product_id }) || {}).name || m.product_id })
                : null;
            break;
        }

        case "PURCHASING_RECOMMENDATION": {
            const batch = getRow(TABLES.PURCHASING_BATCH, { owner_action_id: action.owner_action_id });
            out.purchasingBatch = batch || null;
            out.purchasingSupplierName = "";
            out.purchasingLines = [];
            if (!batch) break;

            const supplier = batch.supplier_id ? getRow(TABLES.SUPPLIER, { supplier_id: batch.supplier_id }) : null;
            out.purchasingSupplierName = supplier ? supplier.name : "";

            // Per-kiosk breakdown isn't stored (see Purchasing.js/plan) — it's
            // re-derived live from current stock_item_par + stock_movement
            // data every time this action is opened, using the exact same
            // computeItemTrigger_ the weekly scan itself uses.
            const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true);
            const movementsByKiosk = {};
            getRows(TABLES.STOCK_MOVEMENT, () => true).forEach((m) => {
                if (!movementsByKiosk[m.kiosk_id]) movementsByKiosk[m.kiosk_id] = [];
                movementsByKiosk[m.kiosk_id].push(m);
            });
            const parByItemKiosk = {};
            getRows(TABLES.STOCK_ITEM_PAR, () => true).forEach((p) => {
                parByItemKiosk[p.stock_item_id + "|" + p.kiosk_id] = p;
            });

            out.purchasingLines = getRows(TABLES.PURCHASING_BATCH_LINE, { purchasing_batch_id: batch.purchasing_batch_id }).map(
                (line) => {
                    const item = getRow(TABLES.STOCK_ITEM, { stock_item_id: line.stock_item_id });
                    const kioskBreakdown = kiosks.map((k) => {
                        const parRow = parByItemKiosk[line.stock_item_id + "|" + k.kiosk_id] || null;
                        const trigger = computeItemTrigger_(line.stock_item_id, parRow, movementsByKiosk[k.kiosk_id] || []);
                        return {
                            kioskId: k.kiosk_id,
                            kioskName: k.name,
                            currentStock: trigger.currentStock,
                            shortfall: trigger.shortfall,
                            triggered: trigger.triggered,
                            flag: trigger.flag,
                        };
                    });
                    return Object.assign({}, line, {
                        stockItemName: item ? item.name : line.stock_item_id,
                        unit: item ? item.count_unit : "",
                        flagList: line.flags ? String(line.flags).split(",").filter((f) => f) : [],
                        kioskBreakdown: kioskBreakdown,
                    });
                },
            );
            break;
        }

        default:
            break;
    }

    return out;
}

/**
 * Editable fields on a `request` row (owner-side triage — staff-entered
 * fields like title/details/category are immutable historical record, per
 * FormHelpIssue.js's own header comment). Logs to activity_log against the
 * owner_action that surfaced this request (activity_log has no request_id
 * column of its own — it's scoped to owner_action by design).
 */
function updateRequest(requestId, changes, ownerActionId, changedBy) {
    return withLock(() => {
        const existing = getRow(TABLES.REQUEST, { request_id: requestId });
        if (!existing) return { ok: false, error: "Request not found." };

        const editable = ["owner_status", "owner_priority", "assigned_to", "due_date", "owner_note", "resolution_note"];
        const patch = { request_id: requestId };
        const logEntries = [];

        editable.forEach((f) => {
            if (!changes.hasOwnProperty(f)) return;
            const oldVal = existing[f];
            const newVal = changes[f];
            if (String(oldVal || "") === String(newVal || "")) return;
            patch[f] = newVal;
            logEntries.push({ field: f, old: oldVal, new: newVal });
        });
        if (!logEntries.length) return { ok: true, row: existing };

        const updated = updateRow_(TABLES.REQUEST, ["request_id"], patch);
        if (ownerActionId) {
            logEntries.forEach((l) => logActivity_(ownerActionId, changedBy, "request." + l.field, l.old, l.new, ""));
        }
        return { ok: true, row: updated };
    });
}

/**
 * Add/edit a stocktake_line while its header is still PENDING review —
 * lets the owner correct a miscounted item or add one staff missed before
 * confirming. count_unit always comes from stock_item, never owner-typed,
 * matching the original submission's own convention.
 */
function saveStocktakeLine(stocktakeHeaderId, isNew, line) {
    const header = getRow(TABLES.STOCKTAKE_HEADER, { stocktake_header_id: stocktakeHeaderId });
    if (!header) return { ok: false, error: "Stocktake not found." };
    if (header.reconciliation_status !== "PENDING")
        return { ok: false, error: "This stocktake has already been reviewed." };

    const item = getRow(TABLES.STOCK_ITEM, { stock_item_id: line.stock_item_id });
    if (!item) return { ok: false, error: "Unknown stock item." };
    const qty = Number(line.counted_qty);
    if (!Number.isFinite(qty) || qty < 0) return { ok: false, error: "Count must be a number, 0 or more." };

    const clean = {
        stocktake_line_id: isNew ? newId() : line.stocktake_line_id,
        stocktake_header_id: stocktakeHeaderId,
        stock_item_id: item.stock_item_id,
        counted_qty: qty,
        count_unit: item.count_unit,
    };
    if (isNew) {
        insertRow(TABLES.STOCKTAKE_LINE, clean);
    } else {
        const updated = updateRow(TABLES.STOCKTAKE_LINE, ["stocktake_line_id"], clean);
        if (!updated) return { ok: false, error: "Line not found." };
    }
    return { ok: true, row: clean };
}

function deleteStocktakeLine(stocktakeLineId) {
    const line = getRow(TABLES.STOCKTAKE_LINE, { stocktake_line_id: stocktakeLineId });
    if (!line) return { ok: false, error: "Line not found." };
    const header = getRow(TABLES.STOCKTAKE_HEADER, { stocktake_header_id: line.stocktake_header_id });
    if (!header || header.reconciliation_status !== "PENDING")
        return { ok: false, error: "This stocktake has already been reviewed." };
    deleteRows(TABLES.STOCKTAKE_LINE, { stocktake_line_id: stocktakeLineId });
    return { ok: true };
}

/**
 * Confirms a stocktake: for each current line, compares counted_qty
 * against that stock item's full stock_movement ledger balance to date
 * (sum IN minus sum OUT, every movement type, via stockBalanceAsOf_ in
 * Kpi.js — shared with the Stock Usage View) — self-correcting regardless
 * of history depth, no dependency on "the previous stocktake" bookkeeping.
 * Any non-zero delta posts one STOCKTAKE_ADJUSTMENT movement. Everything
 * in one withLock so the read-then-write per item can't race a concurrent
 * write (matches the "balanced, atomic" reasoning used for transfer apply).
 */
function confirmStocktake(stocktakeHeaderId, confirmedBy) {
    return withLock(() => {
        const header = getRow(TABLES.STOCKTAKE_HEADER, { stocktake_header_id: stocktakeHeaderId });
        if (!header) return { ok: false, error: "Stocktake not found." };
        if (header.reconciliation_status !== "PENDING") return { ok: false, error: "Already reviewed." };

        const lines = getRows(TABLES.STOCKTAKE_LINE, { stocktake_header_id: stocktakeHeaderId });
        const movements = getRows(TABLES.STOCK_MOVEMENT, (m) => m.kiosk_id === header.kiosk_id);
        const items = {};
        getRows(TABLES.STOCK_ITEM).forEach((s) => (items[s.stock_item_id] = s));

        lines.forEach((line) => {
            const balance = stockBalanceAsOf_(movements, line.stock_item_id, null);
            const delta = Number(line.counted_qty) - balance;
            if (delta === 0) return;
            const item = items[line.stock_item_id];
            const unitCost = item && item.current_unit_cost !== "" ? Number(item.current_unit_cost) : "";
            const qty = Math.abs(delta);
            insertRow_(TABLES.STOCK_MOVEMENT, {
                stock_movement_id: newId(),
                submission_id: "",
                kiosk_id: header.kiosk_id,
                stock_item_id: line.stock_item_id,
                movement_type: "STOCKTAKE_ADJUSTMENT",
                direction: delta > 0 ? "IN" : "OUT",
                movement_date: header.stocktake_date,
                qty: qty,
                unit_cost: unitCost,
                cost: unitCost === "" ? "" : Math.round(qty * unitCost * 100) / 100,
                reference_id: line.stocktake_line_id,
                created_at: nowStamp(),
            });
        });

        updateRow_(TABLES.STOCKTAKE_HEADER, ["stocktake_header_id"], {
            stocktake_header_id: stocktakeHeaderId,
            reconciliation_status: "CONFIRMED",
        });

        const action = findOwnerAction_(header.submission_id, "STOCKTAKE_REVIEW");
        if (action) {
            logActivity_(action.owner_action_id, confirmedBy, "reconciliation_status", "PENDING", "CONFIRMED", "");
            advanceOwnerActionOnAction_(action.owner_action_id, { complete: true, note: "stocktake confirmed" });
        }
        return { ok: true };
    });
}

function declineStocktake(stocktakeHeaderId, declinedBy) {
    return withLock(() => {
        const header = getRow(TABLES.STOCKTAKE_HEADER, { stocktake_header_id: stocktakeHeaderId });
        if (!header) return { ok: false, error: "Stocktake not found." };
        if (header.reconciliation_status !== "PENDING") return { ok: false, error: "Already reviewed." };

        updateRow_(TABLES.STOCKTAKE_HEADER, ["stocktake_header_id"], {
            stocktake_header_id: stocktakeHeaderId,
            reconciliation_status: "DECLINED",
        });

        const action = findOwnerAction_(header.submission_id, "STOCKTAKE_REVIEW");
        if (action) {
            logActivity_(action.owner_action_id, declinedBy, "reconciliation_status", "PENDING", "DECLINED", "");
            advanceOwnerActionOnAction_(action.owner_action_id, { complete: true, note: "stocktake declined" });
        }
        return { ok: true };
    });
}

/** Edit source/destination kiosk, qty, or note on a stock_transfer while
 * still PENDING — owner assigns whichever side staff left blank ("owner
 * will decide", see FormMoveStock.js). */
function updateStockTransfer(transferId, changes) {
    const existing = getRow(TABLES.STOCK_TRANSFER, { transfer_id: transferId });
    if (!existing) return { ok: false, error: "Transfer not found." };
    if (existing.status !== "PENDING") return { ok: false, error: "Only pending transfers can be edited." };

    const editable = ["source_kiosk_id", "destination_kiosk_id", "qty", "note"];
    const patch = { transfer_id: transferId };
    editable.forEach((f) => {
        if (changes.hasOwnProperty(f)) patch[f] = changes[f];
    });
    const updated = updateRow(TABLES.STOCK_TRANSFER, ["transfer_id"], patch);
    return { ok: true, row: updated };
}

/**
 * Approves/declines every PENDING line of a submission in one lock/one call
 * — the owner clicks Approve (or Decline) once per submission, not once per
 * product line. Approve blocks a line unless both kiosks are already
 * assigned — enforced here, not deferred to apply, so every APPROVED row is
 * guaranteed complete by the time apply runs. resolveTransferApprovalIfDone_
 * is called once after the whole batch, not per line — it just re-checks
 * current sibling state, so one call after N updates is both correct and
 * cheaper than N redundant checks. If no PENDING lines remain for the
 * submission afterward, the TRANSFER_APPROVAL action resolves and — only if
 * at least one line is APPROVED — a new TRANSFER_APPLY action is created.
 * Apply is a distinct, later owner-initiated step, never automatic-on-
 * approve: approving is a decision, applying posts real (hard-to-undo)
 * stock_movement rows (see applyStockTransfers below).
 */
function approveStockTransfers(transferIds, actorId) {
    return withLock(() => {
        const results = [];
        let submissionId = "";
        transferIds.forEach((id) => {
            const existing = getRow(TABLES.STOCK_TRANSFER, { transfer_id: id });
            if (!existing) { results.push({ id: id, ok: false, error: "Transfer not found." }); return; }
            if (existing.status !== "PENDING") { results.push({ id: id, ok: false, error: "Only pending transfers can be approved." }); return; }
            if (!existing.source_kiosk_id || !existing.destination_kiosk_id) {
                results.push({ id: id, ok: false, error: "Assign both source and destination kiosks before approving." });
                return;
            }
            updateRow_(TABLES.STOCK_TRANSFER, ["transfer_id"], { transfer_id: id, status: "APPROVED" });
            submissionId = existing.submission_id;
            results.push({ id: id, ok: true });
        });
        if (submissionId) resolveTransferApprovalIfDone_(submissionId, actorId);
        return { ok: true, results: results };
    });
}

/** Same shape as approveStockTransfers, one click per submission. */
function declineStockTransfers(transferIds, actorId) {
    return withLock(() => {
        const results = [];
        let submissionId = "";
        transferIds.forEach((id) => {
            const existing = getRow(TABLES.STOCK_TRANSFER, { transfer_id: id });
            if (!existing) { results.push({ id: id, ok: false, error: "Transfer not found." }); return; }
            if (existing.status !== "PENDING") { results.push({ id: id, ok: false, error: "Only pending transfers can be declined." }); return; }
            updateRow_(TABLES.STOCK_TRANSFER, ["transfer_id"], { transfer_id: id, status: "REJECTED" });
            submissionId = existing.submission_id;
            results.push({ id: id, ok: true });
        });
        if (submissionId) resolveTransferApprovalIfDone_(submissionId, actorId);
        return { ok: true, results: results };
    });
}

/** Called after every approve/decline — non-locking, caller already holds
 * the lock. Fires the TRANSFER_APPROVAL action's IN_PROGRESS/RESOLVED
 * transition and, once every line is decided, creates the TRANSFER_APPLY
 * follow-up action if there's anything approved left to apply. */
function resolveTransferApprovalIfDone_(submissionId, actorId) {
    const action = findOwnerAction_(submissionId, "TRANSFER_APPROVAL");
    if (!action) return;
    logActivity_(action.owner_action_id, actorId, "stock_transfer.status", "PENDING", "decided", "");

    const siblings = getRows(TABLES.STOCK_TRANSFER, { submission_id: submissionId });
    const stillPending = siblings.some((t) => t.status === "PENDING");
    advanceOwnerActionOnAction_(action.owner_action_id, {
        complete: !stillPending,
        note: "all transfers decided",
    });
    if (stillPending) return;

    const approvedCount = siblings.filter((t) => t.status === "APPROVED").length;
    if (approvedCount > 0) {
        insertRow_(TABLES.OWNER_ACTION, {
            owner_action_id: newId(),
            source_submission_id: submissionId,
            kiosk_id: action.kiosk_id,
            category: "TRANSFER_APPLY",
            title: `Apply ${approvedCount} approved transfer(s)`,
            status: "OPEN",
            priority: "NORMAL",
            created_at: nowStamp(),
        });
    }
}

/**
 * Applies one or more APPROVED transfers: posts the balanced OUT (source)
 * + IN (destination) stock_movement pair for each, sharing transfer_id/
 * reference_id, then flips status to APPLIED. Every write for the whole
 * batch happens inside this one withLock, using the non-locking DAL
 * primitives — that's what actually delivers "balanced pair, all-or-
 * nothing": no other write can interleave between an OUT and its matching
 * IN, for any transfer in the batch.
 */
function applyStockTransfers(transferIds, appliedBy) {
    return withLock(() => {
        const items = {};
        getRows(TABLES.STOCK_ITEM).forEach((s) => (items[s.stock_item_id] = s));
        const results = [];
        let submissionId = "";

        transferIds.forEach((id) => {
            const t = getRow(TABLES.STOCK_TRANSFER, { transfer_id: id });
            if (!t) { results.push({ id: id, ok: false, error: "Not found." }); return; }
            if (t.status !== "APPROVED") { results.push({ id: id, ok: false, error: "Not approved." }); return; }
            if (!t.source_kiosk_id || !t.destination_kiosk_id) {
                results.push({ id: id, ok: false, error: "Missing kiosk assignment." });
                return;
            }
            submissionId = t.submission_id;
            const item = items[t.stock_item_id];
            const unitCost = item && item.current_unit_cost !== "" ? Number(item.current_unit_cost) : "";
            const qty = Number(t.qty);
            const cost = unitCost === "" ? "" : Math.round(qty * unitCost * 100) / 100;
            const now = nowStamp();

            insertRow_(TABLES.STOCK_MOVEMENT, {
                stock_movement_id: newId(), submission_id: "", kiosk_id: t.source_kiosk_id,
                stock_item_id: t.stock_item_id, movement_type: "TRANSFER_OUT", direction: "OUT",
                movement_date: today(), qty: qty, unit_cost: unitCost, cost: cost,
                transfer_id: t.transfer_id, reference_id: t.transfer_id, created_at: now,
            });
            insertRow_(TABLES.STOCK_MOVEMENT, {
                stock_movement_id: newId(), submission_id: "", kiosk_id: t.destination_kiosk_id,
                stock_item_id: t.stock_item_id, movement_type: "TRANSFER_IN", direction: "IN",
                movement_date: today(), qty: qty, unit_cost: unitCost, cost: cost,
                transfer_id: t.transfer_id, reference_id: t.transfer_id, created_at: now,
            });
            updateRow_(TABLES.STOCK_TRANSFER, ["transfer_id"], { transfer_id: id, status: "APPLIED" });
            results.push({ id: id, ok: true });
        });

        if (submissionId) {
            const action = findOwnerAction_(submissionId, "TRANSFER_APPLY");
            if (action) {
                logActivity_(action.owner_action_id, appliedBy, "stock_transfer.status", "APPROVED", "APPLIED", "");
                const siblings = getRows(TABLES.STOCK_TRANSFER, { submission_id: submissionId });
                const allDone = siblings.every((t) => t.status === "APPLIED" || t.status === "REJECTED");
                advanceOwnerActionOnAction_(action.owner_action_id, {
                    complete: allDone,
                    note: "all approved transfers applied",
                });
            }
        }
        return { ok: true, results: results };
    });
}

/**
 * Add/edit a DRAFT invoice_line while its header is still IN_REVIEW —
 * lines may already exist as AI_EXTRACTED (from InvoiceAI.js) or start
 * from nothing if extraction failed/found none; owner can freely add,
 * correct, or remove any of them before confirming. Editing an
 * AI_EXTRACTED line reclassifies it OWNER_CORRECTED; a genuinely new line
 * is MANUAL_ENTRY.
 */
function saveInvoiceLine(deliveryHeaderId, isNew, line) {
    const header = getRow(TABLES.DELIVERY_HEADER, { delivery_header_id: deliveryHeaderId });
    if (!header) return { ok: false, error: "Delivery not found." };
    if (header.status !== "IN_REVIEW") return { ok: false, error: "This invoice has already been reviewed." };
    if (!String(line.description_raw || "").trim()) return { ok: false, error: "Description is required." };

    let source = "MANUAL_ENTRY";
    if (!isNew) {
        const existing = getRow(TABLES.INVOICE_LINE, { invoice_line_id: line.invoice_line_id });
        if (!existing) return { ok: false, error: "Line not found." };
        if (existing.status !== "DRAFT") return { ok: false, error: "Only draft lines can be edited." };
        source = existing.source === "AI_EXTRACTED" ? "OWNER_CORRECTED" : existing.source;
    }

    const clean = {
        invoice_line_id: isNew ? newId() : line.invoice_line_id,
        delivery_header_id: deliveryHeaderId,
        stock_item_id: line.stock_item_id || "",
        supplier_item_code: line.supplier_item_code || "",
        description_raw: String(line.description_raw).trim(),
        qty: line.qty !== undefined && line.qty !== "" ? Number(line.qty) : "",
        unit_cost: line.unit_cost !== undefined && line.unit_cost !== "" ? Number(line.unit_cost) : "",
        line_total: line.line_total !== undefined && line.line_total !== "" ? Number(line.line_total) : "",
        source: source,
        status: "DRAFT",
        approved_at: "",
        approved_by: "",
    };
    if (isNew) {
        insertRow(TABLES.INVOICE_LINE, clean);
    } else {
        updateRow(TABLES.INVOICE_LINE, ["invoice_line_id"], clean);
    }
    return { ok: true, row: clean };
}

function deleteInvoiceLine(invoiceLineId) {
    const line = getRow(TABLES.INVOICE_LINE, { invoice_line_id: invoiceLineId });
    if (!line) return { ok: false, error: "Line not found." };
    if (line.status !== "DRAFT") return { ok: false, error: "Only draft lines can be deleted." };
    const header = getRow(TABLES.DELIVERY_HEADER, { delivery_header_id: line.delivery_header_id });
    if (!header || header.status !== "IN_REVIEW") return { ok: false, error: "This invoice has already been reviewed." };
    deleteRows(TABLES.INVOICE_LINE, { invoice_line_id: invoiceLineId });
    return { ok: true };
}

/**
 * Whole-invoice Confirm: validates every remaining DRAFT line has
 * stock_item_id/qty>0/unit_cost>=0, then approves all of them together and
 * posts one stock_movement (DELIVERY_IN) per line — matches this
 * codebase's existing "Confirm Production" batch-confirm precedent rather
 * than per-line approve/reject. All in one withLock.
 */
function confirmInvoiceReview(deliveryHeaderId, confirmedBy) {
    return withLock(() => {
        const header = getRow(TABLES.DELIVERY_HEADER, { delivery_header_id: deliveryHeaderId });
        if (!header) return { ok: false, error: "Delivery not found." };
        if (header.status !== "IN_REVIEW") return { ok: false, error: "Already reviewed." };

        const lines = getRows(TABLES.INVOICE_LINE, { delivery_header_id: deliveryHeaderId }).filter(
            (l) => l.status === "DRAFT",
        );
        if (!lines.length) return { ok: false, error: "No lines to confirm — add at least one, or Decline instead." };

        for (const l of lines) {
            if (!l.stock_item_id) return { ok: false, error: `"${l.description_raw}" needs a stock item picked.` };
            const qty = Number(l.qty);
            if (!Number.isFinite(qty) || qty <= 0)
                return { ok: false, error: `"${l.description_raw}" needs a quantity greater than 0.` };
            const unitCost = Number(l.unit_cost);
            if (!Number.isFinite(unitCost) || unitCost < 0)
                return { ok: false, error: `"${l.description_raw}" needs a unit cost.` };
        }

        lines.forEach((l) => {
            const qty = Number(l.qty);
            const unitCost = Number(l.unit_cost);
            const lineTotal = l.line_total !== "" ? Number(l.line_total) : Math.round(qty * unitCost * 100) / 100;
            updateRow_(TABLES.INVOICE_LINE, ["invoice_line_id"], {
                invoice_line_id: l.invoice_line_id,
                line_total: lineTotal,
                status: "APPROVED",
                approved_at: nowStamp(),
                approved_by: confirmedBy,
            });
            insertRow_(TABLES.STOCK_MOVEMENT, {
                stock_movement_id: newId(),
                submission_id: "",
                kiosk_id: header.kiosk_id,
                stock_item_id: l.stock_item_id,
                movement_type: "DELIVERY_IN",
                direction: "IN",
                movement_date: header.delivery_date,
                qty: qty,
                unit_cost: unitCost,
                cost: lineTotal,
                reference_id: l.invoice_line_id,
                created_at: nowStamp(),
            });
        });

        updateRow_(TABLES.DELIVERY_HEADER, ["delivery_header_id"], {
            delivery_header_id: deliveryHeaderId,
            status: "REVIEWED",
        });

        const action = findOwnerAction_(header.submission_id, "INVOICE_REVIEW");
        if (action) {
            logActivity_(action.owner_action_id, confirmedBy, "delivery_header.status", "IN_REVIEW", "REVIEWED (confirmed)", "");
            advanceOwnerActionOnAction_(action.owner_action_id, { complete: true, note: "invoice confirmed" });
        }
        return { ok: true };
    });
}

/** Whole-invoice Decline: every remaining DRAFT line is REJECTED, nothing
 * posted. Same header lock/action-resolve shape as confirm. */
function declineInvoiceReview(deliveryHeaderId, declinedBy) {
    return withLock(() => {
        const header = getRow(TABLES.DELIVERY_HEADER, { delivery_header_id: deliveryHeaderId });
        if (!header) return { ok: false, error: "Delivery not found." };
        if (header.status !== "IN_REVIEW") return { ok: false, error: "Already reviewed." };

        getRows(TABLES.INVOICE_LINE, { delivery_header_id: deliveryHeaderId })
            .filter((l) => l.status === "DRAFT")
            .forEach((l) =>
                updateRow_(TABLES.INVOICE_LINE, ["invoice_line_id"], { invoice_line_id: l.invoice_line_id, status: "REJECTED" }),
            );

        updateRow_(TABLES.DELIVERY_HEADER, ["delivery_header_id"], {
            delivery_header_id: deliveryHeaderId,
            status: "REVIEWED",
        });

        const action = findOwnerAction_(header.submission_id, "INVOICE_REVIEW");
        if (action) {
            logActivity_(action.owner_action_id, declinedBy, "delivery_header.status", "IN_REVIEW", "REVIEWED (declined)", "");
            advanceOwnerActionOnAction_(action.owner_action_id, { complete: true, note: "invoice declined" });
        }
        return { ok: true };
    });
}

/**
 * Final pass/fail/NA outcome for one audit_answer, given its question.
 * NA questions are excluded from scoring entirely, regardless of decision.
 * OVERRIDE_PASS/OVERRIDE_FAIL are explicit; ACCEPT inherits the staff
 * answer's own pass/fail (compared against pass_answer); no decision yet
 * returns null (not yet reviewed).
 */
function auditFinalOutcome_(answer, question) {
    if (answer.staff_answer === "NA") return "NA";
    if (!answer.owner_decision) return null;
    if (answer.owner_decision === "OVERRIDE_PASS") return "PASS";
    if (answer.owner_decision === "OVERRIDE_FAIL" || answer.owner_decision === "EVIDENCE_INSUFFICIENT") return "FAIL";
    if (answer.owner_decision === "ACCEPT") return answer.staff_answer === question.pass_answer ? "PASS" : "FAIL";
    return null;
}

/**
 * Owner reviews one audit_answer. Per spec §18.1, each owner-confirmed
 * failure automatically creates one corrective_action (deadline from the
 * AUDIT_CRITICAL_CORRECTION_DAYS/AUDIT_CORRECTION_DAYS settings, default 2
 * days if the question is critical, else 7) — idempotent, checked by
 * existing audit_response_id+audit_question_id pair, so re-reviewing the
 * same answer never creates a duplicate. Once every answer on the response
 * has a decision, computes final_score/final_rating (weighted % of PASS
 * questions, NA excluded) against the AUDIT_PASS_PCT/AUDIT_ATTENTION_PCT
 * settings (default 90%/80%) and resolves the AUDIT_REVIEW action;
 * otherwise just fires the IN_PROGRESS transition.
 */
function reviewAuditAnswer(auditAnswerId, decision, note, reviewedBy) {
    return withLock(() => {
        const answer = getRow(TABLES.AUDIT_ANSWER, { audit_answer_id: auditAnswerId });
        if (!answer) return { ok: false, error: "Answer not found." };
        const question = getRow(TABLES.AUDIT_QUESTION, { audit_question_id: answer.audit_question_id });
        if (!question) return { ok: false, error: "Question not found." };
        if (!["ACCEPT", "OVERRIDE_PASS", "OVERRIDE_FAIL", "EVIDENCE_INSUFFICIENT"].includes(decision)) {
            return { ok: false, error: "Unknown decision." };
        }
        if ((decision === "OVERRIDE_FAIL" || decision === "EVIDENCE_INSUFFICIENT") && !String(note || "").trim()) {
            return { ok: false, error: "A note is required when overriding to fail or marking evidence insufficient." };
        }

        updateRow_(TABLES.AUDIT_ANSWER, ["audit_answer_id"], {
            audit_answer_id: auditAnswerId,
            owner_decision: decision,
            owner_note: note || "",
        });

        const response = getRow(TABLES.AUDIT_RESPONSE, { audit_response_id: answer.audit_response_id });
        const decidedAnswer = Object.assign({}, answer, { owner_decision: decision });
        if (auditFinalOutcome_(decidedAnswer, question) === "FAIL") {
            const already = getRow(TABLES.CORRECTIVE_ACTION, {
                audit_response_id: answer.audit_response_id,
                audit_question_id: answer.audit_question_id,
            });
            if (!already) {
                insertRow_(TABLES.CORRECTIVE_ACTION, {
                    corrective_action_id: newId(),
                    audit_response_id: answer.audit_response_id,
                    audit_question_id: answer.audit_question_id,
                    kiosk_id: response.kiosk_id,
                    status: "OPEN",
                    deadline: addDays(
                        today(),
                        question.critical === true
                            ? getSettingNum("AUDIT_CRITICAL_CORRECTION_DAYS", 2)
                            : getSettingNum("AUDIT_CORRECTION_DAYS", 7),
                    ),
                    created_at: nowStamp(),
                    closed_at: "",
                });
            }
        }

        const questionsById = {};
        getRows(TABLES.AUDIT_QUESTION).forEach((q) => (questionsById[q.audit_question_id] = q));
        const allAnswers = getRows(TABLES.AUDIT_ANSWER, { audit_response_id: answer.audit_response_id });
        const allDecided = allAnswers.every((a) => !!a.owner_decision);

        const action = findOwnerAction_(response.submission_id, "AUDIT_REVIEW");

        if (allDecided) {
            let passWeight = 0;
            let totalWeight = 0;
            allAnswers.forEach((a) => {
                const q = questionsById[a.audit_question_id];
                const outcome = auditFinalOutcome_(a, q);
                if (outcome === "NA" || !outcome) return;
                const w = Number(q.weight) || 1;
                totalWeight += w;
                if (outcome === "PASS") passWeight += w;
            });
            const scorePct = totalWeight > 0 ? Math.round((passWeight / totalWeight) * 10000) / 100 : 0;
            const passPct = getSettingNum("AUDIT_PASS_PCT", 90);
            const attentionPct = getSettingNum("AUDIT_ATTENTION_PCT", 80);
            const rating = scorePct >= passPct ? "PASS" : scorePct >= attentionPct ? "ATTENTION" : "ACTION_REQUIRED";
            updateRow_(TABLES.AUDIT_RESPONSE, ["audit_response_id"], {
                audit_response_id: response.audit_response_id,
                review_status: "FULLY_REVIEWED",
                final_score: scorePct,
                final_rating: rating,
            });
            if (action) advanceOwnerActionOnAction_(action.owner_action_id, { complete: true, note: "audit fully reviewed" });
        } else {
            updateRow_(TABLES.AUDIT_RESPONSE, ["audit_response_id"], {
                audit_response_id: response.audit_response_id,
                review_status: "PARTIALLY_REVIEWED",
            });
            if (action) advanceOwnerActionOnAction_(action.owner_action_id, { complete: false, note: "audit answer reviewed" });
        }

        return { ok: true };
    });
}

/**
 * Owner reviews replacement evidence for one corrective_action. Accept
 * closes it for good; Reject leaves it OPEN so the kiosk must resubmit —
 * that next audit_correction submission's own correction_cycle increments
 * automatically (existing FormAuditCorrection.js logic, unchanged), and a
 * new AUDIT_CORRECTION_REVIEW action is what continues the loop, not this
 * one staying open indefinitely.
 */
function reviewAuditCorrection(auditCorrectionId, decision, reviewedBy) {
    return withLock(() => {
        const correction = getRow(TABLES.AUDIT_CORRECTION, { audit_correction_id: auditCorrectionId });
        if (!correction) return { ok: false, error: "Correction not found." };
        if (decision !== "ACCEPT" && decision !== "REJECT") return { ok: false, error: "Unknown decision." };

        updateRow_(TABLES.CORRECTIVE_ACTION, ["corrective_action_id"], {
            corrective_action_id: correction.corrective_action_id,
            status: decision === "ACCEPT" ? "CLOSED" : "OPEN",
            closed_at: decision === "ACCEPT" ? nowStamp() : "",
        });

        const action = findOwnerAction_(correction.submission_id, "AUDIT_CORRECTION_REVIEW");
        if (action) {
            logActivity_(
                action.owner_action_id,
                reviewedBy,
                "corrective_action.status",
                "REPLACEMENT_SUBMITTED",
                decision === "ACCEPT" ? "CLOSED" : "OPEN",
                "",
            );
            advanceOwnerActionOnAction_(action.owner_action_id, {
                complete: true,
                note: "audit correction " + decision.toLowerCase() + "d",
            });
        }
        return { ok: true };
    });
}

/**
 * Generic triage edit — status/priority/assigned_to/owner_note/due_date.
 * Writes one real activity_log row per changed field, sets/clears
 * resolved_at when status enters/leaves a resolved-type status.
 */
function updateOwnerAction(ownerActionId, changes, changedBy) {
    return withLock(() => {
        const existing = getRow(TABLES.OWNER_ACTION, { owner_action_id: ownerActionId });
        if (!existing) return { ok: false, error: "Action not found." };

        const editable = ["status", "priority", "assigned_to", "owner_note", "due_date"];
        const patch = { owner_action_id: ownerActionId };
        const logEntries = [];

        editable.forEach((f) => {
            if (!changes.hasOwnProperty(f)) return;
            const oldVal = existing[f];
            const newVal = changes[f];
            if (String(oldVal || "") === String(newVal || "")) return;
            patch[f] = newVal;
            logEntries.push({ field: f, old: oldVal, new: newVal });
        });
        if (!logEntries.length) return { ok: true, row: existing };

        if (patch.status !== undefined) {
            patch.resolved_at = OWNER_ACTION_RESOLVED_STATUSES.includes(patch.status) ? nowStamp() : "";
        }

        const updated = updateRow_(TABLES.OWNER_ACTION, ["owner_action_id"], patch);
        logEntries.forEach((l) =>
            logActivity_(ownerActionId, changedBy, l.field, l.old, l.new, changes.logNote || ""),
        );
        return { ok: true, row: updated };
    });
}

/** Shared activity_log writer — matches the live schema exactly. */
function logActivity_(ownerActionId, changedBy, fieldChanged, oldValue, newValue, note) {
    insertRow_(TABLES.ACTIVITY_LOG, {
        activity_log_id: newId(),
        owner_action_id: ownerActionId,
        changed_at: nowStamp(),
        changed_by: changedBy,
        field_changed: fieldChanged,
        old_value: oldValue,
        new_value: newValue,
        note: note || "",
    });
}

/**
 * Auto-progression: OPEN -> IN_PROGRESS the first time a real owner
 * approval action touches this action; -> RESOLVED (stamps resolved_at)
 * once opts.complete is true — but only while still OPEN/IN_PROGRESS, so
 * this never overrides a manual WAITING_FOR_OWNER/CLOSED/NOT_PROCEEDING.
 * Callers wrap their own call site in withLock — this uses non-locking
 * writes internally.
 */
function advanceOwnerActionOnAction_(ownerActionId, opts) {
    const action = getRow(TABLES.OWNER_ACTION, { owner_action_id: ownerActionId });
    if (!action) return;
    if (action.status === "OPEN") {
        updateRow_(TABLES.OWNER_ACTION, ["owner_action_id"], { owner_action_id: ownerActionId, status: "IN_PROGRESS" });
        logActivity_(ownerActionId, "system", "status", "OPEN", "IN_PROGRESS", "auto: " + opts.note);
    }
    if (opts.complete && (action.status === "OPEN" || action.status === "IN_PROGRESS")) {
        updateRow_(TABLES.OWNER_ACTION, ["owner_action_id"], {
            owner_action_id: ownerActionId,
            status: "RESOLVED",
            resolved_at: nowStamp(),
        });
        logActivity_(ownerActionId, "system", "status", action.status, "RESOLVED", "auto: " + opts.note);
    }
}

/** Shared lookup used by every category's approval function to find the
 * owner_action tied to a given submission + category. */
function findOwnerAction_(sourceSubmissionId, category) {
    return getRow(TABLES.OWNER_ACTION, { source_submission_id: sourceSubmissionId, category: category });
}
