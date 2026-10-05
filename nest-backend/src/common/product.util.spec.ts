import { describe, it, expect } from "vitest";
import { isProductInProduction } from "./product.util.js";

describe("isProductInProduction", () => {
    it("is true for an active product with a normal production role", () => {
        expect(isProductInProduction({ active: true, production_role: "PRIMARY" })).toBe(true);
        expect(isProductInProduction({ active: true, production_role: null })).toBe(true);
    });

    it("is false once Production Role is set to Retired, regardless of Active", () => {
        expect(isProductInProduction({ active: true, production_role: "RETIRED" })).toBe(false);
        expect(isProductInProduction({ active: false, production_role: "RETIRED" })).toBe(false);
    });

    it("is false when simply inactive", () => {
        expect(isProductInProduction({ active: false, production_role: "PRIMARY" })).toBe(false);
    });
});
