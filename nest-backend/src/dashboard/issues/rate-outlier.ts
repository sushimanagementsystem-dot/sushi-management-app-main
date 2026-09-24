/**
 * The "is this kiosk's waste/damage rate really out of the ordinary?" decision,
 * kept free of I/O so the rule can be read, tested, and reused on its own.
 *
 * A sample is `events` (units wasted/damaged) out of `base` (units planned for
 * the same products on the same days). The rate is events / base.
 */
import type { RateSample } from "../kpi/waste-cohort.js";
export type { RateSample };

export const RATE_RULES = {
    /** How many production days the "recent" and the "usual" windows each cover. */
    recentDays: 7,
    historyDays: 28,
    /** Below this much planned volume a rate is noise: a handful of units swings it by whole percentage points. */
    minRecentBase: 100,
    minHistoryBase: 200,
    /** ...and a couple of wasted units is not a trend, however small the base. */
    minEvents: 5,
    /** Must be at least this many times the usual rate AND this many percentage points above it... */
    ratio: 1.5,
    minPointGap: 2,
    /** ...AND beyond normal week-to-week variation: counts behave like Poisson, so sd = sqrt(expected). */
    zScore: 2,
} as const;

export type OutlierVerdict = { flagged: boolean; ratePct: number | null; baselinePct: number | null };

const pct = (s: RateSample): number | null => (s.base > 0 ? (s.events / s.base) * 100 : null);

export function sumSamples(samples: RateSample[]): RateSample {
    return samples.reduce((acc, s) => ({ events: acc.events + s.events, base: acc.base + s.base }), { events: 0, base: 0 });
}

export function assessRateOutlier(recent: RateSample, baseline: RateSample, rules = RATE_RULES): OutlierVerdict {
    const ratePct = pct(recent);
    const baselinePct = pct(baseline);
    const verdict = (flagged: boolean): OutlierVerdict => ({ flagged, ratePct, baselinePct });

    if (ratePct === null || baselinePct === null) return verdict(false);
    if (recent.base < rules.minRecentBase || baseline.base < rules.minHistoryBase) return verdict(false);
    if (recent.events < rules.minEvents || baselinePct <= 0) return verdict(false);

    const expected = (baselinePct / 100) * recent.base;
    const aboveNormalVariation = recent.events >= expected + rules.zScore * Math.sqrt(expected);
    const clearlyHigher = ratePct >= baselinePct * rules.ratio && ratePct - baselinePct >= rules.minPointGap;
    return verdict(clearlyHigher && aboveNormalVariation);
}
