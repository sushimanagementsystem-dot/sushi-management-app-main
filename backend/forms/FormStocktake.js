/**
 * FormStocktake.js — Weekly Stocktake (spec §3.9).
 *
 * A stocktake is a complete snapshot: the form requires an explicit number for
 * every active stock item (0 valid, decimals allowed for kg/litre units).
 * Latest complete accepted submission wins (daily key, delete+rewrite).
 * A submission that somehow arrives partial is stored as INCOMPLETE and must
 * never update current stock or purchasing.
 *
 * Every COMPLETE stocktake raises one STOCKTAKE_REVIEW owner action (not
 * just variance ones — reconciliation movements only ever post after an
 * explicit owner Confirm in the Action Inbox, so every stocktake needs a
 * queue entry to reach that gate). Variance vs the previous complete
 * stocktake (> pct AND >= units settings) only affects priority (URGENT vs
 * NORMAL) and the note text — a review prompt, not an accusation.
 */

/** Countable stock items: active, excluding the per-100g waste-costing rows. */
function getStocktakeItems_() {
    const catNames = {};
    getEnumOptions("stock_category").forEach((r) => (catNames[r.value] = r.label));
    return getRows(TABLES.STOCK_ITEM, (r) => r.active === true)
        .map((r) => ({
            id: r.stock_item_id,
            name: r.name,
            unit: r.count_unit,
            cat: catNames[r.stock_category_id] || "Other",
        }))
        .filter((it) => it.cat.toLowerCase().indexOf("per 100g") === -1);
}

function getStocktakeData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };
    const bizDate = today();

    const existing = {};
    const header = getRow(
        TABLES.STOCKTAKE_HEADER,
        (r) =>
            r.kiosk_id === kiosk.kiosk_id &&
            asDateStr(r.stocktake_date) === bizDate,
    );
    if (header) {
        getRows(TABLES.STOCKTAKE_LINE, {
            stocktake_header_id: header.stocktake_header_id,
        }).forEach((r) => (existing[r.stock_item_id] = Number(r.counted_qty)));
    }

    return {
        ok: true,
        businessDate: bizDate,
        items: getStocktakeItems_(),
        existingCounts: existing,
        alreadySubmitted: !!header,
    };
}

function buildStocktakeKey(ctx) {
    return `WEEKLY_STOCKTAKE|${ctx.kiosk.kiosk_id}|${ctx.businessDate}`;
}

/** Intake check: payload shape only, no sheet reads (shown to staff directly). */
function validateStocktake(p) {
    const counts = p.counts || {};
    const ids = Object.keys(counts);
    if (!ids.length) throw new Error("No counts submitted.");
    ids.forEach((iid) => {
        const q = Number(counts[iid]);
        if (!Number.isFinite(q) || q < 0)
            throw new Error(`"${iid}": count must be a number, 0 or more.`);
    });
}

/**
 * Cascade: delete lines of superseded headers before the headers
 * themselves. Blocks the resubmit entirely (throws, same pattern as
 * Monthly Audit's review lock) once the owner has already acted on a
 * stocktake — reconciliation movements may already be posted, and a
 * resubmit clearing the header/lines behind them would orphan those
 * movements. Runs before def.process() (see Pipeline.js's
 * processSubmission_), so this is the only place this guard can catch a
 * resubmit before real rows are deleted.
 */
function clearStocktakeExtra(oldIds, ctx) {
    const oldHeaders = getRows(TABLES.STOCKTAKE_HEADER, (r) =>
        oldIds.includes(r.submission_id),
    );
    const blocked = oldHeaders.find(
        (h) => h.reconciliation_status && h.reconciliation_status !== "PENDING",
    );
    if (blocked) {
        throw new Error(
            "This stocktake has already been reviewed by the owner — it can no longer be resubmitted.",
        );
    }
    const oldHeaderIds = oldHeaders.map((h) => h.stocktake_header_id);
    if (oldHeaderIds.length) {
        const n = deleteRows(TABLES.STOCKTAKE_LINE, (r) =>
            oldHeaderIds.includes(r.stocktake_header_id),
        );
        if (n > 0) ctx.written = true;
    }
}

function processStocktake(ctx) {
    const counts = ctx.payload.counts || {};

    ctx.stage = "load items";
    const items = getStocktakeItems_();
    const itemById = {};
    items.forEach((it) => (itemById[it.id] = it));

    const expected = items.length;
    const received = items.filter((it) => counts[it.id] !== undefined).length;
    const complete = received >= expected;

    ctx.stage = "load previous stocktake";
    const prevHeader = getRows(
        TABLES.STOCKTAKE_HEADER,
        (r) =>
            r.kiosk_id === ctx.kiosk.kiosk_id &&
            r.completion_status === "COMPLETE" &&
            asDateStr(r.stocktake_date) < ctx.businessDate,
    ).sort((a, b) =>
        asDateStr(b.stocktake_date).localeCompare(asDateStr(a.stocktake_date)),
    )[0];
    const prevCounts = {};
    if (prevHeader) {
        getRows(TABLES.STOCKTAKE_LINE, {
            stocktake_header_id: prevHeader.stocktake_header_id,
        }).forEach(
            (r) => (prevCounts[r.stock_item_id] = Number(r.counted_qty)),
        );
    }

    ctx.stage = "write header/lines";
    const headerId = newId();
    insertRow(TABLES.STOCKTAKE_HEADER, {
        stocktake_header_id: headerId,
        submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        stocktake_date: ctx.businessDate,
        expected_item_count: expected,
        received_item_count: received,
        completion_status: complete ? "COMPLETE" : "INCOMPLETE",
        reconciliation_status: "PENDING",
    });
    ctx.written = true;

    Object.keys(counts).forEach((iid) => {
        const it = itemById[iid];
        if (!it) return;
        insertRow(TABLES.STOCKTAKE_LINE, {
            stocktake_line_id: newId(),
            stocktake_header_id: headerId,
            stock_item_id: iid,
            counted_qty: Number(counts[iid]),
            count_unit: it.unit,
        });
    });

    if (!complete) return "INCOMPLETE";

    ctx.stage = "variance check";
    const flagged = [];
    if (prevHeader) {
        const pct = getSettingNum("STOCKTAKE_VARIANCE_PCT", 50);
        const minUnits = getSettingNum("STOCKTAKE_VARIANCE_MIN_UNITS", 5);
        items.forEach((it) => {
            const prev = prevCounts[it.id];
            if (prev === undefined || prev === 0) return;
            const cur = Number(counts[it.id]);
            const move = Math.abs(cur - prev);
            if (move >= minUnits && (move / prev) * 100 > pct)
                flagged.push(`${it.name}: ${prev} -> ${cur} ${it.unit}`);
        });
    }

    ctx.stage = "write owner_action";
    insertRow(TABLES.OWNER_ACTION, {
        owner_action_id: newId(),
        source_submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        category: "STOCKTAKE_REVIEW",
        title: flagged.length
            ? `Stocktake variance — ${ctx.kiosk.kiosk_id} ${ctx.businessDate} (${flagged.length} item(s))`
            : `Stocktake review — ${ctx.kiosk.kiosk_id} ${ctx.businessDate}`,
        status: "OPEN",
        priority: flagged.length ? "URGENT" : "NORMAL",
        owner_note: flagged.join("; "),
        created_at: nowStamp(),
    });
    return "PROCESSED";
}
