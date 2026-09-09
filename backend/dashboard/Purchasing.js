/**
 * Purchasing.js — weekly stock purchasing recommendations (spec §20).
 * Phase 1: pure computation only. No trigger, no owner_action/batch writes,
 * no email — that's runWeeklyPurchasingScan(), added in Phase 2. Every
 * function here is safe to call read-only from the Apps Script editor for
 * verification against real data.
 */

/** Sheet blank cells arrive as "" (never true null) — normalize to null. */
function blankToNull_(v) {
    return v === "" || v === null || v === undefined ? null : Number(v);
}

/** Latest date this kiosk+item was physically counted (STOCKTAKE_ADJUSTMENT
 * movement), not just any ledger touch. '' if never counted. movements:
 * pre-fetched stock_movement rows for one kiosk. */
function stockCountDate_(stockItemId, movements) {
    const dates = movements
        .filter((m) => m.stock_item_id === stockItemId && m.movement_type === "STOCKTAKE_ADJUSTMENT")
        .map((m) => asDateStr(m.movement_date))
        .sort();
    return dates.length ? dates[dates.length - 1] : "";
}

/**
 * Resolves the one supplier that should receive this item's purchasing
 * recommendation. supplierMapsByItem/suppliersById: pre-built lookup maps
 * (see buildPurchasingRecommendations_ — avoids re-reading the whole
 * supplier_item_map/supplier sheets per item).
 * Zero active mappings -> no recommendation possible.
 * More than one -> AMBIGUOUS_SUPPLIER, not guessed.
 */
function resolveSupplierForItem_(stockItemId, supplierMapsByItem, suppliersById) {
    const maps = supplierMapsByItem[stockItemId] || [];
    if (maps.length === 0) return { supplier: null, mapping: null, ambiguous: false };
    if (maps.length > 1) return { supplier: null, mapping: null, ambiguous: true };
    const mapping = maps[0];
    return { supplier: suppliersById[mapping.supplier_id] || null, mapping: mapping, ambiguous: false };
}

/**
 * Per spec 20.2-20.4. parRow: the stock_item_par row for this kiosk+item, or
 * null if none exists. movements: pre-fetched stock_movement rows for this
 * kiosk. No stock_item_par row -> SET_PAR. No movement history at all for
 * this item -> AWAIT_STOCKTAKE (a current balance of 0 from no data is not
 * the same as a confirmed empty count).
 */
function computeItemTrigger_(stockItemId, parRow, movements) {
    if (!parRow) return { triggered: false, currentStock: null, shortfall: 0, flag: "SET_PAR" };

    const hasHistory = movements.some((m) => m.stock_item_id === stockItemId);
    if (!hasHistory) return { triggered: false, currentStock: null, shortfall: 0, flag: "AWAIT_STOCKTAKE" };

    const currentStock = stockBalanceAsOf_(movements, stockItemId, null);
    const targetPar = blankToNull_(parRow.target_par);
    const minimumStock = blankToNull_(parRow.minimum_stock);
    const safetyStock = blankToNull_(parRow.safety_stock) || 0;
    const triggerPoint = minimumStock !== null ? minimumStock : targetPar;

    if (triggerPoint === null) return { triggered: false, currentStock: currentStock, shortfall: 0, flag: "SET_PAR" };
    if (currentStock > triggerPoint) return { triggered: false, currentStock: currentStock, shortfall: 0, flag: null };

    const refillLevel = (targetPar !== null ? targetPar : triggerPoint) + safetyStock;
    return { triggered: true, currentStock: currentStock, shortfall: Math.max(0, refillLevel - currentStock), flag: null };
}

/** 20.5: whole packs, then rounded up again to the supplier's order
 * multiple (default 1 = no extra rounding). */
function applyPackRounding_(shortfall, packSize, orderMultiple) {
    const size = packSize > 0 ? packSize : 1;
    const multiple = orderMultiple > 0 ? orderMultiple : 1;
    return Math.ceil(Math.ceil(shortfall / size) / multiple) * multiple;
}

/** 20.8: Castlebay salmon orders are always 4 boxes per triggered kiosk,
 * not shortfall-based. Matches on supplier name (see plan note — Castlebay
 * currently only supplies salmon, so this covers any item it's mapped to). */
function castlebayPacksOverride_(supplier) {
    return supplier && /^castlebay$/i.test(String(supplier.name || "").trim()) ? 4 : null;
}

/**
 * Orchestrates the above across every stock_item_par row (grouped by
 * stock_item_id, checked per its kiosk_id) plus every active
 * supplier_item_map'd stock item with zero stock_item_par rows at all
 * (real missing-setup case). Returns supplier-grouped consolidated lines
 * (spec 20.7) plus a diagnostic list for items with no resolvable supplier
 * or no par at all anywhere. Pure/read-only — no writes.
 */
