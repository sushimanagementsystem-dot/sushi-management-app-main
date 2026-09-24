import { BadRequestException, Injectable } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MailerService, SMTP_CATEGORY, type SmtpConfig } from "../../mailer/mailer.service.js";
import { SecretsService } from "../../secrets/secrets.service.js";
import { AI_CATEGORY, AnthropicConfigService, DEFAULT_AI_MODEL, hint } from "../../production-engine/anthropic-config.service.js";
import type { SaveSiteConfigDto } from "./dto/save-site-config.dto.js";
import type { TestMailConnectionDto } from "./dto/test-mail-connection.dto.js";
import type { TestAnthropicConnectionDto } from "./dto/test-anthropic-connection.dto.js";
import type { SiteConfig } from "@prisma/client";

/** Real Anthropic keys look like sk-ant-api03-…; this only catches an obviously wrong paste — the real check is Test. */
const AI_KEY_FORMAT = /^sk-ant-[A-Za-z0-9_-]{20,}$/;
const AI_KEY_FORMAT_HELP = "That doesn't look like an Anthropic API key — it should start with sk-ant- and contain no spaces. Copy it again from console.anthropic.com.";
const AI_MODEL_FORMAT = /^claude-[a-z0-9][a-z0-9.-]{2,60}$/;

/**
 * Site Configuration — one row per config category (`category`: ADMIN,
 * SMTP, ANTHROPIC, ...), edited on its own dashboard page: this is the
 * intended home for any future site-wide integration (WhatsApp, a payment
 * gateway, ...) — adding one is purely additive, a new `category` string
 * plus a `config`/`secrets` JSON shape of its own choosing and a matching
 * page section; no schema/migration is ever needed. Deliberately separate
 * from the `setting` table/page (business logic knobs like rice batching,
 * audit thresholds): this is admin/site-level config.
 *
 * `config` (non-secret) and `secrets` (passwords/tokens/API keys) are
 * two separate JSONB columns. `secrets` is never sent to the frontend at
 * all (see toClientRow), so there's no per-field masking rule that could
 * miss a name — and every secret is stored ENCRYPTED (see SecretsService),
 * so a database dump or read-only SQL access doesn't reveal it either.
 * `is_active`/`last_tested_at`/`last_test_result`/`last_test_error` are
 * real columns so consumers can filter on them directly, and soft-delete
 * (`deleted_at`/`deleted_by`) keeps a removed category's history instead
 * of losing it outright.
 */
