import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { PrismaService } from "../prisma/prisma.service.js";
import { SecretsService } from "../secrets/secrets.service.js";

/** site_config.category this service owns — edited on the Site Configuration dashboard page. */
export const AI_CATEGORY = "ANTHROPIC";
export const DEFAULT_AI_MODEL = "claude-sonnet-5";
const CACHE_MS = 60_000;

export type KeySource = "dashboard" | "environment" | "none";
export type ResolvedAiConfig = { apiKey: string | null; model: string; source: KeySource; keyHint: string | null };

/**
 * Where the Anthropic (Claude) API key and model come from. In order:
 *   1. the key an owner saved on Dashboard → Site Configuration → AI (Claude)
 *      (stored encrypted — see SecretsService — and only if that section is Active),
 *   2. the ANTHROPIC_API_KEY environment variable (the original way — still
 *      works, so nothing breaks for a deployment that never opens the page).
 * The model is the dashboard's choice, else INVOICE_AI_MODEL, else the default.
 *
 * Cached for a minute and dropped whenever Site Configuration is written
 * (invalidate()), so a saved key applies to the next request — and the TTL
 * covers a second server instance that didn't see the save.
 */
@Injectable()
export class AnthropicConfigService {
    private readonly logger = new Logger(AnthropicConfigService.name);
    private cache: { at: number; value: ResolvedAiConfig } | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly secrets: SecretsService,
        private readonly config: ConfigService,
    ) {}

    invalidate(): void {
        this.cache = null;
    }

    async resolve(): Promise<ResolvedAiConfig> {
        if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
        const value = await this.load();
        this.cache = { at: Date.now(), value };
        return value;
    }

    /** Never includes the key itself — safe to send to the dashboard. */
    async status(): Promise<{ source: KeySource; keyHint: string | null; model: string }> {
        const { source, keyHint, model } = await this.resolve();
        return { source, keyHint, model };
    }

    /** One place that builds the SDK client, so tests (and any future proxy/base-URL setting) have a single seam. */
    createClient(apiKey: string): Anthropic {
        return new Anthropic({ apiKey });
    }

    private async load(): Promise<ResolvedAiConfig> {
        const row = await this.prisma.siteConfig.findUnique({ where: { category: AI_CATEGORY } });
        const rowUsable = Boolean(row && row.is_active && !row.deleted_at);
        const rowConfig = (rowUsable ? (row!.config as Record<string, unknown>) : {}) ?? {};
        const model = (typeof rowConfig.model === "string" && rowConfig.model) || this.config.get<string>("INVOICE_AI_MODEL") || DEFAULT_AI_MODEL;

        const stored = rowUsable ? ((row!.secrets as Record<string, unknown> | null)?.apiKey as string | undefined) : undefined;
        if (stored) {
            try {
                const apiKey = this.secrets.decrypt(stored);
                return { apiKey, model, source: "dashboard", keyHint: typeof rowConfig.keyHint === "string" ? rowConfig.keyHint : hint(apiKey) };
            } catch (err) {
                // Unreadable (encryption key changed): behave as "not saved" and fall through to the environment key.
                this.logger.warn(`Saved Anthropic key could not be decrypted — falling back to the environment key. ${err instanceof Error ? err.message : err}`);
            }
        }

        const envKey = this.config.get<string>("ANTHROPIC_API_KEY");
        if (envKey) return { apiKey: envKey, model, source: "environment", keyHint: hint(envKey) };
        return { apiKey: null, model, source: "none", keyHint: null };
    }
}

/** "…a1b2" — enough to tell two keys apart, useless for using one. */
export function hint(apiKey: string): string {
    return "…" + apiKey.slice(-4);
}
