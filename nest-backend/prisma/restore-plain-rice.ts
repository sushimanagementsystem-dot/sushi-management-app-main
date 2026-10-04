// One-off: restores STK170 "Plain Rice", accidentally hard-deleted during a
// real-delete verification test of the deleteTableRow fix (2026-10-04) —
// it passed the reference check since Food Waste-only items legitimately
// have no supplier_item_map/stock_item_par rows, so nothing blocked it.
// Confirmed zero stock_movement rows ever referenced it before restoring —
// no other data was lost. Re-creates it directly into the new RICE (per 100g)
// category (SC09), and also reactivates STK171 "Sushi Rice" (deactivated
// earlier this session), per the client's instruction that both rice items
// should appear only in Food Waste, nowhere else.
//
// Run once: `npx tsx prisma/restore-plain-rice.ts`

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

async function main() {
    const existing = await prisma.stockItem.findUnique({ where: { stock_item_id: "STK170" } });
    if (!existing) {
        const restored = await prisma.stockItem.create({
            data: {
                stock_item_id: "STK170",
                name: "Plain Rice",
                stock_category_id: "SC09",
                count_unit: "G",
                current_unit_cost: null,
                cost_per_100g: null,
                measurement_type: "WEIGHT_G",
                food_waste_eligible: true,
                active: true,
            },
        });
        console.log("✓ restored STK170:", restored);
    } else {
        console.log("STK170 already exists — nothing to do:", existing);
    }

    const sushi = await prisma.stockItem.update({ where: { stock_item_id: "STK171" }, data: { active: true, food_waste_eligible: true } });
    console.log("✓ reactivated STK171 Sushi Rice:", sushi);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
