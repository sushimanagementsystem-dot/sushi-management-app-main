import { describe, it, expect, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { friendlyDbError } from "./prisma-error.js";
import { HttpExceptionFilter } from "./http-exception.filter.js";

const dbErr = (code: string, extra: object = {}) => Object.assign(new Error(`raw ${code}`), { code, ...extra });

describe("friendlyDbError", () => {
    it("explains a duplicate value and names the unique field", () => {
        const r = friendlyDbError(dbErr("P2002", { meta: { driverAdapterError: { cause: { constraint: { index: "user_email_key" } } } } }));
        expect(r?.status).toBe(409);
        expect(r?.message).toContain("already in use by another record (user email)");
    });

    it("maps the other common codes", () => {
        expect(friendlyDbError(dbErr("P2003"))?.message).toContain("still used by other records");
        expect(friendlyDbError(dbErr("P2025"))).toMatchObject({ status: 404 });
        expect(friendlyDbError(dbErr("P2000"))?.message).toContain("too long");
        expect(friendlyDbError(dbErr("P2011"))?.message).toContain("required value is missing");
        expect(friendlyDbError(dbErr("P1001"))).toMatchObject({ status: 503 });
    });

    it("explains a wrong-format value, naming the field", () => {
        const e = Object.assign(new Error("Argument `qty`: Invalid value provided. Expected Int, provided String."), { name: "PrismaClientValidationError" });
        expect(friendlyDbError(e)?.message).toContain('"qty"');
    });

    it("ignores errors it does not recognise", () => {
        expect(friendlyDbError(new Error("boom"))).toBeNull();
        expect(friendlyDbError(undefined)).toBeNull();
    });
});

describe("HttpExceptionFilter", () => {
    const run = (exception: unknown) => {
        const json = vi.fn();
        const status = vi.fn((_code: number) => ({ json }));
        new HttpExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never);
        return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
    };

    it("shows a friendly message for a database error instead of 'Something went wrong.'", () => {
        const { status, body } = run(dbErr("P2002"));
        expect(status).toBe(409);
        expect(body).toMatchObject({ ok: false });
        expect(body.error).not.toBe("Something went wrong.");
    });

    it("keeps deliberate HTTP errors and truly unknown errors as before", () => {
        expect(run(new BadRequestException("Nope")).body).toEqual({ ok: false, error: "Nope" });
        expect(run(new Error("boom"))).toEqual({ status: 500, body: { ok: false, error: "Something went wrong." } });
    });
});
