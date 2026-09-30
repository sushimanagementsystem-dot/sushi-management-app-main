// One-off: Evan's "New Production Email Layout" request (2026-09-29).
//
// 1) Move every SET BOXES / PLATTERS product (product_category_id PC02/PC06)
//    into the ingredient plan_group its actual recipe belongs to, so they
//    stop sitting in their own trailing section and instead sit at the
//    bottom of the right ingredient group (production-email.service.ts's
//    combo-sorts-last change does the "at the bottom" part; this does the
//    "right group" part). Classification is read off each product's real
//    recipe_component rows, not its name — veg content always wins ties
//    (Evan's own rule: "the veggie should take priority"), matching every
//    item in his example doc exactly (see final_changes_plan.md).
//
// 2) Fix the Onigiri sushi-rice qty (200g -> 100g, both flavours) and add
//    the Poke sushi-rice component (180g, all 3 rows) that turned out to be
//    missing entirely when checked against the live data — Evan's own
//    "Poke = 180g, working" comparison point wasn't actually wired up.
//
// Run once: `npx tsx prisma/update-menu-layout-and-rice.ts`. Safe to re-run
// (every write is an upsert/update keyed on a real id).

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

// product_id -> new plan_group, from reading each product's recipe_component
// rows directly (see the exploration in this session). Three PLATTERS
// products (Kanazwa Collection, Kurabu Party Platter, Okayama Collection)
// have NO recipe_component rows at all in this database — left out here on
// purpose rather than guessed; they stay in "PLATTERS" until their recipe
// is entered, at which point they can be classified for real.
const RECLASSIFY: Record<string, string> = {
    // --- Veggie (contains a veg roll/maki/nigiri component) ---
    P060: "Veggie", // Big Maki Mix — Avocado Maki
    P127: "Veggie", // Classic Seafood Signature Set — Cucumber Maki
    P062: "Veggie", // Dynamite Collection — Veggie Roll
    P070: "Veggie", // Iconic Triple — Avocado Maki
    P063: "Veggie", // Our Top Picks — Cucumber Maki
    P123: "Veggie", // Plant Power Selection — all veg
    P069: "Veggie", // Sake Selection — Avocado Maki
    P119: "Veggie", // Seafood Variety Bento — Cucumber Maki
    P067: "Veggie", // Yasai Classics — all veg
    P072: "Veggie", // Matsuri Party Platter — all veg
    P128: "Veggie", // Luxury Seafood Sushi Sharer — Cucumber Maki
    P129: "Veggie", // Deluxe Classic Sushi Sharer — Cucumber Maki
    P130: "Veggie", // Sumptious Chicken Sharer — Cucumber Maki (despite the name)

    // --- Salmon (no veg component, salmon-dominant) ---
    P121: "Salmon", // Classic Sushi Selection
    P061: "Salmon", // Discovery Box
    P065: "Salmon", // Neko Catch
    P120: "Salmon", // O-mega Salmon Selection
    P124: "Salmon", // Salmon Favourites Signature Set
    P064: "Salmon", // Tanoshi Finds
    P066: "Salmon", // The Big Two — salmon/prawn tied 1-1; Salmon comes first in the category order, used as the tiebreak
    P071: "Salmon", // Oduru Party Platter

    // --- California (no veg, no dominant protein — just California Roll) ---
    P125: "California", // Crunchy Rainbow Signature Set

    // --- Chicken ---
    P126: "Chicken", // Chicken + Spice Signature Set
    P122: "Chicken", // Spicy Chicken Selection
};

// component_id for the two rice components (from enum/component check earlier
// in this session): C007 = Seasoned Sushi Rice (what Onigiri/Poke use).
const SUSHI_RICE_COMPONENT_ID = "C007";
const ONIGIRI_RICE_GRAMS = 100; // was 200
const POKE_RICE_GRAMS = 180; // was missing entirely

async function main() {
    let moved = 0;
    for (const [productId, group] of Object.entries(RECLASSIFY)) {
        // sort_last_in_group: true is what makes production-email.service.ts
        // list this item after the group's individual rolls/nigiri — set
        // here, not inferred from product_category_id (see schema comment:
        // that field is also SET BOXES/PLATTERS on some regular items, e.g.
        // Mixed Maki, Salmon Classics, that must NOT move).
        const res = await prisma.product.updateMany({ where: { product_id: productId }, data: { plan_group: group, sort_last_in_group: true } });
        if (res.count === 0) {
            console.warn(`  ⚠ product ${productId} not found — skipped`);
        } else {
            moved++;
        }
    }
    console.log(`✓ reclassified ${moved}/${Object.keys(RECLASSIFY).length} combo/sharer/platter products into their ingredient group`);

    // Onigiri: correct the existing rice recipe_component qty.
    const onigiriProducts = await prisma.product.findMany({ where: { name: { contains: "Onigiri", mode: "insensitive" } } });
    let onigiriFixed = 0;
    for (const p of onigiriProducts) {
        const res = await prisma.recipeComponent.updateMany({
            where: { product_id: p.product_id, component_id: SUSHI_RICE_COMPONENT_ID },
            data: { qty: ONIGIRI_RICE_GRAMS },
        });
        onigiriFixed += res.count;
        if (res.count === 0) console.warn(`  ⚠ ${p.name} (${p.product_id}) had no existing sushi-rice recipe_component row to update`);
    }
    console.log(`✓ Onigiri sushi rice corrected to ${ONIGIRI_RICE_GRAMS}g on ${onigiriFixed} row(s)`);

    // Poke: this component was missing entirely — create it.
    const pokeProducts = await prisma.product.findMany({ where: { name: { contains: "Poke", mode: "insensitive" } } });
    let pokeCreated = 0;
    for (const p of pokeProducts) {
        const existing = await prisma.recipeComponent.findFirst({ where: { product_id: p.product_id, component_id: SUSHI_RICE_COMPONENT_ID } });
        if (existing) {
            await prisma.recipeComponent.update({ where: { recipe_component_id: existing.recipe_component_id }, data: { qty: POKE_RICE_GRAMS } });
        } else {
            await prisma.recipeComponent.create({
                data: { recipe_component_id: crypto.randomUUID(), product_id: p.product_id, component_id: SUSHI_RICE_COMPONENT_ID, qty: POKE_RICE_GRAMS, unit: "gram" },
            });
        }
        pokeCreated++;
    }
    console.log(`✓ Poke sushi rice set to ${POKE_RICE_GRAMS}g on ${pokeCreated} product(s) (was missing entirely)`);

    console.log("\nNot touched — no recipe_component data to classify from, still under \"PLATTERS\":");
    console.log("  SC-R006 Kanazwa Collection, SC-R011 Kurabu Party Platter, SC-R016 Okayama Collection");
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
