import { describe, it, expect } from "vitest";
import { resolveDateRange } from "./date-range.util.js";
import { toDateStr } from "./date.util.js";

const wed = new Date(Date.UTC(2026, 8, 23)); // Wednesday
const fmt = (r: ReturnType<typeof resolveDateRange>) => ({ from: r.from && toDateStr(r.from), to: toDateStr(r.to) });

describe("resolveDateRange", () => {
    it("today / yesterday are single days", () => {
        expect(fmt(resolveDateRange("today", wed))).toEqual({ from: "2026-09-23", to: "2026-09-23" });
        expect(fmt(resolveDateRange("yesterday", wed))).toEqual({ from: "2026-09-22", to: "2026-09-22" });
    });
    it("week runs Monday to today", () => {
        expect(fmt(resolveDateRange("week", wed))).toEqual({ from: "2026-09-21", to: "2026-09-23" });
        expect(fmt(resolveDateRange("week", new Date(Date.UTC(2026, 8, 27))))).toEqual({ from: "2026-09-21", to: "2026-09-27" }); // Sunday
    });
    it("all has no lower bound", () => {
        expect(fmt(resolveDateRange("all", wed))).toEqual({ from: null, to: "2026-09-23" });
    });
});
