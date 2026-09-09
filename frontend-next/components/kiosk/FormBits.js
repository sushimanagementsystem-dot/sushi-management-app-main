/**
 * Small shared pieces used by every kiosk form page (note text, resubmit
 * banner, busy spinner, inline error box, success panel) — pure Tailwind
 * utility classes, no custom CSS. Ported from the identical <style> block
 * every pages/kiosk/*.html form repeated (.note, .banner, .spinner,
 * #result.err, #successPanel).
 */

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export function FormNote({ children }) {
    return <p className="mx-[0.1rem] my-[0.6rem] text-[0.85rem] text-muted">{children}</p>;
}

export function ResubmitBanner({ children }) {
    return (
        <div className="mb-[0.8rem] rounded border border-warn-border bg-warn-bg p-[0.8rem] text-[0.9rem]">
            {children}
        </div>
    );
}

export function Spinner({ loading }) {
    if (!loading) return null;
    return (
        <div
            className="mx-auto mt-4 h-[2.2rem] w-[2.2rem] animate-spin rounded-full border-4 border-line"
            style={{ borderTopColor: "#0e5c45" }}
        />
    );
}

export function ResultError({ children }) {
    if (!children) return null;
    return <div className="mt-4 rounded bg-danger-bg p-4 whitespace-pre-wrap">{children}</div>;
}

/** onLogAnother, when passed, renders an extra "Log another" button before
 * "Back to menu" — used by forms meant for repeated same-shift entries
 * (Damaged Product, Delivery Invoices, Help/Issues), which the original
 * implemented via a plain location.reload(). */
export function SuccessPanel({ message, menuHref, onLogAnother }) {
    return (
        <div className="px-4 py-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-ink">
                <CheckCircle2 size={30} strokeWidth={1.8} />
            </div>
            <div className="my-[0.9rem] text-[1.05rem] font-medium text-ink">{message}</div>
            {onLogAnother && (
                <button
                    onClick={onLogAnother}
                    className="mx-[0.3rem] inline-block rounded-lg border-none bg-ink px-[1.6rem] py-[0.8rem] font-semibold text-white"
                >
                    Log another
                </button>
            )}
            <Link
                href={menuHref}
                className="mx-[0.3rem] inline-block rounded-lg bg-ink px-[1.6rem] py-[0.8rem] font-semibold text-white no-underline"
            >
                Back to menu
            </Link>
        </div>
    );
}

/** Shared "+ Add / Submit / secondary action" button row wrapper — just
 * spacing; buttons pass their own color via className. */
export function FormActions({ children }) {
    return <div className="mt-2">{children}</div>;
}
