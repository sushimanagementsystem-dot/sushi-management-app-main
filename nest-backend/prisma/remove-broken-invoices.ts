// One-off: removes the 2 delivery invoices whose uploaded image is gone
// from the server entirely ("Page 1: the uploaded file is no longer on the
// server, so AI can't read it") — Evan asked for these specifically removed
// since there is nothing to review (no image, 0 extracted lines, never
// confirmed so no stock was ever posted for them).
//
// Does NOT touch the other AI-failed invoices (API key issue, unreadable
// AI answer) — those still have a real, viewable image, just a separate
// extraction problem; left for manual entry / re-run as usual.
//
// Run once: `npx tsx prisma/remove-broken-invoices.ts`

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const HEADER_IDS = ["91334bdd-cb0f-4701-8e66-46530088d497", "bca25290-3858-4a65-84c5-508543916a9b"];

async function main() {
    const headers = await prisma.deliveryHeader.findMany({ where: { delivery_header_id: { in: HEADER_IDS } } });
    if (!headers.length) {
        console.log("None of these delivery_header rows exist anymore — nothing to do.");
        return;
    }

    for (const h of headers) {
        console.log(`Removing delivery_header ${h.delivery_header_id} (kiosk ${h.kiosk_id}, ${h.delivery_date.toISOString().slice(0, 10)}, status ${h.status})`);

        const lines = await prisma.invoiceLine.deleteMany({ where: { delivery_header_id: h.delivery_header_id } });
        console.log(`  invoice_line deleted: ${lines.count}`);

        const files = await prisma.deliveryFile.deleteMany({ where: { delivery_header_id: h.delivery_header_id } });
        console.log(`  delivery_file deleted: ${files.count}`);

        if (h.submission_id) {
            const actions = await prisma.ownerAction.deleteMany({ where: { source_submission_id: h.submission_id, category: "INVOICE_REVIEW" } });
            console.log(`  owner_action deleted: ${actions.count}`);
        }

        await prisma.deliveryHeader.delete({ where: { delivery_header_id: h.delivery_header_id } });
        console.log("  delivery_header deleted.");
    }
    console.log("\n✓ done.");
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
