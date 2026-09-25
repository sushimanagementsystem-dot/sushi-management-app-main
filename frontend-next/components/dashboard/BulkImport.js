"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { apiCall, readFileAsBase64, saveBase64File } from "@/lib/api";
import { useBootstrap } from "@/lib/queries";
import { noticeModal } from "@/components/ConfirmModal";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NETWORK_ERROR = { ok: false, error: "Could not reach the server. Try again." };

/**
 * The one bulk-edit workflow for every dashboard section:
 *   Download Template -> edit in Excel -> Upload File -> validate -> preview -> Apply Changes.
 * Uploading never changes anything; Apply Changes is the only thing that writes, and the server applies the whole file
 * or none of it. A section plugs in by having a bulk-import dataset on the backend (see bulk-import.service.ts).
 */

/** Bulk-update buttons for the datasets offered on one Data Tables tab. Renders nothing for tabs without one. */
export function BulkImportForTable({ table, hasUnsavedChanges }) {
    const { data } = useBootstrap("bulk_import_datasets", {}, { staleTime: 5 * 60 * 1000 });
    const datasets = (data?.ok ? data.datasets : []).filter((d) => d.showOn.includes(table));
    if (!datasets.length) return null;
    return (
        <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {datasets.map((d) => (
                <BulkImportButton key={d.id} dataset={d} beforeOpen={hasUnsavedChanges} />
            ))}
        </div>
    );
}

/** One button that opens the bulk-update window for a dataset ({ id, label, description }). */
export function BulkImportButton({ dataset, beforeOpen, onApplied }) {
    const [open, setOpen] = useState(false);

    async function openWindow() {
        if (beforeOpen && beforeOpen()) {
            await noticeModal("Save or discard your unsaved edits in the table first, then start the bulk update.", "Unsaved edits");
            return;
        }
        setOpen(true);
    }

    return (
        <>
            <button
                type="button"
                onClick={openWindow}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.8rem] font-semibold text-ink hover:border-accent/40"
            >
                <FileSpreadsheet size={15} strokeWidth={2.25} />
                Bulk update: {dataset.label}
            </button>
            {open && <BulkImportWindow dataset={dataset} onApplied={onApplied} onClose={() => setOpen(false)} />}
        </>
    );
}

const STATUS = {
    changed: { label: "Will change", cls: "text-ink" },
    new: { label: "Will be added", cls: "text-success-ink" },
    unchanged: { label: "Unchanged", cls: "text-muted" },
    invalid: { label: "Invalid", cls: "text-danger-ink" },
    unmatched: { label: "Not found", cls: "text-danger-ink" },
    duplicate: { label: "Duplicate", cls: "text-danger-ink" },
};

function show(v) {
    if (v === null || v === undefined || v === "") return "empty";
    if (v === true) return "Yes";
    if (v === false) return "No";
    return String(v);
}

