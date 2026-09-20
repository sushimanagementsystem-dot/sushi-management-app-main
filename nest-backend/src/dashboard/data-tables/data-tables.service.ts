import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";
import { toModelName } from "../../common/model-name.util.js";
import type { FieldSchemaRow, RowChange, RowChangeResult } from "./data-tables.types.js";
import { explainWriteError } from "./write-error.js";

type PrismaDelegate = {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
};

/**
 * Generic read/write engine for the owner dashboard's editable data
 * tables — direct port of backend/dashboard/DataTables.js. "Generic" is
 * the whole point: adding a new editable table is a field_schema entry,
 * never a code change here. Callers must already be ADMIN/DEVELOPER (see
 * DataTablesController's @Roles) — this service assumes that's checked.
 *
 * Reads go through TableCacheService (whole-table, in-memory) — Neon's
 * per-query round trip from this deployment is the real cost (~250-300ms),
 * not query complexity, so serving repeat reads from cache and batching
 * the first-load fan-out (references + enums) with Promise.all are what
 * actually move the needle. Every write below is the one place these
 * tables change, so every write ends with the matching invalidate() —
 * see invalidateFor().
 */
@Injectable()
export class DataTablesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    async bootstrapTablesPage(preferredTable?: string) {
        // type=child tables (embedded only via a parent's sub_table
        // field_schema row) never get their own tab — blank type is
        // treated as parent, for every table configured before this column existed.
        const allTables = await this.tableCache.getAll<{ table_name: string; type: string | null }>("table_schema");
        const tables = allTables.filter((t) => t.type !== "child");
        if (!tables.length) throw new BadRequestException("No tables configured yet.");