@Injectable()
export class SiteConfigService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly mailer: MailerService,
        private readonly secrets: SecretsService,
        private readonly aiConfig: AnthropicConfigService,
    ) {}

    async getBootstrapData() {
        const rows = await this.prisma.siteConfig.findMany({ where: { deleted_at: null } });
        // `ai` = where the Anthropic key currently comes from (dashboard / environment / none) plus its last
        // 4 characters — never the key itself.
        return { config: rows.map((r) => this.toClientRow(r)), ai: await this.aiConfig.status() };
    }

    /** Upserts one category row. `config`/`secrets` merge onto the
     * existing row's values rather than replacing them, so omitting a
     * secret field (a blank password) keeps whatever is already saved. */
    async save(dto: SaveSiteConfigDto, updatedBy: string): Promise<void> {
        const existing = await this.prisma.siteConfig.findUnique({ where: { category: dto.category } });
        const incomingConfig: Record<string, unknown> = { ...dto.config };
        const incomingSecrets = dto.secrets ?? {};
        if (dto.category === AI_CATEGORY) this.prepareAiConfig(incomingConfig, incomingSecrets);

        const mergedConfig = { ...((existing?.config as Record<string, unknown>) ?? {}), ...incomingConfig };
        const mergedSecrets = this.mergeSecrets((existing?.secrets as Record<string, unknown>) ?? {}, incomingSecrets);

        await this.prisma.siteConfig.upsert({
            where: { category: dto.category },
            create: {
                category: dto.category,
                is_active: dto.isActive ?? true,
                config: mergedConfig as never,
                secrets: mergedSecrets as never,
                created_by: updatedBy,
                updated_by: updatedBy,
            },
            update: {
                ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
                config: mergedConfig as never,
                secrets: mergedSecrets as never,
                updated_by: updatedBy,
                // A save on a previously soft-deleted category revives it.
                deleted_at: null,
                deleted_by: null,
            },
        });
        this.invalidateConsumers();
    }

    /** Enable/disable a config category without touching its saved
     * data — e.g. temporarily turn off outbound email while keeping the
     * SMTP credentials in place. */
    async setActive(category: string, isActive: boolean, updatedBy: string): Promise<void> {
        await this.prisma.siteConfig.update({
            where: { category },
            data: { is_active: isActive, updated_by: updatedBy },
        });
        this.invalidateConsumers();
    }

    /** Soft-deletes a config category — keeps the row (and its history)
     * instead of losing it outright; save() revives it if re-saved. */
    async delete(category: string, deletedBy: string): Promise<void> {
        await this.prisma.siteConfig.update({
            where: { category },
            data: { deleted_at: new Date(), deleted_by: deletedBy },
        });
        this.invalidateConsumers();
    }

    /** Sends a real test email using whatever SMTP values are currently in
     * the form (saved or not) — a blank password means "use the already
     * saved password". Records the outcome on the SMTP row so it
     * survives a page reload, including the raw error on failure. */
    async testMailConnection(dto: TestMailConnectionDto, updatedBy: string): Promise<void> {
        const existing = await this.prisma.siteConfig.findUnique({ where: { category: SMTP_CATEGORY } });
        let password = dto.password;
        if (!password) {
            const stored = (existing?.secrets as Record<string, unknown> | undefined)?.password;
            try {
                password = typeof stored === "string" && stored ? this.secrets.decrypt(stored) : "";
            } catch {
                throw new BadRequestException("The saved password can't be read any more (the server's encryption key changed). Enter it again.");
            }
        }
        if (!password) {
            throw new BadRequestException("Enter a password (no password is saved yet to fall back to).");
        }

        const config: SmtpConfig = {
            host: dto.host,
            port: dto.port,
            secure: dto.secure,
            username: dto.username,
            password,
            fromName: dto.fromName,
            fromEmail: dto.fromEmail,
        };

        try {
            await this.mailer.sendTestMail(config, dto.sendTestTo);
            await this.recordTestResult(SMTP_CATEGORY, existing, "success", null, updatedBy);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            await this.recordTestResult(SMTP_CATEGORY, existing, "failed", detail, updatedBy);
            throw new BadRequestException(`Could not send the test email — the SMTP server rejected it (${detail}).`);
        }
    }

    /**
     * Checks an Anthropic key against Anthropic itself — the key typed in
     * the form if there is one, else the saved one — by looking up the
     * chosen model (GET /v1/models/{id}): it needs a valid key and access
     * to that model, and costs nothing. The outcome is recorded on the row
     * so it survives a reload.
     */
    async testAnthropicConnection(dto: TestAnthropicConnectionDto, updatedBy: string): Promise<{ model: string }> {
        const existing = await this.prisma.siteConfig.findUnique({ where: { category: AI_CATEGORY } });

        let apiKey = dto.apiKey?.trim() || "";
        if (!apiKey) {
            const stored = (existing?.secrets as Record<string, unknown> | null)?.apiKey;
            if (typeof stored === "string" && stored) {
                try {
                    apiKey = this.secrets.decrypt(stored);
                } catch {
                    throw new BadRequestException("The saved key can't be read any more (the server's encryption key changed). Enter the key again.");
                }
            }
        }
        if (!apiKey) throw new BadRequestException("Enter an API key to test — none is saved yet.");
        if (!AI_KEY_FORMAT.test(apiKey)) throw new BadRequestException(AI_KEY_FORMAT_HELP);

        const savedModel = (existing?.config as Record<string, unknown> | null)?.model;
        const model = dto.model?.trim() || (typeof savedModel === "string" && savedModel) || DEFAULT_AI_MODEL;
        if (!AI_MODEL_FORMAT.test(model)) throw new BadRequestException("That model name isn't valid.");

        try {
            await this.aiConfig.createClient(apiKey).models.retrieve(model);
        } catch (err) {
            const detail = describeKeyTestError(err, model);
            await this.recordTestResult(AI_CATEGORY, existing, "failed", detail, updatedBy);
            throw new BadRequestException(detail);
        }
        await this.recordTestResult(AI_CATEGORY, existing, "success", null, updatedBy);
        return { model };
    }

    private invalidateConsumers(): void {
        this.mailer.invalidate();
        this.aiConfig.invalidate();
    }

    /**
     * Encrypts on the way in. A secret sent as null or "" is REMOVED (the
     * explicit way to clear one); one that is left out is kept as saved.
     * Anything still plaintext in the merged result — including secrets
     * saved before encryption existed — is encrypted now, so any save of a
     * category upgrades all of its secrets.
     */
    private mergeSecrets(existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
        const merged: Record<string, unknown> = { ...existing };
        for (const [name, value] of Object.entries(incoming)) {
            if (value === null || value === "") {
                delete merged[name];
                continue;
            }
            if (typeof value !== "string" || !value.trim()) throw new BadRequestException(`"${name}" must be text, not blank.`);
            merged[name] = value.trim();
        }
        for (const [name, value] of Object.entries(merged)) {
            if (typeof value === "string" && value && !this.secrets.isEncrypted(value)) merged[name] = this.secrets.encrypt(value);
        }
        return merged;
    }

    /**
     * ANTHROPIC row rules: only `model` is client-editable config; the key
     * must look like a key; and the last-4 hint shown in the UI is set here
     * from the key itself, never taken from the client.
     */
    private prepareAiConfig(config: Record<string, unknown>, secrets: Record<string, unknown>): void {
        const wanted = config.model;
        for (const k of Object.keys(config)) delete config[k];
        if (wanted !== undefined) {
            const model = typeof wanted === "string" ? wanted.trim() : "";
            if (model && !AI_MODEL_FORMAT.test(model)) throw new BadRequestException("That model name isn't valid.");
            config.model = model || null;
        }

        const key = secrets.apiKey;
        if (typeof key === "string" && key.trim()) {
            if (!AI_KEY_FORMAT.test(key.trim())) throw new BadRequestException(AI_KEY_FORMAT_HELP);
            config.keyHint = hint(key.trim());
        } else if (key === null || key === "") {
            config.keyHint = null;
        }
    }

    private async recordTestResult(category: string, existing: SiteConfig | null, result: "success" | "failed", error: string | null, updatedBy: string): Promise<void> {
        await this.prisma.siteConfig.upsert({
            where: { category },
            create: {
                category,
                config: (existing?.config as never) ?? {},
                secrets: (existing?.secrets as never) ?? {},
                last_tested_at: new Date(),
                last_test_result: result,
                last_test_error: error,
                created_by: updatedBy,
                updated_by: updatedBy,
            },
            update: {
                last_tested_at: new Date(),
                last_test_result: result,
                last_test_error: error,
                updated_by: updatedBy,
            },
        });
    }

    private toClientRow(r: SiteConfig) {
        const secrets = (r.secrets as Record<string, unknown>) ?? {};
        return {
            id: r.id.toString(),
            category: r.category,
            isActive: r.is_active,
            config: r.config,
            secretsSet: Object.fromEntries(Object.keys(secrets).map((k) => [k, Boolean(secrets[k])])),
            lastTestedAt: r.last_tested_at ? r.last_tested_at.toISOString() : null,
            lastTestResult: r.last_test_result,
            lastTestError: r.last_test_error,
            createdAt: r.created_at.toISOString(),
            createdBy: r.created_by,
            updatedAt: r.updated_at.toISOString(),
            updatedBy: r.updated_by,
        };
    }
}

/** What went wrong testing a key, in words the owner can act on — never the raw response body. */
export function describeKeyTestError(err: unknown, model: string): string {
    if (err instanceof Anthropic.AuthenticationError) return "Anthropic rejected this key — it is invalid or has been revoked. Copy it again from console.anthropic.com.";
    if (err instanceof Anthropic.PermissionDeniedError) return "This key is valid, but it isn't allowed to use that model.";
    if (err instanceof Anthropic.NotFoundError) return `The model "${model}" wasn't found for this key. Pick another model.`;
    if (err instanceof Anthropic.RateLimitError) return "Anthropic is rate-limiting this key right now. Try again in a minute.";
    if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic (api.anthropic.com). Check the server's internet access and try again.";
    if (err instanceof Anthropic.APIError) return `Anthropic returned an error${err.status ? ` (${err.status})` : ""}. Try again in a minute.`;
    return err instanceof Error ? err.message : String(err);
}
