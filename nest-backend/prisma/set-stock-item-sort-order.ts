// One-off: Evan's final "STOCK TAKE MASTER SHEET" — sets stock_item.sort_order
// to each item's exact row position on that sheet (113 rows, matched 1:1 by
// name against the current database, 0 unmatched, 0 category mismatches —
// see prisma/data/master-sheet-matched.json, built from the sheet itself).
//
// This is what Weekly Stocktake and the Stock Item Data Table now sort by
// (see data-tables.layout.ts / weekly-stocktake.service.ts) — so after this
// runs, both list items in exactly the sheet's own order. Any stock_item
// NOT on the sheet (old/retired items, the per-100g Food Waste tracking
// items, Plain/Sushi Rice) keeps sort_order blank and sorts after every
// numbered item, same as before.
//
// Safe to re-run: every write is an update keyed on stock_item_id.
// Run: `npx tsx prisma/set-stock-item-sort-order.ts`

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

type MatchedRow = { sortOrder: number; stock_item_id: string; name: string };

async function main() {
    const path = join(__dirname, "data", "master-sheet-matched.json");
    const rows = JSON.parse(readFileSync(path, "utf-8")) as MatchedRow[];

    let updated = 0;
    for (const r of rows) {
        const res = await prisma.stockItem.updateMany({ where: { stock_item_id: r.stock_item_id }, data: { sort_order: r.sortOrder } });
        if (res.count === 0) {
            console.warn(`  ⚠ ${r.stock_item_id} (${r.name}) not found — skipped`);
        } else {
            updated++;
        }
    }
    console.log(`✓ set sort_order on ${updated}/${rows.length} stock items to match the master sheet's row order`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