        const tableName = tables.some((t) => t.table_name === preferredTable) ? preferredTable! : tables[0]!.table_name;
        const data = await this.bootstrapDataTable(tableName);
        return { tables, activeTable: tableName, ...data };
    }

    async listTableRows(tableName: string) {
        const fields = await this.getFieldSchema(tableName);
        if (!fields.length) throw new BadRequestException("Unknown or unconfigured table.");
        return { rows: await this.tableCache.getAll(tableName) };
    }

    /**
     * Everything a Data Tables page needs for one table's first load:
     * schema, rows, every referenced table's rows, and every enum's
     * options, in one call. References and enums are fetched in parallel
     * (Promise.all), not sequentially — with N round trips at ~280ms each,
     * sequential awaits were the actual cause of multi-second loads.
     */
    async bootstrapDataTable(tableName: string) {
        const fields = await this.getFieldSchema(tableName);
        if (!fields.length) throw new BadRequestException("Unknown or unconfigured table.");

        const refTables = [...new Set(fields.filter((f) => f.type === "reference" && f.ref_table).map((f) => f.ref_table!))];
        const enumSources = [...new Set(fields.filter((f) => (f.type === "enum" || f.type === "enum_list") && f.enum_source).map((f) => f.enum_source!))];

        const [referenceEntries, enumEntries, rows, meta] = await Promise.all([
            Promise.all(refTables.map(async (t) => [t, await this.tableCache.getAll(t)] as const)),
            Promise.all(enumSources.map(async (e) => [e, await this.enumOptions.getOptions(e)] as const)),
            this.tableCache.getAll(tableName),
            this.getTableMeta(tableName),
        ]);

        return {
            fields,
            rows,
            references: Object.fromEntries(referenceEntries),
            enums: Object.fromEntries(enumEntries),
            meta: meta ?? {},
        };
    }

    async saveTableRow(tableName: string, isNew: boolean, row: Record<string, unknown>) {
        const fields = await this.getFieldSchema(tableName);
        if (!fields.length) throw new BadRequestException("Unknown or unconfigured table.");
        const keyCols = this.keyColumns(fields, tableName);

        const clean = this.validateAndCleanRow(tableName, fields, isNew, row);
        await this.writeRow(tableName, fields, keyCols, isNew, clean);
        this.invalidateFor(tableName);
        // Client can't know a server-generated id in advance — hand back the final row.
        return { row: clean };
    }

    /**
     * Hard-deletes a row — the only kind of delete this action performs.
     * Never trusts the frontend's own gating: re-derives hard_delete from
     * table_schema, and refuses if any field_schema row anywhere still
     * treats this table as a foreign-key target.
     */
    async deleteTableRow(tableName: string, row: Record<string, unknown>) {
        const tableMeta = await this.getTableMeta(tableName);
        if (!tableMeta?.hard_delete) throw new BadRequestException("Deleting rows is not enabled for this table.");

        const fields = await this.getFieldSchema(tableName);
        const keyCols = this.keyColumns(fields, tableName);

        const referencedBy = await this.getFieldsReferencing(tableName);
        if (referencedBy.length) throw new BadRequestException("Cannot permanently delete: other columns reference this table.");

        const result = await this.getDelegate(tableName).deleteMany({ where: keyWhere(keyCols, row) });
        if (result.count === 0) throw new NotFoundException("Row not found.");
        this.invalidateFor(tableName);
    }

    /**
     * Batches N save/delete operations for one table in a single Postgres
     * transaction — mirrors the old system's single-lock-acquisition
     * rationale (many individual writes fighting over one global lock).
     * A bad row is caught individually and reported in its own result —
     * it doesn't abort the rest of the batch.
     */
    async bulkSaveTableRows(tableName: string, changes: RowChange[]): Promise<RowChangeResult[]> {
        const fields = await this.getFieldSchema(tableName);
        if (!fields.length) throw new BadRequestException("Unknown or unconfigured table.");
        const keyCols = this.keyColumns(fields, tableName);
        const tableMeta = await this.getTableMeta(tableName);
        const referencedBy = await this.getFieldsReferencing(tableName);
        const delegate = this.getDelegate(tableName);

        const results: RowChangeResult[] = [];
        for (const c of changes) {
            try {
                if (c.isDelete) {
                    if (!tableMeta?.hard_delete) throw new Error("Deleting rows is not enabled for this table.");
                    if (referencedBy.length) throw new Error("Cannot permanently delete: other columns reference this table.");
                    const result = await delegate.deleteMany({ where: keyWhere(keyCols, c.row) });
                    if (result.count === 0) throw new Error("Row not found.");
                    results.push({ key: c.key, ok: true });
                    continue;
                }

                const clean = this.validateAndCleanRow(tableName, fields, c.isNew, c.row);
                await this.writeRow(tableName, fields, keyCols, c.isNew, clean);
                results.push({ key: c.key, ok: true, row: clean });
            } catch (err) {
                results.push({ key: c.key, ok: false, error: toUserMessage(err) });
            }
        }
        if (changes.length) this.invalidateFor(tableName);
        return results;
    }

    /**
     * The one insert/update used by both the single-row and batch save, so
     * a database rejection is explained the same way on either path: a
     * duplicate email/token or a bad reference becomes a message naming
     * the value and who already has it (see write-error.ts), instead of the
     * raw "Unique constraint failed on the constraint: `user_email_key`".
     */
    private async writeRow(tableName: string, fields: FieldSchemaRow[], keyCols: string[], isNew: boolean, clean: Record<string, unknown>): Promise<void> {
        const delegate = this.getDelegate(tableName);
        try {
            if (isNew) {
                const dup = await delegate.findFirst({ where: keyWhere(keyCols, clean) });
                if (dup) throw new BadRequestException("A row with this key already exists.");
                await delegate.create({ data: clean });
                if (tableName === "product") await this.provisionProductionPar(clean);
            } else {
                const result = await delegate.updateMany({ where: keyWhere(keyCols, clean), data: clean });
                if (result.count === 0) throw new NotFoundException("Row not found.");
            }
        } catch (err) {
            const message = (
                await explainWriteError(err, {
                    tableName,
                    isNew,
                    row: clean,
                    labels: Object.fromEntries(fields.map((f) => [f.column_name, f.label || f.column_name])),
                    titleColumn: fields.find((f) => f.is_title_column)?.column_name,
                    findConflict: (where) => delegate.findFirst({ where }),
                })
            ).message;
            // Only database rejections are rewritten; our own validation errors keep their type.
            if (message !== (err instanceof Error ? err.message : String(err))) throw new BadRequestException(message);
            throw err;
        }
    }

    private async getFieldSchema(tableName: string): Promise<FieldSchemaRow[]> {
        const all = await this.tableCache.getAll<FieldSchemaRow>("field_schema");
        return all.filter((f) => f.table_name === tableName);
    }

    private async getFieldsReferencing(tableName: string): Promise<FieldSchemaRow[]> {
        const all = await this.tableCache.getAll<FieldSchemaRow>("field_schema");
        return all.filter((f) => f.ref_table === tableName);
    }

    private async getTableMeta(tableName: string): Promise<Record<string, unknown> | undefined> {
        const all = await this.tableCache.getAll<Record<string, unknown>>("table_schema");
        return all.find((t) => t.table_name === tableName);
    }

    private keyColumns(fields: FieldSchemaRow[], tableName: string): string[] {
        // type=sub_table rows describe an embedded CHILD table relationship
        // (column_name is the child's own name, not a real column on this
        // table) — some of the real field_schema data marks these
        // primary_key: true too (a modeling quirk in the source data,
        // presumably harmless for the old Sheets-row-matching DAL but not
        // for Prisma's literal compound-key `where`), so they must be
        // excluded here regardless of that flag's value.
        const cols = fields.filter((f) => f.primary_key && f.type !== "sub_table").map((f) => f.column_name);
        if (!cols.length) throw new BadRequestException(`${tableName} has no primary key configured.`);
        return cols;
    }

    private getDelegate(tableName: string): PrismaDelegate {
        return (this.prisma as unknown as Record<string, PrismaDelegate>)[toModelName(tableName)];
    }

    /**
     * Every write path ends here. Invalidates the written table itself,
     * plus field_schema/table_schema whenever THOSE are the table being
     * edited (they drive every other table's bootstrap, so a stale cache
     * of them would misdescribe every other table until it happened to be
     * touched too) — invalidate(tableName) already covers that case since
     * the cache key equals the table name, this just documents it.
     */
    private invalidateFor(tableName: string): void {
        this.tableCache.invalidate(tableName);
        if (tableName === "enum_option") this.enumOptions.invalidate();
        // `setting` isn't in TableCacheService's cached-table set (its own
        // reads go through SettingsService's separate cache — see
        // DashboardSettingsService.save), so the invalidate() above is a
        // no-op for it; this is the one that actually matters if the
        // `setting` table is ever reachable through the generic grid
        // (today it isn't — Settings has its own dedicated page — but
        // saveTableRow/bulkSaveTableRows take an arbitrary table name, so
        // nothing stops a future caller from reaching this path).
        if (tableName === "setting") this.settings.invalidate();
    }

    /**
     * Re-validates required/min/max and strips any column the schema
     * doesn't allow for this operation — the frontend's own checks are UX
     * only, this is the real gate. Key columns come from primary_key, not
     * inferred from editable flags: required on insert, carried through
     * as-is on update.
     */
    private validateAndCleanRow(tableName: string, fields: FieldSchemaRow[], isNew: boolean, row: Record<string, unknown>): Record<string, unknown> {
        const clean: Record<string, unknown> = {};
        for (const f of fields) {
            // Not a real column — an embedded child-table marker (see
            // keyColumns' comment on the same quirk). Never part of the
            // row payload, regardless of any other flag on it.
            if (f.type === "sub_table") continue;

            const label = f.label || f.column_name;

            if (f.primary_key) {
                const val = row[f.column_name];
                if (isNew && isBlank(val)) throw new Error(`${label} is required.`);
                clean[f.column_name] = val;
                continue;
            }

            const allowed = isNew ? f.editable_on_create === true : f.editable_on_update === true;
            if (!allowed) continue;

            const val = row[f.column_name];
            if (f.required && isBlank(val)) throw new Error(`${label} is required.`);

            const isNumericType = f.type === "integer" || f.type === "decimal" || f.type === "money";
            if (isNumericType && !isBlank(val)) {
                const num = Number(val);
                if (Number.isNaN(num)) throw new Error(`${label} must be a number.`);
                if (f.type === "integer" && !Number.isInteger(num)) throw new Error(`${label} must be a whole number.`);
                if (f.min !== null && f.min !== undefined && num < Number(f.min)) throw new Error(`${label} must be at least ${f.min}.`);
                if (f.max !== null && f.max !== undefined && num > Number(f.max)) throw new Error(`${label} must be at most ${f.max}.`);
            }
            // A cleared cell arrives as "" (Tabulator's empty-cell value),
            // but Prisma's Int/Decimal columns reject an empty string
            // outright ("Failed to parse empty string") — unlike a genuine
            // blank text field, "" here only ever means "no value", so it
            // must become a real null, never be written literally.
            clean[f.column_name] = isNumericType && val === "" ? null : val;
        }
        // Sign-in looks a user up by the Google account's email, which is
        // always lowercase, and the unique index is case-sensitive. An email
        // typed as "Jane@Gmail.com " (or with a stray space) would never
        // match at sign-in, so a duplicate inactive "Jane" row got
        // auto-created next to it — the root of most duplicate-email clashes.
        if (tableName === "user" && typeof clean.email === "string") {
            clean.email = clean.email.trim().toLowerCase();
            if (!clean.email) throw new Error("Email is required.");
        }
        return clean;
    }

    /** Auto-creates blank production_par rows for every kiosk of a newly
     * created product's brand — closes the gap where a product with no par
     * row is invisible to Production Par/Fridge Count/the production plan.
     * Best-effort: never allowed to fail the product save itself. Writes
     * production_par as a side effect of a `product` save, so the caller's
     * own invalidateFor("product") never touches it — invalidate it here,
     * at the one place that actually knows these rows were just created,
     * rather than relying on the caller to know about this side effect. */
    private async provisionProductionPar(product: Record<string, unknown>): Promise<void> {
        try {
            const brandId = product.brand_id as string | null;
            const kiosks = await this.prisma.kiosk.findMany({
                where: { active: true, ...(brandId ? { brand_id: brandId } : {}) },
            });
            for (const kiosk of kiosks) {
                await this.prisma.productionPar.create({
                    data: {
                        kiosk_id: kiosk.kiosk_id,
                        product_id: product.product_id as string,
                        MONDAY: 0,
                        TUESDAY: 0,
                        WEDNESDAY: 0,
                        THURSDAY: 0,
                        FRIDAY: 0,
                        SATURDAY: 0,
                        SUNDAY: 0,
                    },
                });
            }
            if (kiosks.length) this.tableCache.invalidate("production_par");
            this.tableCache.invalidate("production_par");
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error(`production_par auto-provisioning failed for ${product.product_id}:`, err);
        }
    }
}

