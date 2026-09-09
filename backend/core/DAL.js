/**
 * DAL.js — data access layer. Maps sheet rows <-> plain objects by header name,
 * never by column index. All writes acquire the script lock; reads don't.
 *
 * Row objects carry a hidden `_row` property (1-based sheet row number) used
 * internally for updates. It is never written back as a column.
 */

const _headerCache = {};

/**
 * Full-table row cache, per execution. getRows() is called repeatedly for
 * the same table within a single request (e.g. bootstrapKpiDashboard reads
 * PRODUCT_MOVEMENT three times) — each call was a separate getValues()
 * round trip to the Sheets backend, which dominates request latency.
 * Cached here after first read and invalidated by any write to that table,
 * so callers still see fresh data after insert/update/delete.
 *
 * (A further optimization — batching every table into one Sheets Advanced
 * Service batchGet call per execution, using open-ended `table!A:ZZ`
 * ranges — was tried and reverted: it measured 24-28s in practice, worse
 * than the ~8-12s this simple per-table cache gives, apparently because
 * Sheets API's batchGet has real server-side cost scanning wide,
 * open-ended ranges across many sheets in one call. SpreadsheetApp's
 * precisely-bounded getRange(2,1,lastRow-1,headers.length) per table,
 * despite being N round trips, was empirically faster for this
 * spreadsheet. Don't reintroduce batchGet without measuring again first.)
 */
const _rowsCache = {};

function getSheet_(table) {
    const sh = getSpreadsheet().getSheetByName(table);
    if (!sh) throw new Error(`Missing sheet tab: "${table}"`);
    return sh;
}

/** Header row of a table, cached per execution. */
function getHeaders_(table) {
    if (!_headerCache[table]) {
        const sh = getSheet_(table);
        const lastCol = sh.getLastColumn();
        if (lastCol === 0)
            throw new Error(`Sheet "${table}" has no header row.`);
        const headers = sh
            .getRange(1, 1, 1, lastCol)
            .getValues()[0]
            .map((h) => String(h).trim());
        headers.forEach((h, i) => {
            if (!h)
                throw new Error(
                    `Sheet "${table}" has an empty header in column ${i + 1}`,
                );
            if (headers.indexOf(h) !== i)
                throw new Error(`Sheet "${table}" has duplicate header "${h}"`);
        });
        _headerCache[table] = headers;
    }
    return _headerCache[table];
}

/** True if row matches filter (object = AND of equality checks, function = predicate). */
function matches_(row, filter) {
    if (!filter) return true;
    if (typeof filter === "function") return !!filter(row);
    return Object.keys(filter).every((k) => row[k] === filter[k]);
}

/**
 * All rows of a table as objects, optionally filtered.
 * filter: {col: value, ...} for equality AND, or a predicate function(row).
 */
function getRows(table, filter) {
    if (!_rowsCache[table]) {
        const headers = getHeaders_(table);
        const sh = getSheet_(table);
        const lastRow = sh.getLastRow();
        const rows = [];
        if (lastRow >= 2) {
            const values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
            for (let i = 0; i < values.length; i++) {
                const row = { _row: i + 2 };
                for (let c = 0; c < headers.length; c++) row[headers[c]] = values[i][c];
                rows.push(row);
            }
        }
        _rowsCache[table] = rows;
    }
    const all = _rowsCache[table];
    return filter ? all.filter((row) => matches_(row, filter)) : all.slice();
}

/** First matching row or null. */
function getRow(table, filter) {
    const rows = getRows(table, filter);
    return rows.length ? rows[0] : null;
}

/** obj -> row array ordered by headers; missing keys become ''. */
function toRowArray_(headers, obj) {
    return headers.map((h) => (obj[h] !== undefined ? obj[h] : ""));
}

/** Warn loudly if obj has keys that aren't columns (typo protection). */
function assertKnownKeys_(table, headers, obj) {
    Object.keys(obj).forEach((k) => {
        if (k !== "_row" && headers.indexOf(k) === -1) {
            throw new Error(`Unknown column "${k}" for table "${table}"`);
        }
    });
}

function insertRow_(table, obj) {
    const headers = getHeaders_(table);
    assertKnownKeys_(table, headers, obj);
    getSheet_(table).appendRow(toRowArray_(headers, obj));
    delete _rowsCache[table];
    return obj;
}

function updateRow_(table, keyCols, obj) {
    const headers = getHeaders_(table);
    assertKnownKeys_(table, headers, obj);
    const filter = {};
    keyCols.forEach((k) => {
        if (obj[k] === undefined)
            throw new Error(`updateRow: obj missing key column "${k}"`);
        filter[k] = obj[k];
    });
    const existing = getRow(table, filter);
    if (!existing) return null;
    const merged = {};
    headers.forEach((h) => {
        merged[h] = obj[h] !== undefined ? obj[h] : existing[h];
    });
    getSheet_(table)
        .getRange(existing._row, 1, 1, headers.length)
        .setValues([toRowArray_(headers, merged)]);
    delete _rowsCache[table];
    return merged;
}

function deleteRows_(table, filter) {
    const rows = getRows(table, filter);
    const sh = getSheet_(table);
    rows.sort((a, b) => b._row - a._row).forEach((r) => sh.deleteRow(r._row));
    delete _rowsCache[table];
    return rows.length;
}

function insertRow(table, obj) {
    return withLock(() => insertRow_(table, obj));
}

/** Updates the row matching obj's keyCols values. Returns merged row, or null if not found. */
function updateRow(table, keyCols, obj) {
    return withLock(() => updateRow_(table, keyCols, obj));
}

/** Deletes all rows matching filter. Returns how many were deleted. */
function deleteRows(table, filter) {
    return withLock(() => deleteRows_(table, filter));
}

/**
 * Update the row matching keyCols, or insert if none exists.
 * Find + write happen under one lock, so concurrent submits can't double-insert.
 */
function upsertRow(table, keyCols, obj) {
    return withLock(() => {
        const updated = updateRow_(table, keyCols, obj);
        return updated !== null ? updated : insertRow_(table, obj);
    });
}
