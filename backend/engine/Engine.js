/**
 * Engine.js — production plan computation (spec §2, Simplified Developer Rules).
 *
 * Input: kiosk, business date, fridge counts {product_id: qty}.
 * Output: plan lines (par target − counted) plus kitchen prep guidance:
 * sushi-rice batches, plain rice, karaage/gyoza bags, prawn-katsu multiples,
 * defrost baseline. Sampling is computed separately in EngineEmail.js (the
 * only place it's actually consumed). All constants come from the
 * `setting` table (M-13).
 *
 * Rice batch count/capacity is decided from PRIMARY demand only (frozen,
 * spec-correct, do not change). Secondary-role items that use sushi rice are
 * NOT guaranteed their full raw make — after the batch count is fixed here,
 * EngineSecondaryAllocation.js rations them into whatever capacity is left,
 * fairly rotating which ones get made when there isn't enough for everyone.
 */

const isPrimary = (role) => role === "PRIMARY" || role === "SEASONAL_PRIMARY";

/** Builds the per-component {total, primary} demand map (grams-ready) from a
 * set of plan lines — shared by both the initial (raw) pass and the final
 * (post-allocation) pass, since the same explosion logic applies to both. */
function buildComponentNeed_(lines, recipe) {
    const need = {};
    lines.forEach((ln) => {
        if (!ln.make) return;
        (recipe[ln.product_id] || []).forEach((rc) => {
            const qty = ln.make * Number(rc.qty);
            need[rc.component_id] = need[rc.component_id] || {
                total: 0,
                primary: 0,
            };
            need[rc.component_id].total += qty;
            if (isPrimary(ln.role)) need[rc.component_id].primary += qty;
        });
    });
    return need;
}

