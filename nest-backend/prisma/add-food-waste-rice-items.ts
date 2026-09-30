// One-off: Evan's System Review v2 asked for a "RICE" Food Waste category
// with two options — Plain Rice and Sushi Rice, in grams, cost per gram to
// be filled in by him later ("I can manually add just let me know where" —
// Data Tables > Stock Item, cost_per_100g column, same as every other
// weighed item). Not part of his master stock sheet (that's the purchasing/
// stocktake list) — this is Food Waste-only, so it's its own small script
// rather than folded into import-evan-data.ts.
//
// Run once: `npx tsx prisma/add-food-waste-rice-items.ts`. Safe to re-run —
// skips a name that already exists instead of creating a duplicate.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const RICE_ITEMS = [
    { name: "Plain Rice", stock_category_id: "SC04" },
    { name: "Sushi Rice", stock_category_id: "SC04" },
];

async function main() {
    const existingIds = (await prisma.stockItem.findMany({ where: { stock_item_id: { startsWith: "STK" } }, select: { stock_item_id: true } }))
        .map((r) => parseInt(r.stock_item_id.slice(3), 10))
        .filter((n) => !Number.isNaN(n));
    let next = (existingIds.length ? Math.max(...existingIds) : 0) + 1;

    for (const item of RICE_ITEMS) {
        const existing = await prisma.stockItem.findFirst({ where: { name: item.name } });
        if (existing) {
            console.log(`already exists: ${item.name} (${existing.stock_item_id}) — skipped`);
            continue;
        }
        const stockItemId = `STK${String(next++).padStart(3, "0")}`;
        await prisma.stockItem.create({
            data: {
                stock_item_id: stockItemId,
                name: item.name,
                stock_category_id: item.stock_category_id,
                count_unit: "G",
                current_unit_cost: null,
                cost_per_100g: null,
                measurement_type: "WEIGHT_G",
                food_waste_eligible: true,
                active: true,
            },
        });
        console.log(`created ${item.name} (${stockItemId})`);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
