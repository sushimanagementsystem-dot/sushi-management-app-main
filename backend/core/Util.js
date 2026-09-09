/**
 * Util.js — locking, IDs, time helpers.
 */

/**
 * Runs fn while holding the script-wide lock. Use around every write path;
 * reads don't need it. Lock is released even if fn throws.
 *
 * Flushes before releasing (also if fn throws, to make any writes it did
 * complete before it failed still fully visible) — LockService only
 * serializes which execution runs the critical section, it does not
 * guarantee Sheets' backend has fully committed a write before the next
 * lock-holder reads. Without this, a read immediately after another
 * execution's write can see stale row positions/counts — this is exactly
 * what caused a real "Those rows are out of bounds" failure in
 * deleteRows_ when two submissions for the same kiosk/day were processed
 * moments apart.
 */
function withLock(fn) {
    const lock = LockService.getScriptLock();
    lock.waitLock(15000);
    try {
        return fn();
    } finally {
        SpreadsheetApp.flush();
        lock.releaseLock();
    }
}

/** Standard UUID v4, e.g. "0b36f8e3-8d5c-4f9a-b1e2-7c4d9a0f3b6d". */
function newId() {
    return Utilities.getUuid();
}

/** Current date as 'yyyy-MM-dd' in script timezone (Europe/Dublin). */
function today() {
    return Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd",
    );
}

/** Any sheet date value (Date object or string) -> 'yyyy-MM-dd'. '' stays ''. */
function asDateStr(v) {
    if (v === null || v === undefined || v === "") return "";
    if (v instanceof Date)
        return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
    return String(v).slice(0, 10);
}

/** 'yyyy-MM-dd' plus n days (n may be negative) -> 'yyyy-MM-dd'. */
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d + n);
    return Utilities.formatDate(dt, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

/** 'yyyy-MM-dd' -> 'MONDAY'..'SUNDAY'. */
function weekdayName(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const names = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    return names[new Date(y, m - 1, d).getDay()];
}

/** Numeric setting with fallback. */
function getSettingNum(key, fallback) {
    const v = Number(getSetting(key, fallback));
    return Number.isFinite(v) ? v : Number(fallback);
}

/**
 * setting table value by key, with fallback. Meant to be cached per
 * execution only — but Apps Script does not guarantee a fresh global scope
 * per triggered invocation (a warm container can be reused across separate
 * calls), so this top-level object can silently carry a stale value from a
 * previous execution into the next one. Every real entry point (doPost,
 * processPendingSubmissions — the latter is also invoked directly by the
 * time-driven trigger, bypassing doPost) MUST call resetSettingCache_() as
 * its first line so a stale/blank cached value can never leak across
 * invocations. Do not rely on this resetting itself.
 */
let _settingCache = {};
function resetSettingCache_() {
    _settingCache = {};
}
function getSetting(key, fallback) {
    if (!(key in _settingCache)) {
        const row = getRow(TABLES.SETTING, { setting_key: key });
        // A row whose value cell is blank must fall back too — String("")
        // is "" (truthy-checked-as-cached below), not null, so without this
        // check a blank-but-present setting silently wins over the fallback
        // (and getSettingNum's Number("") = 0 quietly breaks any
        // truthiness-guarded caller).
        const value = row ? String(row.value) : "";
        _settingCache[key] = value !== "" ? value : null;
    }
    return _settingCache[key] !== null ? _settingCache[key] : fallback;
}

/** Active enum_option rows for a type, e.g. getEnumOptions("request_category"). */
function getEnumOptions(enumType) {
    return getRows(TABLES.ENUM_OPTION, (r) => r.enum_type === enumType && r.active === true)
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((r) => ({ value: r.value, label: r.label }));
}

/** Active kiosks eligible for a product by brand match. product.brand_id is
 * nullable ("valid for both brands" per schema) — null fans out to every
 * active kiosk, not zero. */
function kiosksForBrand_(brandId) {
    return getRows(TABLES.KIOSK, (k) =>
        k.active === true && (!brandId || k.brand_id === brandId),
    );
}

/** Blank production_par rows (all weekdays 0, inert until the owner sets
 * real targets) for every kiosk a new product belongs to by brand. */
function newProductionParRowsFor_(product) {
    return kiosksForBrand_(product.brand_id).map((k) => ({
        kiosk_id: k.kiosk_id,
        product_id: product.product_id,
        MONDAY: 0,
        TUESDAY: 0,
        WEDNESDAY: 0,
        THURSDAY: 0,
        FRIDAY: 0,
        SATURDAY: 0,
        SUNDAY: 0,
    }));
}

/** Active products sellable at this kiosk (brand match), for any form's
 * product picker. extraFilter can add a form-specific condition (e.g.
 * Staff Food's eligibility flag) without duplicating the brand check. */
function productsForKiosk_(kiosk, extraFilter) {
    return getRows(TABLES.PRODUCT, (r) =>
        r.active === true &&
        (!r.brand_id || r.brand_id === kiosk.brand_id) &&
        (!extraFilter || extraFilter(r)),
    );
}

/** Current timestamp as 'yyyy-MM-dd HH:mm:ss' in script timezone. */
function nowStamp() {
    return Utilities.formatDate(
        new Date(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd HH:mm:ss",
    );
}
