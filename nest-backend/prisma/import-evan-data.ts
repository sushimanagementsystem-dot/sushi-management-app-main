// One-off reconciliation of Evan's finalized master sheet
// (STOCK TAKE MASTER SHEET (1) (1).xlsx, confirmed correct by him after 3
// rounds of back-and-forth — see final_changes_plan.md) into stock_item.
//
// Run once: `npx tsx prisma/import-evan-data.ts` (needs a real DATABASE_URL
// in .env — this was written and reviewed without one reachable from the
// dev sandbox, so it has not been executed against a live database yet).
//
// Data source: prisma/data/evan-import-2026-09-28.json, built by matching
// his 113-row sheet against the current stock_item table STRICTLY (exact
// name + category after normalizing case/punctuation) — never a fuzzy
// guess. A row that doesn't match exactly becomes a new stock_item instead
// of being merged into a similarly-named existing one; see
// POSSIBLE_RENAMES below for the ones worth a manual look before deciding
// whether they're actually duplicates.
//
// Safe to re-run: every write is either an update keyed on an existing
// stock_item_id, or an insert with a fixed id computed at build time (see
// build script) — running twice just re-applies the same values.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

type UpdateRow = { stock_item_id: string; name: string; measurement_type: "WEIGHT_G" | "COUNT"; cost_per_100g: number | null };
type CreateRow = {
    stock_item_id: string;
    name: string;
    stock_category_id: string;
    count_unit: string;
    current_unit_cost: number | null;
    cost_per_100g: number | null;
    measurement_type: "WEIGHT_G" | "COUNT";
};
type AmbientLink = { ambient_id: string; real_id: string | null; ambient_name: string };
type ImportData = { updates: UpdateRow[]; creates: CreateRow[]; ambient_links: AmbientLink[] };
type SupplierItemRow = {
    stock_item_id: string;
    name: string;
    supplier_name: string;
    case_multiple: number | null;
    current_price: number | null;
    is_salmon_castlebay: boolean;
};

// New items whose name is close to an existing one but didn't match exactly
// (different wording/pack size/brand on the same concept) — created as new
// rather than guessed, per the conservative matching rule above. Worth a
// human look in the Data Tables "Stock Item" tab: if either pair really is
// the same product, keep one and re-point any stock_movement/par rows
// before deactivating the other (this script does not merge automatically).
const POSSIBLE_RENAMES: [existingName: string, newName: string][] = [
    ["SOY SAUCE 1L", "Soy Sauce"],
    ["SRIRACHA SAUCE", "Sriracha Chilli Sauce"],
    ["WHITE SESAME SEEDS", "SESAME SEEDS, WHITE"],
    ["BLACK SESAME SEEDS", "SESAME SEEDS, BLACK"],
    ["SUSHI GINGER SACHETS", "Sushi Ginger"],
    ["WASABI SACHETS", "Wasabi"],
    ["MISO RAMEN MEAL KIT", "Yutaka Miso Ramen Meal Kit 184g"],
    ["TAN TAN RAMEN MEAL KIT", "Yutaka Tan Tan Ramen Meal Kit 215g"],
    ["UDON MEAL KIT", "Yutaka Yaki Udon Meal Kit 376g"],
    ["BAMBOO CHOPSTICKS", "CHOPSTICKS"],
    ["SODA POP 200ML", "Hata Bin Ramune -Soda Pop 200ml"],
];

const AMBIENT_CATEGORY = { enum_type: "stock_category", value: "SC01" as const, label: "Kiosk (ambient product only)" };

