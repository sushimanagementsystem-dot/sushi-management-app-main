// Plain-language versions of the database errors Prisma can throw, so an
// owner or staff member sees what went wrong ("that email is already used")
// instead of "Something went wrong." or a raw constraint name. Used by the
// global HttpExceptionFilter for every route, and by the Data Tables save
// path for its per-row messages (which add the specific person/value on
// top for unique and foreign-key clashes — see dashboard/data-tables/write-error.ts).

export type FriendlyDbError = { status: number; message: string };

type PrismaLike = {
    code?: string;
    name?: string;
    message?: string;
    meta?: { driverAdapterError?: { cause?: { constraint?: { index?: string } } } };
};

const BUSY = "The database is busy or unreachable right now. Please try again in a moment.";

/** "user_email_key" -> "user email" */
function prettyConstraint(err: PrismaLike): string | undefined {
    const raw = err.meta?.driverAdapterError?.cause?.constraint?.index ?? /constraint: `([^`]+)`/.exec(err.message ?? "")?.[1];
    return raw?.replace(/_(key|fkey|pkey)$/, "").replace(/_/g, " ");
}

/** Returns null for anything that isn't a recognised database error, so the caller keeps its own generic handling. */
export function friendlyDbError(err: unknown): FriendlyDbError | null {
    const e = err as PrismaLike | null;
    if (!e || typeof e !== "object") return null;

    switch (e.code) {
        case "P2002": {
            const field = prettyConstraint(e);
            return { status: 409, message: `That value is already in use by another record${field ? ` (${field})` : ""}. It must be unique — use a different value or edit the existing record.` };
        }
        case "P2003":
            return { status: 409, message: "This refers to something that doesn't exist, or it is still used by other records, so it can't be saved or deleted." };
        case "P2025":
            return { status: 404, message: "That record no longer exists — it may have been deleted or changed by someone else. Reload and try again." };
        case "P2000":
            return { status: 400, message: "One of the values is too long." };
        case "P2011":
        case "P2012":
            return { status: 400, message: "A required value is missing." };
        case "P1001":
        case "P1002":
        case "P1008":
        case "P1017":
        case "P2024":
            return { status: 503, message: BUSY };
    }

    if (e.name === "PrismaClientValidationError") {
        const field = /Argument `(\w+)`/.exec(e.message ?? "")?.[1];
        return { status: 400, message: field ? `The value for "${field.replace(/_/g, " ")}" is in the wrong format (for example text where a number is expected).` : "One of the values is in the wrong format (for example text where a number is expected)." };
    }
    return null;
}
