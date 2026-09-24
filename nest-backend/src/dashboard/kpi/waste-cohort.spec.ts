import { describe, it, expect } from "vitest";
import { addDaysStr, cohortSamples, ratePct, type PlanCell, type RateEvent } from "./waste-cohort.js";

const shelf2 = () => 2;
const plan = (date: string, qty: number, product = "P1", kiosk = "K1"): PlanCell => ({ kiosk, product, date, qty });
const waste = (date: string, producedOn: string | null, qty: number, product = "P1", kiosk = "K1"): RateEvent => ({ kiosk, product, date, producedOn, qty });
const run = (plans: PlanCell[], events: RateEvent[], window: { from: string; to: string }, shift = true) => cohortSamples(["K1"], plans, events, [window], shelf2, shift).get("K1")![0]!;

describe("cohortSamples (waste)", () => {
    it("measures the waste binned in a period against the plan of the batches it came from", () => {
        // Waste binned 09-17..09-19 comes from batches planned 09-15..09-17, so those days' plans are the base.
        const plans = [plan("2026-09-14", 100), plan("2026-09-15", 20), plan("2026-09-16", 30), plan("2026-09-17", 50), plan("2026-09-18", 200)];
        const events = [waste("2026-09-17", "2026-09-15", 2), waste("2026-09-18", "2026-09-16", 3), waste("2026-09-19", "2026-09-17", 5)];
        expect(run(plans, events, { from: "2026-09-17", to: "2026-09-19" })).toEqual({ events: 10, base: 100 });
    });

    it("leaves out waste whose batch has no plan (nothing to measure it against)", () => {
        const plans = [plan("2026-09-15", 20)];
        const events = [waste("2026-09-17", "2026-09-15", 2), waste("2026-09-18", "2026-09-16", 9), waste("2026-09-18", null, 4), waste("2026-09-18", "2026-09-15", 1, "OTHER_PRODUCT")];
        expect(run(plans, events, { from: "2026-09-17", to: "2026-09-19" })).toEqual({ events: 2, base: 20 });
    });

    it("uses each product's own shelf life to find its batch day", () => {
        // LONG (4 days) planned 09-14 and SHORT (2 days) planned 09-16 are both binned on 09-18.
        const plans = [plan("2026-09-14", 10, "LONG"), plan("2026-09-16", 10, "SHORT")];
        const shelf = (p: string) => (p === "LONG" ? 4 : 2);
        const on = (d: string) => cohortSamples(["K1"], plans, [], [{ from: d, to: d }], shelf, true).get("K1")![0]!.base;
        expect(on("2026-09-18")).toBe(20);
        expect(on("2026-09-16")).toBe(0);
    });

    it("damage is not shifted: same-day plan, same-day damage", () => {
        const plans = [plan("2026-09-17", 40)];
        const events = [waste("2026-09-17", null, 2)];
        expect(run(plans, events, { from: "2026-09-17", to: "2026-09-17" }, false)).toEqual({ events: 2, base: 40 });
    });

    it("keeps kiosks apart and handles several windows", () => {
        const plans = [plan("2026-09-15", 10, "P1", "K1"), plan("2026-09-15", 90, "P1", "K2")];
        const events = [waste("2026-09-17", "2026-09-15", 1, "P1", "K1"), waste("2026-09-17", "2026-09-15", 9, "P1", "K2")];
        const out = cohortSamples(["K1", "K2"], plans, events, [{ from: "2026-09-17", to: "2026-09-17" }, { from: "2026-09-01", to: "2026-09-02" }], shelf2, true);
        expect(out.get("K1")![0]).toEqual({ events: 1, base: 10 });
        expect(out.get("K2")![0]).toEqual({ events: 9, base: 90 });
        expect(out.get("K1")![1]).toEqual({ events: 0, base: 0 });
    });
});

describe("helpers", () => {
    it("ratePct is null without a base and rounds to 2 places", () => {
        expect(ratePct({ events: 0, base: 0 })).toBeNull();
        expect(ratePct({ events: 17, base: 321 })).toBe(5.3);
    });
    it("addDaysStr crosses month ends", () => {
        expect(addDaysStr("2026-09-30", 2)).toBe("2026-10-02");
    });
});
