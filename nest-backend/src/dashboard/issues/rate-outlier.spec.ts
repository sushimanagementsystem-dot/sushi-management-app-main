import { describe, it, expect } from "vitest";
import { assessRateOutlier } from "./rate-outlier.js";

describe("assessRateOutlier", () => {
    it("does not flag a rate that is only modestly above the kiosk's own usual level", () => {
        // Real Oranmore shape: 17/321 recent vs 141/1956 usual.
        const v = assessRateOutlier({ events: 17, base: 321 }, { events: 141, base: 1956 });
        expect(v.flagged).toBe(false);
        expect(v.ratePct).toBeCloseTo(5.3, 1);
        expect(v.baselinePct).toBeCloseTo(7.2, 1);
    });

    it("flags a rate that is clearly and statistically above usual", () => {
        expect(assessRateOutlier({ events: 40, base: 300 }, { events: 120, base: 2000 }).flagged).toBe(true); // 13.3% vs 6%
    });

    it("needs both the ratio and the point gap", () => {
        // 3.2% vs 2% is 1.6x but only 1.2 points.
        expect(assessRateOutlier({ events: 10, base: 312 }, { events: 40, base: 2000 }).flagged).toBe(false);
    });

    it("stays quiet when the recent volume is too small to mean anything", () => {
        expect(assessRateOutlier({ events: 8, base: 60 }, { events: 100, base: 2000 }).flagged).toBe(false);
    });

    it("stays quiet on a handful of units even with plenty of volume", () => {
        expect(assessRateOutlier({ events: 4, base: 100 }, { events: 20, base: 2000 }).flagged).toBe(false);
    });

    it("stays quiet without a meaningful baseline", () => {
        expect(assessRateOutlier({ events: 30, base: 300 }, { events: 5, base: 50 }).flagged).toBe(false);
        expect(assessRateOutlier({ events: 30, base: 300 }, { events: 0, base: 2000 }).flagged).toBe(false);
        expect(assessRateOutlier({ events: 0, base: 0 }, { events: 10, base: 500 }).flagged).toBe(false);
    });
});
