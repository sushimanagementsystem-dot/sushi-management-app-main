import { addDays, startOfTodayUtc, startOfWeekUtc } from "./date.util.js";

/** The presets every owner-facing "when" dropdown offers. */
export const DATE_RANGE_KEYS = ["today", "yesterday", "week", "all"] as const;
export type DateRangeKey = (typeof DATE_RANGE_KEYS)[number];

/** `from` is null for "all" — no lower bound. `to` is always a concrete day, never in the future. */
export type ResolvedDateRange = { from: Date | null; to: Date };

/** UTC calendar days, same anchoring as the rest of the dashboard's business dates. "week" is Monday..today. */
export function resolveDateRange(key: DateRangeKey, today: Date = startOfTodayUtc()): ResolvedDateRange {
    switch (key) {
        case "today":
            return { from: today, to: today };
        case "yesterday": {
            const y = addDays(today, -1);
            return { from: y, to: y };
        }
        case "week":
            return { from: startOfWeekUtc(today), to: today };
        case "all":
            return { from: null, to: today };
    }
}
