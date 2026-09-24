import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;

/** The stored value can't be decrypted — wrong/rotated key, or the value was altered. */
export class SecretDecryptError extends Error {}

/**
 * Encrypts secrets (API keys, passwords) before they are written to the
 * database, so a database dump, backup, or anyone with read-only SQL access
 * sees ciphertext, never the credential itself. AES-256-GCM: authenticated,
 * so a tampered value fails to decrypt instead of decrypting to garbage.
 *
 * The key is NOT in the database. It comes from the server's environment:
 * SECRETS_ENCRYPTION_KEY if set (recommended in production — independent of
 * everything else), otherwise derived (HKDF) from SESSION_JWT_SECRET, which
 * every deployment already has. Consequence of the fallback: rotating
 * SESSION_JWT_SECRET makes previously saved secrets unreadable until they
 * are entered again — set SECRETS_ENCRYPTION_KEY to decouple the two.
 *
 * decrypt() passes plaintext through unchanged, so secrets saved before
 * encryption existed keep working and are upgraded the next time their
 * category is saved.
 */
@Injectable()
export class SecretsService {
    private readonly key: Buffer;

    constructor(config: ConfigService) {
        const material = config.get<string>("SECRETS_ENCRYPTION_KEY") || config.getOrThrow<string>("SESSION_JWT_SECRET");
        this.key = Buffer.from(hkdfSync("sha256", material, "sushi-kiosk-site-config", "site-config-secrets-v1", 32));
    }

    isEncrypted(value: unknown): value is string {
        return typeof value === "string" && value.startsWith(PREFIX);
    }

    encrypt(plain: string): string {
        const iv = randomBytes(IV_BYTES);
        const cipher = createCipheriv("aes-256-gcm", this.key, iv);
        const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
        return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    }

    decrypt(stored: string): string {
        if (!this.isEncrypted(stored)) return stored; // legacy plaintext
        try {
            const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
            const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, IV_BYTES));
            decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
            return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
        } catch {
            throw new SecretDecryptError("A saved secret could not be decrypted (the server's encryption key changed, or the value was altered). Enter it again.");
        }
    }
}
