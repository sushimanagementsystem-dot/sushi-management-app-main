"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Store, FileText, AlertTriangle } from "lucide-react";
import EvidencePreview from "@/components/dashboard/EvidencePreview";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import RefreshButton from "@/components/dashboard/RefreshButton";
import DashSelect from "@/components/dashboard/DashSelect";
import { confirmModal, noticeModal } from "@/components/ConfirmModal";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { moneyStr, qtyStr } from "@/lib/kpiUtils";

const STATUS_LABEL = { IN_REVIEW: "In review", REVIEWED: "Confirmed" };

function fmtDate(v) {
    if (!v) return "";
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function InvoicesPage() {
    return (
        <>
            <PageTitle title="Dashboard — Invoices" />
            <DashboardShell activeKey="invoices">
                <InvoicesBody />
            </DashboardShell>
        </>
    );
}

function InvoicesBody() {
    const [kioskId, setKioskId] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [openId, setOpenId] = useState(null);

    const params = { kioskId: kioskId || undefined, from: from || undefined, to: to || undefined };
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_invoices_list", params);

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = res?.rows || [];
    const kiosks = res?.kiosks || [];

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <PageHeader
                title="Invoices"
                description="Every delivery invoice across your kiosks, newest first. Filter by kiosk and date to review each one."
                actions={<RefreshButton onRefetch={refetch} />}
            >
                <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    <DashSelect value={kioskId} onChange={(e) => setKioskId(e.target.value)}>
                        <option value="">All kiosks</option>
                        {kiosks.map((k) => (
                            <option key={k.id} value={k.id}>
                                {k.name}
                            </option>
                        ))}
                    </DashSelect>
                    <label className="flex items-center gap-1.5 text-[0.78rem] text-muted">
                        From
                        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                    </label>
                    <label className="flex items-center gap-1.5 text-[0.78rem] text-muted">
                        To
                        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                    </label>
                    {(from || to || kioskId) && (
                        <button
                            type="button"
                            className="text-[0.78rem] font-semibold text-accent hover:underline"
                            onClick={() => {
                                setKioskId("");
                                setFrom("");
                                setTo("");
                            }}
                        >
                            Clear filters
                        </button>
                    )}
                </div>
            </PageHeader>

            {loading && <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />}
            {error && <div className="text-danger-ink">{error}</div>}

            {!loading && res?.ok !== false && res && (
                <SectionCard title={`${res.totalRows} invoice${res.totalRows === 1 ? "" : "s"}`} className="mb-0">
                    {res.totalRows > res.shownRows && (
                        <p className="mb-2 text-[0.8rem] text-muted">
                            Showing the latest {res.shownRows}. Narrow the date range to see older ones.
                        </p>
                    )}
                    {rows.length === 0 ? (
                        <p className="py-6 text-center text-[0.9rem] text-muted">No invoices match these filters.</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {rows.map((r) => (
                                <InvoiceRow
                                    key={r.deliveryHeaderId}
                                    row={r}
                                    open={openId === r.deliveryHeaderId}
                                    onToggle={() => setOpenId(openId === r.deliveryHeaderId ? null : r.deliveryHeaderId)}
                                    onDeleted={() => {
                                        setOpenId(null);
                                        refetch();
                                    }}
                                />
                            ))}
                        </div>
                    )}
                </SectionCard>
            )}
        </div>
    );
}