function BulkImportWindow({ dataset, onApplied, onClose }) {
    const fileInput = useRef(null);
    const [fileName, setFileName] = useState("");
    const [file64, setFile64] = useState("");
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState("");
    const [error, setError] = useState("");
    const [showUnchanged, setShowUnchanged] = useState(false);
    const [done, setDone] = useState(null);

    async function download() {
        setBusy("download");
        const out = await apiCall("bulk_import_template", { dataset: dataset.id }).catch(() => NETWORK_ERROR);
        setBusy("");
        if (!out || out.ok === false) return setError(out?.error || "Could not build the template.");
        setError("");
        saveBase64File(out.fileBase64, out.fileName, XLSX_MIME);
    }

    async function onFile(e) {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        setError("");
        setPreview(null);
        setFileName(f.name);
        setBusy("preview");
        const b64 = await readFileAsBase64(f);
        setFile64(b64);
        const out = await apiCall("bulk_import_preview", { dataset: dataset.id, fileBase64: b64 }).catch(() => NETWORK_ERROR);
        setBusy("");
        if (out.ok === false) return setError(out.error || "Could not read the file.");
        setPreview(out);
    }

    async function apply() {
        setBusy("apply");
        const out = await apiCall("bulk_import_apply", { dataset: dataset.id, fileBase64: file64, token: preview.token }).catch(() => NETWORK_ERROR);
        setBusy("");
        if (out.ok === false) return setError(out.error || "Nothing was saved.");
        setError("");
        setDone(out);
        if (onApplied) onApplied();
    }

    const s = preview?.summary;
    const problems = preview ? preview.rows.filter((r) => ["invalid", "unmatched", "duplicate"].includes(r.status)) : [];
    const changes = preview ? preview.rows.filter((r) => r.status === "changed" || r.status === "new") : [];
    const unchanged = preview ? preview.rows.filter((r) => r.status === "unchanged") : [];
    const shownRows = [...changes, ...(showUnchanged ? unchanged : [])].sort((a, b) => a.rowNo - b.rowNo);

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
            <div className="flex max-h-[92vh] w-full max-w-[64rem] flex-col rounded-card border border-line bg-bg shadow-elevate-2">
                <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
                    <div>
                        <div className="text-[1.05rem] font-semibold text-ink">Bulk update: {dataset.label}</div>
                        <div className="mt-0.5 text-[0.8rem] text-muted">{dataset.description}</div>
                    </div>
                    <button type="button" onClick={done ? () => window.location.reload() : onClose} aria-label="Close" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card p-0 text-muted hover:text-ink">
                        <X size={16} />
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[0.85rem]">
                    {done ? (
                        <div className="rounded-card border border-line bg-panel/50 px-4 py-4">
                            <div className="mb-1 text-[1rem] font-semibold text-success-ink">Saved</div>
                            <div className="text-ink">
                                {done.changed > 0 && <span>{done.changed} updated. </span>}
                                {done.created > 0 && <span>{done.created} added. </span>}
                                Everything in the file was applied together.
                            </div>
                            <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded-lg border-none bg-accent px-4 py-[0.55rem] text-[0.85rem] font-semibold text-accent-ink">
                                Close and refresh the table
                            </button>
                        </div>
                    ) : (
                        <>
                            <ol className="mb-3 list-decimal pl-5 text-muted">
                                <li>Download the template. It has the current data, ready to edit.</li>
                                <li>Change the values in Excel and save the file (keep the column headings).</li>
                                <li>Upload it here. You will see every change first; nothing is saved until you press Apply Changes.</li>
                            </ol>
                            <div className="flex flex-wrap items-center gap-2">
                                <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
                                <button type="button" onClick={download} disabled={!!busy} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.8rem] font-semibold text-ink disabled:opacity-60">
                                    <Download size={15} strokeWidth={2.25} />
                                    {busy === "download" ? "Preparing…" : "Download Template"}
                                </button>
                                <button type="button" onClick={() => fileInput.current?.click()} disabled={!!busy} className="flex h-8 items-center gap-1.5 rounded-lg border-none bg-accent px-3 text-[0.8rem] font-semibold text-accent-ink disabled:opacity-60">
                                    <Upload size={15} strokeWidth={2.25} />
                                    Upload File
                                </button>
                                {fileName && <span className="text-[0.78rem] text-muted">{busy === "preview" ? "Checking " : ""}{fileName}</span>}
                            </div>

                            {error && <div className="mt-3 rounded-card border border-line bg-danger-bg/40 px-3 py-2 text-danger-ink">{error}</div>}
                            {preview?.fileErrors?.length > 0 && (
                                <div className="mt-3 rounded-card border border-line bg-danger-bg/40 px-3 py-2 text-danger-ink">
                                    {preview.fileErrors.map((m, i) => (
                                        <div key={i}>{m}</div>
                                    ))}
                                </div>
                            )}

                            {preview && !preview.fileErrors?.length && (
                                <div className="mt-4">
                                    <div className="mb-3 flex flex-wrap gap-2 text-[0.8rem]">
                                        <Chip n={s.changed} label="to change" tone="ok" />
                                        <Chip n={s.new} label="to add" tone="ok" />
                                        <Chip n={s.unchanged} label="unchanged" />
                                        <Chip n={s.invalid} label="invalid" tone="bad" />
                                        <Chip n={s.unmatched} label="not found" tone="bad" />
                                        <Chip n={s.duplicate} label="duplicates" tone="bad" />
                                        {s.notInFile > 0 && <span className="self-center text-muted">{s.notInFile} records not in the file stay as they are.</span>}
                                    </div>

                                    {problems.length > 0 && (
                                        <div className="mb-3 rounded-card border border-line bg-danger-bg/40 px-3 py-2 text-danger-ink">
                                            <div className="mb-1 font-semibold">Fix these in the file and upload it again. Nothing can be applied while there are problems.</div>
                                            <ul className="m-0 max-h-48 list-disc overflow-y-auto pl-5">
                                                {problems.map((r) => (
                                                    <li key={r.rowNo}>
                                                        Row {r.rowNo} ({STATUS[r.status].label}
                                                        {preview.labelColumns.length ? ": " + preview.labelColumns.map((c) => r.label[c.key]).filter(Boolean).slice(0, 3).join(" · ") : ""}): {r.message}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {shownRows.length > 0 && (
                                        <div className="max-h-[22rem] overflow-auto rounded-lg border border-line bg-card">
                                            <table className="w-full border-collapse text-[0.82rem]">
                                                <thead>
                                                    <tr>
                                                        {["Row", "Status", ...preview.labelColumns.map((c) => c.header), "Changes"].map((c) => (
                                                            <th key={c} className="sticky top-0 whitespace-nowrap border-b border-line bg-panel px-3 py-2 text-left text-[0.68rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                                                {c}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {shownRows.map((r) => (
                                                        <tr key={r.rowNo}>
                                                            <td className="border-b border-line px-3 py-1.5 tabular-nums text-muted">{r.rowNo}</td>
                                                            <td className={"whitespace-nowrap border-b border-line px-3 py-1.5 font-semibold " + STATUS[r.status].cls}>{STATUS[r.status].label}</td>
                                                            {preview.labelColumns.map((c) => (
                                                                <td key={c.key} className="border-b border-line px-3 py-1.5 text-ink">{r.label[c.key] ?? ""}</td>
                                                            ))}
                                                            <td className="border-b border-line px-3 py-1.5 text-ink">
                                                                {r.changes.length ? (
                                                                    r.changes.map((ch) => (
                                                                        <div key={ch.key} className="whitespace-nowrap">
                                                                            <span className="text-muted">{ch.header}:</span> {show(ch.from)} <span className="text-muted">→</span> <b>{show(ch.to)}</b>
                                                                        </div>
                                                                    ))
                                                                ) : (
                                                                    <span className="text-muted">{r.message || ""}</span>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                    {unchanged.length > 0 && (
                                        <label className="mt-2 flex cursor-pointer items-center gap-2 text-[0.8rem] text-muted">
                                            <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
                                            Also show the {unchanged.length} unchanged rows
                                        </label>
                                    )}
                                    {changes.length === 0 && problems.length === 0 && <div className="mt-2 text-muted">Nothing in this file differs from what is saved now.</div>}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {!done && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                        <span className="text-[0.78rem] text-muted">
                            {preview && !preview.fileErrors?.length ? (preview.canApply ? "Nothing has been saved yet. All changes are applied together, or none." : "Nothing has been saved.") : "Nothing is saved until you press Apply Changes."}
                        </span>
                        <div className="flex gap-2">
                            <button type="button" onClick={onClose} className="rounded-lg border border-line bg-card px-4 py-[0.55rem] text-[0.85rem] font-semibold text-ink">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={!preview?.canApply || !!busy}
                                onClick={apply}
                                className="rounded-lg border-none bg-accent px-4 py-[0.55rem] text-[0.85rem] font-semibold text-accent-ink disabled:opacity-50"
                            >
                                {busy === "apply" ? "Applying…" : preview?.canApply ? `Apply Changes (${changes.length})` : "Apply Changes"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

function Chip({ n, label, tone }) {
    if (!n && tone === "bad") return null;
    const cls = tone === "bad" ? "border-line bg-danger-bg/40 text-danger-ink" : tone === "ok" ? "border-line bg-card text-ink" : "border-line bg-card text-muted";
    return (
        <span className={"rounded-full border px-2.5 py-1 font-semibold " + cls}>
            {n} {label}
        </span>
    );
}
