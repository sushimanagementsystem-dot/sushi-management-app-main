// Turns the raw database error from a Data Tables write into a message an
// owner can act on. Without this, a duplicate email surfaced as
// "Unique constraint failed on the constraint: `user_email_key`" — true,
// but it names neither the person it collides with nor what to do next.

import { friendlyDbError } from "../../common/filters/prisma-error.js";

export type WriteErrorContext = {
    tableName: string;
    isNew: boolean;
    /** The cleaned row that was being written. */
    row: Record<string, unknown>;
    /** column_name -> human label, from field_schema. */
    labels: Record<string, string>;
    /** The table's is_title_column, if it has one — used to name the conflicting row. */
    titleColumn?: string;
    /** Looks up an existing row matching `where`; used to say who already owns a value. */
    findConflict: (where: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
};

type DbError = { code?: string; message?: string; meta?: { driverAdapterError?: { cause?: { constraint?: { index?: string } } } } };

/** "user_email_key" (unique) / "kiosk_brand_id_fkey" (foreign key) -> the constraint's name. */
function constraintName(err: DbError): string | undefined {
    const fromMeta = err.meta?.driverAdapterError?.cause?.constraint?.index;
    if (fromMeta) return fromMeta;
    return /constraint: `([^`]+)`/.exec(err.message ?? "")?.[1];
}

/** Which of the row's columns a constraint name refers to ("user_email_key" -> ["email"]). */
function columnsIn(constraint: string, tableName: string, suffix: string, row: Record<string, unknown>): string[] {
    let rest = constraint;
    if (rest.startsWith(`${tableName}_`)) rest = rest.slice(tableName.length + 1);
    if (rest.endsWith(suffix)) rest = rest.slice(0, -suffix.length);
    const exact = Object.keys(row).filter((k) => k === rest);
    if (exact.length) return exact;
    return Object.keys(row).filter((k) => rest.startsWith(`${k}_`) || rest.endsWith(`_${k}`) || rest.includes(`_${k}_`));
}

export async function explainWriteError(err: unknown, ctx: WriteErrorContext): Promise<Error> {
    const e = err as DbError;
    const constraint = constraintName(e);

    if (e?.code === "P2002" && constraint) {
        const cols = columnsIn(constraint, ctx.tableName, "_key", ctx.row);
        if (!cols.length) return new Error(`Another row already uses one of these values (${constraint}).`);
        const label = cols.map((c) => ctx.labels[c] || c).join(" + ");
        const value = cols.map((c) => String(ctx.row[c])).join(" + ");

        let other: Record<string, unknown> | null = null;
        try {
            other = await ctx.findConflict(Object.fromEntries(cols.map((c) => [c, ctx.row[c]])));
        } catch {
            // best-effort: the message is still useful without the name
        }
        // tables without an is_title_column (e.g. user) still name the row by its "name"
        const title = other ? other[ctx.titleColumn ?? "name"] : undefined;
        const who = title ? `"${String(title)}"` : "another record";
        const inactive = other?.active === false;

        let message: string;
        if (ctx.tableName === "user") {
            // Staff. Say who owns the email and exactly what to do instead.
            if (!ctx.isNew) {
                message = `The email ${value} already belongs to ${who}. Every staff member needs their own email — enter a different one.`;
            } else if (inactive) {
                message = `The email ${value} already belongs to ${who}, who is currently inactive (they probably signed in once and were added automatically). Open that person's row and switch Active on — don't add them again.`;
            } else {
                message = `The email ${value} already belongs to ${who}. Open that person's row to edit them, or use a different email for the new person.`;
            }
        } else {
            const what = label.toLowerCase();
            message = `The ${what} "${value}" is already used by ${who}. Each one needs a different ${what} — change it, or edit the existing row.`;
        }
        return new Error(message);
    }

    if (e?.code === "P2003" && constraint) {
        const cols = columnsIn(constraint, ctx.tableName, "_fkey", ctx.row);
        const what = cols.length ? cols.map((c) => ctx.labels[c] || c).join(" + ") : "A linked value";
        return new Error(`${what} points to something that doesn't exist, or is still in use by other records.`);
    }

    // Any other recognised database error (value too long, required value
    // missing, wrong format, record gone, DB unreachable) — plain language too.
    const friendly = friendlyDbError(err);
    if (friendly) return new Error(friendly.message);

    return err instanceof Error ? err : new Error(String(err));
}
