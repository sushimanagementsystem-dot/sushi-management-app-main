import * as XLSX from "xlsx";

export type OrderLine = { stockItemId: string; recommendedPacks: number; recommendedQty: number; packSize: number; flags: string[] };
export type OrderItemInfo = { name: string; countUnit: string; supplierCode: string; supplierDescription: string; caseUnit: string; sellingUnit: string; price: number | null };
export type OrderSupplier = { name: string; contactEmail: string | null; orderOutputMethod: string; orderSheetTemplate: string | null };
export type OrderEmail = { subject: string; html: string; attachments: { filename: string; content: Buffer; contentType: string }[] };

/** Suppliers whose order goes out as a filled Excel order sheet; every other non-MANUAL method is a plain "what to order" message. */
export const ORDER_SHEET_METHOD = "ORDER_SHEET";
export const isOrderSheet = (method: string | null | undefined) => method === ORDER_SHEET_METHOD;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

function note(flags: string[], staleDays: number): string {
    return flags
        .map((f) => (f === "STALE" ? `stock count is more than ${staleDays} days old` : f === "FIXED_ORDER_QTY" ? "standing order: fixed boxes per kiosk" : f))
        .join("; ");
}

type Row = { code: string; item: string; packs: number; pack: string; qty: string; sellingUnit: string; price: number | null; note: string };

function rowsOf(lines: OrderLine[], items: Map<string, OrderItemInfo>, staleDays: number): Row[] {
    return lines
        .map((l) => {
            const info = items.get(l.stockItemId);
            const unit = info?.countUnit ?? "";
            return {
                code: info?.supplierCode ?? "",
                item: info?.supplierDescription || info?.name || l.stockItemId,
                packs: l.recommendedPacks,
                pack: info?.caseUnit || (l.packSize > 1 ? `${num(l.packSize)} ${unit}` : unit),
                qty: `${num(l.recommendedQty)} ${unit}`.trim(),
                sellingUnit: info?.sellingUnit || unit,
                price: info?.price ?? null,
                note: note(l.flags, staleDays),
            };
        })
        .sort((a, b) => a.item.localeCompare(b.item));
}

