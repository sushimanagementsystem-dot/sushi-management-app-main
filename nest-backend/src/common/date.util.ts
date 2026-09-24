// UTC-anchored date helpers — deliberately not local-timezone math, to
// avoid the exact class of bug found in the Excel import pipeline (dates
// silently shifting by the host's timezone offset). Every "business date"
// in this system is a pure calendar date, never a moment-in-time.

export function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

export function toDateStr(date: Date): string {
    return date.toISOString().slice(0, 10);
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"] as const;

/** Matches the ProductionPar/DefrostPar column names (MONDAY..SUNDAY). */
export function weekdayName(date: Date): (typeof WEEKDAYS)[number] {
    return WEEKDAYS[date.getUTCDay()]!;
}

/** Monday of the ISO week containing `date` — the anchor every "per week"
 * grouping in this system (Profit tab, weekly_sales) uses, so a business
 * date always maps to exactly one week bucket regardless of which day of
 * that week it falls on. */
export function startOfWeekUtc(date: Date): Date {
    const day = date.getUTCDay(); // 0=Sunday..6=Saturday
    const diffToMonday = day === 0 ? -6 : 1 - day;
    return addDays(date, diffToMonday);
}

/** The last millisecond of `date`'s UTC calendar day — for "as of the end of that day" balances when rows carry a time of day. */
export function endOfDay(date: Date): Date {
    return new Date(new Date(`${toDateStr(date)}T00:00:00Z`).getTime() + 86_400_000 - 1);
}