async function main() {
    const dataPath = join(__dirname, "data", "evan-import-2026-09-28.json");
    const data = JSON.parse(readFileSync(dataPath, "utf-8")) as ImportData;
    const supplierItemPath = join(__dirname, "data", "evan-supplier-item-map-2026-09-28.json");
    const supplierItems = JSON.parse(readFileSync(supplierItemPath, "utf-8")) as SupplierItemRow[];

    console.log(`Loaded ${data.updates.length} updates, ${data.creates.length} creates, ${data.ambient_links.length} ambient links from ${dataPath}`);
    console.log(`Loaded ${supplierItems.length} supplier-item mappings from ${supplierItemPath}\n`);

    const missingAmbientTarget = data.ambient_links.filter((l) => !l.real_id);
    if (missingAmbientTarget.length) {
        console.error("Ambient links with no resolved real_id — fix prisma/data/evan-import-2026-09-28.json before running:");
        for (const l of missingAmbientTarget) console.error(`  ${l.ambient_id} (${l.ambient_name})`);
        process.exit(1);
    }

    await prisma.$transaction(async (tx) => {
        // SC01's label is already "KIOSK" on this DB (see schema check below) — relabel to match
        // Evan's own wording so the Stock Take/Food Waste UI reads the same as his sheet.
        await tx.enumOption.upsert({
            where: { enum_type_value: { enum_type: AMBIENT_CATEGORY.enum_type, value: AMBIENT_CATEGORY.value } },
            update: { label: AMBIENT_CATEGORY.label },
            create: { enum_type: AMBIENT_CATEGORY.enum_type, value: AMBIENT_CATEGORY.value, label: AMBIENT_CATEGORY.label, sort_order: 1, active: true },
        });

        for (const u of data.updates) {
            await tx.stockItem.update({
                where: { stock_item_id: u.stock_item_id },
                data: { measurement_type: u.measurement_type, cost_per_100g: u.cost_per_100g },
            });
        }
        console.log(`✓ updated ${data.updates.length} existing stock items (measurement_type + cost_per_100g)`);

        for (const c of data.creates) {
            // upsert, not create: re-running this script (e.g. after adding
            // the supplier-item step below) must not fail on items already
            // inserted by an earlier run.
            await tx.stockItem.upsert({
                where: { stock_item_id: c.stock_item_id },
                update: {
                    name: c.name,
                    stock_category_id: c.stock_category_id,
                    count_unit: c.count_unit,
                    current_unit_cost: c.current_unit_cost,
                    cost_per_100g: c.cost_per_100g,
                    measurement_type: c.measurement_type,
                },
                create: {
                    stock_item_id: c.stock_item_id,
                    name: c.name,
                    stock_category_id: c.stock_category_id,
                    count_unit: c.count_unit,
                    current_unit_cost: c.current_unit_cost,
                    cost_per_100g: c.cost_per_100g,
                    measurement_type: c.measurement_type,
                    food_waste_eligible: true,
                    active: true,
                },
            });
        }
        console.log(`✓ created/updated ${data.creates.length} new stock items`);

        for (const l of data.ambient_links) {
            await tx.stockItem.update({
                where: { stock_item_id: l.ambient_id },
                data: { ambient_duplicate_of: l.real_id },
            });
        }
        console.log(`✓ linked ${data.ambient_links.length} ambient (Kiosk-only) duplicate rows to their real item`);

        // Evan's explicit, confirmed answers for every supplier (see
        // final_changes_plan.md): Castlebay/Asia Market/Tazaki get a filled
        // order-sheet attachment, Bunzl gets a plain "what to order" email,
        // Sysco/VSD/Supermarket stay fully manual (never auto-ordered).
        // Written as explicit per-supplier sets, not a blanket default —
        // this DB's seed data has stale order_output_method values
        // (ONLINE_ORDER_LIST/GMAIL_DRAFT/MANUAL from before "ORDER_SHEET"
        // existed) that don't match Evan's answers at all, so nothing here
        // can be assumed already correct.
        const SUPPLIER_METHODS: Record<string, string> = {
            Castlebay: "ORDER_SHEET",
            "Asia Market": "ORDER_SHEET",
            Tazaki: "ORDER_SHEET",
            Bunzl: "EMAIL_ORDER",
            Sysco: "MANUAL",
            VSD: "MANUAL",
            Supermarket: "MANUAL",
        };
        let supplierFixCount = 0;
        for (const [name, method] of Object.entries(SUPPLIER_METHODS)) {
            const res = await tx.supplier.updateMany({ where: { name }, data: { order_output_method: method } });
            supplierFixCount += res.count;
            if (res.count === 0) console.warn(`  ⚠ no supplier named "${name}" found — order_output_method not set`);
        }
        console.log(`✓ set order_output_method on ${supplierFixCount} supplier(s) to match Evan's confirmed answers`);

        // Supplier Items: which supplier each Stock Take item actually comes
        // from, from Evan's finalized sheet's own Supplier column — this is
        // what buildRecommendations (purchasing-scan.service.ts) needs to
        // resolve a supplier for an item at all; without it, par levels and
        // order emails have nothing to attach to. A stock_item with an
        // existing mapping to a *different* supplier than Evan's answer is
        // deactivated (never deleted — history stays intact) so
        // resolveSupplierForItem never sees two active suppliers for the
        // same item (AMBIGUOUS_SUPPLIER).
        const suppliers = await tx.supplier.findMany();
        const supplierIdByName = new Map(suppliers.map((s) => [s.name, s.supplier_id]));

        let mapCreated = 0;
        let mapUpdated = 0;
        let mapDeactivated = 0;
        for (const row of supplierItems) {
            const supplierId = supplierIdByName.get(row.supplier_name);
            if (!supplierId) {
                console.warn(`  ⚠ no supplier named "${row.supplier_name}" found — skipping mapping for ${row.stock_item_id} (${row.name})`);
                continue;
            }
            const existingForItem = await tx.supplierItemMap.findMany({ where: { stock_item_id: row.stock_item_id, active: true } });
            const correct = existingForItem.find((m) => m.supplier_id === supplierId);
            const wrong = existingForItem.filter((m) => m.supplier_id !== supplierId);
            if (wrong.length) {
                await tx.supplierItemMap.updateMany({ where: { supplier_item_map_id: { in: wrong.map((w) => w.supplier_item_map_id) } }, data: { active: false } });
                mapDeactivated += wrong.length;
            }

            const fixedOrderQty = row.is_salmon_castlebay ? 4 : null;
            if (correct) {
                await tx.supplierItemMap.update({
                    where: { supplier_item_map_id: correct.supplier_item_map_id },
                    data: { case_multiple: row.case_multiple, current_price: row.current_price, fixed_order_qty: fixedOrderQty, active: true },
                });
                mapUpdated++;
            } else {
                await tx.supplierItemMap.create({
                    data: {
                        supplier_id: supplierId,
                        stock_item_id: row.stock_item_id,
                        case_multiple: row.case_multiple,
                        current_price: row.current_price,
                        fixed_order_qty: fixedOrderQty,
                        active: true,
                    },
                });
                mapCreated++;
            }
        }
        console.log(`✓ supplier items: ${mapCreated} created, ${mapUpdated} updated, ${mapDeactivated} stale mapping(s) deactivated`);
    });

    console.log("\nDone.");
    if (POSSIBLE_RENAMES.length) {
        console.log(`\n${POSSIBLE_RENAMES.length} new item(s) were created with a name close to an existing item — worth checking by hand`);
        console.log("in the Data Tables \"Stock Item\" tab in case they're actually the same product renamed:\n");
        for (const [existing, created] of POSSIBLE_RENAMES) console.log(`  existing "${existing}"  <->  new "${created}"`);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
