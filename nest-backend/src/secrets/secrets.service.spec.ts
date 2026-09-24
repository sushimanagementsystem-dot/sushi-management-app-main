import { describe, it, expect } from "vitest";
import { SecretsService, SecretDecryptError } from "./secrets.service.js";

const svc = (env: Record<string, string>) => new SecretsService({ get: (k: string) => env[k], getOrThrow: (k: string) => env[k]! } as never);

describe("SecretsService", () => {
    const a = svc({ SESSION_JWT_SECRET: "jwt-secret-one" });

    it("round-trips a secret and never stores it in the clear", () => {
        const stored = a.encrypt("sk-ant-api03-supersecretvalue");
        expect(stored.startsWith("enc:v1:")).toBe(true);
        expect(stored).not.toContain("supersecretvalue");
        expect(a.decrypt(stored)).toBe("sk-ant-api03-supersecretvalue");
    });

    it("uses a fresh nonce every time, so equal secrets don't look equal in the database", () => {
        expect(a.encrypt("same")).not.toBe(a.encrypt("same"));
    });

    it("passes legacy plaintext through, so secrets saved before encryption still work", () => {
        expect(a.decrypt("plain-old-password")).toBe("plain-old-password");
        expect(a.isEncrypted("plain-old-password")).toBe(false);
    });

    it("refuses to decrypt with a different key instead of returning garbage", () => {
        const stored = a.encrypt("secret");
        expect(() => svc({ SESSION_JWT_SECRET: "a-different-jwt-secret" }).decrypt(stored)).toThrow(SecretDecryptError);
    });

    it("detects a tampered value", () => {
        const stored = a.encrypt("secret");
        const tampered = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
        expect(() => a.decrypt(tampered)).toThrow(SecretDecryptError);
    });

    it("prefers SECRETS_ENCRYPTION_KEY, so rotating the JWT secret doesn't lock secrets out", () => {
        const before = svc({ SESSION_JWT_SECRET: "jwt-1", SECRETS_ENCRYPTION_KEY: "dedicated" });
        const after = svc({ SESSION_JWT_SECRET: "jwt-2-rotated", SECRETS_ENCRYPTION_KEY: "dedicated" });
        expect(after.decrypt(before.encrypt("secret"))).toBe("secret");
    });
});