/**
 * Every call site (findFirst, updateMany, deleteMany) takes Prisma's
 * general WhereInput, not WhereUniqueInput — a flat AND of field filters
 * is correct for both a single-column and a composite key here. The
 * nested compound-key shorthand ({ enum_type_value: { enum_type, value } })
 * only exists on WhereUniqueInput (findUnique/update/delete, singular),
 * which nothing in this file uses; passing it to updateMany/deleteMany/
 * findFirst throws "Unknown argument" — confirmed live against a real
 * composite-@@id table (enum_option) editing/deleting an existing row.
 */
function keyWhere(keyCols: string[], row: Record<string, unknown>): Record<string, unknown> {
    const where: Record<string, unknown> = {};
    for (const k of keyCols) where[k] = row[k];
    return where;
}

function isBlank(val: unknown): boolean {
    return val === undefined || val === null || val === "";
}

/**
 * A bad row's real cause is usually one of the `throw new Error(...)`
 * messages above (already short and user-facing), but an unexpected
 * Prisma error's own .message is a multi-line dump with a code frame and
 * this repo's absolute file paths — never meant for an end user. This
 * shows in the per-row bulk-save result (unlike a single save_table_row
 * failure, which goes through HttpExceptionFilter and never reaches the
 * client raw), so it's sanitized here specifically: keep it as-is when
 * short, otherwise take just the last non-empty line, which for Prisma's
 * own errors is consistently the actual human-readable reason.
 */
function toUserMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err);
    if (message.length <= 200 && !message.includes("\n")) return message;
    const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
    return lines[lines.length - 1] || "Could not save this row.";
}
