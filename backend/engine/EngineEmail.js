/**
 * EngineEmail.js — builds and renders the production-plan email in the old
 * system's format (reference: Evan's Oranmore 18 Jul 2026 email).
 *
 * Sections: Rice (with plain-rice leftover note) / Karaage (campaign reserve +
 * 9-piece box allocation) / Prawn katsu / Sampling box (Fri-Sat) / Production
 * Breakdown by component type / Menu Items to Make by plan_group / Evening
 * Defrost for tomorrow (from tomorrow's pars, per defrost planning mode) /
 * "Submitted by".
 */

/** `plan` must be an already-computed computeProductionPlan() result, not
 * fridge counts — see FormFridgeCount.js's sendProductionEmail_ for why this
 * is threaded through rather than recomputed here (the secondary-item
 * allocator is stateful; recomputing risks divergence from what was already
 * persisted to production_plan). */
function buildEmailModel(kiosk, bizDate, plan, submitterName) {
    const products = {};
    getRows(TABLES.PRODUCT).forEach((r) => (products[r.product_id] = r));
    const comps = {};
    getRows(TABLES.COMPONENT).forEach((r) => (comps[r.component_id] = r));
    const recipe = {};
    getRows(TABLES.RECIPE_COMPONENT).forEach((r) => {
        (recipe[r.product_id] = recipe[r.product_id] || []).push(r);
    });
    const campaigns = {};
    getRows(TABLES.CAMPAIGN).forEach(
        (r) => (campaigns[r.campaign_id] = r.name),
    );

    const need = {};
    plan.lines.forEach((ln) => {
        if (!ln.make) return;
        const prod = products[ln.product_id];
        const isCampaign = prod && prod.campaign_id !== "";
        (recipe[ln.product_id] || []).forEach((rc) => {
            const n = (need[rc.component_id] = need[rc.component_id] || {
                menu: 0,
                campaign: 0,
                campaignProducts: [],
            });
            const qty = ln.make * Number(rc.qty);
            if (isCampaign) {
                n.campaign += qty;
                n.campaignProducts.push(`${ln.make} × ${ln.name}`);
            } else n.menu += qty;
        });
    });

    const samplingUnits = {};
    let samplingLines = [];
    const isSamplingDay =
        getSetting("SAMPLING_DAYS", "FRIDAY,SATURDAY")
            .split(",")
            .indexOf(plan.weekday) !== -1;
    if (isSamplingDay) {
        // SAMPLING_SUSHI is set via the Settings page's component picker —
        // stored as JSON [{componentId, qty}, ...], never free text, so
        // there's no name-matching/typo failure mode here (the picker only
        // ever lets the owner choose a real component_id).
        let samplingConfig = [];
        try {
            samplingConfig = JSON.parse(getSetting("SAMPLING_SUSHI", "[]")) || [];
        } catch (err) {
            console.error("SAMPLING_SUSHI setting is not valid JSON:", err);
        }
        samplingConfig.forEach((entry) => {
            const cid = entry.componentId;
            const qty = Number(entry.qty);
            if (!cid || !comps[cid] || !Number.isFinite(qty) || qty <= 0) return;
            samplingUnits[cid] = (samplingUnits[cid] || 0) + qty;
            const unit = comps[cid].prep_unit || "unit";
            samplingLines.push(
                `${comps[cid].name}: ${qty} ${unit}${qty > 1 ? "s" : ""}`,
            );
        });
    }

    // Every component type gets its own Production Breakdown section EXCEPT
    // the ones with a dedicated line elsewhere in the email (Rice section,
    // Karaage line) — deny-list, not allow-list, so a new dish type (e.g.
    // GYOZA) or any future type just works without a code change here.
    const BREAKDOWN_EXCLUDED_TYPES = [
        "DIRECT_SUSHI_RICE",
        "DIRECT_PLAIN_RICE",
        "KARAAGE",
    ];
    const breakdown = {};
    Object.keys(need).forEach((cid) => {
        const c = comps[cid];
        if (!c || BREAKDOWN_EXCLUDED_TYPES.indexOf(c.component_type) !== -1)
            return;
        breakdown[c.component_type] = breakdown[c.component_type] || [];
        const upp = Number(c.units_per_prep_unit) || 1;
        const menuPieces = need[cid].menu + need[cid].campaign;
        const sampling = samplingUnits[cid] || 0;
        if (!menuPieces && !sampling) return;
        if (c.component_type === "NIGIRI") {
            breakdown.NIGIRI.push({
                name: c.name,
                text: String(menuPieces + sampling),
            });
            return;
        }
        const menuUnits = Math.ceil(menuPieces / upp);
        const total = menuUnits + sampling;
        let text = String(total);
        const parts = [];
        if (sampling) parts.push(`${menuUnits} menu + ${sampling} sampling`);
        const spare = menuUnits * upp - menuPieces;
        if (spare > 0)
            parts.push(`${menuPieces} pieces required; ${spare} spare`);
        if (parts.length) text += ` (${parts.join("; ")})`;
        breakdown[c.component_type].push({ name: c.name, text: text });
    });
    Object.keys(breakdown).forEach((t) =>
        breakdown[t].sort((a, b) => a.name.localeCompare(b.name)),
    );

    const karaage = { bags: 0, reserve: null, boxNote: "", samplingPieces: 0 };
    Object.keys(need).forEach((cid) => {
        const c = comps[cid];
        if (!c || c.component_type !== "KARAAGE") return;
        const upp = Number(c.units_per_prep_unit) || 40;
        const perFlavour = getSettingNum("SAMPLING_KARAAGE_PER_FLAVOUR", 8);
        const flavours = plan.lines.filter(
            (ln) =>
                ln.make > 0 &&
                (recipe[ln.product_id] || []).some(
                    (rc) => rc.component_id === cid,
                ),
        );
        karaage.samplingPieces = isSamplingDay
            ? perFlavour * flavours.length
            : 0;
        const total =
            need[cid].menu + need[cid].campaign + karaage.samplingPieces;
        karaage.bags = Math.ceil(total / upp);
        const spare = karaage.bags * upp - total;
        if (need[cid].campaign > 0) {
            const campProd = plan.lines.find(
                (ln) =>
                    ln.make > 0 &&
                    products[ln.product_id] &&
                    products[ln.product_id].campaign_id,
            );
            const campName = campProd
                ? campaigns[products[campProd.product_id].campaign_id] ||
                  "Campaign"
                : "Campaign";
            karaage.reserve = {
                campaign: campName,
                pieces: need[cid].campaign,
                detail: need[cid].campaignProducts.join(", "),
            };
        }
        const balId = getSetting("KARAAGE_BALANCING_PRODUCT", "P010");
        const koreanLine = plan.lines.find(
            (ln) => ln.product_id === "P009" && ln.make > 0,
        );
        if (spare > 0 && koreanLine) {
            const with9 = Math.min(spare, koreanLine.make);
            karaage.boxNote = `Make ${with9} KOREAN CHICKEN KARAAGE boxes with 9 pieces.`;
        } else if (spare > 0) {
            const bal = products[balId];
            karaage.boxNote = `~${spare} spare pieces go to ${bal ? bal.name : "Teriyaki Chicken Karaage"}.`;
        }
    });

    const groups = {};
    plan.lines
        .filter((ln) => ln.make > 0)
        .forEach((ln) => {
            const prod = products[ln.product_id];
            const g = (prod && (prod.plan_group || "")) || ln.cat || "Other";
            (groups[g] = groups[g] || []).push({
                name: ln.name,
                make: ln.make,
            });
        });
    const ORDER = [
        "Veggie",
        "Salmon",
        "California",
        "Prawn",
        "Chicken",
        "Street Food",
        "Ready Meals",
    ];
    const groupList = Object.keys(groups)
        .sort((a, b) => {
            const ia = ORDER.indexOf(a),
                ib = ORDER.indexOf(b);
            return (
                (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) ||
                a.localeCompare(b)
            );
        })
        .map((g) => ({ name: g, items: groups[g] }));

    const defrost = buildTomorrowDefrost_(
        kiosk,
        bizDate,
        products,
        comps,
        recipe,
    );

    return {
        kiosk: kiosk,
        dateLabel: formatLongDate_(bizDate),
        weekday: plan.weekday,
        plan: plan,
        breakdown: breakdown,
        karaage: karaage,
        samplingLines: samplingLines,
        samplingKaraageNote:
            isSamplingDay && karaage.samplingPieces
                ? `Karaage: ${getSettingNum("SAMPLING_KARAAGE_PER_FLAVOUR", 8)} pieces per flavour`
                : "",
        groups: groupList,
        defrost: defrost,
        submitter: submitterName || "",
    };
}

