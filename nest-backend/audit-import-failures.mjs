import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { Prisma } from "@prisma/client";

// Build field-type map from the real Prisma DMMF (authoritative, in-sync with schema.prisma)
const modelsByDbName = {};
for (const m of Prisma.dmmf.datamodel.models) {
  modelsByDbName[m.dbName || m.name] = m;
}

const wb = XLSX.read(readFileSync("prisma/seed-data.xlsx"), { cellDates: true, type: "buffer" });

const { IMPORT_ORDER } = await import("./src/import/import-config.ts").catch(async () => {
  return await import("./src/import/import-config.js");
});
