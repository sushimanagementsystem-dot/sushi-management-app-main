import type { Component, RecipeComponent } from "@prisma/client";

export type PlanLine = {
    product_id: string;
    name: string;
    role: string | null;
    target: number;
    counted: number;
    make: number;
    cap?: number; // set by the secondary allocator only
};

export type ComponentNeed = Record<string, { total: number; primary: number }>;

export type RecipeMap = Record<string, RecipeComponent[]>;
export type ComponentMap = Record<string, Component>;

export type ProductionHistory = Record<string, { totalQty: number; lastDate: string }>;

export type PrawnKatsuResult = {
    lines: PlanLine[];
    bags: number;
    prepRolls: number;
    spare: number;
    shortfallNote: string | null;
};

export type ProductionPlan = {
    weekday: string;
    lines: PlanLine[];
    rice: {
        primaryG: number;
        secondaryG: number;
        batches: number;
        spareG: number;
        capacityG: number;
        noCook: boolean;
        /** Primary-only breakdown of primaryG by component type (MAKI/ROLL/NIGIRI/DIRECT_SUSHI_RICE) — same inputs that decide `batches`, for showing staff how the total was reached. */
        breakdown: { type: string; count: number; gPerUnit: number; grams: number }[];
    };
    plain: {
        grams: number;
        bowls: number;
        batchesKg: number;
        low: boolean;
        substitutes: string;
    };
    prep: {
        karaageBags: number;
        karaageSpare: number;
        gyoza: { name: string; portions: number; bags: number }[];
        prawnRolls: number;
        prawnPacks: number;
        prawnShortfallNote: string | null;
    };
    defrost: { name: string; qty: number; unit: string | null }[];
};

export const isPrimary = (role: string | null): boolean => role === "PRIMARY" || role === "SEASONAL_PRIMARY";
export const SECONDARY_ROLES = ["SECONDARY", "SEASONAL_SECONDARY"];