/** Tomorrow's component demand per defrost item, by planning mode. */
function buildTomorrowDefrost_(kiosk, bizDate, products, comps, recipe) {
    const tomorrow = addDays(bizDate, 1);
    const weekday = weekdayName(tomorrow);
    const makes = {};
    getRows(TABLES.PRODUCTION_PAR, { kiosk_id: kiosk.kiosk_id }).forEach(
        (par) => {
            const t = Number(par[weekday]);
            const prod = products[par.product_id];
            if (prod && prod.active === true && Number.isFinite(t) && t > 0)
                makes[par.product_id] = t;
        },
    );
    const pieces = {};
    Object.keys(makes).forEach((pid) => {
        (recipe[pid] || []).forEach((rc) => {
            pieces[rc.component_id] =
                (pieces[rc.component_id] || 0) + makes[pid] * Number(rc.qty);
        });
    });
    const unitsOf = (namePart, types) => {
        let u = 0;
        Object.keys(pieces).forEach((cid) => {
            const c = comps[cid];
            if (!c) return;
            if (types.indexOf(c.component_type) === -1) return;
            if (c.name.toLowerCase().indexOf(namePart) === -1) return;
            u += Math.ceil(pieces[cid] / (Number(c.units_per_prep_unit) || 1));
        });
        return u;
    };
    const piecesOf = (namePart, types) => {
        let p = 0;
        Object.keys(pieces).forEach((cid) => {
            const c = comps[cid];
            if (
                c &&
                types.indexOf(c.component_type) !== -1 &&
                c.name.toLowerCase().indexOf(namePart) !== -1
            )
                p += pieces[cid];
        });
        return p;
    };
    const productMakes = (namePart) =>
        Object.keys(makes)
            .filter(
                (pid) =>
                    products[pid].name.toLowerCase().indexOf(namePart) !== -1,
            )
            .reduce((s, pid) => s + makes[pid], 0);

    const pars = {};
    getRows(TABLES.DEFROST_PAR, { kiosk_id: kiosk.kiosk_id }).forEach(
        (r) => (pars[r.defrost_item_id] = Number(r[weekday])),
    );

    const lines = [];
    getRows(TABLES.DEFROST_ITEM, { active: true }).forEach((it) => {
        const yieldA = Number(it.yield_a) || 1;
        let txt = "";
        switch (it.planning_mode) {
            case "KARAAGE_BAGS": {
                const p = piecesOf("karaage", ["KARAAGE"]);
                if (p > 0) txt = `${Math.ceil(p / yieldA)} bags`;
                break;
            }
            case "PRAWN_ROLLS": {
                const rolls = unitsOf("prawn katsu", ["ROLL"]);
                if (rolls > 0) txt = `${Math.ceil(rolls / yieldA)} pack`;
                break;
            }
            case "CALIFORNIA_ROLLS": {
                const rolls = unitsOf("california", ["ROLL"]);
                if (rolls > 0) txt = `${Math.ceil(rolls / yieldA)} pack`;
                break;
            }
            case "PRAWN_NIGIRI_PIECES": {
                const p = piecesOf("prawn", ["NIGIRI"]);
                if (p > 0) txt = `${p} pieces`;
                break;
            }
            case "INARI_PIECES": {
                const p = piecesOf("inari", ["NIGIRI"]);
                if (p > 0) txt = `${p} pieces`;
                break;
            }
            case "CHICKEN_GYOZA_BAGS":
            case "DUCK_GYOZA_BAGS":
            case "VEGETABLE_GYOZA_BAGS": {
                const flavour = it.planning_mode.split("_")[0].toLowerCase();
                const portions = piecesOf(flavour, ["GYOZA"]);
                if (portions > 0)
                    txt = `${Math.ceil(portions / (Number(comps["C020"] && comps["C020"].units_per_prep_unit) || 6))} bags`;
                break;
            }
            case "SALMON_SUMMARY": {
                const rolls = unitsOf("salmon", ["ROLL", "MAKI"]);
                const nig = piecesOf("salmon", ["NIGIRI"]);
                const poke =
                    productMakes("salmon poke") +
                    productMakes("sriracha salmon");
                const sando =
                    productMakes("salmon avocado sushi sando") +
                    productMakes("salmon sando");
                const bits = [];
                if (rolls) bits.push(`${rolls} salmon rolls`);
                if (nig) bits.push(`${nig} salmon nigiri`);
                if (poke) bits.push(`${poke} poke portions`);
                if (sando) bits.push(`${sando} salmon sando`);
                if (bits.length) txt = `Approx. ${bits.join(" + ")} tomorrow`;
                break;
            }
            case "TUNA_SUMMARY": {
                const maki = unitsOf("tuna", ["MAKI", "ROLL"]);
                const nig = piecesOf("tuna", ["NIGIRI"]);
                if (maki || nig)
                    txt = `1 pack (Approx. ${maki} tuna maki + ${nig} tuna nigiri tomorrow)`;
                break;
            }
            case "CHICKEN_KATSU_SUMMARY": {
                const rolls = unitsOf("chicken katsu", ["ROLL"]);
                if (rolls > 0)
                    txt = `Approx. ${rolls} chicken katsu rolls tomorrow`;
                break;
            }
            default:
                break;
        }
        if (!txt && pars[it.defrost_item_id] > 0)
            txt = `${pars[it.defrost_item_id]} ${it.defrost_unit}${pars[it.defrost_item_id] > 1 ? "s" : ""}`;
        if (txt) lines.push({ name: it.name, text: txt });
    });
    return lines;
}

function formatLongDate_(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return Utilities.formatDate(
        new Date(y, m - 1, d),
        Session.getScriptTimeZone(),
        "EEEE d MMMM yyyy",
    );
}
