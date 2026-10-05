import type { BulkDataset, ChangeSet, Db, Target } from "../bulk-import.types.js";
import { norm, text } from "./shared.js";

type ProductRow = { product_id: string; name: string; brand_id: string | null; product_category_id: string; plan_group: string | null };
type Ctx = {
    products: ProductRow[];
    byId: Map<string, ProductRow>;
    byName: Map<string, ProductRow[]>;
    brandName: Map<string, string>;
    categoryLabel: Map<string, string>;
    validGroups: Set<string>;
    groupLabel: Map<string, string>;
    groupRows: { value: string; sortOrder: number | null }[];
};

/**
 * Product Plan Group: which "Menu Items to Make" group a product sits under in the production plan email (Veggie,
 * Salmon, California...), and so which heading/order it follows — see common/plan_group's sort_order on Enum
 * Option. A brand with no products on these groups yet (or on its own older, unrelated set) just never sorts
 * correctly; this re-assigns every product, across brands, in one file, same group names and order for both.
 */
export const productPlanGroupDataset: BulkDataset<Ctx> = {
    id: "product_plan_group",
    label: "Product Plan Groups",
    fileName: "product-plan-groups.xlsx",
    sheetName: "Plan Groups",
    description: "Which Menu Items to Make group (Veggie, Salmon, California...) each product belongs to.",
    showOn: ["product"],
    invalidates: ["product"],
    detect: ["name", "planGroup"],
    columns: [
        { key: "brand", header: "Brand", kind: "info", width: 14 },
        { key: "category", header: "Category", kind: "info", width: 24 },
        { key: "name", header: "Product", aliases: ["product name", "item", "name"], kind: "key", width: 42 },
        { key: "planGroup", header: "Plan Group", aliases: ["plan group", "group", "menu group"], kind: "value", format: "text", width: 22 },
        { key: "code", header: "Product code", aliases: ["code", "product id", "product_id"], kind: "key", width: 38 },
    ],
    instructions: [
        "Type the Plan Group each product belongs to (e.g. Veggie, Salmon, California, Prawn, Chicken) — see the 'Valid Plan Groups' sheet for the exact spelling and current order.",
        "This decides both the heading a product is grouped under in the production plan email, and the order those headings appear in (set on Dashboard > Data Tables > Enum Option > Plan Group, under Sort Order).",
        "Works across both brands in the same file — Sushi Circle products can use the exact same groups as YO!, in the exact same order.",
        "Rows are matched by Product code, or by Product name where it's unique. Leave Plan Group blank to keep it as-is.",
        "To add a new group (or change the order), do that first on Dashboard > Data Tables > Enum Option > Plan Group — then use that exact name here.",
    ],
    async load(db: Db) {
        const [products, brands, categories, groups] = await Promise.all([
            db.product.findMany({ where: { active: true } }),
            db.brand.findMany(),
            db.enumOption.findMany({ where: { enum_type: "product_category" } }),
            db.enumOption.findMany({ where: { enum_type: "plan_group" }, orderBy: [{ sort_order: "asc" }, { label: "asc" }] }),
        ]);
        const byName = new Map<string, ProductRow[]>();
        for (const p of products as ProductRow[]) byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p]);
        return {
            products: products as ProductRow[],
            byId: new Map((products as ProductRow[]).map((p) => [p.product_id, p])),
            byName,
            brandName: new Map((brands as { brand_id: string; name: string }[]).map((b) => [b.brand_id, b.name])),
            categoryLabel: new Map((categories as { value: string; label: string }[]).map((c) => [c.value, c.label])),
            validGroups: new Set((groups as { value: string }[]).map((g) => norm(g.value))),
            groupLabel: new Map((groups as { value: string; label: string }[]).map((g) => [norm(g.value), g.label])),
            groupRows: (groups as { value: string; sort_order: number | null }[]).map((g) => ({ value: g.value, sortOrder: g.sort_order })),
        };
    },
    targets: (ctx): Target[] =>
        ctx.products
            .map((p) => ({
                ref: p.product_id,
                label: {
                    brand: (p.brand_id && ctx.brandName.get(p.brand_id)) || p.brand_id || "",
                    category: ctx.categoryLabel.get(p.product_category_id) ?? p.product_category_id,
                    name: p.name,
                    code: p.product_id,
                },
                current: { planGroup: p.plan_group ? ctx.groupLabel.get(norm(p.plan_group)) ?? p.plan_group : null },
                exists: true,
                sortKey: `${p.brand_id ?? ""}|${ctx.categoryLabel.get(p.product_category_id) ?? ""}|${p.name}`,
            }))
            .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
            .map(({ sortKey: _sortKey, ...t }) => t),
    resolve(raw, ctx) {
        // Validated here (not in check()) because check() isn't handed ctx — resolve() is, and this still runs
        // once per row either way.
        const typedGroup = text(raw.planGroup);
        if (typedGroup && !ctx.validGroups.has(norm(typedGroup))) {
            return { error: `"${typedGroup}" is not a Plan Group that exists yet. Add it on Data Tables > Enum Option > Plan Group first, or check the spelling against the Valid Plan Groups sheet.` };
        }

        const code = text(raw.code);
        if (code) return ctx.byId.has(code) ? { ref: code } : { error: `Product code "${code}" was not found (or is inactive).`, unmatched: true };
        const name = text(raw.name);
        if (!name) return { error: "Missing value: the product code or product name is empty." };
        const hits = ctx.byName.get(norm(name)) ?? [];
        if (!hits.length) return { error: `"${name}" is not an active product.`, unmatched: true };
        if (hits.length > 1) return { error: `"${name}" matches more than one product. Fill in the Product code column to say which.` };
        return { ref: hits[0]!.product_id };
    },
    referenceSheets: (ctx) => [
        {
            name: "Valid Plan Groups",
            rows: [["Order", "Plan Group"], ...ctx.groupRows.map((g) => [g.sortOrder ?? "(unordered, sorts after the ones with an order)", g.value])],
        },
    ],
    async apply(db: Db, changes: ChangeSet[], ctx: Ctx) {
        const ids = changes.map((c) => c.ref);
        const groups = changes.map((c) => {
            const raw = c.merged.planGroup as string | null;
            if (raw === null || raw === "") return null;
            // Resolves to the enum_option's own value (correct casing/spacing), not whatever the client typed —
            // check() above already confirmed norm(raw) matches one, so this is always found here.
            return ctx.groupLabel.get(norm(raw)) ?? raw;
        });
        await db.$executeRaw`
            UPDATE "product" AS p SET "plan_group" = v.group
            FROM (SELECT unnest(${ids}::text[]) AS id, unnest(${groups}::text[]) AS group) AS v
            WHERE p."product_id" = v.id`;
    },
};
