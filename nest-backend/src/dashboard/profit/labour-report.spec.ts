import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildLabourTemplate, parseDateCell, parseLabourReport } from "./labour-report.js";

const KIOSKS = [
    { id: "K01", name: "Limerick" },
    { id: "K02", name: "Oranmore" },
    { id: "K03", name: "Loughrea" },
];

function workbook(rows: unknown[][], bookType: "xlsx" | "csv" = "xlsx"): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

describe("parseLabourReport", () => {
    it("reads kiosk + total hours for the chosen week, and prices hours at the hourly rate", () => {
        const { rows, errors } = parseLabourReport(workbook([["Kiosk", "Total hours"], ["Limerick", 120.5], ["Oranmore", 98]]), KIOSKS, { defaultWeek: new Date("2026-09-16T00:00:00Z"), hourlyRate: 12.5 });
        expect(errors).toEqual([]);
        expect(rows).toEqual([
            { kioskId: "K01", kioskName: "Limerick", weekStart: "2026-09-14", hours: 120.5, hourlyRate: 12.5, labourCost: 1506.25 },
            { kioskId: "K02", kioskName: "Oranmore", weekStart: "2026-09-14", hours: 98, hourlyRate: 12.5, labourCost: 1225 },
        ]);
    });

    it("uses the week column when there is one (any day in the week counts) and a cost column over the rate", () => {
        const { rows } = parseLabourReport(workbook([["Week starting", "Kiosk", "Total Hours", "Labour cost (optional)"], ["16/09/2026", "loughrea", 40, 512.4], ["2026-09-07", "K01", 30, ""]]), KIOSKS, { hourlyRate: 10 });
        expect(rows).toEqual([
            { kioskId: "K03", kioskName: "Loughrea", weekStart: "2026-09-14", hours: 40, hourlyRate: null, labourCost: 512.4 },
            { kioskId: "K01", kioskName: "Limerick", weekStart: "2026-09-07", hours: 30, hourlyRate: 10, labourCost: 300 },
        ]);
    });

    it("keeps hours only (no cost) when there is neither a cost column nor a rate", () => {
        const { rows } = parseLabourReport(workbook([["Kiosk", "Hours"], ["Limerick", 10]]), KIOSKS, { defaultWeek: new Date("2026-09-14T00:00:00Z") });
        expect(rows[0]).toMatchObject({ hours: 10, hourlyRate: null, labourCost: null });
    });

    it("skips title rows above the header, blank rows, and a Total row", () => {
        const { rows, errors } = parseLabourReport(workbook([["Weekly labour report"], [], ["Kiosk", "Total hours"], ["Limerick", 5], [], ["Total", 5]]), KIOSKS, { defaultWeek: new Date("2026-09-14T00:00:00Z") });
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(1);
    });

    it("reports what it cannot read, by row, instead of guessing", () => {
        const { rows, errors } = parseLabourReport(workbook([["Kiosk", "Total hours"], ["Galway", 10], ["Limerick", "lots"], ["Oranmore", 9], ["Oranmore", 8]]), KIOSKS, { defaultWeek: new Date("2026-09-14T00:00:00Z") });
        expect(rows.map((r) => r.kioskId)).toEqual(["K02"]);
        expect(errors).toEqual([
            expect.stringContaining('Row 2: "Galway" is not one of your kiosks'),
            expect.stringContaining("Row 3 (Limerick): total hours must be a number"),
            expect.stringContaining("Row 5: Oranmore appears twice"),
        ]);
    });

    it("needs a week from somewhere", () => {
        const { rows, errors } = parseLabourReport(workbook([["Kiosk", "Total hours"], ["Limerick", 10]]), KIOSKS);
        expect(rows).toEqual([]);
        expect(errors[0]).toContain("no week");
    });

    it("says so when the columns are missing, and when it is not a spreadsheet at all", () => {
        expect(parseLabourReport(workbook([["Name", "Something"], ["a", 1]]), KIOSKS).errors[0]).toContain("Couldn't find the columns");
        expect(parseLabourReport(Buffer.from([]), KIOSKS).errors.length).toBe(1);
    });

    it("reads a CSV (a Google Sheet downloaded as .csv)", () => {
        const { rows } = parseLabourReport(workbook([["Kiosk", "Total hours"], ["Limerick", 12]], "csv"), KIOSKS, { defaultWeek: new Date("2026-09-14T00:00:00Z") });
        expect(rows[0]).toMatchObject({ kioskId: "K01", hours: 12 });
    });
});

describe("dates and template", () => {
    it("understands Irish day-first text, ISO text and Excel serial numbers", () => {
        expect(parseDateCell("22/09/2026")?.toISOString().slice(0, 10)).toBe("2026-09-22");
        expect(parseDateCell("2026-09-22")?.toISOString().slice(0, 10)).toBe("2026-09-22");
        expect(parseDateCell(46287)?.toISOString().slice(0, 10)).toBe("2026-09-22");
        expect(parseDateCell("soon")).toBeNull();
    });

    it("the template can be read back by the parser (one line per kiosk, hours blank)", () => {
        const buf = buildLabourTemplate(KIOSKS, new Date("2026-09-16T00:00:00Z"));
        const sheet = XLSX.read(buf, { type: "buffer" });
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet.Sheets["Labour"]!, { header: 1, defval: "" });
        expect(rows[0]).toEqual(["Week starting", "Kiosk", "Total hours", "Labour cost (optional)"]);
        expect(rows.slice(1).map((r) => [r[0], r[1]])).toEqual([["2026-09-14", "Limerick"], ["2026-09-14", "Oranmore"], ["2026-09-14", "Loughrea"]]);
        expect(parseLabourReport(buf, KIOSKS).errors.length).toBe(3); // blank hours are reported, not saved as zero
    });
});
