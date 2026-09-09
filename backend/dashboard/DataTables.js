/**
 * DataTables.js — generic read/write for the owner dashboard's editable
 * data tables (production_par, stock_item, etc.). "Generic" is the whole
 * point: adding a new editable table is a field_schema entry, never a
 * code change here. A table only becomes reachable through these actions
 * once it has at least one field_schema row — that's the allowlist, not
 * a separate list to keep in sync (see Api.js's isOwnerRole_ gate, which
 * runs before either of these — this file assumes the caller already is
 * ADMIN/DEVELOPER).
 */

function getTableSchema_(tableName) {
    return getRows(TABLES.FIELD_SCHEMA, { table_name: tableName });
}

/**
 * Everything the Data Tables *page* needs on its very first load — the
 * tab list plus a full bootstrapDataTable for whichever table should be
 * active — in one call instead of two sequential ones. Only used once per
 * page load; switching tabs afterward already knows the tab list, so it
 * goes straight to bootstrapDataTable/listTableRows.
 */
function bootstrapTablesPage(preferredTable) {
    // type=child tables (embedded only via a parent's sub_table field_schema
    // row, e.g. supplier_item_map/recipe_component) never get their own
    // tab — blank type is treated as parent, for every table configured
    // before this column existed.
    const tables = getRows(TABLES.TABLE_SCHEMA, (t) => t.type !== "child");
    if (!tables.length) {
        return { ok: false, error: "No tables configured yet." };
    }
    const tableName = tables.some((t) => t.table_name === preferredTable)
        ? preferredTable
        : tables[0].table_name;
    const data = bootstrapDataTable(tableName);
    if (!data.ok) return data;
    return Object.assign({ tables: tables, activeTable: tableName }, data);
}

function listTableRows(tableName) {
    const fields = getTableSchema_(tableName);
    if (!fields.length) {
        return { ok: false, error: "Unknown or unconfigured table." };
    }
    return { ok: true, rows: getRows(tableName) };
}

/**
 * Everything a Data Tables page needs for one table's *first* load this
 * session, in a single GAS invocation: schema, rows, every referenced
 * table's rows, and every enum's options. Replaces what used to be up to
 * 4 separate round trips (get_table_schema + list_table_rows +
 * N×list_reference_rows + M×get_enum_options) — each one paid GAS's own
 * startup overhead independently, which is the actual bottleneck at this
 * data's scale, not Sheets query speed. Reference tables/enum sources come
 * straight from this table's own schema, so no separate "is this actually
 * referenced" check is needed the way the old standalone actions had —
 * that scoping is implicit here.
 */
function bootstrapDataTable(tableName) {
    const fields = getTableSchema_(tableName);
    if (!fields.length) {
        return { ok: false, error: "Unknown or unconfigured table." };
    }

    const refTables = Array.from(
        new Set(fields.filter((f) => f.type === "reference").map((f) => f.ref_table)),
    );
    const enumSources = Array.from(
        new Set(
            fields
                .filter((f) => (f.type === "enum" || f.type === "enum_list") && f.enum_source)
                .map((f) => f.enum_source),
        ),
    );

    const references = {};
    refTables.forEach((t) => {
        references[t] = getRows(t);
    });
    const enums = {};
    enumSources.forEach((e) => {
        enums[e] = getEnumOptions(e);
    });

    // This table's own table_schema row (label, description, hard_delete,
    // has_detail_view, type) — included here so any caller, including a
    // detail-view's embedded child grid (which never appears in
    // bootstrapTablesPage's own tab list), gets its meta from the same
    // place its data comes from, no separate lookup needed.
    const meta = getRow(TABLES.TABLE_SCHEMA, { table_name: tableName }) || {};

    return {
        ok: true,
        fields: fields,
        rows: getRows(tableName),
        references: references,
        enums: enums,
        meta: meta,
    };
}

/**
 * Re-validates required/min/max and strips any column the schema doesn't
 * allow for this operation — the frontend's own checks are UX only, this
 * is the real gate, same as every other write in this backend. Shared by
 * saveTableRow (single-row) and bulkSaveTableRows (many rows, one lock).
 *
 * Key columns come from primary_key, not inferred from editable flags.
 * Every key value is client-supplied: a generated UUID (crypto.randomUUID,
 * see tables.html) for a table's own id, or a picked foreign key for a
 * composite key (e.g. production_par's kiosk_id/product_id) — the backend
 * never generates one itself, so the client always knows a new row's real
 * identity immediately, no round trip needed to find out. Required on
 * insert; on update just carried through as-is (needed to find the row,
 * even though a key is never itself editable after creation). Throws on
 * any validation failure — caller decides whether that aborts everything
 * (saveTableRow) or just this one row (bulkSaveTableRows).
 */
