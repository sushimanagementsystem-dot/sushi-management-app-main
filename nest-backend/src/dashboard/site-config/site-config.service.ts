import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { MailerService, SMTP_CATEGORY, type SmtpConfig } from "../../mailer/mailer.service.js";
import type { SaveSiteConfigDto } from "./dto/save-site-config.dto.js";
import type { TestMailConnectionDto } from "./dto/test-mail-connection.dto.js";
import type { SiteConfig } from "@prisma/client";

/**
 * Site Configuration — one row per config category (`category`: ADMIN,
 * SMTP, ...), edited on its own dashboard page: this is the intended home
 * for any future site-wide integration (WhatsApp, a payment gateway,
 * ...) — adding one is purely additive, a new `category` string plus a
 * `config`/`secrets` JSON shape of its own choosing and a matching page
 * section; no schema/migration is ever needed. Deliberately separate
 * from the `setting` table/page (business logic knobs like rice
 * batching, audit thresholds): this is admin/site-level config.
 *
 * `config` (non-secret) and `secrets` (passwords/tokens/API keys) are
 * two separate JSONB columns — `secrets` is never sent to the frontend at
 * all (see toClientRow), so there's no per-field masking rule that could
 * miss a name. `is_active`/`last_tested_at`/`last_test_result`/
 * `last_test_error` are real columns so consumers like MailerService can
 * filter on them directly, and soft-delete (`deleted_at`/`deleted_by`)
 * keeps a removed category's history instead of losing it outright.
 */
@Injectable()
export class SiteConfigService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly mailer: MailerService,
    ) {}

    async getBootstrapData() {
        const rows = await this.prisma.siteConfig.findMany({ where: { deleted_at: null } });
        return { config: rows.map((r) => this.toClientRow(r)) };
    }

    /** Upserts one category row. `config`/`secrets` merge onto the
     * existing row's values rather than replacing them, so omitting a
     * secret field (a blank password) keeps whatever is already saved. */
    async save(dto: SaveSiteConfigDto, updatedBy: string): Promise<void> {
        const existing = await this.prisma.siteConfig.findUnique({ where: { category: dto.category } });
        const mergedConfig = { ...((existing?.config as Record<string, unknown>) ?? {}), ...dto.config };
        const mergedSecrets = { ...((existing?.secrets as Record<string, unknown>) ?? {}), ...dto.secrets };

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
        this.mailer.invalidate();
    }

    /** Enable/disable a config category without touching its saved
     * data — e.g. temporarily turn off outbound email while keeping the
     * SMTP credentials in place. */
    async setActive(category: string, isActive: boolean, updatedBy: string): Promise<void> {
        await this.prisma.siteConfig.update({
            where: { category },
            data: { is_active: isActive, updated_by: updatedBy },
        });
        this.mailer.invalidate();
    }

    /** Soft-deletes a config category — keeps the row (and its history)
     * instead of losing it outright; save() revives it if re-saved. */
    async delete(category: string, deletedBy: string): Promise<void> {
        await this.prisma.siteConfig.update({
            where: { category },
            data: { deleted_at: new Date(), deleted_by: deletedBy },
        });
        this.mailer.invalidate();
    }

    /** Sends a real test email using whatever SMTP values are currently in
     * the form (saved or not) — a blank password means "use the already
     * saved password". Records the outcome on the SMTP row so it
     * survives a page reload, including the raw error on failure. */
    async testMailConnection(dto: TestMailConnectionDto, updatedBy: string): Promise<void> {
        const existing = await this.prisma.siteConfig.findUnique({ where: { category: SMTP_CATEGORY } });
        let password = dto.password;
        if (!password) {
            password = ((existing?.secrets as Record<string, unknown> | undefined)?.password as string | undefined) ?? "";
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
            await this.recordTestResult(existing, "success", null, updatedBy);
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            await this.recordTestResult(existing, "failed", detail, updatedBy);
            throw new BadRequestException(`Could not send the test email — the SMTP server rejected it (${detail}).`);
        }
    }

    private async recordTestResult(existing: SiteConfig | null, result: "success" | "failed", error: string | null, updatedBy: string): Promise<void> {
        await this.prisma.siteConfig.upsert({
            where: { category: SMTP_CATEGORY },
            create: {
                category: SMTP_CATEGORY,
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
