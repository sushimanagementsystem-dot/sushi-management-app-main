import type { BulkDataset, ChangeSet, ColumnDef, Db, Target } from "../bulk-import.types.js";
import { DAY_HEADERS, WEEKDAYS, findKiosk, loadKiosks, norm, num, text, type KioskRow } from "./shared.js";

/**
 * Defrost items the production email works out by itself from tomorrow's Production Par and the recipes (see
 * ProductionEmailService.buildTomorrowDefrost). Every other item only appears in the email if it has a number here.
 */
const AUTOMATIC_MODES = new Set([
    "KARAAGE_BAGS",
    "PRAWN_ROLLS",
    "CALIFORNIA_ROLLS",
    "PRAWN_NIGIRI_PIECES",
    "INARI_PIECES",
    "CHICKEN_GYOZA_BAGS",
    "DUCK_GYOZA_BAGS",
    "VEGETABLE_GYOZA_BAGS",
    "SALMON_SUMMARY",
    "TUNA_SUMMARY",
    "CHICKEN_KATSU_SUMMARY",
]);

type Item = { defrost_item_id: string; name: string; defrost_unit: string; automatic: boolean };
type Ctx = { kiosks: KioskRow[]; items: Item[]; pars: Map<string, Record<string, unknown>> };

const dayColumns: ColumnDef[] = WEEKDAYS.map((d) => ({ key: d, header: DAY_HEADERS[d].header, aliases: DAY_HEADERS[d].aliases, kind: "value", format: "number", min: 0, width: 7 }));

/**
 * Defrost Par: manual defrost amounts per kiosk, item and weekday, for items with no automatic calculation. The
 * template lists every active defrost item at every kiosk; a row that does not exist yet is created when it gets a number.
 */
export const defrostParDataset: BulkDataset<Ctx> = {
    id: "defrost_par",
    label: "Defrost Par",
    fileName: "defrost-par.xlsx",
    sheetName: "Defrost Par",
    description: "Manual defrost amounts per kiosk, item and weekday (for items the email cannot work out itself).",
    showOn: ["defrost_par"],
    invalidates: ["defrost_par"],
    detect: ["kiosk", "code"],
    columns: [
        { key: "kiosk", header: "Kiosk", aliases: ["kiosk id", "kiosk code"], kind: "key", required: true, width: 8 },
        { key: "kioskName", header: "Kiosk name", kind: "info", width: 22 },
        { key: "name", header: "Defrost item", aliases: ["item", "name", "defrost item name"], kind: "key", width: 30 },
        { key: "unit", header: "Unit", kind: "info", width: 14 },
        { key: "how", header: "How it is worked out", kind: "info", width: 44 },
        ...dayColumns,
        { key: "code", header: "Defrost item code", aliases: ["code", "defrost item id", "item code"], kind: "key", width: 16 },
    ],
    instructions: [
        "One row per kiosk and defrost item, Monday to Sunday: the amount to defrost that day, in the item's Unit.",
        "Items marked Automatic are worked out from the production plan; a number here is only used if the plan needs none of that item.",
        "Items marked 'Type the amount here' only appear in the production email when they have a number for tomorrow's weekday.",
        "The email is sent the day before, so the Tuesday column is what shows in Monday's email. Blank cells keep the current value (no amount).",
    ],
    async load(db: Db) {
        const [kiosks, items, pars] = await Promise.all([loadKiosks(db), db.defrostItem.findMany({ where: { active: true }, orderBy: { defrost_item_id: "asc" } }), db.defrostPar.findMany()]);
        const list: Item[] = (items as { defrost_item_id: string; name: string; defrost_unit: string | null; planning_mode: string | null }[]).map((i) => ({
            defrost_item_id: i.defrost_item_id,
            name: i.name,
            defrost_unit: i.defrost_unit ?? "",
            automatic: AUTOMATIC_MODES.has(i.planning_mode ?? ""),
        }));
        const map = new Map<string, Record<string, unknown>>();
        for (const p of pars as (Record<string, unknown> & { kiosk_id: string; defrost_item_id: string })[]) map.set(`${p.kiosk_id}|${p.defrost_item_id}`, p);
        return { kiosks, items: list, pars: map };
    },
    targets: (ctx): Target[] =>
        ctx.kiosks.flatMap((k) =>
            ctx.items.map((i) => {
                const p = ctx.pars.get(`${k.kiosk_id}|${i.defrost_item_id}`);
                return {
                    ref: `${k.kiosk_id}|${i.defrost_item_id}`,
                    label: { kiosk: k.kiosk_id, kioskName: k.name, name: i.name, unit: i.defrost_unit, how: i.automatic ? "Automatic (a number here is only a fallback)" : "Type the amount here", code: i.defrost_item_id },
                    current: Object.fromEntries(WEEKDAYS.map((d) => [d, num(p?.[d])])),
                    exists: !!p,
                };
            }),
        ),
    resolve(raw, ctx) {
        const kiosk = findKiosk(ctx.kiosks, raw.kiosk);
        if (!kiosk) return { error: `Kiosk "${text(raw.kiosk)}" is not an active kiosk.`, unmatched: true };
        const code = text(raw.code);
        const name = text(raw.name);
        if (!code && !name) return { error: "Missing value: the defrost item code or name is empty." };
        const hits = code ? ctx.items.filter((i) => i.defrost_item_id === code) : ctx.items.filter((i) => norm(i.name) === norm(name));
        if (!hits.length) return { error: `"${code || name}" is not an active defrost item.`, unmatched: true };
        if (hits.length > 1) return { error: `"${name}" matches more than one defrost item. Fill in the Defrost item code column.` };
        return { ref: `${kiosk.kiosk_id}|${hits[0]!.defrost_item_id}` };
    },
    async apply(db: Db, changes: ChangeSet[]) {
        const kiosk = changes.map((c) => c.ref.split("|")[0]!);
        const item = changes.map((c) => c.ref.slice(c.ref.indexOf("|") + 1));
        const d = (day: string) => changes.map((c) => (c.merged[day] ?? null) as number | null);
        const [mo, tu, we, th, fr, sa, su] = WEEKDAYS.map(d);
        await db.$executeRaw`
            INSERT INTO "defrost_par" ("kiosk_id", "defrost_item_id", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")
            SELECT * FROM unnest(${kiosk}::text[], ${item}::text[], ${mo}::numeric[], ${tu}::numeric[], ${we}::numeric[], ${th}::numeric[], ${fr}::numeric[], ${sa}::numeric[], ${su}::numeric[])
            ON CONFLICT ("kiosk_id", "defrost_item_id") DO UPDATE SET
               "MONDAY" = EXCLUDED."MONDAY", "TUESDAY" = EXCLUDED."TUESDAY", "WEDNESDAY" = EXCLUDED."WEDNESDAY", "THURSDAY" = EXCLUDED."THURSDAY",
               "FRIDAY" = EXCLUDED."FRIDAY", "SATURDAY" = EXCLUDED."SATURDAY", "SUNDAY" = EXCLUDED."SUNDAY"`;
    },
};
