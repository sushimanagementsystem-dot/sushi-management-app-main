export type Issue = {
    id: string;
    kioskId: string;
    kioskName: string;
    category: "MISSING_TASK" | "STOCK_VARIANCE" | "WASTE_HIGH" | "DAMAGE_HIGH";
    severity: "high" | "warn";
    title: string;
    /** YYYY-MM-DD this issue is dated to — the day a point-in-time check
     * (missing task, rate outlier) was evaluated as of, or the specific day a
     * stock variance actually happened. Drives the newest-first sort. */
    date: string;
};
