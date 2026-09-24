"use client";

import { createRoot } from "react-dom/client";

/**
 * Styled yes/no confirmation, reusing the same modal look as dashboard "add
 * row" forms. Resolves true if the user chose to proceed. confirmLabel
 * defaults to "Leave" (the original nav-guard use case) — pass something
 * like "Delete" for other confirmations, and `danger: true` when the
 * action actually destroys stored data (not just an unsaved local edit) —
 * that button renders red instead of the standard brand-green, so a
 * delete confirmation never looks the same as a routine "yes, continue."
 * Ported from dashboard-common.js's confirmModal(), kept as an imperative
 * promise-returning function (rather than a controlled component) so call
 * sites — many, scattered through every dashboard page — don't need their
 * own modal-open state. Pure Tailwind utility classes, no custom CSS.
 */
export function confirmModal(message, confirmLabel, danger) {
    return new Promise((resolve) => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);

        const cleanup = (result) => {
            root.unmount();
            container.remove();
            resolve(result);
        };

        // Below 720px this becomes a bottom sheet (full width, anchored to
        // the bottom edge) instead of a small floating card — same pattern
        // as the Data Tables and Action Inbox detail modals.
        root.render(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end">
                <div className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]">
                    <p>{message}</p>
                    <div className="mt-[0.8rem] flex justify-end gap-[0.6rem] max-[720px]:flex-col-reverse">
                        <button
                            className="rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink max-[720px]:min-h-[2.75rem]"
                            onClick={() => cleanup(false)}
                        >
                            Cancel
                        </button>
                        <button
                            className={
                                "rounded-lg border-none px-4 py-[0.6rem] text-[0.9rem] font-semibold max-[720px]:min-h-[2.75rem] " +
                                (danger ? "bg-danger-ink text-white hover:bg-danger-ink/90" : "bg-accent text-accent-ink")
                            }
                            onClick={() => cleanup(true)}
                        >
                            {confirmLabel || "Leave"}
                        </button>
                    </div>
                </div>
            </div>,
        );
    });
}

/**
 * Styled replacement for the browser's alert() — a title, a message, one OK button. Multi-line messages are laid
 * out properly: a line starting with "• " becomes a list item, a blank line a gap, anything else a paragraph
 * (see the invoice "can't confirm yet" message). Pass `{ actionLabel }` to add a primary action button next to
 * "Close"; the promise resolves true if that button was clicked, false/undefined otherwise.
 */
export function noticeModal(message, title, options = {}) {
    return new Promise((resolve) => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        const finish = (result) => {
            root.unmount();
            container.remove();
            resolve(result);
        };
        const close = () => finish(false);

        const lines = String(message || "Something went wrong.").split("\n");
        root.render(
            <div
                className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end"
                onClick={close}
                onKeyDown={(e) => e.key === "Escape" && close()}
            >
                <div
                    role="alertdialog"
                    aria-modal="true"
                    className="w-[30rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className="m-0 mb-[0.6rem] text-[1.05rem] font-bold tracking-[-0.01em] text-ink">{title || "Something needs attention"}</h3>
                    <div className="text-[0.92rem] leading-snug text-ink">
                        {lines.map((ln, i) =>
                            ln.startsWith("• ") ? (
                                <div key={i} className="mt-1.5 rounded-lg bg-panel px-3 py-2">
                                    {ln.slice(2)}
                                </div>
                            ) : ln.trim() === "" ? (
                                <div key={i} className="h-2" />
                            ) : (
                                <p key={i} className="m-0 mt-1">
                                    {ln}
                                </p>
                            ),
                        )}
                    </div>
                    <div className="mt-[1rem] flex justify-end gap-[0.6rem] max-[720px]:flex-col-reverse">
                        <button
                            autoFocus={!options.actionLabel}
                            className={
                                "rounded-lg border-none px-5 py-[0.6rem] text-[0.9rem] font-semibold max-[720px]:min-h-[2.75rem] " +
                                (options.actionLabel ? "bg-line text-ink" : "bg-accent text-accent-ink")
                            }
                            onClick={close}
                        >
                            {options.actionLabel ? "Close" : "OK"}
                        </button>
                        {options.actionLabel && (
                            <button
                                autoFocus
                                className="rounded-lg border-none bg-accent px-5 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink max-[720px]:min-h-[2.75rem]"
                                onClick={() => finish(true)}
                            >
                                {options.actionLabel}
                            </button>
                        )}
                    </div>
                </div>
            </div>,
        );
    });
}
