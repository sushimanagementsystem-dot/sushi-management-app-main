import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseLabourReport } from "./labour-report.js";

const KIOSKS = [
    { id: "K01", name: "Limerick" },
    { id: "K02", name: "Oranmore" },
    { id: "K03", name: "Loughrea" },
    { id: "K04", name: "Headford Road" },
];

const HEADER = ["Department name", "Salary identifier", "First name", "Surname", "Employee group name", "Type", "Salary code", "Total worked hours (excl. breaks)", "Hourly rate", "Salary"];

function workbook(rows: unknown[][], bookType: "xlsx" | "csv" = "xlsx"): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    return XLSX.write(wb, { type: "buffer", bookType }) as Buffer;
}

const WEEK = { weekOf: new Date("2026-09-16T00:00:00Z") }; // any day in the week; parser anchors to Monday

describe("parseLabourReport (payroll export)", () => {
    it("counts Shifts hours into a kiosk's Total Hours, and adds the pay line (Shifts + its meal deduction) to Labour cost", () => {
        const { rows, errors } = parseLabourReport(
            workbook([
                HEADER,
                ["Limerick", "1", "Cristhian", "Villegas", "Team Member", "Shifts", "1", "26.25", "14.15", "371.44"],
                ["Limerick", "1", "Cristhian", "Villegas", "Team Member", "Meal deduction", "Meal deduction", "4", "-3", "-12"],
            ]),
            KIOSKS,
            WEEK,
        );
        expect(errors).toEqual([]);
        expect(rows).toEqual([{ kioskId: "K01", kioskName: "Limerick", weekStart: "2026-09-14", hours: 26.25, hourlyRate: null, labourCost: 359.44 }]);
    });

    it("splits a pay line shared across kiosks (comma-separated Department) by that employee's Shifts hours at each one", () => {
        const { rows, notes } = parseLabourReport(
            workbook([
                HEADER,
                ["Headford Road", "5", "Nihal", "Doddamani", "Team Member", "Shifts", "5", "25.25", "14.15", "357.29"],
                ["Limerick", "5", "Nihal", "Doddamani", "Team Member", "Shifts", "5", "13", "14.15", "183.95"],
                ["Headford Road,Limerick", "5", "Nihal", "Doddamani", "Team Member", "Meal deduction", "Meal deduction", "7", "-3", "-21"],
            ]),
            KIOSKS,
            WEEK,
        );
        const headford = rows.find((r) => r.kioskId === "K04")!;
        const limerick = rows.find((r) => r.kioskId === "K01")!;
        expect(headford.hours).toBe(25.25);
        expect(limerick.hours).toBe(13);
        // -21 split 25.25:13 -> -13.86 / -7.14
        expect(headford.labourCost).toBeCloseTo(357.29 - 13.86, 2);
        expect(limerick.labourCost).toBeCloseTo(183.95 - 7.14, 2);
        expect(notes.some((n) => n.includes("Nihal Doddamani") && n.includes("split between"))).toBe(true);
    });

    it("splits evenly, with a note, when there are no Shifts hours to weigh a shared pay line by", () => {
        const { rows, notes } = parseLabourReport(workbook([HEADER, ["Limerick,Oranmore", "9", "Ana", "Popescu", "Team Member", "Meal deduction", "Meal deduction", "2", "-3", "-6"]]), KIOSKS, WEEK);
        expect(rows.map((r) => r.labourCost).sort()).toEqual([-3, -3]);
        expect(notes.some((n) => n.includes("no Shifts hours"))).toBe(true);
    });

    it("puts a pay line with no Department under unassigned instead of guessing, and leaves it out of every kiosk's total", () => {
        const { rows, unassigned } = parseLabourReport(
            workbook([HEADER, ["", "", "Evan", "O'Ceallaigh", "", "Weekly salary", "100", "1", "767.12", "767.12"], ["Limerick", "1", "A", "B", "Team Member", "Shifts", "1", "10", "14.15", "141.5"]]),
            KIOSKS,
            WEEK,
        );
        expect(unassigned).toEqual([{ name: "Evan O'Ceallaigh", type: "Weekly salary", amount: 767.12 }]);
        expect(rows).toEqual([{ kioskId: "K01", kioskName: "Limerick", weekStart: "2026-09-14", hours: 10, hourlyRate: null, labourCost: 141.5 }]);
    });

    it("a non-Shifts pay line (e.g. Weekly salary) adds cost but never hours, even with a Department", () => {
        const { rows } = parseLabourReport(workbook([HEADER, ["Limerick", "9", "A", "B", "Team Member", "Weekly salary", "100", "1", "700", "700"]]), KIOSKS, WEEK);
        expect(rows).toEqual([{ kioskId: "K01", kioskName: "Limerick", weekStart: "2026-09-14", hours: 0, hourlyRate: null, labourCost: 700 }]);
    });

    it("reports an unknown kiosk name by row, instead of guessing", () => {
        const { rows, errors } = parseLabourReport(workbook([HEADER, ["Galway", "1", "A", "B", "Team Member", "Shifts", "1", "10", "14.15", "141.5"]]), KIOSKS, WEEK);
        expect(rows).toEqual([]);
        expect(errors[0]).toContain('"Galway" is not one of your kiosks');
    });

    it("reports a bad Salary or bad Shifts hours value by row", () => {
        const { errors: e1 } = parseLabourReport(workbook([HEADER, ["Limerick", "1", "A", "B", "Team Member", "Shifts", "1", "10", "14.15", "lots"]]), KIOSKS, WEEK);
        expect(e1[0]).toContain("is not a number in the Salary column");
        const { errors: e2 } = parseLabourReport(workbook([HEADER, ["Limerick", "1", "A", "B", "Team Member", "Shifts", "1", "lots", "14.15", "141.5"]]), KIOSKS, WEEK);
        expect(e2[0]).toContain("total worked hours must be a number");
    });

    it("skips blank rows and a Total row", () => {
        const { rows, errors } = parseLabourReport(workbook([HEADER, ["Limerick", "1", "A", "B", "Team Member", "Shifts", "1", "10", "14.15", "141.5"], [], ["Total", "", "", "", "", "", "", "", "", "1234"]]), KIOSKS, WEEK);
        expect(errors).toEqual([]);
        expect(rows).toHaveLength(1);
    });

    it("says so when the columns are missing, and when it is not a spreadsheet at all", () => {
        expect(parseLabourReport(workbook([["Name", "Something"], ["a", 1]]), KIOSKS, WEEK).errors[0]).toContain("Couldn't find the columns");
        expect(parseLabourReport(Buffer.from([]), KIOSKS, WEEK).errors.length).toBe(1);
    });

    it("reads a CSV (a Google Sheet — or this export — downloaded as .csv)", () => {
        const { rows } = parseLabourReport(workbook([HEADER, ["Limerick", "1", "A", "B", "Team Member", "Shifts", "1", "10", "14.15", "141.5"]], "csv"), KIOSKS, WEEK);
        expect(rows[0]).toMatchObject({ kioskId: "K01", hours: 10, labourCost: 141.5 });
    });
});
