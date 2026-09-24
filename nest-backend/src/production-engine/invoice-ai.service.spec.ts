import { describe, it, expect, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { InvoiceAiService, describeError, invoiceReviewTitle } from "./invoice-ai.service.js";

const textReply = (obj: unknown, stop_reason = "end_turn") => ({ stop_reason, content: [{ type: "text", text: JSON.stringify(obj) }] });

const STOCK = [
    { stock_item_id: "S1", name: "AVOCADO", count_unit: "kg", active: true },
    { stock_item_id: "S2", name: "RICE", count_unit: "kg", active: true },
    { stock_item_id: "S3", name: "RICE PAPER", count_unit: "pack", active: true },
];

function build(opts: { create: ReturnType<typeof vi.fn>; apiKey?: string | null; files?: Record<string, { mimeType: string; size?: number } | null>; maps?: unknown[] }) {
    const upload = {
        read: vi.fn(async (url: string) => {
            const f = opts.files?.[url] === undefined ? { mimeType: "image/jpeg" } : opts.files[url];
            if (!f) throw new NotFoundException("gone");
            return { buffer: Buffer.alloc(f.size ?? 10), mimeType: f.mimeType, name: "x" };
        }),
    };
    const prisma = {
        stockItem: { findMany: vi.fn(async () => STOCK) },
        supplierItemMap: { findMany: vi.fn(async () => opts.maps ?? []) },
    };
    const aiConfig = {
        resolve: async () => ({ apiKey: opts.apiKey === undefined ? "sk-ant-test" : opts.apiKey, model: "claude-sonnet-5", source: "dashboard", keyHint: null }),
        createClient: () => ({ messages: { create: opts.create } }),
    };
    return new InvoiceAiService(aiConfig as never, upload as never, prisma as never);
}

const line = (description_raw: string, extra: Partial<Record<string, unknown>> = {}) => ({ description_raw, supplier_item_code: "", qty: 2, unit_cost: 1.5, line_total: 3, ...extra });

describe("InvoiceAiService.extract", () => {
    it("reads the invoice, then matches every unresolved line in ONE extra request", async () => {
        const create = vi
            .fn()
            .mockResolvedValueOnce(textReply({ lines: [line("Hass avocados 10kg"), line("Sushi rice 5kg"), line("Mystery item")] }))
            .mockResolvedValueOnce(textReply({ matches: [{ index: 0, stock_item_id: "S1" }, { index: 1, stock_item_id: "S2" }, { index: 2, stock_item_id: "NONE" }] }));
        const svc = build({ create });

        const res = await svc.extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.lines.map((l) => l.stock_item_id)).toEqual(["S1", "S2", null]);
        expect(create).toHaveBeenCalledTimes(2); // 1 read + 1 batched match, not 1 + one per line
    });

    it("uses the supplier's own item code without spending an AI call on matching", async () => {
        const create = vi.fn().mockResolvedValueOnce(textReply({ lines: [line("Whatever the supplier calls it", { supplier_item_code: "AV-10" })] }));
        const svc = build({ create, maps: [{ supplier_code: "av-10", supplier_description: null, stock_item_id: "S1" }] });

        const res = await svc.extract([{ url: "/uploads/a", page: 1 }], "SUP1");

        expect(res.ok && res.lines[0]!.stock_item_id).toBe("S1");
        expect(create).toHaveBeenCalledTimes(1);
    });

    it("matches an exact stock name directly, but does not treat a substring as a match", async () => {
        const create = vi
            .fn()
            .mockResolvedValueOnce(textReply({ lines: [line("rice"), line("rice paper sheets")] }))
            .mockResolvedValueOnce(textReply({ matches: [{ index: 0, stock_item_id: "S3" }] })); // only "rice paper sheets" is sent to the AI
        const svc = build({ create });

        const res = await svc.extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok && res.lines.map((l) => l.stock_item_id)).toEqual(["S2", "S3"]);
        const sent = (create.mock.calls[1]![0] as { messages: { content: string }[] }).messages[0]!.content;
        expect(sent).toContain('0: "rice paper sheets"');
        expect(sent).not.toContain('"rice"\n');
    });

    it("keeps the extracted lines even if the matching request fails", async () => {
        const create = vi.fn().mockResolvedValueOnce(textReply({ lines: [line("Mystery item")] })).mockRejectedValueOnce(new Error("boom"));
        const res = await build({ create }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok && res.lines).toHaveLength(1);
        expect(res.ok && res.lines[0]!.stock_item_id).toBeNull();
    });

    it("sanitises garbage numbers instead of storing NaN/negatives", async () => {
        const create = vi.fn().mockResolvedValueOnce(textReply({ lines: [line("rice", { qty: -3, unit_cost: "abc", line_total: 4 })] }));
        const res = await build({ create }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok && res.lines[0]).toMatchObject({ qty: 0, unit_cost: 0, line_total: 4 });
    });

    it("gives the owner a plain sentence for a bad API key, not the raw 401 JSON", async () => {
        const authErr = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, "401 invalid x-api-key", new Headers());
        const res = await build({ create: vi.fn().mockRejectedValue(authErr) }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toContain("Site Configuration");
        expect(res.error).not.toContain("authentication_error");
        expect(res.error).not.toContain("request_id");
    });

    it("reports a truncated answer instead of failing on half a JSON document", async () => {
        const create = vi.fn().mockResolvedValueOnce({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"lines":[{"desc' }] });
        const res = await build({ create }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok === false && res.error).toContain("ran out of room");
    });

    it("says so when an uploaded file is gone from the server, and never calls the AI", async () => {
        const create = vi.fn();
        const res = await build({ create, files: { "/uploads/a": null } }).extract([{ url: "/uploads/a", page: 2 }], null);

        expect(res.ok === false && res.error).toContain("Page 2");
        expect(res.ok === false && res.error).toContain("no longer on the server");
        expect(create).not.toHaveBeenCalled();
    });

    it("refuses file types the AI can't read, and oversized photos, with a clear reason", async () => {
        const create = vi.fn();
        const video = await build({ create, files: { "/uploads/v": { mimeType: "video/mp4" } } }).extract([{ url: "/uploads/v", page: 1 }], null);
        const huge = await build({ create, files: { "/uploads/h": { mimeType: "image/jpeg", size: 6 * 1024 * 1024 } } }).extract([{ url: "/uploads/h", page: 1 }], null);

        expect(video.ok === false && video.error).toContain("can't be read by AI");
        expect(huge.ok === false && huge.error).toContain("over 5 MB");
        expect(create).not.toHaveBeenCalled();
    });

    it("sends PDFs as document blocks and pages in page order", async () => {
        const create = vi.fn().mockResolvedValueOnce(textReply({ lines: [] }));
        const svc = build({ create, files: { "/uploads/p1": { mimeType: "application/pdf" }, "/uploads/p2": { mimeType: "image/png" } } });

        await svc.extract([{ url: "/uploads/p2", page: 2 }, { url: "/uploads/p1", page: 1 }], null);

        const content = (create.mock.calls[0]![0] as { messages: { content: { type: string }[] }[] }).messages[0]!.content;
        expect(content.map((c) => c.type)).toEqual(["document", "image", "text"]);
    });

    it("asks for enough output room for a long invoice", async () => {
        const create = vi.fn().mockResolvedValueOnce(textReply({ lines: [] }));
        await build({ create }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect((create.mock.calls[0]![0] as { max_tokens: number }).max_tokens).toBeGreaterThanOrEqual(16000);
    });
});

describe("which key is used", () => {
    it("explains where to add the key when none is set anywhere, without calling the AI", async () => {
        const create = vi.fn();
        const res = await build({ create, apiKey: null }).extract([{ url: "/uploads/a", page: 1 }], null);

        expect(res.ok === false && res.error).toContain("Site Configuration");
        expect(create).not.toHaveBeenCalled();
    });
});

describe("describeError / invoiceReviewTitle", () => {
    it("maps common vendor failures to owner-readable text", () => {
        const mk = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message: "m" } }, "m", new Headers());
        expect(describeError(mk(429))).toContain("busy");
        expect(describeError(mk(529))).toContain("AI service error (529)");
        expect(describeError(mk(400))).toContain("rejected the request");
        expect(describeError(new Error("plain"))).toBe("plain");
    });

    it("words the Action Inbox title the same way for a first run and a re-run", () => {
        expect(invoiceReviewTitle(true, 3)).toBe("Invoice review: 3 line(s) extracted, ready for review");
        expect(invoiceReviewTitle(true, 0)).toContain("no lines");
        expect(invoiceReviewTitle(false, 0)).toContain("failed");
    });
});
