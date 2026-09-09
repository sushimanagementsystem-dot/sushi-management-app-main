/**
 * FormMoveStock.js — Move Stock Between Kiosks (spec §3.12): staff create a
 * transfer REQUEST only — never moves stock directly. Writes `stock_transfer`
 * rows with status PENDING and raises one owner_action (TRANSFER_APPROVAL)
 * per line so it surfaces in the owner's approval queue. Applying an approved
 * transfer (the balanced OUT+IN stock_movement pair, all-or-nothing) is a
 * future owner-dashboard action — this processor never touches stock_movement.
 *
 * Structural guarantee: this form only ever deals with stock_item, never
 * product, so made-in-kiosk finished sushi can't be selected (spec exclusion
 * is automatic, not a rule we have to enforce separately).
 */

function getMoveStockData(token) {
    const kiosk = getKioskByToken(token);
    if (!kiosk) return { ok: false, error: "Invalid kiosk link." };

    const catNames = {};
    getEnumOptions("stock_category").forEach((r) => (catNames[r.value] = r.label));
    const items = getRows(TABLES.STOCK_ITEM, (r) => r.active === true).map(
        (r) => ({
            id: r.stock_item_id,
            name: r.name,
            unit: r.count_unit,
            cat: catNames[r.stock_category_id] || "Other",
        }),
    );
    const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true).map((r) => ({
        id: r.kiosk_id,
        name: r.name,
    }));

    return {
        ok: true,
        businessDate: today(),
        thisKiosk: { id: kiosk.kiosk_id, name: kiosk.name },
        kiosks: kiosks,
        items: items,
        reasons: getEnumOptions("transfer_reason"),
    };
}

function buildMoveStockKey(ctx) {
    return `MOVE_STOCK|${ctx.kiosk.kiosk_id}|${ctx.payload.client_key || "no-key"}`;
}

/**
 * Intake check: payload shape only, no sheet reads (shown to staff directly).
 * Source/destination may each be left blank ("owner to decide") — staff often
 * know only one side (they need X, or they have surplus X) — but not both
 * blank at once, since then there's nothing actionable to approve.
 */
function validateMoveStock(p) {
    if (!p.client_key)
        throw new Error("Missing form key — reload the page and try again.");
    if (!p.source_kiosk_id && !p.destination_kiosk_id)
        throw new Error(
            "Select at least one kiosk — where it's coming from, or going to.",
        );
    if (p.source_kiosk_id && p.source_kiosk_id === p.destination_kiosk_id)
        throw new Error("Source and destination kiosks must be different.");
    const lines = p.lines || [];
    if (!lines.length) throw new Error("Add at least one item.");
    lines.forEach((ln, i) => {
        const q = Number(ln.qty);
        if (!ln.stock_item_id || !Number.isFinite(q) || q <= 0)
            throw new Error(
                `Line ${i + 1}: quantity must be a number greater than 0.`,
            );
    });
}

function processMoveStock(ctx) {
    const p = ctx.payload;

    ctx.stage = "resolve kiosks/items";
    const source = p.source_kiosk_id
        ? getRow(TABLES.KIOSK, {
              kiosk_id: String(p.source_kiosk_id),
              active: true,
          })
        : null;
    if (p.source_kiosk_id && !source)
        throw new Error("Unknown or inactive source kiosk.");
    const dest = p.destination_kiosk_id
        ? getRow(TABLES.KIOSK, {
              kiosk_id: String(p.destination_kiosk_id),
              active: true,
          })
        : null;
    if (p.destination_kiosk_id && !dest)
        throw new Error("Unknown or inactive destination kiosk.");
    if (source && dest && dest.kiosk_id === source.kiosk_id)
        throw new Error("Source and destination kiosks must be different.");

    const items = {};
    getRows(TABLES.STOCK_ITEM).forEach((r) => (items[r.stock_item_id] = r));

    ctx.stage = "write stock_transfer";
    const lineSummaries = [];
    (p.lines || []).forEach((ln) => {
        const item = items[ln.stock_item_id];
        if (!item) throw new Error(`Unknown stock item "${ln.stock_item_id}".`);

        insertRow(TABLES.STOCK_TRANSFER, {
            transfer_id: newId(),
            submission_id: ctx.submissionId,
            source_kiosk_id: source ? source.kiosk_id : "",
            destination_kiosk_id: dest ? dest.kiosk_id : "",
            stock_item_id: item.stock_item_id,
            qty: Number(ln.qty),
            count_unit: item.count_unit,
            reason: p.reason || "",
            note: String(p.note || "").trim(),
            user_id: ctx.userId || "",
            status: "PENDING",
        });
        ctx.written = true;
        lineSummaries.push(`${ln.qty} ${item.count_unit} ${item.name}`);
    });

    ctx.stage = "write owner_action";
    insertRow(TABLES.OWNER_ACTION, {
        owner_action_id: newId(),
        source_submission_id: ctx.submissionId,
        kiosk_id: ctx.kiosk.kiosk_id,
        category: "TRANSFER_APPROVAL",
        title: `Transfer request: ${lineSummaries.length} item(s) — ${source ? source.kiosk_id : "?"} -> ${dest ? dest.kiosk_id : "?"}`,
        status: "OPEN",
        priority: "NORMAL",
        owner_note: lineSummaries.join("; "),
        created_at: nowStamp(),
    });
}
