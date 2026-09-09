/**
 * EngineEmailRender.js — HTML for the production-plan email (old format).
 */

function renderProductionEmail(m) {
    const S = {
        h1: "font-size:22px;font-weight:700;margin:0 0 2px",
        sub: "color:#444;margin:0 0 14px",
        h2: "font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:3px;margin:18px 0 8px",
        h3: "font-size:14px;font-weight:700;margin:12px 0 4px",
        p: "margin:5px 0",
        ul: "margin:4px 0 10px 22px;padding:0",
        box: (bg, border) =>
            `background:${bg};border-left:4px solid ${border};padding:10px 14px;margin:12px 0;border-radius:4px`,
        foot: "color:#888;font-size:12px;margin-top:18px",
    };
    const li = (t) => `<li style="margin:2px 0">${t}</li>`;
    const ul = (items) => `<ul style="${S.ul}">${items.join("")}</ul>`;

    let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c2430;max-width:640px">`;
    html += `<h1 style="${S.h1}">Today's Production Plan</h1>`;
    html += `<p style="${S.sub}"><b>${m.kiosk.name}</b> — ${m.dateLabel}</p>`;

    html += `<h2 style="${S.h2}">Rice</h2>`;
    const riceItems = [];
    const r = m.plan.rice;
    const riceBreakdownText = formatRiceBreakdown_(r.primaryG);
    riceItems.push(
        `<b>Sushi rice:</b> ` +
            (r.batches > 0
                ? `${r.batches} × 2kg batch${r.batches > 1 ? "es" : ""}${riceBreakdownText}`
                : r.noCook
                  ? `no batch today — Primary need (${r.primaryG} g) is below the cook threshold${riceBreakdownText}`
                  : `none needed today`),
    );
    const pl = m.plan.plain;
    if (pl.grams > 0) {
        if (pl.low) {
            riceItems.push(
                `<b>Plain rice:</b> only ${pl.bowls} bowl(s) needed — below the minimum cook. ` +
                    (pl.substitutes
                        ? `Use substitutes: ${substituteNames_(pl.substitutes)}.`
                        : `Use the agreed substitute meals.`),
            );
        } else {
            const leftoverG = Math.max(
                0,
                pl.batchesKg * getSettingNum("PLAIN_RICE_BATCH_YIELD_G", 1980) -
                    pl.grams,
            );
            const leftoverBowls = Math.round(
                leftoverG / getSettingNum("RICE_PER_BOWL_G", 180),
            );
            riceItems.push(
                `<b>Plain rice:</b> cook ${pl.batchesKg} × 1kg batch${pl.batchesKg > 1 ? "es" : ""}` +
                    (leftoverG > 0
                        ? `; approximately ${leftoverG}g fresh cooked rice should remain for tomorrow (about ${leftoverBowls} bowls)`
                        : ""),
            );
        }
    }
    html += ul(riceItems.map(li));

    if (m.karaage.bags > 0) {
        html += `<p style="${S.p}"><b>Karaage:</b> Defrost ${m.karaage.bags} bag${m.karaage.bags > 1 ? "s" : ""}.</p>`;
        if (m.karaage.reserve) {
            html +=
                `<div style="${S.box("#fff8e1", "#f0a800")}"><b>${m.karaage.reserve.campaign}:</b> ` +
                `Keep ${m.karaage.reserve.pieces} karaage pieces aside for ${m.karaage.reserve.campaign} ` +
                `(${m.karaage.reserve.detail}).</div>`;
        }
        if (m.karaage.boxNote)
            html += `<p style="${S.p};color:#555">${m.karaage.boxNote}</p>`;
    }

    m.plan.prep.gyoza.forEach((g) => {
        html += `<p style="${S.p}"><b>${g.name}:</b> ${g.portions} portion${g.portions > 1 ? "s" : ""} → defrost ${g.bags} bag${g.bags > 1 ? "s" : ""}.</p>`;
    });

    if (m.plan.prep.prawnRolls > 0) {
        html += `<p style="${S.p}"><b>Prawn katsu:</b> Defrost ${m.plan.prep.prawnPacks} bag${m.plan.prep.prawnPacks > 1 ? "s" : ""} and prepare ${m.plan.prep.prawnRolls} rolls.</p>`;
    }
    if (m.plan.prep.prawnShortfallNote) {
        html += `<div style="${S.box("#fdecea", "#d93025")}"><b>Attention:</b> ${m.plan.prep.prawnShortfallNote}</div>`;
    }

    if (m.samplingLines.length) {
        html +=
            `<div style="${S.box("#e8f0fe", "#1a73e8")}">` +
            `<b>Friday/Saturday Sampling</b><br><i>Keep these quantities separate from fridge stock.</i>` +
            ul(m.samplingLines.map(li)) +
            (m.samplingKaraageNote
                ? `<p style="${S.p}">${m.samplingKaraageNote}</p>`
                : "") +
            `</div>`;
    }

    // Label + display order are owner-editable data (enum_option,
    // enum_type="component_type"), not hardcoded here — add a new dish
    // type's label/order in Data Tables and it gets a real Production
    // Breakdown heading with no code change. Falls back to a title-cased
    // raw type if a component_type shows up before its enum_option row
    // exists, so nothing silently disappears either way.
    const typeLabels = {};
    const typeOrder = [];
    getEnumOptions("component_type").forEach((o) => {
        typeLabels[o.value] = o.label;
        typeOrder.push(o.value);
    });
    const breakdownTypes = Object.keys(m.breakdown)
        .filter((t) => m.breakdown[t].length)
        .sort((a, b) => {
            const ia = typeOrder.indexOf(a);
            const ib = typeOrder.indexOf(b);
            if (ia === -1 && ib === -1) return a.localeCompare(b);
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        });
    if (breakdownTypes.length) {
        html += `<h2 style="${S.h2}">Production Breakdown</h2>`;
        breakdownTypes.forEach((t) => {
            const label =
                typeLabels[t] || t.charAt(0) + t.slice(1).toLowerCase();
            html += `<h3 style="${S.h3}">${label}</h3>`;
            html += ul(m.breakdown[t].map((b) => li(`${b.name}: ${b.text}`)));
        });
    }

    html += `<h2 style="${S.h2}">Menu Items to Make</h2>`;
    if (!m.groups.length)
        html += `<p style="${S.p}">Nothing to make — fridge meets all targets.</p>`;
    m.groups.forEach((g) => {
        html += `<h3 style="${S.h3}">${g.name}</h3>`;
        html += ul(g.items.map((it) => li(`${it.name}: ${it.make}`)));
    });

    if (m.defrost.length) {
        html +=
            `<div style="${S.box("#e6f4ea", "#188038")}">` +
            `<b>Evening Defrost — for tomorrow</b>` +
            `<p style="${S.p}">Below is a rough guide as to what you will need in total to complete tomorrow's production. Defrost only the shortfall needed to reach the quantities below:</p>` +
            ul(m.defrost.map((d) => li(`${d.name}: ${d.text}`))) +
            `</div>`;
    }

    if (m.submitter)
        html += `<p style="${S.foot}">Submitted by ${m.submitter}</p>`;
    html += `</div>`;
    return html;
}

/**
 * Bracket text next to "Sushi rice" showing the exact (pre-rounding) batch
 * count — e.g. "(2.8 sushi)" — so staff can see how close they are to the
 * next 2kg batch and trim production to stay under it.
 */
function formatRiceBreakdown_(primaryG) {
    const batchYield = getSettingNum("RICE_BATCH_SEASONED_YIELD_G", 5150);
    if (!batchYield) return "";
    return ` (${(primaryG / batchYield).toFixed(1)} sushi)`;
}

/** "P021,P022" -> product names for the substitutes note. */
function substituteNames_(ids) {
    const names = [];
    String(ids)
        .split(",")
        .forEach((pid) => {
            const p = getRow(TABLES.PRODUCT, { product_id: pid.trim() });
            if (p) names.push(p.name);
        });
    return names.join(", ") || ids;
}
