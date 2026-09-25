import type { BulkDataset, ChangeSet, ColumnDef, Db, Target } from "../bulk-import.types.js";
import { DAY_HEADERS, WEEKDAYS, findKiosk, loadKiosks, norm, text, type KioskRow } from "./shared.js";

type ParTarget = { ref: string; kiosk: KioskRow; productId: string; productName: string; categoryLabel: string; days: Record<string, number> };
type Ctx = { kiosks: KioskRow[]; targets: ParTarget[]; byRef: Map<string, ParTarget>; byKioskName: Map<string, Map<string, ParTarget[]>> };

const dayColumns: ColumnDef[] = WEEKDAYS.map((d) => ({ key: d, header: DAY_HEADERS[d].header, aliases: DAY_HEADERS[d].aliases, kind: "value", format: "integer", min: 0, width: 7 }));

/**
 * Production Par: how many of each product a kiosk makes on each weekday. Updates existing kiosk + product rows only:
 * a row that does not exist is reported, never created (new products get their rows when the product is added).
 * Rows are listed the way Data Tables lists them: kiosk, product category, product name.
 */
export const productionParDataset: BulkDataset<Ctx> = {
    id: "production_par",
    label: "Production Par",
    fileName: "production-par.xlsx",
    sheetName: "Production Par",
    description: "Weekly fridge targets: how many of each product each kiosk makes on each weekday.",
    showOn: ["production_par"],
    invalidates: ["production_par"],
    detect: ["kiosk", "code"],
    columns: [
        { key: "kiosk", header: "Kiosk", aliases: ["kiosk id", "kiosk code"], kind: "key", required: true, width: 8 },
        { key: "kioskName", header: "Kiosk name", kind: "info", width: 22 },
        { key: "category", header: "Category", kind: "info", width: 26 },
        { key: "name", header: "Product", aliases: ["product name", "item", "name"], kind: "key", width: 42 },
        ...dayColumns,
        { key: "code", header: "Product code", aliases: ["code", "product id", "product_id"], kind: "key", width: 38 },
    ],
    instructions: [
        "One row per kiosk and product, Monday to Sunday. Type the number to make on each day (whole numbers, 0 or more).",
        "Rows are matched by Kiosk and Product code (or by the product name at that kiosk). Blank cells keep the current number.",
        "A product that is not set up for a kiosk is reported: add the product first, do not add rows here.",
    ],
    async load(db: Db) {
        const [kiosks, pars, products, categories] = await Promise.all([
            loadKiosks(db),
            db.productionPar.findMany(),
            db.product.findMany({ where: { active: true } }),
            db.enumOption.findMany({ where: { enum_type: "product_category" }, orderBy: { sort_order: "asc" } }),
        ]);
        const kioskById = new Map(kiosks.map((k) => [k.kiosk_id, k]));
        const productById = new Map((products as { product_id: string; name: string; product_category_id: string }[]).map((p) => [p.product_id, p]));
        const catLabel = new Map((categories as { value: string; label: string }[]).map((c) => [c.value, c.label]));
        const catOrder = new Map((categories as { value: string }[]).map((c, i) => [c.value, i]));
        const targets: (ParTarget & { order: number })[] = [];
        for (const p of pars as (Record<string, unknown> & { kiosk_id: string; product_id: string })[]) {
            const kiosk = kioskById.get(p.kiosk_id);
            const product = productById.get(p.product_id);
            if (!kiosk || !product) continue; // an inactive kiosk or product is not on the sheet
            targets.push({
                ref: `${kiosk.kiosk_id}|${product.product_id}`,
                kiosk,
                productId: product.product_id,
                productName: product.name,
                categoryLabel: catLabel.get(product.product_category_id) ?? product.product_category_id,
                order: catOrder.get(product.product_category_id) ?? 9999,
                days: Object.fromEntries(WEEKDAYS.map((d) => [d, Number(p[d] ?? 0)])),
            });
        }
        targets.sort((a, b) => a.kiosk.kiosk_id.localeCompare(b.kiosk.kiosk_id) || a.order - b.order || a.productName.localeCompare(b.productName) || a.productId.localeCompare(b.productId));
        const byKioskName = new Map<string, Map<string, ParTarget[]>>();
        for (const t of targets) {
            const perKiosk = byKioskName.get(t.kiosk.kiosk_id) ?? new Map<string, ParTarget[]>();
            perKiosk.set(norm(t.productName), [...(perKiosk.get(norm(t.productName)) ?? []), t]);
            byKioskName.set(t.kiosk.kiosk_id, perKiosk);
        }
        return { kiosks, targets, byRef: new Map(targets.map((t) => [t.ref, t])), byKioskName };
    },
    targets: (ctx): Target[] =>
        ctx.targets.map((t) => ({
            ref: t.ref,
            label: { kiosk: t.kiosk.kiosk_id, kioskName: t.kiosk.name, category: t.categoryLabel, name: t.productName, code: t.productId },
            current: t.days,
            exists: true,
        })),
    resolve(raw, ctx) {
        const kiosk = findKiosk(ctx.kiosks, raw.kiosk);
        if (!kiosk) return { error: `Kiosk "${text(raw.kiosk)}" is not an active kiosk.`, unmatched: true };
        const code = text(raw.code);
        if (code) {
            const ref = `${kiosk.kiosk_id}|${code}`;
            return ctx.byRef.has(ref) ? { ref } : { error: `There is no Production Par row for product code "${code}" at ${kiosk.kiosk_id} (or the product is inactive). Add the product first.`, unmatched: true };
        }
        const name = text(raw.name);
        if (!name) return { error: "Missing value: the product code or product name is empty." };
        const hits = ctx.byKioskName.get(kiosk.kiosk_id)?.get(norm(name)) ?? [];
        if (!hits.length) return { error: `"${name}" has no Production Par row at ${kiosk.kiosk_id}.`, unmatched: true };
        if (hits.length > 1) return { error: `"${name}" matches more than one product at ${kiosk.kiosk_id}. Fill in the Product code column.` };
        return { ref: hits[0]!.ref };
    },
    async apply(db: Db, changes: ChangeSet[]) {
        const kiosk = changes.map((c) => c.ref.split("|")[0]!);
        const product = changes.map((c) => c.ref.slice(c.ref.indexOf("|") + 1));
        const d = (day: string) => changes.map((c) => c.merged[day] as number);
        const [mo, tu, we, th, fr, sa, su] = WEEKDAYS.map(d);
        const updated: number = await db.$executeRaw`
            UPDATE "production_par" AS p SET "MONDAY" = v.mo, "TUESDAY" = v.tu, "WEDNESDAY" = v.we, "THURSDAY" = v.th, "FRIDAY" = v.fr, "SATURDAY" = v.sa, "SUNDAY" = v.su
            FROM (SELECT * FROM unnest(${kiosk}::text[], ${product}::text[], ${mo}::int[], ${tu}::int[], ${we}::int[], ${th}::int[], ${fr}::int[], ${sa}::int[], ${su}::int[])
                  AS t(kiosk_id, product_id, mo, tu, we, th, fr, sa, su)) AS v
            WHERE p."kiosk_id" = v.kiosk_id AND p."product_id" = v.product_id`;
        if (updated !== changes.length) throw new Error(`Expected to update ${changes.length} Production Par rows but updated ${updated}; nothing was saved.`);
    },
};
