import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { SettingsService } from "../reference-data/settings.service.js";
import { addDays, toDateStr } from "../common/date.util.js";
import {
    SECONDARY_ROLES,
    type ComponentMap,
    type PlanLine,
    type PrawnKatsuResult,
    type ProductionHistory,
    type RecipeMap,
} from "./production-engine.types.js";

const MAX_ITER = 500;

/**
 * Rations Secondary/Seasonal-Secondary sushi-rice items into whatever rice
 * capacity Primary items leave behind (fairness-rotation greedy fill),
 * then bag-rounds Prawn Katsu. Direct port of
 * backend/engine/EngineSecondaryAllocation.js — algorithm and comments
 * kept intact; only the storage layer (Prisma vs Sheets DAL) changed.
 * Called once per plan build, after Engine.js's frozen Primary/batch-count
 * math has already fixed the day's rice capacity.
 */
@Injectable()
export class SecondaryAllocationService {
    constructor(private readonly settings: SettingsService) {}

    async allocate(
        tx: Prisma.TransactionClient,
        lines: PlanLine[],
        kioskId: string,
        businessDate: Date,
        comps: ComponentMap,
        recipe: RecipeMap,
        sushiCapacityG: number,
    ): Promise<{ lines: PlanLine[]; prawnKatsu: PrawnKatsuResult }> {
        lines = lines.map((ln) => ({ ...ln }));

        if (sushiCapacityG <= 0) {
            for (const ln of lines) {
                if (SECONDARY_ROLES.includes(ln.role ?? "") && this.productUsesSushiRice(ln.product_id, recipe, comps)) {
                    ln.make = 0;
                }
            }
            return { lines, prawnKatsu: { lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null } };
        }

        const lookbackDays = (await this.settings.getNumber("SECONDARY_HISTORY_LOOKBACK_DAYS")) ?? 7;
        const history = await this.loadHistory(tx, kioskId, businessDate, lookbackDays);

        for (const ln of lines) {
            if (SECONDARY_ROLES.includes(ln.role ?? "") && this.productUsesSushiRice(ln.product_id, recipe, comps)) {
                ln.cap = await this.sandoCapFor(ln.product_id, ln.make);
                ln.make = 0;
            }
        }

        const sequence: string[] = [];
        let currentGrams = await this.riceGramsDiscrete(lines, recipe, comps);

        for (let i = 0; i < MAX_ITER; i++) {
            const candidates: { ln: PlanLine; trial: PlanLine[]; trialGrams: number; incremental: number; weeklyQty: number; lastDateKey: string; productId: string }[] = [];

            for (const ln of lines) {
                if (!SECONDARY_ROLES.includes(ln.role ?? "")) continue;
                if (ln.cap === undefined || ln.make >= ln.cap) continue;
                const step = await this.sandoStepFor(ln.product_id);
                if (ln.make + step > ln.cap) continue;

                const trial = lines.map((l) => (l === ln ? { ...l, make: l.make + step } : l));
                const trialGrams = await this.riceGramsDiscrete(trial, recipe, comps);
                const incremental = trialGrams - currentGrams;
                if (incremental < 0 || trialGrams > sushiCapacityG) continue;

                const hist = history[ln.product_id] ?? { totalQty: 0, lastDate: "" };
                candidates.push({ ln, trial, trialGrams, incremental, weeklyQty: hist.totalQty, lastDateKey: hist.lastDate, productId: ln.product_id });
            }

            if (!candidates.length) break;
            candidates.sort(
                (a, b) =>
                    a.weeklyQty - b.weeklyQty ||
                    (a.lastDateKey < b.lastDateKey ? -1 : a.lastDateKey > b.lastDateKey ? 1 : 0) ||
                    b.incremental - a.incremental ||
                    a.productId.localeCompare(b.productId),
            );

            const win = candidates[0]!;
            lines = win.trial;
            currentGrams = win.trialGrams;
            sequence.push(win.productId);
        }

        const prawnResult = await this.balancePrawnKatsu(lines, history, comps, recipe, sushiCapacityG, sequence);
        return { lines: prawnResult.lines, prawnKatsu: prawnResult };
    }

    private productUsesSushiRice(productId: string, recipe: RecipeMap, comps: ComponentMap): boolean {
        return (recipe[productId] ?? []).some((rc) => {
            const c = comps[rc.component_id];
            return c && ["ROLL", "MAKI", "NIGIRI", "DIRECT_SUSHI_RICE"].includes(c.component_type ?? "");
        });
    }

    private productComponentQty(productId: string, componentId: string, recipe: RecipeMap): number {
        return (recipe[productId] ?? []).filter((rc) => rc.component_id === componentId).reduce((sum, rc) => sum + rc.qty, 0);
    }

