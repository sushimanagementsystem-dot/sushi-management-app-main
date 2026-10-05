import { describe, it, expect, vi } from "vitest";
import { AuditReportEmailService } from "./audit-report-email.service.js";
import type { MailMessage } from "../../mailer/mailer.service.js";

function build(overrides: { result?: Record<string, unknown>; kiosk?: Record<string, unknown> | null } = {}) {
    const result = {
        auditResponseId: "R1",
        kioskName: "Kiosk One",
        auditDate: "2026-10-04",
        reviewStatus: "FULLY_REVIEWED",
        finalScore: 92.5,
        finalRating: "PASS",
        photos: [{ auditAnswerId: "A1", url: "/uploads/abc", questionText: "Floors clean?", sectionName: "Hygiene", outcome: "PASS" }],
        corrections: [],
        ...overrides.result,
    };
    const kiosk = overrides.kiosk === undefined ? { kiosk_id: "K1", production_email: "kiosk1@example.com" } : overrides.kiosk;

    const auditResult = { bootstrap: vi.fn(async () => result) };
    const upload = { read: vi.fn(async () => ({ buffer: Buffer.from("fake-image-bytes"), mimeType: "image/jpeg", name: "evidence.jpg" })) };
    const mailer = { sendMail: vi.fn(async (_msg: MailMessage) => {}) };
    const tableCache = { getAll: async () => (kiosk ? [kiosk] : []) };

    const svc = new AuditReportEmailService(auditResult as never, upload as never, mailer as never, tableCache as never);
    return { svc, auditResult, upload, mailer, result, kiosk };
}

describe("AuditReportEmailService", () => {
    it("throws when the kiosk has no production_email, before touching the mailer", async () => {
        const { svc, mailer } = build({ kiosk: { kiosk_id: "K1", production_email: null } });
        await expect(svc.sendAuditReportEmail("R1", "K1")).rejects.toThrow("production_email");
        expect(mailer.sendMail).not.toHaveBeenCalled();
    });

    it("sends to the kiosk's production_email, with every photo as an inline cid attachment", async () => {
        const { svc, mailer, upload } = build();
        await svc.sendAuditReportEmail("R1", "K1");
        expect(upload.read).toHaveBeenCalledWith("/uploads/abc");
        expect(mailer.sendMail).toHaveBeenCalledTimes(1);
        const call = mailer.sendMail.mock.calls[0]![0];
        expect(call.to).toBe("kiosk1@example.com");
        expect(call.subject).toContain("Kiosk One");
        expect(call.subject).toContain("PASS");
        expect(call.attachments).toHaveLength(1);
        expect(call.attachments![0]!.cid).toBe("audit-photo-A1");
        expect(call.html).toContain("cid:audit-photo-A1");
    });

    it("still sends the report if one photo fails to read — it just shows without that image", async () => {
        const { svc, mailer, upload } = build();
        upload.read.mockRejectedValueOnce(new Error("not found"));
        await svc.sendAuditReportEmail("R1", "K1");
        expect(mailer.sendMail).toHaveBeenCalledTimes(1);
        const call = mailer.sendMail.mock.calls[0]![0];
        expect(call.attachments).toHaveLength(0);
        expect(call.html).not.toContain("cid:");
    });

    it("includes applicable corrections in the email body", async () => {
        const { svc, mailer } = build({
            result: {
                corrections: [{ questionText: "Fire extinguisher checked?", sectionName: "Safety", critical: true, ownerNote: "Replace unit", status: null, deadline: "2026-10-06", closedAt: null }],
            },
        });
        await svc.sendAuditReportEmail("R1", "K1");
        const call = mailer.sendMail.mock.calls[0]![0];
        expect(call.html).toContain("Fire extinguisher checked?");
        expect(call.html).toContain("Replace unit");
        expect(call.html).toContain("CRITICAL");
    });
});
