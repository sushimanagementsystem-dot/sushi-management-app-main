import { Injectable } from "@nestjs/common";
import type { Campaign, Component, DefrostItem, DefrostPar, Kiosk, Product, ProductionPar, RecipeComponent } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { SettingsService } from "../reference-data/settings.service.js";
import { EnumOptionService } from "../reference-data/enum-option.service.js";
import { TableCacheService } from "../reference-data/table-cache.service.js";
import { MailerService } from "../mailer/mailer.service.js";
import { addDays, weekdayName } from "../common/date.util.js";
import type { ProductionPlan } from "./production-engine.types.js";

type Need = Record<string, { menu: number; campaign: number; campaignProducts: string[] }>;
type BreakdownLine = { name: string; text: string };
type DefrostLine = { name: string; text: string };

/**
 * Production-plan email — port of backend/engine/EngineEmail.js +
 * EngineEmailRender.js. Takes the SAME plan object already written to
 * production_plan by FridgeCountProcessor, not a fresh
 * computeProductionPlan() call — SecondaryAllocationService is stateful
 * (reads recent production_plan history), so recomputing here could
 * diverge from what was just persisted. One computation, threaded through
 * both consumers, same as the old system.
 *
 * Simplification vs. the old system: the "Menu Items to Make" grouping
 * falls back to `product.plan_group || "Other"` only — the old code's
 * `ln.cat` fallback doesn't apply here since the new PlanLine type never
 * carries a `cat` field (every product used in practice has plan_group
 * set). Everything else (rice, karaage campaign-reserve detection,
 * Friday/Saturday sampling, production breakdown by component type,
 * tomorrow's evening defrost projection) is a faithful port.
 */