    private componentRawQuantity(lines: PlanLine[], recipe: RecipeMap, componentId: string): number {
        let total = 0;
        for (const ln of lines) {
            if (!ln.make) continue;
            total += ln.make * this.productComponentQty(ln.product_id, componentId, recipe);
        }
        return total;
    }

    /** Discrete (ceil-to-whole-prep-unit) rice grams — answers "does the next
     * increment actually cost more rice right now", separate from Engine's
     * continuous grams() used for the frozen Primary/batch-count math. */
    private async riceGramsDiscrete(lines: PlanLine[], recipe: RecipeMap, comps: ComponentMap, prepOverride?: Record<string, number>): Promise<number> {
        const [gPerMaki, gPerRoll, gPerNigiri] = await Promise.all([
            this.settings.getNumber("RICE_PER_MAKI_G"),
            this.settings.getNumber("RICE_PER_FULL_ROLL_G"),
            this.settings.getNumber("RICE_PER_NIGIRI_G"),
        ]);

        const raw: Record<string, number> = {};
        for (const ln of lines) {
            if (!ln.make) continue;
            for (const rc of recipe[ln.product_id] ?? []) {
                raw[rc.component_id] = (raw[rc.component_id] ?? 0) + ln.make * rc.qty;
            }
        }

        let total = 0;
        for (const [cid, rawQty] of Object.entries(raw)) {
            const c = comps[cid];
            if (!c) continue;
            const upp = Number(c.units_per_prep_unit) || 1;
            if (c.component_type === "ROLL" || c.component_type === "MAKI") {
                const prepUnits = prepOverride?.[cid] !== undefined ? prepOverride[cid] : Math.ceil(rawQty / upp);
                total += prepUnits * (c.component_type === "ROLL" ? (gPerRoll ?? 125) : (gPerMaki ?? 90));
            } else if (c.component_type === "NIGIRI") {
                total += rawQty * (gPerNigiri ?? 24);
            } else if (c.component_type === "DIRECT_SUSHI_RICE") {
                total += rawQty;
            }
        }
        return total;
    }

