import { Injectable } from "@nestjs/common";
import type { Component, DefrostItem, DefrostPar, Prisma, Product, ProductionPar, RecipeComponent } from "@prisma/client";
import { SettingsService } from "../reference-data/settings.service.js";
import { TableCacheService } from "../reference-data/table-cache.service.js";
import { SecondaryAllocationService } from "./secondary-allocation.service.js";
import { weekdayName } from "../common/date.util.js";
import { isPrimary, type ComponentMap, type ComponentNeed, type PlanLine, type ProductionPlan, type RecipeMap } from "./production-engine.types.js";
import type { Kiosk } from "@prisma/client";

/**
 * Production plan computation — direct port of backend/engine/Engine.js.
 * Rice batch count/capacity is decided from PRIMARY demand only (frozen,
 * spec-correct, do not change). Secondary-role items are rationed into
 * whatever capacity is left by SecondaryAllocationService. All constants
 * come from the `setting` table.
 */
@Injectable()
export class ProductionEngineService {
    constructor(
        private readonly settings: SettingsService,
        private readonly secondaryAllocation: SecondaryAllocationService,
        private readonly tableCache: TableCacheService,
    ) {}

    async computeProductionPlan(
        tx: Prisma.TransactionClient,
        kiosk: Kiosk,
        businessDate: Date,
        counts: Record<string, number>,
        carryoverGrams: number,
    ): Promise<ProductionPlan> {
        const weekday = weekdayName(businessDate);

        // Read-only reference data, never written within this transaction
        // (only via DataTablesService's owner-edit path — see its
        // invalidateFor) — safe and much faster to read from the shared
        // cache than from `tx`, since Neon's per-query round trip
        // (~250-300ms from this deployment) is the real cost here.
        const [products, allPars, components, recipeRows] = await Promise.all([
            this.tableCache.getAll<Product>("product"),
            this.tableCache.getAll<ProductionPar>("production_par"),
            this.tableCache.getAll<Component>("component"),
            this.tableCache.getAll<RecipeComponent>("recipe_component"),
        ]);
        const productById = new Map(products.map((p) => [p.product_id, p]));
        const comps: ComponentMap = Object.fromEntries(components.map((c) => [c.component_id, c]));
        const recipe: RecipeMap = {};
        for (const rc of recipeRows) (recipe[rc.product_id] ??= []).push(rc);
        const pars = allPars.filter((p) => p.kiosk_id === kiosk.kiosk_id);

        let lines: PlanLine[] = [];
        for (const par of pars) {
            const prod = productById.get(par.product_id);
            if (!prod || !prod.active) continue;
            const target = Number((par as unknown as Record<string, number>)[weekday]);
            if (!Number.isFinite(target) || target <= 0) continue;
            const counted = Number(counts[par.product_id] ?? 0);
            lines.push({ product_id: par.product_id, name: prod.name, role: prod.production_role, target, counted, make: Math.max(0, target - counted) });
        }

        const [gPerMaki, gPerRoll, gPerNigiri] = await Promise.all([
            this.settings.getNumber("RICE_PER_MAKI_G"),
            this.settings.getNumber("RICE_PER_FULL_ROLL_G"),
            this.settings.getNumber("RICE_PER_NIGIRI_G"),
        ]);
        type RiceBreakdownAccum = Record<string, { count: number; grams: number }>;
        const gramsFor = (need: ComponentNeed): { total: number; primary: number; primaryByType: RiceBreakdownAccum } => {
            let total = 0;
            let primary = 0;
            const primaryByType: RiceBreakdownAccum = {};
            for (const [cid, n] of Object.entries(need)) {
                const c = comps[cid];
                if (!c) continue;
                const upp = Number(c.units_per_prep_unit) || 1;
                // Count of "servings" for the client-facing breakdown (Total Maki, Total Rolls, ...) —
                // matches the multiplier gramsFor already applies per component_type.
                const countOf = (qty: number): number => {
                    if (c.component_type === "MAKI" || c.component_type === "ROLL") return qty / upp;
                    return qty; // NIGIRI, DIRECT_SUSHI_RICE
                };
                const grams = (qty: number): number => {
                    if (c.component_type === "MAKI") return (qty / upp) * (gPerMaki ?? 90);
                    if (c.component_type === "ROLL") return (qty / upp) * (gPerRoll ?? 125);
                    if (c.component_type === "NIGIRI") return qty * (gPerNigiri ?? 24);
                    if (c.component_type === "DIRECT_SUSHI_RICE") return qty;
                    return 0;
                };
                total += grams(n.total);
                primary += grams(n.primary);
                if (n.primary && (c.component_type === "MAKI" || c.component_type === "ROLL" || c.component_type === "NIGIRI" || c.component_type === "DIRECT_SUSHI_RICE")) {
                    const entry = (primaryByType[c.component_type] ??= { count: 0, grams: 0 });
                    entry.count += countOf(n.primary);
                    entry.grams += grams(n.primary);
                }
            }
            return { total, primary, primaryByType };
        };

        // Pass 1 — Primary-only decides the batch count/capacity (frozen formula).
        const rawNeed = this.buildComponentNeed(lines, recipe);
        const rawGrams = gramsFor(rawNeed);
        const ricePrimary = rawGrams.primary;
        const gPerUnitByType: Record<string, number> = {
            MAKI: gPerMaki ?? 90,
            ROLL: gPerRoll ?? 125,
            NIGIRI: gPerNigiri ?? 24,
            DIRECT_SUSHI_RICE: 1,
        };
        const riceBreakdown = Object.entries(rawGrams.primaryByType)
            .filter(([, v]) => v.grams > 0)
            .map(([type, v]) => ({ type, count: Math.round(v.count), gPerUnit: gPerUnitByType[type] ?? 0, grams: Math.round(v.grams) }));
        const batchYield = (await this.settings.getNumber("RICE_BATCH_SEASONED_YIELD_G")) ?? 5150;
        const noCookBelow = (await this.settings.getNumber("RICE_NO_COOK_THRESHOLD_G")) ?? 2000;
        const riceBatches = ricePrimary < noCookBelow ? 0 : Math.ceil(ricePrimary / batchYield);
        const riceSpare = riceBatches * batchYield - ricePrimary;
        const sushiCapacityG = riceBatches * batchYield;

        const allocation = await this.secondaryAllocation.allocate(tx, lines, kiosk.kiosk_id, businessDate, comps, recipe, sushiCapacityG);
        lines = allocation.lines;

        // Pass 2 — re-run the same explosion on the final (post-allocation)
        // lines, so riceTotal/need/karaage/gyoza all reflect what's actually made.
        const need = this.buildComponentNeed(lines, recipe);
        const finalGrams = gramsFor(need);
        const riceTotal = finalGrams.total;
        const riceSecondary = riceTotal - ricePrimary;

        const gPerBowl = (await this.settings.getNumber("RICE_PER_BOWL_G")) ?? 180;
        let plainGramsRaw = 0;
        for (const [cid, n] of Object.entries(need)) {
            if (comps[cid]?.component_type === "DIRECT_PLAIN_RICE") plainGramsRaw += n.total;
        }
        // Staff-reported leftover cooked rice from yesterday morning offsets
        // today's raw demand before deciding how much to cook.
        const plainGrams = Math.max(0, plainGramsRaw - (carryoverGrams || 0));
        const bowls = plainGrams > 0 ? Math.round(plainGrams / gPerBowl) : 0;
        const minPortions = (await this.settings.getNumber("PLAIN_RICE_MIN_PORTIONS")) ?? 3;
        const plainYield = (await this.settings.getNumber("PLAIN_RICE_BATCH_YIELD_G")) ?? 1980;
        const plainLow = bowls > 0 && bowls < minPortions;
        const plainBatchesKg = plainLow ? 0 : Math.ceil(plainGrams / plainYield);
        const substitutes = (await this.settings.get("RICE_BOWL_SUBSTITUTES")) ?? "";

        const prep: ProductionPlan["prep"] = {
            karaageBags: 0,
            karaageSpare: 0,
            gyoza: [],
            prawnRolls: allocation.prawnKatsu.prepRolls,
            prawnPacks: allocation.prawnKatsu.bags,
            prawnShortfallNote: allocation.prawnKatsu.shortfallNote,
        };
        for (const [cid, n] of Object.entries(need)) {
            const c = comps[cid];
            if (!c || !n.total) continue;
            const upp = Number(c.units_per_prep_unit) || 1;
            if (c.component_type === "KARAAGE") {
                const bags = Math.ceil(n.total / upp);
                prep.karaageBags += bags;
                prep.karaageSpare += bags * upp - n.total;
            }
            if (c.component_type === "GYOZA") {
                prep.gyoza.push({ name: c.name, portions: n.total, bags: Math.ceil(n.total / upp) });
            }
        }

        const [allDefrostItems, allDefrostPars] = await Promise.all([
            this.tableCache.getAll<DefrostItem>("defrost_item"),
            this.tableCache.getAll<DefrostPar>("defrost_par"),
        ]);
        const defrostItemById = new Map(allDefrostItems.filter((d) => d.active).map((d) => [d.defrost_item_id, d]));
        const defrostPars = allDefrostPars.filter((p) => p.kiosk_id === kiosk.kiosk_id);
        const defrost = defrostPars
            .map((r) => ({ qty: Number((r as unknown as Record<string, unknown>)[weekday]) || 0, item: defrostItemById.get(r.defrost_item_id) }))
            .filter((r): r is { qty: number; item: NonNullable<typeof r.item> } => r.qty > 0 && !!r.item)
            .map((r) => ({ name: r.item.name, qty: r.qty, unit: r.item.defrost_unit }));

        return {
            weekday,
            lines,
            rice: {
                primaryG: Math.round(ricePrimary),
                secondaryG: Math.round(riceSecondary),
                batches: riceBatches,
                spareG: Math.round(riceSpare),
                capacityG: sushiCapacityG,
                noCook: riceBatches === 0 && ricePrimary > 0,
                breakdown: riceBreakdown,
            },
            plain: { grams: Math.round(plainGrams), bowls, batchesKg: plainBatchesKg, low: plainLow, substitutes },
            prep,
            defrost,
        };
    }

    private buildComponentNeed(lines: PlanLine[], recipe: RecipeMap): ComponentNeed {
        const need: ComponentNeed = {};
        for (const ln of lines) {
            if (!ln.make) continue;
            for (const rc of recipe[ln.product_id] ?? []) {
                const qty = ln.make * rc.qty;
                need[rc.component_id] ??= { total: 0, primary: 0 };
                need[rc.component_id]!.total += qty;
                if (isPrimary(ln.role)) need[rc.component_id]!.primary += qty;
            }
        }
        return need;
    }
}
