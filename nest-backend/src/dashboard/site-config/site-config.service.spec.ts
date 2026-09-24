import { describe, it, expect, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { BadRequestException } from "@nestjs/common";
import { SiteConfigService } from "./site-config.service.js";
import { SecretsService } from "../../secrets/secrets.service.js";

const secrets = new SecretsService({ get: () => undefined, getOrThrow: () => "jwt-secret" } as never);
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

/** site_config rows carry a BigInt id, which JSON.stringify refuses — this is what the assertions below serialise. */
const dump = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

type Row = { id: bigint; category: string; config: Record<string, unknown>; secrets: Record<string, unknown>; is_active: boolean } & Record<string, unknown>;

/** In-memory site_config table: just enough Prisma surface for SiteConfigService. */
function build(seed: Row[] = [], models: { retrieve: ReturnType<typeof vi.fn> } = { retrieve: vi.fn(async () => ({})) }) {
    const rows = new Map(seed.map((r) => [r.category, r]));
    const upsert = vi.fn(async ({ where, create, update }: { where: { category: string }; create: Row; update: Partial<Row> }) => {
        const prev = rows.get(where.category);
        const next = prev ? { ...prev, ...update } : { created_at: new Date(), updated_at: new Date(), ...create, id: BigInt(rows.size + 1), is_active: create.is_active ?? true };
        rows.set(where.category, next as Row);
        return next;
    });
    const prisma = {
        siteConfig: {
            findUnique: vi.fn(async ({ where }: { where: { category: string } }) => rows.get(where.category) ?? null),
            findMany: vi.fn(async () => [...rows.values()].map((r) => ({ created_at: new Date(), updated_at: new Date(), last_tested_at: null, last_test_result: null, last_test_error: null, created_by: null, updated_by: null, ...r }))),
            upsert,
        },
    };
    const mailer = { invalidate: vi.fn() };
    const aiConfig = { invalidate: vi.fn(), status: vi.fn(async () => ({ source: "none", keyHint: null, model: "claude-sonnet-5" })), createClient: vi.fn(() => ({ models })) };
    const svc = new SiteConfigService(prisma as never, mailer as never, secrets, aiConfig as never);
    return { svc, rows, mailer, aiConfig, models };
}

describe("SiteConfigService — Anthropic key", () => {
    it("stores the key encrypted, records only its last 4 characters, and applies it immediately", async () => {
        const { svc, rows, aiConfig, mailer } = build();
        await svc.save({ category: "ANTHROPIC", config: { model: "claude-opus-5" }, secrets: { apiKey: `  ${KEY}  ` } }, "U1");

        const saved = rows.get("ANTHROPIC")!;
        const stored = saved.secrets.apiKey as string;
        expect(stored.startsWith("enc:v1:")).toBe(true);
        expect(dump(saved)).not.toContain(KEY);
        expect(secrets.decrypt(stored)).toBe(KEY); // trimmed, and recoverable by the server
        expect(saved.config).toEqual({ model: "claude-opus-5", keyHint: "…6789" });
        expect(aiConfig.invalidate).toHaveBeenCalled();
        expect(mailer.invalidate).toHaveBeenCalled();
    });

    it("never sends the key (or its ciphertext) to the browser", async () => {
        const { svc } = build();
        await svc.save({ category: "ANTHROPIC", secrets: { apiKey: KEY } }, "U1");

        const out = dump(await svc.getBootstrapData());
        expect(out).not.toContain(KEY);
        expect(out).not.toContain("enc:v1:");
        expect(out).toContain('"secretsSet":{"apiKey":true}');
    });

    it("rejects something that isn't shaped like a key, and a bad model name", async () => {
        const { svc } = build();
        await expect(svc.save({ category: "ANTHROPIC", secrets: { apiKey: "hunter2" } }, "U1")).rejects.toThrow(/sk-ant-/);
        await expect(svc.save({ category: "ANTHROPIC", config: { model: "gpt-4; drop table" }, secrets: {} }, "U1")).rejects.toThrow(/model name/);
    });

    it("saving only the model keeps the saved key; a client can't forge the hint or add other config", async () => {
        const { svc, rows } = build();
        await svc.save({ category: "ANTHROPIC", secrets: { apiKey: KEY } }, "U1");
        const before = rows.get("ANTHROPIC")!.secrets.apiKey;

        await svc.save({ category: "ANTHROPIC", config: { model: "claude-sonnet-5", keyHint: "…FAKE", evil: "x" }, secrets: {} }, "U1");

        const saved = rows.get("ANTHROPIC")!;
        expect(saved.secrets.apiKey).toBe(before);
        expect(saved.config).toEqual({ model: "claude-sonnet-5", keyHint: "…6789" });
    });

    it("removes the key when it is sent as null", async () => {
        const { svc, rows } = build();
        await svc.save({ category: "ANTHROPIC", secrets: { apiKey: KEY } }, "U1");
        await svc.save({ category: "ANTHROPIC", secrets: { apiKey: null as never } }, "U1");

        expect(rows.get("ANTHROPIC")!.secrets).toEqual({});
        expect(rows.get("ANTHROPIC")!.config.keyHint).toBeNull();
    });
});

describe("SiteConfigService — other categories", () => {
    it("encrypts a legacy plaintext SMTP password the next time the category is saved", async () => {
        const { svc, rows } = build([{ id: 1n, category: "SMTP", config: { host: "smtp.example.com" }, secrets: { password: "old-plain-password" }, is_active: true }]);
        await svc.save({ category: "SMTP", config: { host: "smtp.example.com", port: 587 } }, "U1"); // no new password entered

        const stored = rows.get("SMTP")!.secrets.password as string;
        expect(stored.startsWith("enc:v1:")).toBe(true);
        expect(secrets.decrypt(stored)).toBe("old-plain-password");
    });

    it("refuses a blank-spaces secret rather than saving it", async () => {
        const { svc } = build();
        await expect(svc.save({ category: "SMTP", secrets: { password: "   " } }, "U1")).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe("SiteConfigService.testAnthropicConnection", () => {
    it("checks the typed key against the chosen model and records success without storing the key", async () => {
        const { svc, rows, models, aiConfig } = build();
        const res = await svc.testAnthropicConnection({ apiKey: KEY, model: "claude-opus-5" }, "U1");

        expect(res.model).toBe("claude-opus-5");
        expect(aiConfig.createClient).toHaveBeenCalledWith(KEY);
        expect(models.retrieve).toHaveBeenCalledWith("claude-opus-5");
        const row = rows.get("ANTHROPIC")!;
        expect(row.last_test_result).toBe("success");
        expect(dump(row)).not.toContain(KEY);
    });

    it("tests the saved key when the field is left blank", async () => {
        const { svc, aiConfig } = build();
        await svc.save({ category: "ANTHROPIC", secrets: { apiKey: KEY } }, "U1");
        await svc.testAnthropicConnection({}, "U1");
        expect(aiConfig.createClient).toHaveBeenCalledWith(KEY);
    });

    it("turns a rejected key into a plain sentence and records the failure", async () => {
        const authErr = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "invalid x-api-key", new Headers());
        const { svc, rows } = build([], { retrieve: vi.fn().mockRejectedValue(authErr) });

        await expect(svc.testAnthropicConnection({ apiKey: KEY }, "U1")).rejects.toThrow(/invalid or has been revoked/);
        const row = rows.get("ANTHROPIC")!;
        expect(row.last_test_result).toBe("failed");
        expect(String(row.last_test_error)).not.toContain("authentication_error");
    });

    it("asks for a key when none is typed and none is saved", async () => {
        const { svc } = build();
        await expect(svc.testAnthropicConnection({}, "U1")).rejects.toThrow(/none is saved yet/);
    });
});