function buildPurchasingRecommendations_() {
    const kiosks = getRows(TABLES.KIOSK, (r) => r.active === true);
    const activeKioskIds = {};
    kiosks.forEach((k) => (activeKioskIds[k.kiosk_id] = true));

    const stockItems = getRows(TABLES.STOCK_ITEM, (r) => r.active === true);

    const parRows = getRows(TABLES.STOCK_ITEM_PAR, () => true).filter((p) => activeKioskIds[p.kiosk_id]);
    const parByItem = {};
    parRows.forEach((p) => {
        if (!parByItem[p.stock_item_id]) parByItem[p.stock_item_id] = {};
        parByItem[p.stock_item_id][p.kiosk_id] = p;
    });

    const supplierMaps = getRows(TABLES.SUPPLIER_ITEM_MAP, (r) => r.active === true);
    const supplierMapsByItem = {};
    supplierMaps.forEach((m) => {
        if (!supplierMapsByItem[m.stock_item_id]) supplierMapsByItem[m.stock_item_id] = [];
        supplierMapsByItem[m.stock_item_id].push(m);
    });
    const suppliers = getRows(TABLES.SUPPLIER, (r) => r.active === true);
    const suppliersById = {};
    suppliers.forEach((s) => (suppliersById[s.supplier_id] = s));

    const allMovements = getRows(TABLES.STOCK_MOVEMENT, () => true);
    const movementsByKiosk = {};
    allMovements.forEach((m) => {
        if (!movementsByKiosk[m.kiosk_id]) movementsByKiosk[m.kiosk_id] = [];
        movementsByKiosk[m.kiosk_id].push(m);
    });

    const lines = [];
    const diagnosticLines = [];

    stockItems.forEach((item) => {
        const itemPars = parByItem[item.stock_item_id] || {};
        const kioskIdsWithPar = Object.keys(itemPars);
        const supplierResult = resolveSupplierForItem_(item.stock_item_id, supplierMapsByItem, suppliersById);

        if (kioskIdsWithPar.length === 0) {
            if (supplierResult.ambiguous) {
                diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["AMBIGUOUS_SUPPLIER"] });
            } else if (supplierResult.supplier && supplierResult.supplier.order_output_method !== "MANUAL") {
                diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["SET_PAR"] });
            }
            return;
        }

        const castlebayOverride = castlebayPacksOverride_(supplierResult.supplier);
        let totalShortfall = 0;
        let castlebayPacks = 0;
        let anyTriggered = false;
        let anyStale = false;
        let anyAwaitStocktake = false;

        kioskIdsWithPar.forEach((kioskId) => {
            const movements = movementsByKiosk[kioskId] || [];
            const trigger = computeItemTrigger_(item.stock_item_id, itemPars[kioskId], movements);
            if (trigger.flag === "AWAIT_STOCKTAKE") anyAwaitStocktake = true;
            if (!trigger.triggered) return;
            anyTriggered = true;
            if (castlebayOverride !== null) {
                castlebayPacks += castlebayOverride;
            } else {
                totalShortfall += trigger.shortfall;
            }
            const countDate = stockCountDate_(item.stock_item_id, movements);
            if (!countDate || daysBetween_(countDate, today()) > getSettingNum("STOCKTAKE_STALE_DAYS", 7)) anyStale = true;
        });

        if (!anyTriggered) {
            if (anyAwaitStocktake && supplierResult.supplier && supplierResult.supplier.order_output_method !== "MANUAL") {
                diagnosticLines.push({ stockItemId: item.stock_item_id, flags: ["AWAIT_STOCKTAKE"] });
            }
            return;
        }

        if (!supplierResult.supplier) {
            diagnosticLines.push({
                stockItemId: item.stock_item_id,
                flags: [supplierResult.ambiguous ? "AMBIGUOUS_SUPPLIER" : "NO_SUPPLIER"],
            });
            return;
        }
        if (supplierResult.supplier.order_output_method === "MANUAL") return;

        const packSize = Number(supplierResult.mapping.case_multiple) || 1;
        const orderMultiple = Number(supplierResult.mapping.order_multiple) || 1;
        const flags = [];
        if (anyStale) flags.push("STALE");

        let recommendedPacks;
        if (castlebayOverride !== null) {
            recommendedPacks = castlebayPacks;
            flags.push("CASTLEBAY_OVERRIDE");
        } else {
            recommendedPacks = applyPackRounding_(totalShortfall, packSize, orderMultiple);
        }

        lines.push({
            stockItemId: item.stock_item_id,
            supplierId: supplierResult.supplier.supplier_id,
            totalShortfall: totalShortfall,
            packSize: packSize,
            orderMultiple: orderMultiple,
            recommendedPacks: recommendedPacks,
            recommendedQty: recommendedPacks * packSize,
            flags: flags,
        });
    });

    const supplierBatches = {};
    lines.forEach((l) => {
        if (!supplierBatches[l.supplierId]) supplierBatches[l.supplierId] = [];
        supplierBatches[l.supplierId].push(l);
    });

    return { supplierBatches: supplierBatches, diagnosticLines: diagnosticLines };
}

/**
 * Writes one owner_action + purchasing_batch + purchasing_batch_line rows
 * for a batch. supplier/supplierId null = the shared "setup needed"
 * diagnostic batch. Per-row locked inserts (insertRow already wraps
 * insertRow_ in withLock — see DAL.js), not one lock around the whole scan,
 * so a slow Gmail draft call later doesn't hold the script lock.
 */
