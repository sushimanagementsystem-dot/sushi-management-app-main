import * as XLSX from "xlsx";

export type OrderLine = { stockItemId: string; recommendedPacks: number; recommendedQty: number; packSize: number; flags: string[] };
export type OrderItemInfo = { name: string; countUnit: string; supplierCode: string; supplierDescription: string; caseUnit: string };
export type OrderSupplier = { name: string; contactEmail: string | null; orderOutputMethod: string };
export type OrderEmail = { subject: string; html: string; attachments: { filename: string; content: Buffer; contentType: string }[] };

/** Suppliers whose order goes out as a filled Excel order sheet; every other non-MANUAL method is a plain "what to order" message. */
export const ORDER_SHEET_METHOD = "ORDER_SHEET";
export const isOrderSheet = (method: string | null | undefined) => method === ORDER_SHEET_METHOD;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number) => String(Math.round(n * 1000) / 1000);

function note(flags: string[], staleDays: number): string {
    return flags
        .map((f) => (f === "STALE" ? `stock count is more than ${staleDays} days old` : f === "CASTLEBAY_OVERRIDE" ? "standing order: fixed boxes per kiosk" : f))
        .join("; ");
}

type Row = { code: string; item: string; packs: number; pack: string; qty: string; note: string };

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
                note: note(l.flags, staleDays),
            };
        })
        .sort((a, b) => a.item.localeCompare(b.item));
}

/** The order as an .xlsx: one row per item, quantities filled in from the par levels, ready to be reviewed and sent on. */
export function buildOrderSheet(supplierName: string, lines: OrderLine[], items: Map<string, OrderItemInfo>, staleDays: number): Buffer {
    const rows = rowsOf(lines, items, staleDays);
    const data = [["Supplier code", "Item", "Pack", "Packs to order", "Total quantity", "Notes"], ...rows.map((r) => [r.code, r.item, r.pack, r.packs, r.qty, r.note])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws["!cols"] = [{ wch: 14 }, { wch: 46 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Order");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/**
 * The email that goes to the OWNER (never to the supplier): the drafted order to review and forward. Sheet suppliers
 * also get the Excel order sheet attached; everyone else gets just the message listing what to order.
 */
export function buildOrderEmail(supplier: OrderSupplier, lines: OrderLine[], items: Map<string, OrderItemInfo>, date: string, staleDays: number): OrderEmail {
    const rows = rowsOf(lines, items, staleDays);
    const sheet = isOrderSheet(supplier.orderOutputMethod);
    const table = `<table style="border-collapse:collapse;font-size:14px"><thead><tr>${["Code", "Item", "Order", "Pack", "Total", "Notes"]
        .map((h) => `<th style="text-align:left;border-bottom:2px solid #ccc;padding:4px 10px">${h}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${[esc(r.code), esc(r.item), `<b>${r.packs}</b>`, esc(r.pack), esc(r.qty), esc(r.note)].map((c) => `<td style="border-bottom:1px solid #eee;padding:4px 10px">${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    const sendTo = supplier.contactEmail ? `Send to: <b>${esc(supplier.contactEmail)}</b>` : "No supplier email is saved for this supplier yet (add one on the Supplier table).";
    const html = `<div style="font-family:Arial,sans-serif;color:#222">
<p>Order drafted for <b>${esc(supplier.name)}</b> (${esc(date)}), from the latest stocktake and the par levels. Nothing has been sent to the supplier.</p>
<p>${sendTo}</p>
${sheet ? "<p>The order sheet is attached: review it, then send it on.</p>" : "<p>Review the list below, then send it on.</p>"}
${table}
<p style="color:#666;font-size:12px">${rows.length} item(s). Set in Data Tables: Supplier, Supplier Items and Stock Item Par.</p>
</div>`;
    const attachments = sheet
        ? [{ filename: `Order sheet - ${supplier.name} - ${date}.xlsx`, content: buildOrderSheet(supplier.name, lines, items, staleDays), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
        : [];
    return { subject: `Order to review: ${supplier.name} (${date})`, html, attachments };
}
