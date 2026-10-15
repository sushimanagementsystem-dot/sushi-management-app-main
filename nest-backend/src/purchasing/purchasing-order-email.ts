import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, "order-sheet-templates");

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

type Row = { code: string; item: string; packs: number; sellingQty: number; pack: string; qty: string; sellingUnit: string; price: number | null; note: string };

function rowsOf(lines: OrderLine[], items: Map<string, OrderItemInfo>, staleDays: number): Row[] {
    return lines
        .map((l) => {
            const info = items.get(l.stockItemId);
            const unit = info?.countUnit ?? "";
            return {
                code: info?.supplierCode ?? "",
                item: info?.supplierDescription || info?.name || l.stockItemId,
                packs: l.recommendedPacks,
                sellingQty: l.recommendedQty,
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
function buildGenericSheet(rows: Row[]): { buffer: Buffer; unmatched: string[] } {
    const data = [["Supplier code", "Item", "Pack", "Packs to order", "Total quantity", "Notes"], ...rows.map((r) => [r.code, r.item, r.pack, r.packs, r.qty, r.note])];
    return { buffer: sheetFromRows("Order", [], data, [14, 46, 14, 14, 16, 40]), unmatched: [] };
}

async function loadTemplate(filename: string): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(TEMPLATES_DIR, filename));
    return wb;
}

const cellText = (row: ExcelJS.Row, col: number) => String(row.getCell(col).value ?? "").trim();

/**
 * Tazaki's own order form (tazaki.xlsx) — their full standing price catalogue, used identically across every
 * kiosk of theirs, not just ours. We never regenerate this sheet from scratch (that drops their colours, merged
 * title cells and baked-in Item Code/Price columns) — we load their real file and only fill the Quantity cell on
 * each row we're ordering, matched by Item Code (falling back to an exact Item Description match for items we
 * have no code for). Quantity here is SELLING units (e.g. kg, packs), not cases — Price is clearly per selling
 * unit (checked against real prices: a case-price would be unrealistically cheap), and Subtotal = Price x
 * Quantity is a formula already baked into their sheet, so getting the unit wrong here silently wrecks every
 * subtotal. Anything we can't match to a row is never silently dropped — it's returned as "unmatched" so the
 * owner email can call it out for manual entry.
 */
async function buildTazakiSheet(rows: Row[]): Promise<{ buffer: Buffer; unmatched: string[] }> {
    const wb = await loadTemplate("tazaki.xlsx");
    const ws = wb.worksheets[0]!;
    const byCode = new Map<string, number>();
    const byDescription = new Map<string, number>();
    ws.eachRow((row, rowNumber) => {
        const code = cellText(row, 1);
        const desc = cellText(row, 2).toLowerCase();
        if (code) byCode.set(code, rowNumber);
        if (desc) byDescription.set(desc, rowNumber);
    });

    const unmatched: string[] = [];
    for (const r of rows) {
        const rowNumber = (r.code && byCode.get(r.code.trim())) || byDescription.get(r.item.trim().toLowerCase());
        if (!rowNumber) {
            unmatched.push(r.item);
            continue;
        }
        ws.getRow(rowNumber).getCell(6).value = r.sellingQty; // Quantity column
    }
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), unmatched };
}

/** Asia Market's own order template (asia-market.xlsx) — same reasoning as Tazaki, matched by Product code. Their
 * "Price per case" header means Quantity here is cases, unlike Tazaki. */
async function buildAsiaMarketSheet(rows: Row[]): Promise<{ buffer: Buffer; unmatched: string[] }> {
    const wb = await loadTemplate("asia-market.xlsx");
    const ws = wb.worksheets[0]!;
    const byCode = new Map<string, number>();
    ws.eachRow((row, rowNumber) => {
        const code = cellText(row, 2);
        if (code) byCode.set(code, rowNumber);
    });

    const unmatched: string[] = [];
    for (const r of rows) {
        const rowNumber = r.code && byCode.get(r.code.trim());
        if (!rowNumber) {
            unmatched.push(r.item);
            continue;
        }
        ws.getRow(rowNumber).getCell(4).value = r.packs; // QTY ordered column, in cases
    }
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), unmatched };
}

/**
 * Castlebay's own order form (castlebay.xlsx) — "Name of Store" and "Delivery Week Beginning" are filled per
 * kiosk/run by scanning for those exact labels (whichever row they land on) rather than a hardcoded cell address.
 * Items are matched by product name against column A; Quantity Required is cases, EXCEPT any row whose own
 * "Unit" column says "per kg" (Salmon — billed by variable actual weight, not a fixed case size): that quantity
 * is never guessed in cases-vs-kg, since getting it wrong risks a real under/over order — it's returned as
 * unmatched for manual entry instead.
 */
