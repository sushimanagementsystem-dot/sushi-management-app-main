import { Injectable, Logger } from "@nestjs/common";
import { AuditResultService } from "./audit-result.service.js";
import { UploadService } from "../../upload/upload.service.js";
import { MailerService } from "../../mailer/mailer.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import type { Kiosk } from "@prisma/client";

function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Emails the finished Audit Result — score, rating, photos, applicable
 * corrections, same scope as the dashboard's own Audit Result page (see
 * that page's "nothing else" comment) — to the kiosk's production_email.
 * Called from AuditReviewService only once review_status first reaches
 * FULLY_REVIEWED: the owner's own review is the gate the client asked
 * for, not the staff submission.
 */
@Injectable()
export class AuditReportEmailService {
    private readonly logger = new Logger(AuditReportEmailService.name);

    constructor(
        private readonly auditResult: AuditResultService,
        private readonly upload: UploadService,
        private readonly mailer: MailerService,
        private readonly tableCache: TableCacheService,
    ) {}

    async sendAuditReportEmail(auditResponseId: string, kioskId: string): Promise<void> {
        const result = await this.auditResult.bootstrap(auditResponseId);
        const kiosks = await this.tableCache.getAll<Kiosk>("kiosk");
        const kiosk = kiosks.find((k) => k.kiosk_id === kioskId);
        if (!kiosk?.production_email) throw new Error("Kiosk has no production_email.");

        const attachments: { filename: string; content: Buffer; contentType?: string; cid: string }[] = [];
        const photoCids = new Map<string, string>();
        for (const p of result.photos) {
            try {
                const file = await this.upload.read(p.url);
                const cid = `audit-photo-${p.auditAnswerId}`;
                attachments.push({ filename: file.name, content: file.buffer, contentType: file.mimeType, cid });
                photoCids.set(p.auditAnswerId, cid);
            } catch (err) {
                // A missing/unreadable photo must never block the whole report — it just shows without that image.
                this.logger.warn(`Could not attach evidence photo for audit answer ${p.auditAnswerId}: ${err instanceof Error ? err.message : err}`);
            }
        }

        await this.mailer.sendMail({
            to: kiosk.production_email,
            subject: `Monthly Audit Result - ${result.kioskName} - ${result.auditDate}: ${result.finalRating} (${result.finalScore}%)`,
            html: this.renderHtml(result, photoCids),
            attachments,
        });
    }

    private renderHtml(res: Awaited<ReturnType<AuditResultService["bootstrap"]>>, photoCids: Map<string, string>): string {
        const ratingColor = res.finalRating === "PASS" ? "#188038" : res.finalRating === "ATTENTION" ? "#f0a800" : "#d93025";
        const ratingBg = res.finalRating === "PASS" ? "#e6f4ea" : res.finalRating === "ATTENTION" ? "#fff8e1" : "#fdecea";

        let html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1c2430;max-width:640px">`;
        html += `<h1 style="font-size:22px;font-weight:700;margin:0 0 2px">Monthly Audit Result</h1>`;
        html += `<p style="color:#444;margin:0 0 14px"><b>${escapeHtml(res.kioskName)}</b> — ${res.auditDate}</p>`;

        html += `<div style="background:${ratingBg};border-left:4px solid ${ratingColor};padding:12px 16px;margin:12px 0;border-radius:4px">`;
        html += `<span style="font-size:28px;font-weight:700">${res.finalScore}%</span>`;
        html += ` <span style="font-size:15px;font-weight:700;color:${ratingColor}">${res.finalRating}</span>`;
        html += `</div>`;

        if (res.corrections.length) {
            html += `<h2 style="font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:3px;margin:18px 0 8px">Applicable corrections</h2>`;
            for (const c of res.corrections) {
                const closed = c.status === "RESOLVED" || !!c.closedAt;
                html += `<div style="border-left:3px solid ${closed ? "#188038" : "#d93025"};background:#f7f8f9;padding:10px 14px;margin:8px 0;border-radius:4px">`;
                html += `<div style="font-weight:700">${escapeHtml(c.questionText)}${c.critical ? ` <span style="color:#d93025;font-size:12px">CRITICAL</span>` : ""}</div>`;
                html += `<div style="color:#666;font-size:12px">${escapeHtml(c.sectionName)}</div>`;
                if (c.ownerNote) html += `<p style="margin:5px 0">${escapeHtml(c.ownerNote)}</p>`;
                html += `<div style="color:#888;font-size:12px;margin-top:4px">${closed ? "Closed " + (c.closedAt || "") : "Deadline " + (c.deadline || "—")}</div>`;
                html += `</div>`;
            }
        }

        html += `<h2 style="font-size:16px;font-weight:700;border-bottom:2px solid #333;padding-bottom:3px;margin:18px 0 8px">Photos</h2>`;
        if (!res.photos.length) {
            html += `<p style="margin:5px 0">No evidence photos were attached to this audit.</p>`;
        } else {
            for (const p of res.photos) {
                const cid = photoCids.get(p.auditAnswerId);
                html += `<div style="margin:10px 0">`;
                if (cid) html += `<img src="cid:${cid}" style="max-width:280px;display:block;border-radius:6px;margin-bottom:4px" />`;
                html += `<div style="font-size:13px;font-weight:600">${escapeHtml(p.questionText)}</div>`;
                html += `<div style="font-size:12px;color:#666">${escapeHtml(p.sectionName)}${p.outcome ? " — " + p.outcome : ""}</div>`;
                html += `</div>`;
            }
        }

        html += `</div>`;
        return html;
    }
}