function validateAndCleanRow_(fields, isNew, row) {
    const clean = {};
    fields.forEach((f) => {
        const label = f.label || f.column_name;

        if (f.primary_key === true) {
            const val = row[f.column_name];
            if (isNew && (val === undefined || val === null || val === "")) {
                throw new Error(label + " is required.");
            }
            clean[f.column_name] = val;
            return;
        }

        const allowed = isNew ? f.editable_on_create === true : f.editable_on_update === true;
        if (!allowed) return;
        const val = row[f.column_name];
        if (f.required === true && (val === undefined || val === null || val === "")) {
            throw new Error(label + " is required.");
        }
        if (
            (f.type === "integer" || f.type === "decimal" || f.type === "money") &&
            val !== "" &&
            val !== undefined &&
            val !== null
        ) {
            const num = Number(val);
            if (isNaN(num)) throw new Error(label + " must be a number.");
            if (f.type === "integer" && !Number.isInteger(num)) {
                throw new Error(label + " must be a whole number.");
            }
            if (f.min !== "" && f.min !== undefined && f.min !== null && num < Number(f.min)) {
                throw new Error(label + " must be at least " + f.min + ".");
            }
            if (f.max !== "" && f.max !== undefined && f.max !== null && num > Number(f.max)) {
                throw new Error(label + " must be at most " + f.max + ".");
            }
        }
        clean[f.column_name] = val;
    });
    return clean;
}

/**
 * Creates (isNew) or updates a single row.
 */
function saveTableRow(tableName, isNew, row) {
    const fields = getTableSchema_(tableName);
    if (!fields.length) {
        return { ok: false, error: "Unknown or unconfigured table." };
    }

    const keyFields = fields.filter((f) => f.primary_key === true);
    if (!keyFields.length) {
        return { ok: false, error: tableName + " has no primary key configured." };
    }
    const keyCols = keyFields.map((f) => f.column_name);

    let clean;
    try {
        clean = validateAndCleanRow_(fields, isNew, row);
    } catch (err) {
        return { ok: false, error: err.message };
    }

    if (isNew) {
        const dup = getRow(tableName, (r) =>
            keyCols.every((k) => String(r[k]) === String(clean[k])),
        );
        if (dup) {
            return { ok: false, error: "A row with this key already exists." };
        }
        insertRow(tableName, clean);
        if (tableName === TABLES.PRODUCT) provisionProductionPar_(clean, insertRow);
    } else {
        const updated = updateRow(tableName, keyCols, clean);
        if (!updated) return { ok: false, error: "Row not found." };
    }
    // Client can't know a server-generated id in advance — hand back the
    // final row so it can sync its local copy (see tables.html's Save).
    return { ok: true, row: clean };
}

/** Auto-creates blank production_par rows (see Util.js's
 * newProductionParRowsFor_) for every kiosk of a newly-created product's
 * brand — the sync gap this closes (a product with no par row is invisible
 * to Production Par, Fridge Count, and the production email alike) was a
 * real client-reported bug, not a nice-to-have. Best-effort: never allowed
 * to fail the product save itself, since provisioning is automation on top
 * of the real write, not a precondition for it. `insertFn` is `insertRow`
 * (locked) from saveTableRow's own call, or `insertRow_` (unlocked, caller
 * already holds the lock) from bulkSaveTableRows'. */
function provisionProductionPar_(product, insertFn) {
    try {
        newProductionParRowsFor_(product).forEach((row) =>
            insertFn(TABLES.PRODUCTION_PAR, row),
        );
    } catch (err) {
        console.error(
            "production_par auto-provisioning failed for " + product.product_id + ":",
            (err && err.stack) || err,
        );
    }
}

