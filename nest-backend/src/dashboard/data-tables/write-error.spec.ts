import { describe, it, expect } from "vitest";
import { explainWriteError, type WriteErrorContext } from "./write-error.js";

// The exact shape Prisma 7 + the pg driver adapter produces (captured from a real failing insert).
const unique = (index: string) => ({
    code: "P2002",
    message: `Invalid \`prisma.user.create()\` invocation:\n\nUnique constraint failed on the constraint: \`${index}\``,
    meta: { driverAdapterError: { cause: { kind: "UniqueConstraintViolation", constraint: { index } } } },
});
const foreignKey = (index: string) => ({
    code: "P2003",
    message: `Foreign key constraint violated on the constraint: \`${index}\``,
    meta: { driverAdapterError: { cause: { kind: "ForeignKeyConstraintViolation", constraint: { index } } } },
});

const userCtx = (other: Record<string, unknown> | null): WriteErrorContext => ({
    tableName: "user",
    isNew: true,
    row: { user_id: "b6d99458", name: "Zuzanna", email: "zbekacz@gmail.com", role: "STAFF", active: true },
    labels: { email: "Email" },
    titleColumn: "name",
    findConflict: async () => other,
});

describe("explainWriteError", () => {
    it("names the existing staff member and says it is inactive", async () => {
        const err = await explainWriteError(unique("user_email_key"), userCtx({ name: "Zuzanna Bekacz", active: false }));
        expect(err.message).toContain('The email zbekacz@gmail.com already belongs to "Zuzanna Bekacz", who is currently inactive');
        expect(err.message).toContain("switch Active on");
        expect(err.message).not.toContain("user_email_key");
    });

    it("tells the owner to edit the existing row when that person is active", async () => {
        const err = await explainWriteError(unique("user_email_key"), userCtx({ name: "Evan", active: true }));
        expect(err.message).toContain('"Evan"');
        expect(err.message).not.toContain("inactive");
        expect(err.message).toContain("Open that person's row to edit them");
    });

    it("when editing an existing staff row, asks for a different email", async () => {
        const ctx = userCtx({ name: "Evan", active: true });
        ctx.isNew = false;
        expect((await explainWriteError(unique("user_email_key"), ctx)).message).toBe('The email zbekacz@gmail.com already belongs to "Evan". Every staff member needs their own email — enter a different one.');
    });

    it("still explains the clash when the lookup fails or finds nothing", async () => {
        const ctx = userCtx(null);
        ctx.findConflict = async () => {
            throw new Error("db down");
        };
        expect((await explainWriteError(unique("user_email_key"), ctx)).message).toContain("already belongs to another record");
    });

    it("falls back to the name column when the table has no title column", async () => {
        const ctx = userCtx({ name: "Zuzanna Bekacz", active: false });
        ctx.titleColumn = undefined;
        expect((await explainWriteError(unique("user_email_key"), ctx)).message).toContain('"Zuzanna Bekacz"');
    });

    it("handles a non-user table generically (kiosk token)", async () => {
        const err = await explainWriteError(unique("kiosk_token_key"), {
            tableName: "kiosk",
            isNew: false,
            row: { kiosk_id: "K05", token: "abc" },
            labels: { token: "Token" },
            titleColumn: "name",
            findConflict: async () => ({ name: "Limerick" }),
        });
        expect(err.message).toBe('The token "abc" is already used by "Limerick". Each one needs a different token — change it, or edit the existing row.');
    });

    it("explains a foreign key failure without the raw constraint text", async () => {
        const err = await explainWriteError(foreignKey("kiosk_brand_id_fkey"), {
            tableName: "kiosk",
            isNew: true,
            row: { kiosk_id: "K05", brand_id: "NOPE" },
            labels: { brand_id: "Brand" },
            findConflict: async () => null,
        });
        expect(err.message).toBe("Brand points to something that doesn't exist, or is still in use by other records.");
    });

    it("passes unrelated errors through unchanged", async () => {
        const original = new Error("Email is required.");
        expect(await explainWriteError(original, userCtx(null))).toBe(original);
    });
});
