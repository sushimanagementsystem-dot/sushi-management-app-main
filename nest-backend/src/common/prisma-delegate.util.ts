import { toModelName } from "./model-name.util.js";

/** The subset of a Prisma model delegate's methods used by the generic (table-name-driven) engines —
 * Data Tables and the audit log's undo. Works for the real Prisma client or a $transaction client alike. */
export type PrismaDelegate = {
    findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
    create: (args: unknown) => Promise<Record<string, unknown>>;
    createMany: (args: unknown) => Promise<{ count: number }>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
    deleteMany: (args: unknown) => Promise<{ count: number }>;
    count: (args: unknown) => Promise<number>;
};

/** Sheet/table name ("stock_movement") -> that table's delegate on `db`, which may be the real Prisma client or a
 * $transaction client. Generic so a new table never needs a new switch-case here. */
export function delegateFor(db: unknown, tableName: string): PrismaDelegate {
    return (db as unknown as Record<string, PrismaDelegate>)[toModelName(tableName)];
}
