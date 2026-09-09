/**
 * EngineSecondaryAllocation.js — rations Secondary-role sushi-rice items into
 * whatever rice capacity Primary items leave behind, instead of showing them
 * at their full raw target-minus-fridge quantity regardless of whether
 * there's actually rice for them (spec: Primary decides the batch; Secondary
 * only ever uses the leftover). Ported from the reference system's proven
 * algorithm (fairness-rotation greedy fill + prawn-katsu bag rounding),
 * translated to this schema — not a line-for-line copy.
 *
 * Called once per plan build, from Engine.js, after Primary/batch-count math
 * (frozen, untouched) has already fixed the rice capacity for the day.
 */

const SECONDARY_ALLOCATION_ROLES = ["SECONDARY", "SEASONAL_SECONDARY"];
const SECONDARY_ALLOCATION_MAX_ITER = 500;

function productUsesSushiRice_(productId, recipe, comps) {
    return (recipe[productId] || []).some((rc) => {
        const c = comps[rc.component_id];
        return (
            c &&
            ["ROLL", "MAKI", "NIGIRI", "DIRECT_SUSHI_RICE"].indexOf(
                c.component_type,
            ) !== -1
        );
    });
}

function productComponentQty_(productId, componentId, recipe) {
    return (recipe[productId] || [])
        .filter((rc) => rc.component_id === componentId)
        .reduce((sum, rc) => sum + Number(rc.qty), 0);
}

function componentRawQuantity_(lines, recipe, componentId) {
    let total = 0;
    lines.forEach((ln) => {
        if (!ln.make) return;
        total += ln.make * productComponentQty_(ln.product_id, componentId, recipe);
    });
    return total;
}

/** Discrete (ceil-to-whole-prep-unit) rice grams — deliberately separate from
 * Engine.js's continuous grams() used for the frozen Primary/batch-count
 * math. This one answers "does the next increment actually cost more rice
 * right now", which requires whole-prep-unit rounding, not a fractional
 * formula. prepOverride lets balancePrawnKatsu_ trial a specific bag-rounded
 * prep quantity for one component without changing anyone's `make`. */
function riceGramsForLinesDiscrete_(lines, recipe, comps, prepOverride) {
    const gPerMaki = getSettingNum("RICE_PER_MAKI_G", 90);
    const gPerRoll = getSettingNum("RICE_PER_FULL_ROLL_G", 125);
    const gPerNigiri = getSettingNum("RICE_PER_NIGIRI_G", 24);

    const raw = {};
    lines.forEach((ln) => {
        if (!ln.make) return;
        (recipe[ln.product_id] || []).forEach((rc) => {
            raw[rc.component_id] =
                (raw[rc.component_id] || 0) + ln.make * Number(rc.qty);
        });
    });

    let total = 0;
    Object.keys(raw).forEach((cid) => {
        const c = comps[cid];
        if (!c) return;
        const upp = Number(c.units_per_prep_unit) || 1;
        if (c.component_type === "ROLL" || c.component_type === "MAKI") {
            const prepUnits =
                prepOverride && prepOverride[cid] !== undefined
                    ? prepOverride[cid]
                    : Math.ceil(raw[cid] / upp);
            total += prepUnits * (c.component_type === "ROLL" ? gPerRoll : gPerMaki);
        } else if (c.component_type === "NIGIRI") {
            total += raw[cid] * gPerNigiri;
        } else if (c.component_type === "DIRECT_SUSHI_RICE") {
            total += raw[cid];
        }
    });
    return total;
}

/** Dormant, settings-driven "multi-box-per-prep-unit" rule (spec: Sando —
 * "one preparation unit creates 2 sale boxes"). No live Sando product exists
 * today, so SANDO_STEP_PRODUCT_IDS is blank and this is always a no-op. */
