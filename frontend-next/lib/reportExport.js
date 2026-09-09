/**
 * Shared export helpers for the Reports page — every report type builds
 * the same {columns, rows} shape (see reportTypes.js), and these two
 * functions turn that into a downloadable CSV or an emailable HTML table.
 * One implementation instead of one per report type.
 */

function csvCell(value) {
    const str = value === null || value === undefined ? "" : String(value);
    // Quote whenever the value could be misread as a delimiter/newline, or
    // could be sniffed as a formula by Excel/Sheets (=, +, -, @ at the
    // start) — prefixing a straight quote defuses that without changing
    // what a human reading the cell sees.
    const needsQuote = /[",\n]/.test(str);
    const safe = /^[=+\-@]/.test(str) ? "'" + str : str;
    return needsQuote ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function buildCsv(columns, rows) {
    const header = columns.map((c) => csvCell(c.label)).join(",");
    const lines = rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(","));
    return [header, ...lines].join("\r\n");
}

export function downloadCsv(filename, columns, rows) {
    const csv = buildCsv(columns, rows);
    // A BOM so Excel (which guesses encoding from the first bytes, not
    // declared charset) reads UTF-8 correctly instead of mangling anything
    // outside plain ASCII.
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

export function buildReportHtml(title, subtitle, columns, rows) {
    const thead = columns.map((c) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #20221f;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:#6c6b62;">${escapeHtml(c.label)}</th>`).join("");
    const tbody = rows
        .map(
            (row) =>
                `<tr>${columns.map((c) => `<td style="padding:6px 10px;border-bottom:1px solid #e7e3d8;font-size:13px;">${escapeHtml(String(c.value(row) ?? ""))}</td>`).join("")}</tr>`,
        )
        .join("");
    return `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#20221f;">
            <h2 style="margin:0 0 4px;">${escapeHtml(title)}</h2>
            ${subtitle ? `<p style="margin:0 0 16px;color:#6c6b62;font-size:13px;">${escapeHtml(subtitle)}</p>` : ""}
            <table style="border-collapse:collapse;width:100%;">
                <thead><tr>${thead}</tr></thead>
                <tbody>${tbody || `<tr><td style="padding:10px;color:#6c6b62;">No data for this period.</td></tr>`}</tbody>
            </table>
        </div>
    `;
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
