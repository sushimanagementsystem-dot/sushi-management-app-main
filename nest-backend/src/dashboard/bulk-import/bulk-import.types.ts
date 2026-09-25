/**
 * The one bulk-edit workflow every dashboard section uses:
 *   Download template -> edit in Excel -> upload -> validate -> preview -> Apply.
 * A section only describes ITS data (a BulkDataset); reading the file, validating, previewing, the "nothing is
 * written until Apply" rule and the all-or-nothing transaction are shared (bulk-import.engine.ts / .service.ts).
 */

export type ColumnFormat = "text" | "integer" | "number" | "money" | "boolean";

export type ColumnDef = {
    key: string;
    header: string;
    /** Other headers that mean the same column (a client's own sheet). */
    aliases?: string[];
    /**
     * key   - identifies the record (matched to the system, never changed by an upload);
     * info  - context for the person editing (name, category...), read by the template only;
     * value - what the upload may change.
     */
    kind: "key" | "info" | "value";
    format?: ColumnFormat;
    /** value columns: smallest allowed number. */
    min?: number;
    /** A blank cell in this key column is an error ("missing value"). */
    required?: boolean;
    width?: number;
};

/** One record that the sheet can change: an existing one, or (exists=false) one the upload may create. */
export type Target = {
    /** Unique, stable identity inside the dataset. */
    ref: string;
    /** Display values for the key/info columns (template rows and the preview). */
    label: Record<string, string>;
    /** Current value of each value column (null = not set). */
    current: Record<string, unknown>;
    exists: boolean;
};

export type Resolution =
    | { ref: string; create?: Target }
    | { error: string; unmatched?: boolean };

export type ChangeSet = {
    ref: string;
    exists: boolean;
    /** Only the values that differ from now. */
    values: Record<string, unknown>;
    /** Current values with `values` applied. */
    merged: Record<string, unknown>;
    label: Record<string, string>;
};

/** Anything that can run queries: the Prisma client, or a transaction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export interface BulkDataset<Ctx = unknown> {
    id: string;
    label: string;
    fileName: string;
    sheetName: string;
    /** One-line description for the UI. */
    description: string;
    /** Data Tables tabs (table_name) this dataset is offered on. */
    showOn: string[];
    columns: ColumnDef[];
    /** Column keys that must all be found for a row to be recognised as the header row. */
    detect: string[];
    /** Cache tables to clear after an apply. */
    invalidates: string[];
    load(db: Db): Promise<Ctx>;
    /** Every record the template lists (existing records, plus blank rows to fill where that makes sense). */
    targets(ctx: Ctx): Target[];
    /** Maps a file row (values by column key) to a record — or says why it can't. */
    resolve(raw: Record<string, unknown>, ctx: Ctx): Resolution;
    /** Extra check on the row as it would be after the change (e.g. minimum stock above the target). */
    check?(merged: Record<string, unknown>, target: Target): string | null;
    /** Writes the changes. Runs inside the transaction; anything thrown rolls everything back. */
    apply(db: Db, changes: ChangeSet[], ctx: Ctx): Promise<void>;
    /** Extra reference sheets in the template (e.g. the list of item codes). */
    referenceSheets?(ctx: Ctx): { name: string; rows: unknown[][] }[];
    /** Short how-to lines shown on the template's "How to use" sheet. */
    instructions: string[];
}

export type RowStatus = "changed" | "new" | "unchanged" | "invalid" | "unmatched" | "duplicate";

export type PreviewRow = {
    rowNo: number;
    status: RowStatus;
    message?: string;
    label: Record<string, string>;
    changes: { key: string; header: string; from: unknown; to: unknown }[];
};

export type Preview = {
    dataset: string;
    label: string;
    /** Key/info columns shown for each row, then the value columns that can change. */
    labelColumns: { key: string; header: string }[];
    valueColumns: { key: string; header: string }[];
    rows: PreviewRow[];
    summary: { fileRows: number; changed: number; new: number; unchanged: number; invalid: number; unmatched: number; duplicate: number; notInFile: number };
    /** Problems with the file as a whole (wrong columns, unreadable...). */
    fileErrors: string[];
    /** True only when there are no problems at all and at least one change: apply is all-or-nothing. */
    canApply: boolean;
    /** Fingerprint of the exact changes previewed; Apply is refused if the data moved on since. */
    token: string;
};