function createPurchasingBatch_(supplierId, supplier, lines, isDiagnostic) {
    const ownerActionId = newId();
    insertRow(TABLES.OWNER_ACTION, {
        owner_action_id: ownerActionId,
        source_submission_id: "",
        kiosk_id: "",
        category: "PURCHASING_RECOMMENDATION",
        title: isDiagnostic ? "Purchasing — setup needed" : `Purchasing recommendation — ${supplier.name}`,
        status: "OPEN",
        priority: "NORMAL",
        owner_note: "",
        created_at: nowStamp(),
    });

    const batchId = newId();
    insertRow(TABLES.PURCHASING_BATCH, {
        purchasing_batch_id: batchId,
        owner_action_id: ownerActionId,
        supplier_id: supplierId || "",
        order_output_method: supplier ? supplier.order_output_method : "",
        generated_at: nowStamp(),
    });

    lines.forEach((line) => {
        insertRow(TABLES.PURCHASING_BATCH_LINE, {
            purchasing_batch_line_id: newId(),
            purchasing_batch_id: batchId,
            stock_item_id: line.stockItemId,
            total_shortfall: line.totalShortfall || "",
            pack_size: line.packSize || "",
            order_multiple: line.orderMultiple || "",
            recommended_packs: line.recommendedPacks || "",
            recommended_qty: line.recommendedQty || "",
            flags: (line.flags || []).join(","),
        });
    });

    return { ownerActionId: ownerActionId, batchId: batchId };
}

/** Plain-text Gmail draft — never sent automatically (spec 20.10). One
 * recipient (supplier.contact_email); comma-separated already works there
 * if a supplier ever needs more than one. */
function draftPurchasingEmail_(supplier, lines, stockItemsById) {
    const bodyLines = lines.map((line) => {
        const item = stockItemsById[line.stockItemId];
        const name = item ? item.name : line.stockItemId;
        const unit = item ? item.count_unit : "";
        const flagsText = line.flags.length ? ` (${line.flags.join(", ")})` : "";
        return `${name}: ${line.recommendedPacks} pack(s) = ${line.recommendedQty} ${unit}${flagsText}`;
    });
    GmailApp.createDraft(
        supplier.contact_email || "",
        `Purchasing recommendation — ${supplier.name}`,
        `Purchasing recommendation for ${supplier.name}:\n\n${bodyLines.join("\n")}\n\nReview and send from your Drafts folder.`,
    );
}

/**
 * The scheduled entry point (weekly trigger, see setup() in Pipeline.js).
 * Skips suppliers with a still-open PURCHASING_RECOMMENDATION batch created
 * within PURCHASING_DUPLICATE_WINDOW_DAYS (spec 20.11). MANUAL suppliers
 * never reach here — buildPurchasingRecommendations_ already excludes them.
 */
function runWeeklyPurchasingScan() {
    const rec = buildPurchasingRecommendations_();

    const suppliersById = {};
    getRows(TABLES.SUPPLIER, () => true).forEach((s) => (suppliersById[s.supplier_id] = s));
    const stockItemsById = {};
    getRows(TABLES.STOCK_ITEM, () => true).forEach((s) => (stockItemsById[s.stock_item_id] = s));

    const windowDays = getSettingNum("PURCHASING_DUPLICATE_WINDOW_DAYS", 1);
    const cutoff = addDays(today(), -windowDays);
    const openStatuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_OWNER"];
    const recentActionIds = getRows(
        TABLES.OWNER_ACTION,
        (r) => r.category === "PURCHASING_RECOMMENDATION" && openStatuses.indexOf(r.status) !== -1 && asDateStr(r.created_at) >= cutoff,
    ).map((a) => a.owner_action_id);
    const recentSupplierIds = {};
    getRows(TABLES.PURCHASING_BATCH, (b) => recentActionIds.indexOf(b.owner_action_id) !== -1).forEach(
        (b) => (recentSupplierIds[b.supplier_id || "__diagnostic__"] = true),
    );

    let created = 0;
    let skipped = 0;

    Object.keys(rec.supplierBatches).forEach((supplierId) => {
        if (recentSupplierIds[supplierId]) {
            skipped++;
            return;
        }
        const supplier = suppliersById[supplierId];
        if (!supplier) return;
        const lines = rec.supplierBatches[supplierId];
        createPurchasingBatch_(supplierId, supplier, lines, false);
        created++;
        if (supplier.order_output_method === "GMAIL_DRAFT") {
            try {
                draftPurchasingEmail_(supplier, lines, stockItemsById);
            } catch (err) {
                console.error(`Purchasing scan: failed to create Gmail draft for supplier ${supplierId}: ${err}`);
            }
        }
    });

    if (rec.diagnosticLines.length) {
        if (recentSupplierIds["__diagnostic__"]) {
            skipped++;
        } else {
            createPurchasingBatch_(null, null, rec.diagnosticLines, true);
            created++;
        }
    }

    console.log(`Purchasing scan: ${created} batch(es) created, ${skipped} skipped (duplicate window)`);
    return { ok: true, created: created, skipped: skipped };
}