function sheetFromRows(sheetName: string, headerRows: unknown[][], data: unknown[][], colWidths: number[]): Buffer {
    const ws = XLSX.utils.aoa_to_sheet([...headerRows, ...data]);
    ws["!cols"] = colWidths.map((wch) => ({ wch }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Generic fallback layout, used for any ORDER_SHEET supplier without one of the exact templates below. */
function buildGenericSheet(rows: Row[]): Buffer {
    const data = [["Supplier code", "Item", "Pack", "Packs to order", "Total quantity", "Notes"], ...rows.map((r) => [r.code, r.item, r.pack, r.packs, r.qty, r.note])];
    return sheetFromRows("Order", [], data, [14, 46, 14, 14, 16, 40]);
}

/** Tazaki's own order form — the only layout they accept (used identically across every kiosk of theirs, not just ours). */
function buildTazakiSheet(contactEmail: string | null, rows: Row[]): Buffer {
    const headerRows = [
        ["Tazaki Foods Order Sheet", "", "Tazaki Foods Order Email", "", contactEmail ?? "", "", ""],
        ["Item Code", "Item Description", "Selling UoM", "Case UoM", "Price", "Quantity", "Subtotal"],
    ];
    const data = rows.map((r) => [r.code, r.item, r.sellingUnit, r.pack, r.price ?? "", r.packs, r.price !== null ? Math.round(r.price * r.packs * 100) / 100 : ""]);
    return sheetFromRows("Order Sheet", headerRows, data, [12, 46, 12, 12, 10, 10, 12]);
}

/** Asia Market's own order template — same reasoning as Tazaki. */
function buildAsiaMarketSheet(rows: Row[]): Buffer {
    const headerRows = [["Product", "Product code", "Price per case", "QTY ordered", "€"]];
    const data = rows.map((r) => [r.item, r.code, r.price ?? "", r.packs, r.price !== null ? Math.round(r.price * r.packs * 100) / 100 : ""]);
    return sheetFromRows("Sheet1", headerRows, data, [46, 14, 14, 14, 12]);
}

/** Castlebay's own order form — "Name of Store" and "Delivery Week Beginning" are filled per kiosk/run; their reference "Stores" list isn't ours to fill and isn't copied here (the sheet suppliers forward only this one tab). */
function buildCastlebaySheet(kioskName: string, deliveryWeekStart: string, rows: Row[]): Buffer {
    const headerRows: unknown[][] = [
        ["CastleBay Trading Order Sheet", "", "", "", ""],
        [],
        ["Delivery Week Beginning", deliveryWeekStart, "", "", ""],
        [],
        ["Name of Store", kioskName, "", "", ""],
        [],
        ["Supplier product  Name", "Case", "Unit ", "Cost", "Quantity Required"],
    ];
    const data = rows.map((r) => [r.item, r.pack, r.sellingUnit, r.price ?? "", r.qty]);
    return sheetFromRows("Order Sheet", headerRows, data, [40, 16, 10, 12, 18]);
}

/**
 * The order as an .xlsx: one row per item, quantities filled in from the par levels, ready to be reviewed and sent
 * on. Dispatches to the exact template a supplier requires, falling back to a generic layout otherwise.
 * supplierStoreName: the kiosk's name as registered with THIS supplier (Kiosk.supplier_store_name, falling back
 * to our own kiosk name) — only used where the sheet itself names the store (Castlebay); never the internal name
 * used for the email subject/filename, which can differ from what the supplier has on file.
 */
export function buildOrderSheet(supplier: OrderSupplier, lines: OrderLine[], items: Map<string, OrderItemInfo>, staleDays: number, supplierStoreName: string, deliveryWeekStart: string): Buffer {
    const rows = rowsOf(lines, items, staleDays);
    switch (supplier.orderSheetTemplate) {
        case "TAZAKI":
            return buildTazakiSheet(supplier.contactEmail, rows);
        case "ASIA_MARKET":
            return buildAsiaMarketSheet(rows);
        case "CASTLEBAY":
            return buildCastlebaySheet(supplierStoreName, deliveryWeekStart, rows);
        default:
            return buildGenericSheet(rows);
    }
}

/**
 * The email that goes to the OWNER (never to the supplier): the drafted order to review and forward, one kiosk at a
 * time (the subject and filename both carry the kiosk name — multiple kiosks' stocktakes can land the same day,
 * so there'd otherwise be no way to tell whose order is whose). Sheet suppliers also get the Excel order sheet
 * attached, built in their own exact required layout; everyone else gets just the message listing what to order.
 */
export function buildOrderEmail(
    supplier: OrderSupplier,
    lines: OrderLine[],
    items: Map<string, OrderItemInfo>,
    date: string,
    staleDays: number,
    kioskName: string,
    supplierStoreName: string,
    deliveryWeekStart: string,
): OrderEmail {
    const rows = rowsOf(lines, items, staleDays);
    const sheet = isOrderSheet(supplier.orderOutputMethod);
    const table = `<table style="border-collapse:collapse;font-size:14px"><thead><tr>${["Code", "Item", "Order", "Pack", "Total", "Notes"]
        .map((h) => `<th style="text-align:left;border-bottom:2px solid #ccc;padding:4px 10px">${h}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${[esc(r.code), esc(r.item), `<b>${r.packs}</b>`, esc(r.pack), esc(r.qty), esc(r.note)].map((c) => `<td style="border-bottom:1px solid #eee;padding:4px 10px">${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    const sendTo = supplier.contactEmail ? `Send to: <b>${esc(supplier.contactEmail)}</b>` : "No supplier email is saved for this supplier yet (add one on the Supplier table).";
    const html = `<div style="font-family:Arial,sans-serif;color:#222">
<p>Order drafted for <b>${esc(supplier.name)}</b> — <b>${esc(kioskName)}</b> (${esc(date)}), from the latest stocktake and the par levels. Nothing has been sent to the supplier.</p>
<p>${sendTo}</p>
${sheet ? "<p>The order sheet is attached: review it, then send it on.</p>" : "<p>Review the list below, then send it on.</p>"}
${table}
<p style="color:#666;font-size:12px">${rows.length} item(s). Set in Data Tables: Supplier, Supplier Items and Stock Item Par.</p>
</div>`;
    const attachments = sheet
        ? [{ filename: `Order sheet - ${supplier.name} - ${kioskName} - ${date}.xlsx`, content: buildOrderSheet(supplier, lines, items, staleDays, supplierStoreName, deliveryWeekStart), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
        : [];
    return { subject: `Order to review: ${supplier.name} — ${kioskName} (${date})`, html, attachments };
}
