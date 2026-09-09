/**
 * Fixed bottom bar for long list-style kiosk forms (Fridge Count, Weekly
 * Stocktake, Monthly Audit) — the count/progress and the submit action stay
 * visible without scrolling all the way down, and the plain "X / Y counted"
 * text becomes an actual progress bar. Render `<StickyActionBar.Spacer />`
 * as the last thing inside the page's `Wrap` so the fixed bar never covers
 * the last row of content.
 */
export default function StickyActionBar({ children, filled, total }) {
    const hasProgress = typeof total === "number" && total > 0;
    const pct = hasProgress ? Math.min(100, Math.round((filled / total) * 100)) : 0;

    return (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(16,24,40,0.08)] backdrop-blur">
            <div className="mx-auto max-w-5xl">
                {hasProgress && (
                    <div className="mb-2 flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                            <div
                                className="h-full rounded-full bg-accent transition-[width] duration-300"
                                style={{ width: pct + "%" }}
                            />
                        </div>
                        <span className="flex-none text-[0.75rem] font-medium text-muted">
                            {filled} / {total}
                        </span>
                    </div>
                )}
                {children}
            </div>
        </div>
    );
}

StickyActionBar.Spacer = function Spacer() {
    return <div className="h-[5.5rem]" />;
};