async function buildCastlebaySheet(kioskName: string, deliveryWeekStart: string, rows: Row[]): Promise<{ buffer: Buffer; unmatched: string[] }> {
    const wb = await loadTemplate("castlebay.xlsx");
    const ws = wb.worksheets[0]!;
    const byName = new Map<string, number>();
    ws.eachRow((row, rowNumber) => {
        const label = cellText(row, 1);
        if (!label) return;
        const lower = label.toLowerCase();
        if (lower === "name of store") row.getCell(2).value = kioskName;
        else if (lower === "delivery week beginning") row.getCell(2).value = deliveryWeekStart;
        else if (lower !== "supplier product  name") byName.set(lower, rowNumber);
    });

    const unmatched: string[] = [];
    for (const r of rows) {
        const rowNumber = byName.get(r.item.trim().toLowerCase());
        if (!rowNumber) {
            unmatched.push(r.item);
            continue;
        }
        const row = ws.getRow(rowNumber);
        if (cellText(row, 3).toLowerCase() === "per kg") {
            unmatched.push(`${r.item} (billed per kg — enter quantity manually)`);
            continue;
        }
        row.getCell(5).value = r.packs; // Quantity Required column, in cases
    }
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), unmatched };
}

/**
 * The order as an .xlsx: one row per item, quantities filled in from the par levels, ready to be reviewed and sent
 * on. Dispatches to the exact template a supplier requires, falling back to a generic layout otherwise.
 * supplierStoreName: the kiosk's name as registered with THIS supplier (Kiosk.supplier_store_name, falling back
 * to our own kiosk name) — only used where the sheet itself names the store (Castlebay); never the internal name
 * used for the email subject/filename, which can differ from what the supplier has on file.
 */
export async function buildOrderSheet(supplier: OrderSupplier, lines: OrderLine[], items: Map<string, OrderItemInfo>, staleDays: number, supplierStoreName: string, deliveryWeekStart: string): Promise<{ buffer: Buffer; unmatched: string[] }> {
    const rows = rowsOf(lines, items, staleDays);
    switch (supplier.orderSheetTemplate) {
        case "TAZAKI":
            return buildTazakiSheet(rows);
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
export async function buildOrderEmail(
    supplier: OrderSupplier,
    lines: OrderLine[],
    items: Map<string, OrderItemInfo>,
    date: string,
    staleDays: number,
    kioskName: string,
    supplierStoreName: string,
    deliveryWeekStart: string,
): Promise<OrderEmail> {
    const rows = rowsOf(lines, items, staleDays);
    const sheet = isOrderSheet(supplier.orderOutputMethod);
    const table = `<table style="border-collapse:collapse;font-size:14px"><thead><tr>${["Code", "Item", "Order", "Pack", "Total", "Notes"]
        .map((h) => `<th style="text-align:left;border-bottom:2px solid #ccc;padding:4px 10px">${h}</th>`)
        .join("")}</tr></thead><tbody>${rows
        .map((r) => `<tr>${[esc(r.code), esc(r.item), `<b>${r.packs}</b>`, esc(r.pack), esc(r.qty), esc(r.note)].map((c) => `<td style="border-bottom:1px solid #eee;padding:4px 10px">${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`;
    const sendTo = supplier.contactEmail ? `Send to: <b>${esc(supplier.contactEmail)}</b>` : "No supplier email is saved for this supplier yet (add one on the Supplier table).";

    const orderSheet = sheet ? await buildOrderSheet(supplier, lines, items, staleDays, supplierStoreName, deliveryWeekStart) : null;
    const unmatchedNote = orderSheet && orderSheet.unmatched.length
        ? `<p style="color:#b45309"><b>Could not be matched onto ${esc(supplier.name)}'s order sheet — add manually:</b> ${orderSheet.unmatched.map(esc).join(", ")}</p>`
        : "";

    const html = `<div style="font-family:Arial,sans-serif;color:#222">
<p>Order drafted for <b>${esc(supplier.name)}</b> — <b>${esc(kioskName)}</b> (${esc(date)}), from the latest stocktake and the par levels. Nothing has been sent to the supplier.</p>
<p>${sendTo}</p>
${sheet ? "<p>The order sheet is attached: review it, then send it on.</p>" : "<p>Review the list below, then send it on.</p>"}
${unmatchedNote}
${table}
<p style="color:#666;font-size:12px">${rows.length} item(s). Set in Data Tables: Supplier, Supplier Items and Stock Item Par.</p>
</div>`;
    const attachments = orderSheet
        ? [{ filename: `Order sheet - ${supplier.name} - ${kioskName} - ${date}.xlsx`, content: orderSheet.buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]
        : [];
    return { subject: `Order to review: ${supplier.name} — ${kioskName} (${date})`, html, attachments };
}
