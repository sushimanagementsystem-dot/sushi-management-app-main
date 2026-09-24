import { Injectable, Logger } from "@nestjs/common";
import nodemailer, { type Transporter } from "nodemailer";
import { PrismaService } from "../prisma/prisma.service.js";
import { SecretsService } from "../secrets/secrets.service.js";

export type MailMessage = {
    to: string;
    cc?: string;
    subject: string;
    html: string;
};

export type SmtpConfig = {
    host: string;
    port: number;
    /** true = TLS from connect (port 465), false = STARTTLS (port 587). */
    secure: boolean;
    username: string;
    password: string;
    fromName: string;
    fromEmail: string;
};

/** site_config.category this service owns. */
export const SMTP_CATEGORY = "SMTP";

/**
 * Real outbound email — generic SMTP, fully driven by the single `SMTP`
 * row in `site_config` (host/port/TLS mode/username/from name/from email
 * in that row's `config` JSON; the password in its `secrets` JSON),
 * editable by the owner on the Site Configuration dashboard page. No SMTP
 * provider or
 * credential is hardcoded/env-only here — the admin picks the sending
 * account themselves (Gmail, Office365, any SMTP relay) and can change it
 * without a redeploy. `is_active` lets the admin disable outbound email
 * without losing the saved credentials.
 *
 * The transporter is built lazily on first send and cached; SiteConfigService
 * calls invalidate() after every save so a config change takes effect on
 * the very next email without a server restart.
 *
 * If unconfigured, sendMail() throws rather than silently dropping the
 * message — callers (ProductionEmailService, DeveloperNotifyService)
 * already handle a thrown error the same way the old system handled a
 * mail-send failure: record it, degrade gracefully, never lose the
 * underlying data write.
 */
@Injectable()
export class MailerService {
    private readonly logger = new Logger(MailerService.name);
    private transporter: Transporter | null = null;
    private config: SmtpConfig | null = null;
    private loaded = false;

    constructor(
        private readonly prisma: PrismaService,
        private readonly secrets: SecretsService,
    ) {}

    /** Call after any write to the SMTP `site_config` row. */
    invalidate(): void {
        this.loaded = false;
        this.transporter = null;
        this.config = null;
    }

    async isConfigured(): Promise<boolean> {
        await this.ensureLoaded();
        return this.transporter !== null;
    }

    async sendMail(message: MailMessage): Promise<void> {
        await this.ensureLoaded();
        if (!this.transporter || !this.config) {
            throw new Error("Email is not configured — set up SMTP on the Site Configuration page.");
        }
        await this.transporter.sendMail({
            from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            html: message.html,
        });
    }

    /** Sends a one-off test email with the given (possibly unsaved) SMTP
     * config — backs the Site Configuration page's "Send test email",
     * which verifies whatever is currently in the form before it's saved.
     * Independent of the cached transporter sendMail() uses. */
    async sendTestMail(config: SmtpConfig, to: string): Promise<void> {
        const transporter = buildTransporter(config);
        await transporter.sendMail({
            from: `"${config.fromName}" <${config.fromEmail}>`,
            to,
            subject: "Test email — SMTP connection check",
            html: "<p>This is a test email confirming your SMTP settings are working.</p>",
        });
    }

    private async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        this.loaded = true;
        const row = await this.prisma.siteConfig.findUnique({ where: { category: SMTP_CATEGORY } });
        if (!row || !row.is_active || row.deleted_at) {
            this.logger.warn("SMTP is not configured (or is turned off) on the Site Configuration page — outbound email is disabled.");
            return;
        }
        const config = row.config as Record<string, unknown>;
        const secrets = (row.secrets as Record<string, unknown> | null) ?? {};
        const host = config.host as string | undefined;
        const port = config.port as number | undefined;
        const username = config.username as string | undefined;
        let password: string | undefined;
        try {
            // Stored encrypted (see SecretsService); a password saved before that existed is plaintext and passes through.
            password = typeof secrets.password === "string" && secrets.password ? this.secrets.decrypt(secrets.password) : undefined;
        } catch (err) {
            this.logger.warn(`${err instanceof Error ? err.message : err} Outbound email is disabled until the SMTP password is entered again.`);
            return;
        }
        const fromEmail = (config.fromEmail as string | undefined) || username;
        const fromName = (config.fromName as string | undefined) || "Sushi Kiosk System";
        const secure = Boolean(config.secure);

        if (!host || !port || !username || !password || !fromEmail) {
            this.logger.warn("SMTP is not fully configured on the Site Configuration page — outbound email is disabled.");
            return;
        }
        this.config = { host, port, secure, username, password, fromName, fromEmail };
        this.transporter = buildTransporter(this.config);
    }
}

function buildTransporter(config: SmtpConfig): Transporter {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.username, pass: config.password },
    });
}
