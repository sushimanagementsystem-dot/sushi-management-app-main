"use client";

import { useState } from "react";
import { Download, Mail, X, Check } from "lucide-react";
import { downloadCsv, buildReportHtml } from "@/lib/reportExport";
import { useApiMutation } from "@/lib/queries";

const EMAIL_STORAGE_KEY = "report_email_last";

/**
 * The two "download-able" actions every report on the Reports page needs —
 * CSV export (client-side, no round trip) and "Email report" (posts the
 * same columns/rows, rendered as an HTML table, to send_report_email,
 * which forwards it through the app's existing MailerService). One
 * component instead of repeating this per report type.
 */
// The same compact size as the Refresh button next to them, so the three sit as one row; the icon-only buttons of
// the email form drop the global button padding (p-0), otherwise their icon is pushed off-centre.
const REPORT_BTN =
    "flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-1 text-[0.72rem] font-medium text-ink shadow-elevate-1 hover:border-accent/40 hover:bg-panel hover:text-accent";
const ICON_BTN = "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-none p-0";

export default function ReportExportButtons({ filename, title, subtitle, columns, rows }) {
    const [showEmailForm, setShowEmailForm] = useState(false);
    const [email, setEmail] = useState("");
    const [sent, setSent] = useState(false);
    const [error, setError] = useState("");

    const sendMutation = useApiMutation("send_report_email", {
        onSuccess: (res) => {
            if (!res.ok) {
                setError(res.error || "Failed to send.");
                return;
            }
            setSent(true);
            setShowEmailForm(false);
            try {
                localStorage.setItem(EMAIL_STORAGE_KEY, email);
            } catch {
                // Best-effort convenience only — a private window or blocked
                // storage just means the field starts blank next time.
            }
        },
        onError: () => setError("Failed to send."),
    });

    function openEmailForm() {
        setError("");
        setSent(false);
        let last = "";
        try {
            last = localStorage.getItem(EMAIL_STORAGE_KEY) || "";
        } catch {
            // ignore
        }
        setEmail(last);
        setShowEmailForm(true);
    }

    function submitEmail(e) {
        e.preventDefault();
        setError("");
        const html = buildReportHtml(title, subtitle, columns, rows);
        sendMutation.mutate({ to: email, subject: title + (subtitle ? " — " + subtitle : ""), html });
    }

    return (
        <div className="flex flex-wrap items-center gap-1.5">
            <button
                type="button"
                onClick={() => downloadCsv(filename, columns, rows)}
                title="Download this report as CSV"
                className={REPORT_BTN}
            >
                <Download size={15} strokeWidth={2.25} />
                Export CSV
            </button>

            {!showEmailForm ? (
                <button
                    type="button"
                    onClick={openEmailForm}
                    title="Email this report"
                    className={REPORT_BTN}
                >
                    <Mail size={15} strokeWidth={2.25} />
                    Email report
                </button>
            ) : (
                <form onSubmit={submitEmail} className="flex items-center gap-1.5">
                    <input
                        type="email"
                        required
                        autoFocus
                        placeholder="owner@email.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="h-8 w-48 py-1 px-2 text-[0.75rem]"
                    />
                    <button
                        type="submit"
                        disabled={sendMutation.isPending}
                        title="Send"
                        className={ICON_BTN + " bg-accent text-accent-ink disabled:opacity-50"}
                    >
                        <Check size={16} strokeWidth={2.5} />
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowEmailForm(false)}
                        title="Cancel"
                        className={ICON_BTN + " bg-line text-muted"}
                    >
                        <X size={16} strokeWidth={2.5} />
                    </button>
                </form>
            )}

            {sent && <span className="text-[0.75rem] text-success-ink">Sent!</span>}
            {error && <span className="text-[0.75rem] text-danger-ink">{error}</span>}
        </div>
    );
}