    /** Dormant, settings-driven "multi-box-per-prep-unit" rule (Sando) — no
     * live Sando product exists today, so this is always a no-op (step 1). */
    private async sandoStepFor(productId: string): Promise<number> {
        const ids = ((await this.settings.get("SANDO_STEP_PRODUCT_IDS")) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return ids.includes(productId) ? ((await this.settings.getNumber("SANDO_UNITS_PER_PREP")) ?? 2) : 1;
    }

    private async sandoCapFor(productId: string, rawCap: number): Promise<number> {
        const step = await this.sandoStepFor(productId);
        return step * Math.ceil(rawCap / step);
    }

    /** Rolling-window production history (kiosk+product) from the already
     * durably-written production_plan table. Window is
     * [businessDate-lookbackDays, businessDate), strictly before today. */
    private async loadHistory(tx: Prisma.TransactionClient, kioskId: string, businessDate: Date, lookbackDays: number): Promise<ProductionHistory> {
        const windowStart = addDays(businessDate, -lookbackDays);
        const rows = await tx.productionPlan.findMany({
            where: { kiosk_id: kioskId, business_date: { gte: windowStart, lt: businessDate } },
        });
        const history: ProductionHistory = {};
        for (const r of rows) {
            const h = (history[r.product_id] ??= { totalQty: 0, lastDate: "" });
            h.totalQty += Number(r.planned_qty) || 0;
            const d = toDateStr(r.business_date);
            if (d > h.lastDate) h.lastDate = d;
        }
        return history;
    }

    /**
     * Rounds real Prawn Katsu demand up to a whole roll count, then up again
     * to a full bag (once opened, must be fully used). Trims secondary
     * items if the bag doesn't fit capacity (most-recently-added first);
     * fills surplus bag capacity with more secondary product if there's
     * room. Never throws — soft-fails with a shortfallNote so the plan/
     * email always goes out regardless.
     */
    private async balancePrawnKatsu(
        linesIn: PlanLine[],
        history: ProductionHistory,
        comps: ComponentMap,
        recipe: RecipeMap,
        sushiCapacityG: number,
        sequenceIn: string[],
    ): Promise<PrawnKatsuResult> {
        let lines = linesIn.map((ln) => ({ ...ln }));
        let sequence = sequenceIn.slice();

        const cid = (await this.settings.get("PRAWN_KATSU_COMPONENT_ID")) ?? "";
        const c = comps[cid];
        if (!c) return { lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

        const piecesPerRoll = Number(c.units_per_prep_unit) || 10;
        const rollsPerBag = (await this.settings.getNumber("PRAWN_KATSU_ROLLS_PER_BAG")) ?? 5;

        let rawPieces = this.componentRawQuantity(lines, recipe, cid);
        if (rawPieces <= 0) return { lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

        // Phase 1 — trim secondary contributors, most-recently-added first,
        // until the bag-rounded prep quantity fits capacity, or nothing's left.
        for (;;) {
            const normalRolls = Math.ceil(rawPieces / piecesPerRoll);
            const prepRolls = Math.ceil(normalRolls / rollsPerBag) * rollsPerBag;
            const trialGrams = await this.riceGramsDiscrete(lines, recipe, comps, { [cid]: prepRolls });
            if (trialGrams <= sushiCapacityG) break;

            let removed = false;
            for (let i = sequence.length - 1; i >= 0; i--) {
                const ln = lines.find((l) => l.product_id === sequence[i]);
                if (ln && ln.make > 0 && this.productComponentQty(ln.product_id, cid, recipe) > 0) {
                    ln.make = Math.max(0, ln.make - (await this.sandoStepFor(ln.product_id)));
                    sequence.splice(i, 1);
                    removed = true;
                    break;
                }
            }
            if (!removed) {
                for (const ln of lines) {
                    if (SECONDARY_ROLES.includes(ln.role ?? "") && this.productComponentQty(ln.product_id, cid, recipe) > 0) ln.make = 0;
                }
                break;
            }
            rawPieces = this.componentRawQuantity(lines, recipe, cid);
        }

        rawPieces = this.componentRawQuantity(lines, recipe, cid);
        if (rawPieces === 0) return { lines, bags: 0, prepRolls: 0, spare: 0, shortfallNote: null };

        const prepRolls = Math.ceil(Math.ceil(rawPieces / piecesPerRoll) / rollsPerBag) * rollsPerBag;
        const targetPieces = prepRolls * piecesPerRoll;

        // Phase 2 — fill surplus with normal secondary candidates, respecting
        // each one's cap. Phase 3 — if still short, allow eligible items to
        // exceed their normal cap (the opened bag must be used).
        lines = await this.fillPrawnSurplus(lines, history, comps, recipe, cid, targetPieces, sushiCapacityG, true);
        lines = await this.fillPrawnSurplus(lines, history, comps, recipe, cid, targetPieces, sushiCapacityG, false);

        const finalRaw = this.componentRawQuantity(lines, recipe, cid);
        return {
            lines,
            prepRolls,
            bags: prepRolls / rollsPerBag,
            spare: Math.max(0, targetPieces - finalRaw),
            shortfallNote:
                finalRaw === targetPieces
                    ? null
                    : `Prawn katsu bag rounding couldn't fully allocate the ${prepRolls}-roll bag — ${targetPieces - finalRaw} piece(s) short. Please check with the kitchen.`,
        };
    }

    /** Shared body of the two near-identical fill passes (normal-cap and forced-over-cap). */
    private async fillPrawnSurplus(
        linesIn: PlanLine[],
        history: ProductionHistory,
        comps: ComponentMap,
        recipe: RecipeMap,
        cid: string,
        targetPieces: number,
        sushiCapacityG: number,
        respectCap: boolean,
    ): Promise<PlanLine[]> {
        let lines = linesIn;
        for (let i = 0; i < MAX_ITER; i++) {
            const rawPieces = this.componentRawQuantity(lines, recipe, cid);
            const remaining = targetPieces - rawPieces;
            if (remaining <= 0) break;

            const baselineGrams = await this.riceGramsDiscrete(lines, recipe, comps);
            const candidates: { trial: PlanLine[]; componentPieces: number; incremental: number; currentMake: number; weeklyQty: number; lastDateKey: string; productId: string }[] = [];

            for (const ln of lines) {
                if (!SECONDARY_ROLES.includes(ln.role ?? "")) continue;
                const perUnit = this.productComponentQty(ln.product_id, cid, recipe);
                if (perUnit <= 0) continue;

                const step = respectCap ? await this.sandoStepFor(ln.product_id) : 1;
                if (respectCap && ln.cap !== undefined && ln.make + step > ln.cap) continue;
                const componentPieces = perUnit * step;
                if (componentPieces > remaining) continue;

                const trial = lines.map((l) => (l === ln ? { ...l, make: l.make + step } : l));
                const trialGrams = await this.riceGramsDiscrete(trial, recipe, comps);
                if (trialGrams > sushiCapacityG) continue;

                const hist = history[ln.product_id] ?? { totalQty: 0, lastDate: "" };
                candidates.push({
                    trial,
                    componentPieces,
                    incremental: trialGrams - baselineGrams,
                    currentMake: ln.make,
                    weeklyQty: hist.totalQty,
                    lastDateKey: hist.lastDate,
                    productId: ln.product_id,
                });
            }

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

            lines = candidates[0]!.trial;
        }
        return lines;
    }
}
