import { describe, it, expect, vi } from "vitest";
import { ProductionEmailService } from "./production-email.service.js";
import type { ProductionPlan } from "./production-engine.types.js";
import type { MailMessage } from "../mailer/mailer.service.js";

function emptyPlan(overrides: Partial<ProductionPlan> = {}): ProductionPlan {
    return {
        weekday: "MONDAY",
        lines: [],
        rice: { primaryG: 0, secondaryG: 0, batches: 0, spareG: 0, capacityG: 0, noCook: true, breakdown: [] },
        plain: { grams: 0, bowls: 0, batchesKg: 0, low: false, substitutes: "" },
        prep: { karaageBags: 0, karaageSpare: 0, gyoza: [], prawnRolls: 0, prawnPacks: 0, prawnShortfallNote: null },
        defrost: [],
        ...overrides,
    };
}

function build() {
    const tableCache = {
        getAll: vi.fn(async (table: string) => {
            if (table === "product") return [{ product_id: "P1", name: "Chicken Gyoza Platter", plan_group: "Street Food sides", sort_last_in_group: false, campaign_id: null }];
            if (table === "component") return [{ component_id: "C020", name: "Chicken Gyoza Portion", component_type: "GYOZA", units_per_prep_unit: "6" }];
            if (table === "recipe_component") return [{ product_id: "P1", component_id: "C020", qty: 1 }];
            if (table === "campaign") return [];
            if (table === "production_par") return [];
            if (table === "defrost_item") return [];
            if (table === "defrost_par") return [];
            return [];
        }),
    };
    const settings = { get: vi.fn(async () => null), getNumber: vi.fn(async () => null) };
    const enumOptions = { getOptions: vi.fn(async () => []) };
    const mailer = { sendMail: vi.fn(async (_msg: MailMessage) => {}) };
    const prisma = { user: { findUnique: vi.fn(async () => null) } };

    const svc = new ProductionEmailService(prisma as never, tableCache as never, settings as never, enumOptions as never, mailer as never);
    return { svc, mailer };
}

describe("ProductionEmailService — Production Breakdown, Gyoza", () => {
    it("shows the portion count (the sellable/servable unit), not the bag count units_per_prep_unit divides down to", async () => {
        const { svc, mailer } = build();
        // 6 make x 1 qty = 6 portions needed. Dividing by units_per_prep_unit (6 portions/bag) would show "1" — the
        // bug a real client reported ("Street Food - Gyoza ... showing as 1 ... each bag has 6 portions ... should say 6").
        const plan = emptyPlan({ lines: [{ product_id: "P1", name: "Chicken Gyoza Platter", role: "PRIMARY", target: 6, counted: 0, make: 6 }] });

        await svc.sendProductionPlanEmail({ kiosk_id: "K1", name: "Test Kiosk", production_email: "k1@example.com" } as never, new Date("2026-10-05T00:00:00Z"), plan, "");

        const html = mailer.sendMail.mock.calls[0]![0].html as string;
        expect(html).toContain("Chicken Gyoza Portion: 6");
        expect(html).not.toContain("Chicken Gyoza Portion: 1<");
    });
});
