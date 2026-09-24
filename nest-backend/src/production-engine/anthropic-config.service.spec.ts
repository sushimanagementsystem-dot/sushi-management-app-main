import { describe, it, expect, vi } from "vitest";
import { AnthropicConfigService } from "./anthropic-config.service.js";
import { SecretsService } from "../secrets/secrets.service.js";

const secrets = new SecretsService({ get: () => undefined, getOrThrow: () => "jwt-secret" } as never);
const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";

type Row = { is_active: boolean; deleted_at: Date | null; config: Record<string, unknown>; secrets: Record<string, unknown> | null };
const row = (over: Partial<Row> = {}): Row => ({ is_active: true, deleted_at: null, config: {}, secrets: { apiKey: secrets.encrypt(KEY) }, ...over });

function build(dbRow: Row | null, env: Record<string, string> = {}) {
    const findUnique = vi.fn(async () => dbRow);
    const svc = new AnthropicConfigService({ siteConfig: { findUnique } } as never, secrets, { get: (k: string) => env[k] } as never);
    return { svc, findUnique };
}

describe("AnthropicConfigService", () => {
    it("uses the key saved on the dashboard (decrypted), even when an environment key exists", async () => {
        const { svc } = build(row(), { ANTHROPIC_API_KEY: "sk-ant-env-key-0000000000000000" });
        const r = await svc.resolve();
        expect(r.apiKey).toBe(KEY);
        expect(r.source).toBe("dashboard");
        expect(r.keyHint).toBe("…6789");
    });

    it("falls back to the environment key when nothing is saved", async () => {
        const { svc } = build(null, { ANTHROPIC_API_KEY: "sk-ant-env-key-0000000000000000" });
        const r = await svc.resolve();
        expect(r).toMatchObject({ source: "environment", apiKey: "sk-ant-env-key-0000000000000000", keyHint: "…0000" });
    });

    it("ignores a saved key while its section is switched off (Inactive) or removed", async () => {
        const env = { ANTHROPIC_API_KEY: "sk-ant-env-key-0000000000000000" };
        expect((await build(row({ is_active: false }), env).svc.resolve()).source).toBe("environment");
        expect((await build(row({ deleted_at: new Date() }), env).svc.resolve()).source).toBe("environment");
        expect((await build(row({ is_active: false }), {}).svc.resolve()).source).toBe("none");
    });

    it("reports none when there is no key anywhere", async () => {
        const r = await build(null).svc.resolve();
        expect(r).toMatchObject({ apiKey: null, source: "none", keyHint: null });
    });

    it("treats an undecryptable saved key as not saved and falls back, instead of crashing", async () => {
        const { svc } = build(row({ secrets: { apiKey: "enc:v1:bm90LXJlYWwtY2lwaGVydGV4dA" } }), { ANTHROPIC_API_KEY: "sk-ant-env-key-0000000000000000" });
        expect((await svc.resolve()).source).toBe("environment");
    });

    it("model: dashboard choice, else INVOICE_AI_MODEL, else the default", async () => {
        expect((await build(row({ config: { model: "claude-opus-5" } }), { INVOICE_AI_MODEL: "claude-haiku-4-5" }).svc.resolve()).model).toBe("claude-opus-5");
        expect((await build(row(), { INVOICE_AI_MODEL: "claude-haiku-4-5" }).svc.resolve()).model).toBe("claude-haiku-4-5");
        expect((await build(row()).svc.resolve()).model).toBe("claude-sonnet-5");
    });

    it("caches, and invalidate() makes a newly saved key apply immediately", async () => {
        const { svc, findUnique } = build(row());
        await svc.resolve();
        await svc.resolve();
        expect(findUnique).toHaveBeenCalledTimes(1);
        svc.invalidate();
        await svc.resolve();
        expect(findUnique).toHaveBeenCalledTimes(2);
    });

    it("status() never contains the key", async () => {
        const status = await build(row()).svc.status();
        expect(JSON.stringify(status)).not.toContain(KEY);
        expect(status).toEqual({ source: "dashboard", keyHint: "…6789", model: "claude-sonnet-5" });
    });
});
