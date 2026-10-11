"use client";

import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

/**
 * Imperative-promise modals (confirmModal/noticeModal below) each mount
 * their own ad-hoc React root straight into document.body, outside the
 * app's own component tree — no router/Suspense transition to piggyback
 * on. An earlier version tried driving the open/close animation through
 * React's <ViewTransition> here, but that API's snapshot/timing model is
 * built around the main app tree (router navigations, Suspense) and
 * fought with this root's own manual mount/unmount, producing a visible
 * glitch on close (closes, snaps back, closes again). Plain CSS
 * transitions tied directly to a `closing` boolean are simpler and fully
 * reliable for this specific "animate an imperative overlay in and out"
 * shape. External call sites never see any of this — confirmModal/
 * noticeModal's own exported signatures and behavior are unchanged.
 */
// Must match the literal `duration-150` Tailwind classes below — Tailwind's
// JIT scanner needs the class name written out statically in this file to
// generate it, so these two stay in sync by hand rather than being derived
// from one shared constant via string interpolation (see BtnCard.js's own
// comment on the same constraint for chip colors).
const TRANSITION_MS = 150;

/** Mounts `panel` inside an animated backdrop (`backdropClassName` + optional
 * `backdropExtraProps`, e.g. onClick-to-close). Returns requestClose(afterExit),
 * which plays the exit transition before running the real cleanup. */
function mountAnimatedModal(backdropClassName, panel, backdropExtraProps) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    let requestCloseRef = () => {};
    function Bridge() {
        const [visible, setVisible] = useState(false); // false -> true plays the enter transition
        const [closing, setClosing] = useState(false);

        useEffect(() => {
            // Mounted at opacity-0/scale-95; flip on the next frame so the
            // transition actually plays instead of starting already-settled.
            const raf = requestAnimationFrame(() => setVisible(true));
            return () => cancelAnimationFrame(raf);
        }, []);

        requestCloseRef = (afterExit) => {
            setClosing(true);
            setTimeout(afterExit, TRANSITION_MS);
        };

        const shown = visible && !closing;
        return (
            <div className={backdropClassName + " transition-opacity duration-150 ease-out " + (shown ? "opacity-100" : "opacity-0")} {...backdropExtraProps}>
                <div className={"transition-[transform,opacity] duration-150 ease-out " + (shown ? "scale-100 opacity-100" : "scale-95 opacity-0")}>{panel}</div>
            </div>
        );
    }
    root.render(<Bridge />);

    function requestClose(afterExit) {
        requestCloseRef(() => {
            root.unmount();
            container.remove();
            afterExit();
        });
    }

    return requestClose;
}

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
        // Below 720px this becomes a bottom sheet (full width, anchored to
        // the bottom edge) instead of a small floating card — same pattern
        // as the Data Tables and Action Inbox detail modals.
        const requestClose = mountAnimatedModal(
            "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end",
            <div className="w-[26rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]">
                <p>{message}</p>
                <div className="mt-[0.8rem] flex justify-end gap-[0.6rem] max-[720px]:flex-col-reverse">
                    <button
                        className="rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink max-[720px]:min-h-[2.75rem]"
                        onClick={() => requestClose(() => resolve(false))}
                    >
                        Cancel
                    </button>
                    <button
                        className={
                            "rounded-lg border-none px-4 py-[0.6rem] text-[0.9rem] font-semibold max-[720px]:min-h-[2.75rem] " +
                            (danger ? "bg-danger-ink text-white hover:bg-danger-ink/90" : "bg-accent text-accent-ink")
                        }
                        onClick={() => requestClose(() => resolve(true))}
                    >
                        {confirmLabel || "Leave"}
                    </button>
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
        const close = () => requestClose(() => resolve(false));
        const lines = String(message || "Something went wrong.").split("\n");

        const requestClose = mountAnimatedModal(
            "fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end",
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
                            onClick={() => requestClose(() => resolve(true))}
                        >
                            {options.actionLabel}
                        </button>
                    )}
                </div>
            </div>,
            { onClick: close, onKeyDown: (e) => e.key === "Escape" && close() },
        );
    });
}