@Injectable()
export class ProductionEmailService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
        private readonly enumOptions: EnumOptionService,
        private readonly mailer: MailerService,
    ) {}

    async sendProductionPlanEmail(kiosk: Kiosk, businessDate: Date, plan: ProductionPlan, submitterEmail: string): Promise<void> {
        if (!kiosk.production_email) throw new Error("Kiosk has no production_email.");

        const normalizedEmail = String(submitterEmail || "").trim().toLowerCase();
        const submitter = normalizedEmail ? await this.prisma.user.findUnique({ where: { email: normalizedEmail } }) : null;

        const model = await this.buildEmailModel(kiosk, businessDate, plan, submitter?.name ?? "");
        const html = await this.renderProductionEmail(model);

        await this.mailer.sendMail({
            to: kiosk.production_email,
            cc: String(submitterEmail || "").trim() || undefined,
            subject: `Today's Production Plan - ${kiosk.name} - ${model.dateLabel}`,
            html,
        });
    }

    private async buildEmailModel(kiosk: Kiosk, businessDate: Date, plan: ProductionPlan, submitterName: string) {
        const [products, comps, recipeRows, campaigns] = await Promise.all([
            this.tableCache.getAll<Product>("product"),
            this.tableCache.getAll<Component>("component"),
            this.tableCache.getAll<RecipeComponent>("recipe_component"),
            this.tableCache.getAll<Campaign>("campaign"),
        ]);
        const productById = new Map(products.map((p) => [p.product_id, p]));
        const compById = new Map(comps.map((c) => [c.component_id, c]));
        const campaignNameById = new Map(campaigns.map((c) => [c.campaign_id, c.name]));
        const recipe: Record<string, RecipeComponent[]> = {};
        for (const rc of recipeRows) (recipe[rc.product_id] ??= []).push(rc);

        const need: Need = {};
        for (const ln of plan.lines) {
            if (!ln.make) continue;
            const prod = productById.get(ln.product_id);
            const isCampaign = !!prod?.campaign_id;
            for (const rc of recipe[ln.product_id] ?? []) {
                const n = (need[rc.component_id] ??= { menu: 0, campaign: 0, campaignProducts: [] });
                const qty = ln.make * rc.qty;
                if (isCampaign) {
                    n.campaign += qty;
                    n.campaignProducts.push(`${ln.make} × ${ln.name}`);
                } else {
                    n.menu += qty;
                }
            }
        }

        const sampleDays = (await this.settings.get("SAMPLING_DAYS")) ?? "FRIDAY,SATURDAY";
        const isSamplingDay = sampleDays.split(",").includes(plan.weekday);
        const samplingUnits: Record<string, number> = {};
        const samplingLines: string[] = [];
        if (isSamplingDay) {
            let samplingConfig: { componentId?: string; qty?: number }[] = [];
            try {
                samplingConfig = JSON.parse((await this.settings.get("SAMPLING_SUSHI")) ?? "[]");
            } catch {
                samplingConfig = [];
            }
            for (const entry of samplingConfig) {
                const cid = entry.componentId;
                const qty = Number(entry.qty);
                const c = cid ? compById.get(cid) : undefined;
                if (!cid || !c || !Number.isFinite(qty) || qty <= 0) continue;
                samplingUnits[cid] = (samplingUnits[cid] ?? 0) + qty;
                const unit = c.prep_unit || "unit";
                samplingLines.push(`${c.name}: ${qty} ${unit}${qty > 1 ? "s" : ""}`);
            }
        }

        // Deny-list, not allow-list — a new component_type just falls into
        // its own Production Breakdown heading with no code change here.
        const BREAKDOWN_EXCLUDED_TYPES = new Set(["DIRECT_SUSHI_RICE", "DIRECT_PLAIN_RICE", "KARAAGE"]);
        const breakdown: Record<string, BreakdownLine[]> = {};
        for (const [cid, n] of Object.entries(need)) {
            const c = compById.get(cid);
            if (!c || !c.component_type || BREAKDOWN_EXCLUDED_TYPES.has(c.component_type)) continue;
            const list = (breakdown[c.component_type] ??= []);
            const upp = Number(c.units_per_prep_unit) || 1;
            const menuPieces = n.menu + n.campaign;
            const sampling = samplingUnits[cid] ?? 0;
            if (!menuPieces && !sampling) continue;
            if (c.component_type === "NIGIRI") {
                list.push({ name: c.name, text: String(menuPieces + sampling) });
                continue;
            }
            const menuUnits = Math.ceil(menuPieces / upp);
            const total = menuUnits + sampling;
            let text = String(total);
            const parts: string[] = [];
            if (sampling) parts.push(`${menuUnits} menu + ${sampling} sampling`);
            const spare = menuUnits * upp - menuPieces;
            if (spare > 0) parts.push(`${menuPieces} pieces required; ${spare} spare`);
            if (parts.length) text += ` (${parts.join("; ")})`;
            list.push({ name: c.name, text });
        }
        for (const list of Object.values(breakdown)) list.sort((a, b) => a.name.localeCompare(b.name));

        const karaage: { bags: number; reserve: { campaign: string; pieces: number; detail: string } | null; boxNote: string; samplingPieces: number } = {
            bags: 0,
            reserve: null,
            boxNote: "",
            samplingPieces: 0,
        };
        const perFlavour = (await this.settings.getNumber("SAMPLING_KARAAGE_PER_FLAVOUR")) ?? 8;
        for (const [cid, n] of Object.entries(need)) {
            const c = compById.get(cid);
            if (!c || c.component_type !== "KARAAGE") continue;
            const upp = Number(c.units_per_prep_unit) || 40;
            const flavours = plan.lines.filter((ln) => ln.make > 0 && (recipe[ln.product_id] ?? []).some((rc) => rc.component_id === cid));
            karaage.samplingPieces = isSamplingDay ? perFlavour * flavours.length : 0;
            const total = n.menu + n.campaign + karaage.samplingPieces;
            karaage.bags = Math.ceil(total / upp);
            const spare = karaage.bags * upp - total;
            if (n.campaign > 0) {
                const campProd = plan.lines.find((ln) => ln.make > 0 && productById.get(ln.product_id)?.campaign_id);
                const campId = campProd ? productById.get(campProd.product_id)?.campaign_id : null;
                const campName = (campId && campaignNameById.get(campId)) || "Campaign";
                karaage.reserve = { campaign: campName, pieces: n.campaign, detail: n.campaignProducts.join(", ") };
            }
            const balId = (await this.settings.get("KARAAGE_BALANCING_PRODUCT")) ?? "P010";
            const koreanLine = plan.lines.find((ln) => ln.product_id === "P009" && ln.make > 0);
            if (spare > 0 && koreanLine) {
                const with9 = Math.min(spare, koreanLine.make);
                karaage.boxNote = `Make ${with9} KOREAN CHICKEN KARAAGE boxes with 9 pieces.`;
            } else if (spare > 0) {
                const bal = productById.get(balId);
                karaage.boxNote = `~${spare} spare pieces go to ${bal ? bal.name : "Teriyaki Chicken Karaage"}.`;
            }
        }

        const groupsMap: Record<string, { name: string; make: number }[]> = {};
        for (const ln of plan.lines) {
            if (ln.make <= 0) continue;
            const prod = productById.get(ln.product_id);
            const g = prod?.plan_group || "Other";
            (groupsMap[g] ??= []).push({ name: ln.name, make: ln.make });
        }
        const ORDER = ["Veggie", "Salmon", "California", "Prawn", "Chicken", "Street Food", "Ready Meals"];
        const groups = Object.keys(groupsMap)
            .sort((a, b) => {
                const ia = ORDER.indexOf(a);
                const ib = ORDER.indexOf(b);
                return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
            })
            .map((g) => ({ name: g, items: groupsMap[g]! }));

        const defrost = await this.buildTomorrowDefrost(kiosk, businessDate, productById, compById, recipe);

        return {
            kiosk,
            dateLabel: formatLongDate(businessDate),
            plan,
            breakdown,
            karaage,
            samplingLines,
            samplingKaraageNote: isSamplingDay && karaage.samplingPieces ? `Karaage: ${perFlavour} pieces per flavour` : "",
            groups,
            defrost,
            // plan.plain.substitutes is raw comma-separated product_ids
            // (RICE_BOWL_SUBSTITUTES setting) — resolve to display names
            // here, same as EngineEmail.js's substituteNames_.
            plainSubstituteNames: plan.plain.substitutes
                ? plan.plain.substitutes
                      .split(",")
                      .map((id) => productById.get(id.trim())?.name || id.trim())
                      .join(", ")
                : "",
            plainLeftoverNote: await this.buildPlainLeftoverNote(plan),
            submitter: submitterName || "",
        };
    }

    private async buildPlainLeftoverNote(plan: ProductionPlan): Promise<string> {
        const pl = plan.plain;
        if (pl.low || pl.grams <= 0 || pl.batchesKg <= 0) return "";
        const plainYield = (await this.settings.getNumber("PLAIN_RICE_BATCH_YIELD_G")) ?? 1980;
        const gPerBowl = (await this.settings.getNumber("RICE_PER_BOWL_G")) ?? 180;
        const leftoverG = Math.max(0, pl.batchesKg * plainYield - pl.grams);
        if (leftoverG <= 0) return "";
        const leftoverBowls = Math.round(leftoverG / gPerBowl);
        return `; approximately ${leftoverG}g fresh cooked rice should remain for tomorrow (about ${leftoverBowls} bowls)`;
    }

    /**
     * Bracket text next to "Sushi rice" showing the exact (pre-rounding)
     * batch count — e.g. "(2.8 sushi)" — so staff can see how close they
     * are to the next 2kg batch and trim production to stay under it.
     */
    private async formatRiceBreakdown(primaryG: number): Promise<string> {
        const batchYield = (await this.settings.getNumber("RICE_BATCH_SEASONED_YIELD_G")) ?? 5150;
        if (!batchYield) return "";
        return ` (${(primaryG / batchYield).toFixed(1)} sushi)`;
    }

    /** Tomorrow's component demand per defrost item, by planning mode. */
    private async buildTomorrowDefrost(
        kiosk: Kiosk,
        businessDate: Date,
        productById: Map<string, Product>,
        compById: Map<string, Component>,
        recipe: Record<string, RecipeComponent[]>,
    ): Promise<DefrostLine[]> {
        const tomorrow = addDays(businessDate, 1);
        const weekday = weekdayName(tomorrow);

        const [allProductionPars, allDefrostItems, allDefrostPars] = await Promise.all([
            this.tableCache.getAll<ProductionPar>("production_par"),
            this.tableCache.getAll<DefrostItem>("defrost_item"),
            this.tableCache.getAll<DefrostPar>("defrost_par"),
        ]);

        const makes: Record<string, number> = {};
        for (const par of allProductionPars) {
            if (par.kiosk_id !== kiosk.kiosk_id) continue;
            const t = Number((par as unknown as Record<string, number>)[weekday]);
            const prod = productById.get(par.product_id);
            if (prod?.active && Number.isFinite(t) && t > 0) makes[par.product_id] = t;
        }
        const pieces: Record<string, number> = {};
        for (const [pid, qty] of Object.entries(makes)) {
            for (const rc of recipe[pid] ?? []) {
                pieces[rc.component_id] = (pieces[rc.component_id] ?? 0) + qty * rc.qty;
            }
        }
        const unitsOf = (namePart: string, types: string[]): number => {
            let u = 0;
            for (const [cid, p] of Object.entries(pieces)) {
                const c = compById.get(cid);
                if (!c || !c.component_type || !types.includes(c.component_type)) continue;
                if (!c.name.toLowerCase().includes(namePart)) continue;
                u += Math.ceil(p / (Number(c.units_per_prep_unit) || 1));
            }
            return u;
        };
        const piecesOf = (namePart: string, types: string[]): number => {
            let total = 0;
            for (const [cid, p] of Object.entries(pieces)) {
                const c = compById.get(cid);
                if (c && c.component_type && types.includes(c.component_type) && c.name.toLowerCase().includes(namePart)) total += p;
            }
            return total;
        };
        const productMakes = (namePart: string): number =>
            Object.entries(makes)
                .filter(([pid]) => productById.get(pid)?.name.toLowerCase().includes(namePart))
                .reduce((s, [, qty]) => s + qty, 0);

        const pars: Record<string, number> = {};
        for (const r of allDefrostPars) {
            if (r.kiosk_id !== kiosk.kiosk_id) continue;
            pars[r.defrost_item_id] = Number((r as unknown as Record<string, unknown>)[weekday]) || 0;
        }

        const lines: DefrostLine[] = [];
        for (const it of allDefrostItems) {
            if (!it.active) continue;
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
                    const flavour = it.planning_mode.split("_")[0]!.toLowerCase();
                    const portions = piecesOf(flavour, ["GYOZA"]);
                    if (portions > 0) txt = `${Math.ceil(portions / (Number(compById.get("C020")?.units_per_prep_unit) || 6))} bags`;
                    break;
                }
                case "SALMON_SUMMARY": {
                    const rolls = unitsOf("salmon", ["ROLL", "MAKI"]);
                    const nig = piecesOf("salmon", ["NIGIRI"]);
                    const poke = productMakes("salmon poke") + productMakes("sriracha salmon");
                    const sando = productMakes("salmon avocado sushi sando") + productMakes("salmon sando");
                    const bits: string[] = [];
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
                    if (maki || nig) txt = `1 pack (Approx. ${maki} tuna maki + ${nig} tuna nigiri tomorrow)`;
                    break;
                }
                case "CHICKEN_KATSU_SUMMARY": {
                    const rolls = unitsOf("chicken katsu", ["ROLL"]);
                    if (rolls > 0) txt = `Approx. ${rolls} chicken katsu rolls tomorrow`;
                    break;
                }
                default:
                    break;
            }
            const par = pars[it.defrost_item_id] ?? 0;
            if (!txt && par > 0) txt = `${par} ${it.defrost_unit}${par > 1 ? "s" : ""}`;
            if (txt) lines.push({ name: it.name, text: txt });
        }
        return lines;
    }

    private async renderProductionEmail(m: Awaited<ReturnType<ProductionEmailService["buildEmailModel"]>>): Promise<string> {
        const S = {
            h1: "font-size:22px;font-weight:700;margin:0 0 2px",
            sub: "color:#444;margin:0 0 14px",
            h2: "font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:3px;margin:18px 0 8px",
            h3: "font-size:14px;font-weight:700;margin:12px 0 4px",
            p: "margin:5px 0",
            ul: "margin:4px 0 10px 22px;padding:0",
            box: (bg: string, border: string) => `background:${bg};border-left:4px solid ${border};padding:10px 14px;margin:12px 0;border-radius:4px`,
            foot: "color:#888;font-size:12px;margin-top:18px",
        };
        const li = (t: string) => `<li style="margin:2px 0">${t}</li>`;
        const ul = (items: string[]) => `<ul style="${S.ul}">${items.join("")}</ul>`;

        let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c2430;max-width:640px">`;
        html += `<h1 style="${S.h1}">Today's Production Plan</h1>`;
        html += `<p style="${S.sub}"><b>${m.kiosk.name}</b> — ${m.dateLabel}</p>`;

        html += `<h2 style="${S.h2}">Rice</h2>`;
        const riceItems: string[] = [];
        const r = m.plan.rice;
        const riceBreakdownText = await this.formatRiceBreakdown(r.primaryG);
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
                        (m.plainSubstituteNames ? `Use substitutes: ${m.plainSubstituteNames}.` : `Use the agreed substitute meals.`),
                );
            } else {
                riceItems.push(`<b>Plain rice:</b> cook ${pl.batchesKg} × 1kg batch${pl.batchesKg > 1 ? "es" : ""}${m.plainLeftoverNote}`);
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
            if (m.karaage.boxNote) html += `<p style="${S.p};color:#555">${m.karaage.boxNote}</p>`;
        }

        for (const g of m.plan.prep.gyoza) {
            html += `<p style="${S.p}"><b>${g.name}:</b> ${g.portions} portion${g.portions > 1 ? "s" : ""} → defrost ${g.bags} bag${g.bags > 1 ? "s" : ""}.</p>`;
        }

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
                (m.samplingKaraageNote ? `<p style="${S.p}">${m.samplingKaraageNote}</p>` : "") +
                `</div>`;
        }

        html += await this.renderBreakdown(m.breakdown);

        html += `<h2 style="${S.h2}">Menu Items to Make</h2>`;
        if (!m.groups.length) html += `<p style="${S.p}">Nothing to make — fridge meets all targets.</p>`;
        for (const g of m.groups) {
            html += `<h3 style="${S.h3}">${g.name}</h3>`;
            html += ul(g.items.map((it) => li(`${it.name}: ${it.make}`)));
        }

        if (m.defrost.length) {
            html +=
                `<div style="${S.box("#e6f4ea", "#188038")}">` +
                `<b>Evening Defrost — for tomorrow</b>` +
                `<p style="${S.p}">Below is a rough guide as to what you will need in total to complete tomorrow's production. Defrost only the shortfall needed to reach the quantities below:</p>` +
                ul(m.defrost.map((d) => li(`${d.name}: ${d.text}`))) +
                `</div>`;
        }

        if (m.submitter) html += `<p style="${S.foot}">Submitted by ${m.submitter}</p>`;
        html += `</div>`;
        return html;
    }

    /** Label + display order for each component_type come from owner-editable
     * enum_option rows, not hardcoded — a new dish type gets a real
     * Production Breakdown heading with no code change. Falls back to a
     * title-cased raw type if a component_type shows up before its
     * enum_option row exists. */
    private async renderBreakdown(breakdown: Record<string, BreakdownLine[]>): Promise<string> {
        const options = await this.enumOptions.getOptions("component_type");
        const typeLabels = new Map(options.map((o) => [o.value, o.label]));
        const typeOrder = options.map((o) => o.value);
        const breakdownTypes = Object.keys(breakdown)
            .filter((t) => breakdown[t]!.length)
            .sort((a, b) => {
                const ia = typeOrder.indexOf(a);
                const ib = typeOrder.indexOf(b);
                if (ia === -1 && ib === -1) return a.localeCompare(b);
                if (ia === -1) return 1;
                if (ib === -1) return -1;
                return ia - ib;
            });
        if (!breakdownTypes.length) return "";
        const h2 = "font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:3px;margin:18px 0 8px";
        const h3 = "font-size:14px;font-weight:700;margin:12px 0 4px";
        const ulStyle = "margin:4px 0 10px 22px;padding:0";
        let html = `<h2 style="${h2}">Production Breakdown</h2>`;
        for (const t of breakdownTypes) {
            const label = typeLabels.get(t) || t.charAt(0) + t.slice(1).toLowerCase();
            html += `<h3 style="${h3}">${label}</h3>`;
            html += `<ul style="${ulStyle}">${breakdown[t]!.map((b) => `<li style="margin:2px 0">${b.name}: ${b.text}</li>`).join("")}</ul>`;
        }
        return html;
    }
}

function formatLongDate(date: Date): string {
    return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
