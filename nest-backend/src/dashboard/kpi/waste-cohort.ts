/**
 * Waste / damage rate arithmetic, free of I/O. A rate is `events` (units wasted
 * or damaged) out of `base` (units planned for the batches those units came from).
 *
 * Waste is booked on the day it is thrown away but belongs to a batch made
 * `shelf life` days earlier (product_movement.attributed_production_date). So a
 * rate over a period compares that period's waste with the PLAN OF THOSE BATCHES,
 * not with the plan of the same calendar days — the two would put different
 * days on the top and bottom of the fraction.
 */
export type RateSample = { events: number; base: number };
export type DateWindow = { from: string; to: string }; // inclusive YYYY-MM-DD

export type PlanCell = { kiosk: string; product: string; date: string; qty: number };
/** `date` is when the unit was binned/damaged; `producedOn` is the day its batch was planned for (null = unknown). */
export type RateEvent = { kiosk: string; product: string; date: string; producedOn: string | null; qty: number };

const DAY_MS = 86_400_000;

export function addDaysStr(date: string, days: number): string {
    return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

const inWindow = (date: string, w: DateWindow) => date >= w.from && date <= w.to;

/**
 * One sample per kiosk per window.
 *  - base: planned units of every batch that would be binned inside the window
 *    (plan day + shelf life falls in the window). With `shiftByShelfLife` false
 *    (damage, which is booked the day it happens) it is simply the plan of the days in the window.
 *  - events: units binned inside the window that match a planned (kiosk, product,
 *    production day). Units with no plan behind them (a day with no fridge count, a
 *    product never planned) have nothing to be measured against and are left out.
 */
export function cohortSamples(
    kioskIds: readonly string[],
    plans: PlanCell[],
    events: RateEvent[],
    windows: DateWindow[],
    shelfDaysOf: (product: string) => number,
    shiftByShelfLife: boolean,
): Map<string, RateSample[]> {
    const out = new Map(kioskIds.map((k) => [k, windows.map((): RateSample => ({ events: 0, base: 0 }))]));
    const planned = new Set<string>();

    for (const p of plans) {
        const samples = out.get(p.kiosk);
        if (!samples || p.qty <= 0) continue;
        planned.add(`${p.kiosk}|${p.product}|${p.date}`);
        const binnedOn = shiftByShelfLife ? addDaysStr(p.date, shelfDaysOf(p.product)) : p.date;
        windows.forEach((w, i) => {
            if (inWindow(binnedOn, w)) samples[i]!.base += p.qty;
        });
    }
    for (const e of events) {
        const samples = out.get(e.kiosk);
        const producedOn = shiftByShelfLife ? e.producedOn : e.date;
        if (!samples || !producedOn || !planned.has(`${e.kiosk}|${e.product}|${producedOn}`)) continue;
        windows.forEach((w, i) => {
            if (inWindow(e.date, w)) samples[i]!.events += e.qty;
        });
    }
    return out;
}

export const ratePct = (s: RateSample): number | null => (s.base > 0 ? Math.round((s.events / s.base) * 10000) / 100 : null);
