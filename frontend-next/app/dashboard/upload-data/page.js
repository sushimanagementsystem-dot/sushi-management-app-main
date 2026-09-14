"use client";

import { useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import { apiCall, readFileAsBase64 } from "@/lib/api";

const MAX_ERRORS_SHOWN = 5;

/**
 * Lets an owner re-sync the whole database from an updated copy of the
 * handover workbook (same 42-sheet format as Database.xlsx) instead of
 * re-entering changes by hand through Data Tables one row at a time.
 *
 * Runs as start + one step per sheet (nest-backend/src/import/
 * import-database.controller.ts) rather than one big request, so the
 * full sheet list can be shown immediately and each one can light up as
 * it finishes — a plain useApiMutation single-shot call can't show that,
 * since it only resolves once at the very end. Steps run sequentially,
 * not in parallel: IMPORT_ORDER (parents before children) only resolves
 * foreign keys correctly if sheets are synced in that exact order.
 *
 * Upsert-based on the backend, so re-uploading the same or a newer
 * workbook syncs existing rows rather than duplicating them — safe to
 * run more than once.
 */
export default function UploadDataPage() {
    const [file, setFile] = useState(null);
    const [pickError, setPickError] = useState("");
    // sheets: [{ sheet, rows, present, status: 'pending'|'running'|'done'|'error', result? }]
    const [sheets, setSheets] = useState(null);
    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState("");
    const inputRef = useRef(null);
    // Bumped on every new run and captured by the loop's closure — lets an
    // abandoned run (Clear clicked mid-upload) stop writing state updates
    // for a run that's no longer the current one, without needing a real
    // cancellation signal to the backend.
    const runIdRef = useRef(0);

    function handleFileChange(e) {
        const picked = e.target.files?.[0] || null;
        setPickError("");
        setSheets(null);
        setRunError("");
        if (picked && !/\.xlsx?$/i.test(picked.name)) {
            setPickError("Please choose an .xlsx or .xls file.");
            setFile(null);
            return;
        }
        setFile(picked);
    }

    async function handleUpload() {
        if (!file) return;
        const runId = ++runIdRef.current;
        setRunning(true);
        setRunError("");
        setSheets(null);

        try {
            const fileBase64 = await readFileAsBase64(file);
            const startRes = await apiCall("import_database_excel_start", { fileBase64, fileName: file.name });
            if (runId !== runIdRef.current) return; // superseded by Clear/another upload
            if (!startRes.ok) {
                setRunError(startRes.error || "Could not start the upload.");
                setRunning(false);
                return;
            }

            const { importId, sheets: preview } = startRes;
            let current = preview.map((s) => ({ ...s, status: "pending" }));
            setSheets(current);

            for (let index = 0; index < preview.length; index++) {
                if (runId !== runIdRef.current) return;
                current = current.map((s, i) => (i === index ? { ...s, status: "running" } : s));
                setSheets(current);

                const stepRes = await apiCall("import_database_excel_step", { importId, index });
                if (runId !== runIdRef.current) return;

                if (!stepRes.ok) {
                    current = current.map((s, i) => (i === index ? { ...s, status: "error", errorMessage: stepRes.error } : s));
                    setSheets(current);
                    setRunError(stepRes.error || "Upload failed partway through — you can fix the file and upload again; already-synced tables don't need re-doing.");
                    setRunning(false);
                    return;
                }

                current = current.map((s, i) => (i === index ? { ...s, status: "done", result: stepRes.result } : s));
                setSheets(current);
            }

            if (runId === runIdRef.current) setRunning(false);
        } catch {
            if (runId === runIdRef.current) {
                setRunError("Upload failed — check your connection and try again.");
                setRunning(false);
            }
        }
    }

    function reset() {
        runIdRef.current++; // orphan any in-flight step loop
        setFile(null);
        setPickError("");
        setSheets(null);
        setRunning(false);
        setRunError("");
        if (inputRef.current) inputRef.current.value = "";
    }

    const completedCount = sheets ? sheets.filter((s) => s.status === "done" || s.status === "error").length : 0;
    const totals = sheets
        ? sheets.reduce(
              (acc, s) => ({
                  rows: acc.rows + (s.result?.rows ?? 0),
                  upserted: acc.upserted + (s.result?.upserted ?? 0),
                  errors: acc.errors + (s.result?.errors?.length ?? 0),
              }),
              { rows: 0, upserted: 0, errors: 0 },
          )
        : null;

    return (
        <>
            <PageTitle title="Dashboard — Upload Data" />
            <DashboardShell activeKey="upload-data">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Upload Data"
                        description="Upload a new or updated database workbook (the same format as the handover file) to sync it into the system — much faster than re-entering changes by hand in Data Tables."
                    />

                    <SectionCard
                        title="Database Workbook"
                        description="An .xlsx file with one sheet per table (kiosk, stock_item, product, …). Existing rows are matched by their ID and updated in place, new rows are added — nothing is deleted, and it's safe to upload the same or a newer file more than once. Tables sync one at a time, in the order shown below."
                    >
                        <div className="flex flex-wrap items-center gap-3">
                            <input
                                ref={inputRef}
                                type="file"
                                accept=".xlsx,.xls"
                                disabled={running}
                                onChange={handleFileChange}
                                className="text-[0.9rem] disabled:opacity-50"
                            />
                            <button
                                type="button"
                                disabled={!file || running}
                                onClick={handleUpload}
                                className="rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50"
                            >
                                {running ? "Syncing…" : "Upload & Sync"}
                            </button>
                            {(file || sheets) && (
                                <button
                                    type="button"
                                    onClick={reset}
                                    className="rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink hover:bg-[#ddd7c8] active:scale-[0.97]"
                                >
                                    Clear
                                </button>
                            )}
                            {sheets && (
                                <span className="text-[0.85rem] text-muted">
                                    {completedCount} / {sheets.length} tables synced
                                </span>
                            )}
                        </div>

                        {pickError && <div className="mt-3 text-[0.9rem] text-danger-ink">{pickError}</div>}
                        {runError && (
                            <div className="mt-3 rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-[0.9rem] text-danger-ink">
                                {runError}
                            </div>
                        )}
                    </SectionCard>

                    {sheets && <SheetProgressList sheets={sheets} totals={totals} running={running} />}
                </div>
            </DashboardShell>
        </>
    );
}

function SheetProgressList({ sheets, totals, running }) {
    return (
        <SectionCard title={running ? "Syncing…" : "Sync Results"}>
            <div className="mb-4 grid grid-cols-3 gap-3 max-[560px]:grid-cols-1">
                <Tile label="Rows read" value={totals.rows} />
                <Tile label="Upserted" value={totals.upserted} tone="success" />
                <Tile label="Errors" value={totals.errors} tone={totals.errors > 0 ? "danger" : undefined} />
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full min-w-[480px] border-collapse text-[0.85rem]">
                    <thead>
                        <tr className="border-b border-line bg-panel text-left">
                            <th className="w-8 px-3 py-2"></th>
                            <th className="px-3 py-2 font-semibold text-muted">Table</th>
                            <th className="px-3 py-2 font-semibold text-muted">Rows</th>
                            <th className="px-3 py-2 font-semibold text-muted">Upserted</th>
                            <th className="px-3 py-2 font-semibold text-muted">Errors</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sheets.map((s) => (
                            <tr key={s.sheet} className="border-b border-line last:border-0">
                                <td className="px-3 py-2">
                                    <StatusIcon status={s.status} />
                                </td>
                                <td className={"px-3 py-2 font-medium " + (s.status === "pending" ? "text-muted" : "text-ink")}>
                                    {s.sheet}
                                    {!s.present && <span className="ml-1.5 text-[0.75rem] font-normal text-muted">(not in file)</span>}
                                </td>
                                <td className="px-3 py-2 text-muted">{s.result ? s.result.rows : s.status === "pending" ? "—" : s.rows}</td>
                                <td className="px-3 py-2 text-muted">{s.result ? s.result.upserted : "—"}</td>
                                <td className="px-3 py-2">
                                    <SheetErrors sheet={s} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </SectionCard>
    );
}

function StatusIcon({ status }) {
    if (status === "running") return <Loader2 size={16} className="animate-spin text-accent" />;
    if (status === "done") return <Check size={16} className="text-success-ink" />;
    if (status === "error") return <X size={16} className="text-danger-ink" />;
    return <div className="h-2 w-2 rounded-full bg-line" />;
}

function SheetErrors({ sheet }) {
    if (sheet.status === "error" && !sheet.result) {
        return <span className="font-semibold text-danger-ink">{sheet.errorMessage || "failed"}</span>;
    }
    const errors = sheet.result?.errors || [];
    if (errors.length === 0) return <span className="text-muted">—</span>;
    return (
        <div>
            <span className="font-semibold text-danger-ink">{errors.length}</span>
            <ul className="mt-1 list-inside list-disc text-[0.8rem] text-danger-ink">
                {errors.slice(0, MAX_ERRORS_SHOWN).map((e, i) => (
                    <li key={i}>
                        row {e.row + 1}: {e.message}
                    </li>
                ))}
            </ul>
            {errors.length > MAX_ERRORS_SHOWN && <div className="mt-1 text-[0.8rem] text-muted">+{errors.length - MAX_ERRORS_SHOWN} more</div>}
        </div>
    );
}

function Tile({ label, value, tone }) {
    const toneClass =
        tone === "success"
            ? "bg-success-bg border-success-border text-success-ink"
            : tone === "danger"
              ? "bg-danger-bg border-danger-border text-danger-ink"
              : "bg-card border-line text-ink";
    return (
        <div className={"rounded-lg border px-4 py-3 " + toneClass}>
            <div className="text-[1.4rem] font-semibold">{value}</div>
            <div className="text-[0.8rem] opacity-80">{label}</div>
        </div>
    );
}