function computeProductionPlan(kiosk, businessDate, counts, carryoverGrams) {
    const weekday = weekdayName(businessDate);
    const products = {};
    getRows(TABLES.PRODUCT).forEach((r) => (products[r.product_id] = r));

    const pars = getRows(TABLES.PRODUCTION_PAR, { kiosk_id: kiosk.kiosk_id });
    let lines = [];
    pars.forEach((par) => {
        const prod = products[par.product_id];
        if (!prod || prod.active !== true) return;
        const target = Number(par[weekday]);
        if (!Number.isFinite(target) || target <= 0) return;
        const counted = Number(counts[par.product_id] || 0);
        lines.push({
            product_id: par.product_id,
            name: prod.name,
            role: prod.production_role,
            target: target,
            counted: counted,
            make: Math.max(0, target - counted),
        });
    });

    const comps = {};
    getRows(TABLES.COMPONENT).forEach((r) => (comps[r.component_id] = r));
    const recipe = {};
    getRows(TABLES.RECIPE_COMPONENT).forEach((r) => {
        recipe[r.product_id] = recipe[r.product_id] || [];
        recipe[r.product_id].push(r);
    });

    const gPerMaki = getSettingNum("RICE_PER_MAKI_G", 90);
    const gPerRoll = getSettingNum("RICE_PER_FULL_ROLL_G", 125);
    const gPerNigiri = getSettingNum("RICE_PER_NIGIRI_G", 24);
    const gramsFor_ = (need) => {
        let total = 0;
        let primary = 0;
        const primaryByType = {};
        Object.keys(need).forEach((cid) => {
            const c = comps[cid];
            if (!c) return;
            const upp = Number(c.units_per_prep_unit) || 1;
            // Count of "servings" for the client-facing breakdown (Total Maki,
            // Total Rolls, ...) — matches the multiplier grams() already
            // applies per component_type.
            const countOf = (n) => {
                if (c.component_type === "MAKI" || c.component_type === "ROLL")
                    return n / upp;
                return n; // NIGIRI, DIRECT_SUSHI_RICE
            };
            const grams = (n) => {
                if (c.component_type === "MAKI") return (n / upp) * gPerMaki;
                if (c.component_type === "ROLL") return (n / upp) * gPerRoll;
                if (c.component_type === "NIGIRI") return n * gPerNigiri;
                if (c.component_type === "DIRECT_SUSHI_RICE") return n;
                return 0;
            };
            total += grams(need[cid].total);
            primary += grams(need[cid].primary);
            if (
                need[cid].primary &&
                (c.component_type === "MAKI" ||
                    c.component_type === "ROLL" ||
                    c.component_type === "NIGIRI" ||
                    c.component_type === "DIRECT_SUSHI_RICE")
            ) {
                const entry = (primaryByType[c.component_type] =
                    primaryByType[c.component_type] || { count: 0, grams: 0 });
                entry.count += countOf(need[cid].primary);
                entry.grams += grams(need[cid].primary);
            }
        });
        return { total: total, primary: primary, primaryByType: primaryByType };
    };

    // Pass 1 — Primary-only decides the batch count/capacity (frozen formula).
    const rawNeed = buildComponentNeed_(lines, recipe);
    const rawGrams = gramsFor_(rawNeed);
    const ricePrimary = rawGrams.primary;
    const batchYield = getSettingNum("RICE_BATCH_SEASONED_YIELD_G", 5150);
    const noCookBelow = getSettingNum("RICE_NO_COOK_THRESHOLD_G", 2000);
    const riceBatches =
        ricePrimary < noCookBelow ? 0 : Math.ceil(ricePrimary / batchYield);
    const riceSpare = riceBatches * batchYield - ricePrimary;
    const sushiCapacityG = riceBatches * batchYield;
    const gPerUnitByType_ = {
        MAKI: gPerMaki,
        ROLL: gPerRoll,
        NIGIRI: gPerNigiri,
        DIRECT_SUSHI_RICE: 1,
    };
    const riceBreakdown = Object.keys(rawGrams.primaryByType)
        .filter((t) => rawGrams.primaryByType[t].grams > 0)
        .map((t) => ({
            type: t,
            count: Math.round(rawGrams.primaryByType[t].count),
            gPerUnit: gPerUnitByType_[t] || 0,
            grams: Math.round(rawGrams.primaryByType[t].grams),
        }));

    // Allocate: ration Secondary sushi-rice items into the leftover capacity.
    const allocation = allocateSecondaryAndPrawnKatsu_(
        lines,
        kiosk.kiosk_id,
        businessDate,
        comps,
        recipe,
        sushiCapacityG,
    );
    lines = allocation.lines;

    // Pass 2 — re-run the same explosion on the final (post-allocation)
    // lines, so riceTotal/need/karaage/gyoza all reflect what's actually made.
    const need = buildComponentNeed_(lines, recipe);
    const finalGrams = gramsFor_(need);
    const riceTotal = finalGrams.total;
    const riceSecondary = riceTotal - ricePrimary;

    const gPerBowl = getSettingNum("RICE_PER_BOWL_G", 180);
    let plainGramsRaw = 0;
    Object.keys(need).forEach((cid) => {
        const c = comps[cid];
        if (c && c.component_type === "DIRECT_PLAIN_RICE")
            plainGramsRaw += need[cid].total;
    });
    // Staff-reported leftover cooked rice from yesterday morning offsets
    // today's raw demand before deciding how much to cook — spec'd
    // (Project Rules.docx §7.4: "Morning carryover is obtained from the
    // configured plain-rice carryover question") but never wired up until
    // now; previously every day was planned as if starting from zero.
    const plainGrams = Math.max(0, plainGramsRaw - (Number(carryoverGrams) || 0));
    const bowls = plainGrams > 0 ? Math.round(plainGrams / gPerBowl) : 0;
    const minPortions = getSettingNum("PLAIN_RICE_MIN_PORTIONS", 3);
    const plainYield = getSettingNum("PLAIN_RICE_BATCH_YIELD_G", 1980);
    const plainLow = bowls > 0 && bowls < minPortions;
    const plainBatchesKg = plainLow ? 0 : Math.ceil(plainGrams / plainYield);
    const substitutes = getSetting("RICE_BOWL_SUBSTITUTES", "");

    // Prawn-katsu rolls/bags come from the allocator's bag-rounded result
    // (PRAWN_KATSU_COMPONENT_ID setting), not a name match against `need` —
    // that result already accounts for whole-bag rounding and any
    // capacity-driven trimming, which a plain need-map read can't express.
    const prep = {
        karaageBags: 0,
        karaageSpare: 0,
        gyoza: [],
        prawnRolls: allocation.prawnKatsu.prepRolls,
        prawnPacks: allocation.prawnKatsu.bags,
        prawnShortfallNote: allocation.prawnKatsu.shortfallNote,
    };
    Object.keys(need).forEach((cid) => {
        const c = comps[cid];
        if (!c || !need[cid].total) return;
        const upp = Number(c.units_per_prep_unit) || 1;
        if (c.component_type === "KARAAGE") {
            const bags = Math.ceil(need[cid].total / upp);
            prep.karaageBags += bags;
            prep.karaageSpare += bags * upp - need[cid].total;
        }
        if (c.component_type === "GYOZA") {
            prep.gyoza.push({
                name: c.name,
                portions: need[cid].total,
                bags: Math.ceil(need[cid].total / upp),
            });
        }
    });

    const defrostItems = {};
    getRows(TABLES.DEFROST_ITEM, { active: true }).forEach(
        (r) => (defrostItems[r.defrost_item_id] = r),
    );
    const defrost = getRows(TABLES.DEFROST_PAR, { kiosk_id: kiosk.kiosk_id })
        .filter((r) => Number(r[weekday]) > 0 && defrostItems[r.defrost_item_id])
        .map((r) => ({
            name: defrostItems[r.defrost_item_id].name,
            qty: Number(r[weekday]),
            unit: defrostItems[r.defrost_item_id].defrost_unit,
        }));

    return {
        weekday: weekday,
        lines: lines,
        rice: {
            primaryG: Math.round(ricePrimary),
            secondaryG: Math.round(riceSecondary),
            batches: riceBatches,
            spareG: Math.round(riceSpare),
            capacityG: sushiCapacityG,
            noCook: riceBatches === 0 && ricePrimary > 0,
            breakdown: riceBreakdown,
        },
        plain: {
            grams: Math.round(plainGrams),
            bowls: bowls,
            batchesKg: plainBatchesKg,
            low: plainLow,
            substitutes: substitutes,
        },
        prep: prep,
        defrost: defrost,
    };
}