function InvoiceRow({ row, open, onToggle, onDeleted }) {
    const failedFile = row.files.find((f) => f.aiStatus === "FAILED");
    const Chevron = open ? ChevronDown : ChevronRight;
    const { data: detail, isPending: detailLoading, error: detailError } = useBootstrap(
        "bootstrap_invoice_detail",
        open ? { deliveryHeaderId: row.deliveryHeaderId } : null,
    );
    const detailOk = detail && detail.ok !== false;
    const deleteMutation = useApiMutation("delete_invoice", {
        onSuccess: (res) => {
            if (!res.ok) return noticeModal(res.error || "Delete failed.", "Can't delete");
            onDeleted();
        },
        onError: () => noticeModal("Could not reach the server — the invoice was not deleted.", "Can't delete"),
    });
    async function deleteInvoice() {
        const ok = await confirmModal(
            "Permanently delete this invoice? This removes it and its lines for good — use this only for one that can never be reviewed (e.g. the image is gone and AI can't read it). This cannot be undone.",
            "Delete invoice",
            true,
        );
        if (!ok) return;
        deleteMutation.mutate({ deliveryHeaderId: row.deliveryHeaderId });
    }
    return (
        <div className="rounded-card border border-line bg-card shadow-elevate-1">
            <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
                <Chevron size={15} className="flex-shrink-0 text-muted" />
                <span className="w-28 font-semibold text-ink">{fmtDate(row.deliveryDate)}</span>
                <span className="flex items-center gap-1 text-[0.85rem] text-muted">
                    <Store size={13} /> {row.kioskName}
                </span>
                <span className="flex-1 text-[0.9rem] text-ink">{row.supplierName || "—"}</span>
                <span className="text-[0.78rem] text-muted">{row.lineCount} line{row.lineCount === 1 ? "" : "s"}</span>
                <span className="text-[0.78rem] text-muted">{STATUS_LABEL[row.status] || row.status}</span>
                {failedFile && (
                    <span className="flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-[0.72rem] font-semibold text-warn-ink">
                        <AlertTriangle size={11} /> AI couldn&apos;t read
                    </span>
                )}
            </button>

            {open && (
                <div className="border-t border-line px-4 py-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[0.8rem] text-muted">
                            {row.documentType}
                            {row.staffInvoiceNumber ? ` · Invoice no. ${row.staffInvoiceNumber}` : ""}
                        </div>
                        <div className="flex items-center gap-2">
                            {detailOk && detail.inReview && detail.inboxActionId && (
                                <a
                                    href={`/dashboard/inbox/${detail.inboxActionId}`}
                                    className="rounded-lg bg-accent px-3 py-1.5 text-[0.82rem] font-semibold text-accent-ink no-underline hover:bg-accent/90"
                                >
                                    Review in Action Inbox
                                </a>
                            )}
                            {row.status === "IN_REVIEW" && (
                                <button
                                    type="button"
                                    disabled={deleteMutation.isPending}
                                    onClick={deleteInvoice}
                                    className="rounded-lg border border-danger-border px-3 py-1.5 text-[0.82rem] font-semibold text-danger-ink hover:bg-danger-bg disabled:opacity-50"
                                >
                                    {deleteMutation.isPending ? "Deleting…" : "Delete invoice"}
                                </button>
                            )}
                        </div>
                    </div>

                    {detailLoading && <div className="my-3 text-[0.85rem] text-muted">Loading lines…</div>}
                    {detailError && <div className="my-3 text-[0.85rem] text-danger-ink">Could not load the lines.</div>}
                    {detailOk && (
                        <div className="mb-3 overflow-x-auto">
                            <table className="w-full border-collapse text-[0.85rem]">
                                <thead>
                                    <tr className="text-left text-muted">
                                        <th className="border-b border-line px-2 py-1.5 font-semibold">Description</th>
                                        <th className="border-b border-line px-2 py-1.5 font-semibold">Stock item</th>
                                        <th className="border-b border-line px-2 py-1.5 text-right font-semibold">Qty</th>
                                        <th className="border-b border-line px-2 py-1.5 text-right font-semibold">Unit cost</th>
                                        <th className="border-b border-line px-2 py-1.5 text-right font-semibold">Line total</th>
                                        <th className="border-b border-line px-2 py-1.5 font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {detail.lines.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="px-2 py-3 text-center text-muted">No lines on this invoice.</td>
                                        </tr>
                                    )}
                                    {detail.lines.map((l) => (
                                        <tr key={l.invoiceLineId} className={l.status === "DECLINED" ? "text-muted line-through" : ""}>
                                            <td className="border-b border-line px-2 py-1.5">{l.description || "—"}</td>
                                            <td className="border-b border-line px-2 py-1.5">{l.stockItemName || <span className="text-danger-ink">Not matched</span>}</td>
                                            <td className="border-b border-line px-2 py-1.5 text-right">{qtyStr(l.qty)}</td>
                                            <td className="border-b border-line px-2 py-1.5 text-right">{l.unitCost !== null ? moneyStr(l.unitCost) : "—"}</td>
                                            <td className="border-b border-line px-2 py-1.5 text-right">{l.lineTotal !== null ? moneyStr(l.lineTotal) : "—"}</td>
                                            <td className="border-b border-line px-2 py-1.5">{l.status}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                {detail.lines.length > 0 && (
                                    <tfoot>
                                        <tr>
                                            <td colSpan={4} className="px-2 py-2 text-right font-semibold text-ink">Invoice total</td>
                                            <td className="px-2 py-2 text-right text-base font-bold text-ink">{moneyStr(detail.total)}</td>
                                            <td />
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>
                    )}
                    {row.files.length === 0 && <p className="text-[0.85rem] text-muted">No invoice image on record.</p>}
                    {row.files.map((f, i) => (
                        <div key={f.deliveryFileId} className="mb-3">
                            {f.fileUrl ? (
                                <EvidencePreview url={f.fileUrl} label={f.fileName || `Page ${f.pageSequence ?? i + 1}`} />
                            ) : (
                                <div className="rounded-card border border-line bg-panel px-3 py-2.5 text-[0.85rem] text-muted">
                                    <FileText size={13} className="mr-1 inline" />
                                    No image stored for this page.
                                </div>
                            )}
                            {f.aiStatus === "FAILED" && f.aiError && <div className="mt-1 text-[0.8rem] text-danger-ink">{f.aiError}</div>}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
