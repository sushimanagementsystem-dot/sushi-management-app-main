type DraftLine = { description_raw: string | null; stock_item_id: string | null; qty: unknown; unit_cost: unknown };

/**
 * Everything that stops a DRAFT invoice line from being approved — every line, every problem, at once, so the
 * owner fixes them all in one pass instead of finding them one confirm-click at a time.
 */
export function invoiceConfirmProblems(lines: DraftLine[]): string[] {
    const problems: string[] = [];
    for (const l of lines) {
        const name = (l.description_raw ?? "").trim() || "(line without a description)";
        const fixes: string[] = [];
        if (!l.stock_item_id) fixes.push("pick the matching stock item");
        const qty = Number(l.qty);
        if (!Number.isFinite(qty) || qty <= 0) fixes.push("enter a quantity above 0");
        const unitCost = l.unit_cost === null || l.unit_cost === undefined ? NaN : Number(l.unit_cost);
        if (!Number.isFinite(unitCost) || unitCost < 0) fixes.push("enter the unit cost");
        if (fixes.length) problems.push(`• "${name}": ${fixes.join(", ")}`);
    }
    return problems;
}

/** The message shown to the owner when Confirm is refused. First line is a sentence, then one bullet per line. */
export function invoiceConfirmMessage(problems: string[]): string {
    const n = problems.length;
    return [`${n === 1 ? "1 line needs" : `${n} lines need`} attention before this invoice can be confirmed:`, ...problems, "", "Click Edit lines, choose the stock item (and fill any missing quantity or cost) for each one, press Save, then press Confirm again."].join("\n");
}
