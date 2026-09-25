import { describe, it, expect } from "vitest";
import { explainUserBlockers, type UserHistoryCounts } from "./staff-removal.js";

const NONE: UserHistoryCounts = { submissions: 0, transfers: 0, staffFood: 0, requests: 0, weeklySales: 0, auditCorrections: 0, assignedActions: 0, activity: 0 };
const staff = { name: "Sam", role: "STAFF", active: false, isSelf: false, otherActiveAdmins: 1 };

describe("explainUserBlockers", () => {
    it("allows deleting someone with no history at all", () => {
        expect(explainUserBlockers(staff, NONE)).toBeNull();
    });
    it("refuses, and lists what they did, when the person has history; points at Active = off", () => {
        const msg = explainUserBlockers(staff, { ...NONE, submissions: 12, staffFood: 1 })!;
        expect(msg).toContain("Sam can't be deleted");
        expect(msg).toContain("12 form submissions, 1 staff food record");
        expect(msg).toContain("Set them to inactive instead");
    });
    it("pluralises correctly, including entries", () => {
        expect(explainUserBlockers(staff, { ...NONE, activity: 9, weeklySales: 1 })).toContain("1 weekly sales entry, 9 activity log entries");
    });
    it("never lets you delete yourself", () => {
        expect(explainUserBlockers({ ...staff, isSelf: true }, NONE)).toContain("your own account");
    });
    it("never deletes the last active admin, but can delete an admin when another remains", () => {
        expect(explainUserBlockers({ ...staff, role: "ADMIN", active: true, otherActiveAdmins: 0 }, NONE)).toContain("last active admin");
        expect(explainUserBlockers({ ...staff, role: "ADMIN", active: true, otherActiveAdmins: 1 }, NONE)).toBeNull();
    });
});
