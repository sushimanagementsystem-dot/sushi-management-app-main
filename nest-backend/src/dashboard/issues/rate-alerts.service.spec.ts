import { describe, it, expect } from "vitest";
import { RateAlertsService } from "./rate-alerts.service.js";
import { WasteRateService } from "../kpi/waste-rate.service.js";

const ASOF = new Date(Date.UTC(2026, 8, 24));
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const addDaysStr = (s: string, n: number) => new Date(d(s).getTime() + n * 864e5).toISOString().slice(0, 10);

type Plan = { kiosk_id: string; product_id: string; business_date: Date; planned_qty: number };
type Move = { kiosk_id: string; product_id: string; attributed_production_date: Date | null; movement_date: Date; qty: number };

/** One kiosk plans `perDay` units of product P1 on each day in [from, to]. */
function plansFor(kiosk: string, from: string, to: string, perDay: number, product = "P1"): Plan[] {
    const out: Plan[] = [];
    for (let day = from; day <= to; day = addDaysStr(day, 1)) out.push({ kiosk_id: kiosk, product_id: product, business_date: d(day), planned_qty: perDay });
    return out;
}
const waste = (kiosk: string, producedOn: string, qty: number, product = "P1"): Move => ({
    kiosk_id: kiosk,
    product_id: product,
    attributed_production_date: d(producedOn),
    movement_date: d(addDaysStr(producedOn, 2)),
    qty,
});
const daily = (kiosk: string, from: string, days: number, qty: number) => Array.from({ length: days }, (_, i) => waste(kiosk, addDaysStr(from, i), qty));

function build(plans: Plan[], wasteRows: Move[], kiosks = ["K01", "K02"]) {
    const prisma = {
        productionPlan: { findMany: async () => plans },
        productMovement: { findMany: async ({ where }: { where: { movement_type: string } }) => (where.movement_type === "EXPIRED_WASTE" ? wasteRows : []) },
    };
    const cache = {
        getAll: async (t: string) => (t === "kiosk" ? kiosks.map((id) => ({ kiosk_id: id, name: `Kiosk ${id}`, active: true })) : [{ product_id: "P1", shelf_life_days: 2 }]),
    };
    const settings = { getNumber: async () => 2 };
    return new RateAlertsService(cache as never, new WasteRateService(prisma as never, cache as never, settings as never));
}

// asOf 09-24, shelf life 2: recent production days 09-15..09-21, usual 08-18..09-14.
const HISTORY_START = "2026-08-18";
const RECENT_START = "2026-09-15";
const RECENT_END = "2026-09-21";

describe("RateAlertsService", () => {
    it("flags a kiosk whose waste is clearly above its OWN usual level, and says so in units", async () => {
        const plans = plansFor("K01", HISTORY_START, RECENT_END, 20);
        const usual = daily("K01", HISTORY_START, 28, 1); // 28 of 560 = 5%
        const spike = daily("K01", RECENT_START, 7, 5); // 35 of 140 = 25%
        const issues = await build(plans, [...usual, ...spike]).findOutliers(ASOF);

        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ kioskId: "K01", category: "WASTE_HIGH", date: "2026-09-24" });
        expect(issues[0]!.title).toContain("35 of 140 planned units");
        expect(issues[0]!.title).toContain("usual for this kiosk");
    });

    it("ignores waste that has no planned production to be measured against", async () => {
        // K01 has no plan on 09-17 (fridge count missed) yet 30 units of waste are attributed to that day.
        const plans = [...plansFor("K01", HISTORY_START, "2026-09-16", 20), ...plansFor("K01", "2026-09-18", RECENT_END, 20)];
        const issues = await build(plans, [...daily("K01", HISTORY_START, 28, 1), waste("K01", "2026-09-17", 30)]).findOutliers(ASOF);
        expect(issues).toEqual([]);
    });

    it("does not count production days whose waste is not all in yet", async () => {
        // A big plan on 09-22/23 with no waste booked yet must not dilute the recent rate.
        const plans = [...plansFor("K01", HISTORY_START, RECENT_END, 20), ...plansFor("K01", "2026-09-22", "2026-09-23", 500)];
        const [issue] = await build(plans, [...daily("K01", HISTORY_START, 28, 1), ...daily("K01", RECENT_START, 7, 5)]).findOutliers(ASOF);
        expect(issue!.title).toContain("35 of 140 planned units");
    });

    it("compares against the other kiosks (never itself) when a kiosk has no history of its own", async () => {
        const plans = [...plansFor("K01", RECENT_START, RECENT_END, 20), ...plansFor("K02", HISTORY_START, RECENT_END, 20)];
        const issues = await build(plans, [...daily("K02", HISTORY_START, 28, 1), ...daily("K01", RECENT_START, 7, 5)]).findOutliers(ASOF);

        expect(issues).toHaveLength(1);
        expect(issues[0]!.kioskId).toBe("K01");
        expect(issues[0]!.title).toContain("at the other kiosks");
    });

    it("reports nothing when there is not enough recorded data", async () => {
        expect(await build([], []).findOutliers(ASOF)).toEqual([]);
    });
});
