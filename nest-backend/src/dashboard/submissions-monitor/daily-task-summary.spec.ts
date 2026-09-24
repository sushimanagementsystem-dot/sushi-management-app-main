import { describe, it, expect } from "vitest";
import { summarizeDailyTasks } from "./daily-task-summary.js";

const DAILY = ["MORNING_WASTE", "FRIDGE_COUNT", "STAFF_FOOD"] as const;
const day = (date: string, done: string[], extra: string[] = []) => ({
    date,
    kiosks: { K01: Object.fromEntries([...DAILY, ...extra, "DELIVERY_INVOICE"].map((t) => [t, done.includes(t) || extra.includes(t)])) },
});

describe("summarizeDailyTasks", () => {
    it("only the daily tasks decide a gap: a clean day stays clean however few other forms were sent", () => {
        const s = summarizeDailyTasks([day("2026-09-22", [...DAILY])], "K01", DAILY, "2026-09-24");
        expect(s).toMatchObject({ daysCounted: 1, daysWithGap: 0, completionPct: 100 });
    });

    it("sending every other form does not rescue a day with a missed daily task", () => {
        const s = summarizeDailyTasks([day("2026-09-22", ["MORNING_WASTE", "FRIDGE_COUNT"], ["FOOD_WASTE", "HELP_ISSUE"])], "K01", DAILY, "2026-09-24");
        expect(s).toMatchObject({ daysCounted: 1, daysWithGap: 1, tasksDone: 2, tasksExpected: 3, completionPct: 67 });
    });

    it("leaves today out, since it is not over yet", () => {
        const s = summarizeDailyTasks([day("2026-09-24", []), day("2026-09-23", [...DAILY])], "K01", DAILY, "2026-09-24");
        expect(s).toMatchObject({ daysCounted: 1, daysWithGap: 0, completionPct: 100 });
    });

    it("has nothing to report before any day has finished", () => {
        expect(summarizeDailyTasks([day("2026-09-24", [])], "K01", DAILY, "2026-09-24")).toEqual({ daysCounted: 0, daysWithGap: 0, tasksDone: 0, tasksExpected: 0, completionPct: 0 });
    });

    it("counts a day with no submissions at all as a gap", () => {
        const s = summarizeDailyTasks([{ date: "2026-09-21", kiosks: {} }], "K01", DAILY, "2026-09-24");
        expect(s).toMatchObject({ daysCounted: 1, daysWithGap: 1, completionPct: 0 });
    });
});
