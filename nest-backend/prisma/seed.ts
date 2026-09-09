// Dev/initial seed — loads prisma/seed-data.xlsx (a copy of the real,
// working Google Sheets database) straight into Postgres via the same
// import pipeline the client-handover upload endpoint uses (see
// src/import/excel-import.ts). Run with `npx prisma db seed`.
//
// Override SEED_XLSX_PATH to seed from a different workbook without
// touching this file.

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { importExcelDatabase } from "../src/import/excel-import.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

async function main() {
    const filePath = process.env.SEED_XLSX_PATH || join(__dirname, "seed-data.xlsx");
    console.log(`Seeding from ${filePath} ...\n`);
    const buffer = readFileSync(filePath);

    const results = await importExcelDatabase(prisma, buffer);

    let totalRows = 0;
    let totalUpserted = 0;
    let totalErrors = 0;

    for (const r of results) {
        totalRows += r.rows;
        totalUpserted += r.upserted;
        totalErrors += r.errors.length;
        const status = r.errors.length ? "⚠" : "✓";
        console.log(`${status} ${r.sheet.padEnd(24)} ${r.upserted}/${r.rows} upserted`);
        for (const e of r.errors.slice(0, 5)) {
            console.log(`    row ${e.row}: ${e.message}`);
        }
        if (r.errors.length > 5) {
            console.log(`    ... and ${r.errors.length - 5} more`);
        }
    }

    console.log(`\nDone: ${totalUpserted}/${totalRows} rows upserted across ${results.length} tables, ${totalErrors} errors.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