/**
 * Hard-deletes a row — the only kind of delete this action performs.
 * "Soft delete" isn't a separate action at all: the active column, when a
 * table has one, is just a normal editable boolean column in the grid —
 * unchecking it goes through the regular edit/Save flow (save_table_row)
 * like any other field change. This action only exists for hard_delete
 * tables (e.g. production_par), which have no active column to toggle in
 * the first place. Never trusts the frontend's own gating: re-derives
 * hard_delete here from table_schema, and refuses regardless of config if
 * any field_schema row anywhere still treats this table as a foreign-key
 * target (ref_table) — a table genuinely safe to hard-delete has nothing
 * pointing at it in the first place, so this should never actually block
 * a correctly-configured table, only catch a misconfiguration. (A
 * type=sub_table row names its embedded child via its own dedicated
 * sub_table_name column, not ref_table, specifically so declaring a child
 * table never trips this check the way a real foreign key should.)
 */
function deleteTableRow(tableName, row) {
    const tableMeta = getRow(TABLES.TABLE_SCHEMA, { table_name: tableName });
    if (!tableMeta || tableMeta.hard_delete !== true) {
        return { ok: false, error: "Deleting rows is not enabled for this table." };
    }

    const fields = getTableSchema_(tableName);
    const keyCols = fields.filter((f) => f.primary_key === true).map((f) => f.column_name);
    if (!keyCols.length) {
        return { ok: false, error: tableName + " has no primary key configured." };
    }
    const filter = {};
    keyCols.forEach((k) => (filter[k] = row[k]));

    const referencedBy = getRows(TABLES.FIELD_SCHEMA, { ref_table: tableName });
    if (referencedBy.length) {
        return {
            ok: false,
            error: "Cannot permanently delete: other columns reference this table.",
        };
    }
    const deletedCount = deleteRows(tableName, filter);
    if (!deletedCount) return { ok: false, error: "Row not found." };
    return { ok: true };
}

/**
 * Batches N save/delete operations for one table behind a single lock
 * acquisition, instead of N separate save_table_row/delete_table_row API
 * calls each fighting over the same global script lock — that's what let
 * bulk operations (a large checkbox-selected delete, or just editing many
 * cells before one Save) start timing out once concurrent requests grew
 * past a handful. Same validation as the single-row functions above
 * (deliberately reused, not reimplemented): deletes go through the exact
 * same hard_delete/reference checks as deleteTableRow, saves go through
 * validateAndCleanRow_ — just looped inside one withLock using the
 * unlocked DAL primitives, instead of each row acquiring its own lock.
 *
 * changes: [{ key, isNew, isDelete, row }]. A bad row (failed validation,
 * duplicate key, not found) is caught individually and reported in that
 * row's own result — it doesn't abort the rest of the batch.
 */
function bulkSaveTableRows(tableName, changes) {
    const fields = getTableSchema_(tableName);
    if (!fields.length) {
        return { ok: false, error: "Unknown or unconfigured table." };
    }
    const keyFields = fields.filter((f) => f.primary_key === true);
    if (!keyFields.length) {
        return { ok: false, error: tableName + " has no primary key configured." };
    }
    const keyCols = keyFields.map((f) => f.column_name);
    const tableMeta = getRow(TABLES.TABLE_SCHEMA, { table_name: tableName }) || {};
    const referencedBy = getRows(TABLES.FIELD_SCHEMA, { ref_table: tableName });

    return withLock(() => {
        const results = changes.map((c) => {
            try {
                if (c.isDelete) {
                    if (tableMeta.hard_delete !== true) {
                        throw new Error("Deleting rows is not enabled for this table.");
                    }
                    if (referencedBy.length) {
                        throw new Error("Cannot permanently delete: other columns reference this table.");
                    }
                    const filter = {};
                    keyCols.forEach((k) => (filter[k] = c.row[k]));
                    const deletedCount = deleteRows_(tableName, filter);
                    if (!deletedCount) throw new Error("Row not found.");
                    return { key: c.key, ok: true };
                }

                const clean = validateAndCleanRow_(fields, c.isNew, c.row);
                if (c.isNew) {
                    const dup = getRow(tableName, (r) => keyCols.every((k) => String(r[k]) === String(clean[k])));
                    if (dup) throw new Error("A row with this key already exists.");
                    insertRow_(tableName, clean);
                    if (tableName === TABLES.PRODUCT) provisionProductionPar_(clean, insertRow_);
                } else {
                    const updated = updateRow_(tableName, keyCols, clean);
                    if (!updated) throw new Error("Row not found.");
                }
                return { key: c.key, ok: true, row: clean };
            } catch (err) {
                return { key: c.key, ok: false, error: err.message };
            }
        });
        return { ok: true, results: results };
    });
}
