// One-off: Evan confirmed "[Stock Item] list is wrong.. Use the universal
// product list I had sent", and the same stale items were also surfacing in
// the Move Stock Between Kiosks and Food Waste item dropdowns (both already
// correctly filter to active items — the items themselves were just still
// marked active). Deactivates stock items that are NOT in his finalized
// master sheet (evan-import-2026-09-28.json) — leftover items from before
// his sheet existed, e.g. "Chicken Skewer", "Okonomi Sauce" (his own
// examples).
//
// Deliberately excludes, even though they're also outside his sheet:
//   - Food Waste-only items (stock_item_id starting "FW") — a separate
//     feature (Food Waste form), not part of the Stock Take/purchasing list
//     his sheet covers. Deactivating these breaks Food Waste.
//   - The 11 pairs import-evan-data.ts flagged as POSSIBLE_RENAMES — each
//     one might be the SAME product as something already created from his
//     sheet under a new name, just worded differently. Deactivating the old
//     one before confirming they're duplicates risks losing the wrong one's
//     history/price if they turn out to be different products.
//   - STK004 "MAYONAISSE, SRIRACHA" (SC01/Kiosk) — already separately
//     flagged in final_changes_plan.md as a known stale ambient-category
//     item, not acted on without asking.
//
// Safe to re-run: updateMany on active=true rows only.
// Run: `npx tsx prisma/deactivate-non-sheet-stock-items.ts`

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const POSSIBLE_RENAME_EXISTING_NAMES = new Set([
    "SOY SAUCE 1L",
    "SRIRACHA SAUCE",
    "WHITE SESAME SEEDS",
    "BLACK SESAME SEEDS",
    "SUSHI GINGER SACHETS",
    "WASABI SACHETS",
    "MISO RAMEN MEAL KIT",
    "TAN TAN RAMEN MEAL KIT",
    "UDON MEAL KIT",
    "BAMBOO CHOPSTICKS",
    "SODA POP 200ML",
]);
const KNOWN_FLAGGED_SEPARATELY = new Set(["STK004"]);

async function main() {
    const dataPath = join(__dirname, "data", "evan-import-2026-09-28.json");
    const data = JSON.parse(readFileSync(dataPath, "utf-8")) as { updates: { stock_item_id: string }[]; creates: { stock_item_id: string }[]; ambient_links: { ambient_id: string }[] };
    const inSheet = new Set([...data.updates.map((u) => u.stock_item_id), ...data.creates.map((c) => c.stock_item_id), ...data.ambient_links.map((l) => l.ambient_id), "STK170", "STK171"]);

    const active = await prisma.stockItem.findMany({ where: { active: true }, select: { stock_item_id: true, name: true } });

    const toDeactivate = active.filter(
        (s) =>
            !inSheet.has(s.stock_item_id) &&
            !s.stock_item_id.startsWith("FW") &&
            !POSSIBLE_RENAME_EXISTING_NAMES.has(s.name.trim().toUpperCase()) &&
            !KNOWN_FLAGGED_SEPARATELY.has(s.stock_item_id),
    );

    console.log(`Deactivating ${toDeactivate.length} stock item(s) not in Evan's master sheet:`);
    toDeactivate.forEach((s) => console.log(`  ${s.stock_item_id} | ${s.name}`));

    if (toDeactivate.length) {
        await prisma.stockItem.updateMany({ where: { stock_item_id: { in: toDeactivate.map((s) => s.stock_item_id) } }, data: { active: false } });
    }
    console.log(`\n✓ done — ${toDeactivate.length} deactivated.`);
    console.log(`\nLeft untouched on purpose: Food Waste-only ("FW...") items, the 11 possible-rename items, and STK004 — see comment at top of this script for why.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
