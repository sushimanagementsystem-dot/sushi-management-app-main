/**
 * Date/format helpers shared by the KPI Dashboard, Kiosk Comparison, and
 * Stock Usage View pages — ported from dashboard.html's inline helpers
 * (no shared date util exists in the original app either; mirrors
 * Util.js's yyyy-MM-dd string convention).
 */

export function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

export function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

export function addDaysStr(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
}

export const KPI_PRESETS = [
    { key: "today", label: "Today" },
    { key: "last7", label: "Last 7 days" },
    { key: "last30", label: "Last 30 days" },
    { key: "thisMonth", label: "This month" },
];

/** Presets for pages that look back over whole weeks/months (Staff Food): the previous full Mon–Sun week, the
 * previous calendar month, and everything on record. Keys are understood by presetRange below. */
export const LOOKBACK_PRESETS = [
    { key: "last7", label: "Last 7 days" },
    { key: "lastWeek", label: "Last week" },
    { key: "last30", label: "Last 30 days" },
    { key: "lastMonth", label: "Last month" },
    { key: "thisMonth", label: "This month" },
    { key: "all", label: "All time" },
];

export function presetRange(presetKey) {
    const end = todayStr();
    let start;
    if (presetKey === "lastWeek") {
        const [y, m, d] = end.split("-").map(Number);
        const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
        const thisMonday = addDaysStr(end, -dow);
        return { start: addDaysStr(thisMonday, -7), end: addDaysStr(thisMonday, -1) };
    }
    if (presetKey === "lastMonth") {
        const [y, m] = end.split("-").map(Number);
        const first = new Date(y, m - 2, 1);
        const last = new Date(y, m - 1, 0);
        const fmt = (dt) => dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
        return { start: fmt(first), end: fmt(last) };
    }
    if (presetKey === "all") return { start: "2000-01-01", end };
    if (presetKey === "today") start = end;
    else if (presetKey === "last30") start = addDaysStr(end, -29);
    else if (presetKey === "thisMonth") start = end.slice(0, 8) + "01";
    else start = addDaysStr(end, -6); // last7, and the default
    return { start, end };
}

const KPI_PRESET_KEYS = KPI_PRESETS.map((p) => p.key);

/**
 * Reads kiosk_id/range(or start+end) off the current URL so a refresh (or
 * a shared link) reopens the same view instead of resetting to the
 * default preset — same "URL is the source of truth for filter state"
 * pattern as the Action Inbox list. `range` wins when present and valid;
 * an explicit start+end pair (from a custom date pick) is used only when
 * there's no preset; otherwise falls back to `defaultPreset`.
 */
export function dateFiltersFromQuery(defaultPreset, presets = KPI_PRESETS) {
    const validKeys = presets === KPI_PRESETS ? KPI_PRESET_KEYS : presets.map((p) => p.key);
    if (typeof window === "undefined") {
        const r = presetRange(defaultPreset);
        return { kioskId: "", startDate: r.start, endDate: r.end, preset: defaultPreset };
    }
    const q = new URLSearchParams(window.location.search);
    const kioskId = q.get("kiosk_id") || "";
    const range = q.get("range");
    if (range && validKeys.includes(range)) {
        const r = presetRange(range);
        return { kioskId, startDate: r.start, endDate: r.end, preset: range };
    }
    const start = q.get("start");
    const end = q.get("end");
    if (start && end) return { kioskId, startDate: start, endDate: end, preset: null };
    const r = presetRange(defaultPreset);
    return { kioskId, startDate: r.start, endDate: r.end, preset: defaultPreset };
}

/** Mirrors kiosk/preset-or-custom-range state into the URL (replaceState —
 * filter state, not a new navigable location). */
export function writeDateFiltersToQuery({ kioskId, startDate, endDate, preset }) {
    const q = new URLSearchParams();
    if (kioskId) q.set("kiosk_id", kioskId);
    if (preset) q.set("range", preset);
    else {
        if (startDate) q.set("start", startDate);
        if (endDate) q.set("end", endDate);
    }
    const qs = q.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
}

export function moneyStr(n) {
    return "€" + (Math.round((n || 0) * 100) / 100).toFixed(2);
}

export function qtyStr(n) {
    const r = Math.round((n || 0) * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

export function emptyStatTotals() {
    return { qty: 0, cost: 0, count: 0, uncostedCount: 0 };
}

export function sumStat(statsByKiosk, kioskIds) {
    const total = emptyStatTotals();
    kioskIds.forEach((k) => {
        const s = statsByKiosk[k];
        if (!s) return;
        total.qty += s.qty;
        total.cost += s.cost;
        total.count += s.count;
        total.uncostedCount += s.uncostedCount;
    });
    return total;
}

export function pluckMovement(movementStats, kioskIds, type) {
    const out = {};
    kioskIds.forEach((k) => (out[k] = (movementStats[k] || {})[type] || emptyStatTotals()));
    return out;
}