function sandoStepFor_(productId) {
    const ids = getSetting("SANDO_STEP_PRODUCT_IDS", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    return ids.indexOf(productId) !== -1
        ? getSettingNum("SANDO_UNITS_PER_PREP", 2)
        : 1;
}

function sandoCapFor_(productId, rawCap) {
    const step = sandoStepFor_(productId);
    return step * Math.ceil(rawCap / step);
}

/** Rolling-window production history (kiosk+product) from the already
 * durably-written production_plan table — no new table needed. Window is
 * [businessDate-lookbackDays, businessDate), strictly before today, so this
 * can never see rows from the run currently in progress. */
function loadSecondaryProductionHistory_(kioskId, businessDate, lookbackDays) {
    const windowStart = addDays(businessDate, -lookbackDays);
    const history = {};
    getRows(
        TABLES.PRODUCTION_PLAN,
        (r) =>
            r.kiosk_id === kioskId &&
            asDateStr(r.business_date) >= windowStart &&
            asDateStr(r.business_date) < businessDate,
    ).forEach((r) => {
        const h = (history[r.product_id] = history[r.product_id] || {
            totalQty: 0,
            lastDate: "",
        });
        h.totalQty += Number(r.planned_qty) || 0;
        const d = asDateStr(r.business_date);
        if (d > h.lastDate) h.lastDate = d;
    });
    return history;
}

/**
 * Greedy-fills Secondary/Seasonal-Secondary sushi-rice items into whatever
 * capacity Primary left behind, one prep-increment at a time, prioritized by
 * production fairness (least-made-recently first) so variety rotates rather
 * than always favoring the same item. Then hands off to the prawn-katsu
 * bag-rounding pass. Mutates nothing outside its own cloned `lines`.
 */
function allocateSecondaryAndPrawnKatsu_(
    lines,
    kioskId,
    businessDate,
    comps,
    recipe,
    sushiCapacityG,
) {
    lines = lines.map((ln) => Object.assign({}, ln));

    if (sushiCapacityG <= 0) {
        lines.forEach((ln) => {
            if (
                SECONDARY_ALLOCATION_ROLES.indexOf(ln.role) !== -1 &&
                productUsesSushiRice_(ln.product_id, recipe, comps)
            )
                ln.make = 0;
        });
        return {
            lines: lines,
            prawnKatsu: { bags: 0, prepRolls: 0, spare: 0, shortfallNote: null },
        };
    }

    const history = loadSecondaryProductionHistory_(
        kioskId,
        businessDate,
        getSettingNum("SECONDARY_HISTORY_LOOKBACK_DAYS", 7),
    );

    lines.forEach((ln) => {
        if (
            SECONDARY_ALLOCATION_ROLES.indexOf(ln.role) !== -1 &&
            productUsesSushiRice_(ln.product_id, recipe, comps)
        ) {
            ln.cap = sandoCapFor_(ln.product_id, ln.make);
            ln.make = 0;
        }
    });

    const sequence = [];
    let currentGrams = riceGramsForLinesDiscrete_(lines, recipe, comps);

    for (let i = 0; i < SECONDARY_ALLOCATION_MAX_ITER; i++) {
        const candidates = [];
        lines.forEach((ln) => {
            if (SECONDARY_ALLOCATION_ROLES.indexOf(ln.role) === -1) return;
            if (ln.cap === undefined || ln.make >= ln.cap) return;
            const step = sandoStepFor_(ln.product_id);
            if (ln.make + step > ln.cap) return;

            const trial = lines.map((l) =>
                l === ln ? Object.assign({}, l, { make: l.make + step }) : l,
            );
            const trialGrams = riceGramsForLinesDiscrete_(trial, recipe, comps);
            const incremental = trialGrams - currentGrams;
            if (incremental < 0 || trialGrams > sushiCapacityG) return;

            const hist = history[ln.product_id] || { totalQty: 0, lastDate: "" };
            candidates.push({
                ln: ln,
                trial: trial,
                trialGrams: trialGrams,
                incremental: incremental,
                weeklyQty: hist.totalQty,
                lastDateKey: hist.lastDate,
                productId: ln.product_id,
            });
        });

        if (!candidates.length) break;
        candidates.sort(
            (a, b) =>
                a.weeklyQty - b.weeklyQty ||
                (a.lastDateKey < b.lastDateKey
                    ? -1
                    : a.lastDateKey > b.lastDateKey
                      ? 1
                      : 0) ||
                b.incremental - a.incremental ||
                a.productId.localeCompare(b.productId),
        );

        const win = candidates[0];
        lines = win.trial;
        currentGrams = win.trialGrams;
        sequence.push(win.productId);
    }

    const prawnResult = balancePrawnKatsu_(
        lines,
        history,
        comps,
        recipe,
        sushiCapacityG,
        sequence,
    );
    return { lines: prawnResult.lines, prawnKatsu: prawnResult };
}

/**
 * Rounds real Prawn Katsu demand up to a whole number of rolls, then up
 * again to a full PRAWN_KATSU_ROLLS_PER_BAG-roll bag (a bag, once opened,
 * must be fully used). If the bag doesn't fit capacity, trims secondary
 * items that used it (most-recently-added first); if there's still surplus
 * bag capacity after rounding, tries to fill it with more secondary product.
 * Never throws — if it genuinely can't resolve, returns a shortfallNote and
 * lets the plan/email continue (soft-fail, confirmed decision: the
 * production email must always go out).
 */
function balancePrawnKatsu_(lines, history, comps, recipe, sushiCapacityG, sequence) {
    lines = lines.map((ln) => Object.assign({}, ln));
    sequence = sequence.slice();

    const cid = getSetting("PRAWN_KATSU_COMPONENT_ID", "");
    const c = comps[cid];
    if (!c)
        return { lines: lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

    const piecesPerRoll = Number(c.units_per_prep_unit) || 10;
    const rollsPerBag = getSettingNum("PRAWN_KATSU_ROLLS_PER_BAG", 5);

    let rawPieces = componentRawQuantity_(lines, recipe, cid);
    if (rawPieces <= 0)
        return { lines: lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

    // Phase 1 — trim secondary contributors, most-recently-added first,
    // until the bag-rounded prep quantity fits capacity, or nothing's left.
    for (;;) {
        const normalRolls = Math.ceil(rawPieces / piecesPerRoll);
        const prepRolls = Math.ceil(normalRolls / rollsPerBag) * rollsPerBag;
        const trialGrams = riceGramsForLinesDiscrete_(lines, recipe, comps, {
            [cid]: prepRolls,
        });
        if (trialGrams <= sushiCapacityG) break;

        let removed = false;
        for (let i = sequence.length - 1; i >= 0; i--) {
            const ln = lines.find((l) => l.product_id === sequence[i]);
            if (
                ln &&
                ln.make > 0 &&
                productComponentQty_(ln.product_id, cid, recipe) > 0
            ) {
                ln.make = Math.max(0, ln.make - sandoStepFor_(ln.product_id));
                sequence.splice(i, 1);
                removed = true;
                break;
            }
        }
        if (!removed) {
            lines.forEach((ln) => {
                if (
                    SECONDARY_ALLOCATION_ROLES.indexOf(ln.role) !== -1 &&
                    productComponentQty_(ln.product_id, cid, recipe) > 0
                )
                    ln.make = 0;
            });
            break;
        }
        rawPieces = componentRawQuantity_(lines, recipe, cid);
    }

    rawPieces = componentRawQuantity_(lines, recipe, cid);
    if (rawPieces === 0)
        return { lines: lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

    const prepRolls =
        Math.ceil(Math.ceil(rawPieces / piecesPerRoll) / rollsPerBag) * rollsPerBag;
    const targetPieces = prepRolls * piecesPerRoll;

    // Phase 2 — fill surplus with normal secondary candidates, respecting
    // each one's own cap. Phase 3 — if still short, allow eligible items to
    // exceed their normal cap (the opened bag must be used).
    lines = fillPrawnSurplus_(
        lines, history, comps, recipe, cid, targetPieces, sushiCapacityG, true,
    );
    lines = fillPrawnSurplus_(
        lines, history, comps, recipe, cid, targetPieces, sushiCapacityG, false,
    );

    const finalRaw = componentRawQuantity_(lines, recipe, cid);
    return {
        lines: lines,
        prepRolls: prepRolls,
        bags: prepRolls / rollsPerBag,
        spare: Math.max(0, targetPieces - finalRaw),
        shortfallNote:
            finalRaw === targetPieces
                ? null
                : `Prawn katsu bag rounding couldn't fully allocate the ${prepRolls}-roll bag — ` +
                  `${targetPieces - finalRaw} piece(s) short. Please check with the kitchen.`,
    };
}

/** Shared body of the reference system's two near-identical fill loops
 * (normal-cap and forced-over-cap), parameterized by respectCap. */
function fillPrawnSurplus_(
    lines, history, comps, recipe, cid, targetPieces, sushiCapacityG, respectCap,
) {
    for (let i = 0; i < SECONDARY_ALLOCATION_MAX_ITER; i++) {
        const rawPieces = componentRawQuantity_(lines, recipe, cid);
        const remaining = targetPieces - rawPieces;
        if (remaining <= 0) break;

        const candidates = [];
        lines.forEach((ln) => {
            if (SECONDARY_ALLOCATION_ROLES.indexOf(ln.role) === -1) return;
            const perUnit = productComponentQty_(ln.product_id, cid, recipe);
            if (perUnit <= 0) return;

            const step = respectCap ? sandoStepFor_(ln.product_id) : 1;
            if (respectCap && ln.cap !== undefined && ln.make + step > ln.cap) return;
            const componentPieces = perUnit * step;
            if (componentPieces > remaining) return;

            const trial = lines.map((l) =>
                l === ln ? Object.assign({}, l, { make: l.make + step }) : l,
            );
            const trialGrams = riceGramsForLinesDiscrete_(trial, recipe, comps);
            if (trialGrams > sushiCapacityG) return;

            const hist = history[ln.product_id] || { totalQty: 0, lastDate: "" };
            candidates.push({
                trial: trial,
                componentPieces: componentPieces,
                incremental: trialGrams - riceGramsForLinesDiscrete_(lines, recipe, comps),
                currentMake: ln.make,
                weeklyQty: hist.totalQty,
                lastDateKey: hist.lastDate,
                productId: ln.product_id,
            });
        });

        if (!candidates.length) break;

        if (respectCap) {
            candidates.sort(
                (a, b) =>
                    b.componentPieces - a.componentPieces ||
                    a.weeklyQty - b.weeklyQty ||
                    (a.lastDateKey < b.lastDateKey ? -1 : a.lastDateKey > b.lastDateKey ? 1 : 0) ||
                    a.productId.localeCompare(b.productId),
            );
        } else {
            candidates.sort(
                (a, b) =>
                    a.incremental - b.incremental ||
                    b.componentPieces - a.componentPieces ||
                    a.currentMake - b.currentMake ||
                    a.weeklyQty - b.weeklyQty ||
                    (a.lastDateKey < b.lastDateKey ? -1 : a.lastDateKey > b.lastDateKey ? 1 : 0) ||
                    a.productId.localeCompare(b.productId),
            );
        }

        lines = candidates[0].trial;
    }
    return lines;
}
