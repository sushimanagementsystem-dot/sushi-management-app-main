import { X } from "lucide-react";

/**
 * Shared "one row of a repeatable line-item form" card — category/product/
 * qty style rows (Morning Waste, Food Waste, Move Stock, Stocktake, …) all
 * share this shape. Replaces the old bare `flex gap-[0.4rem]` row with a
 * bordered card + a labelled field per input, so it's obvious at a glance
 * what each control is for and where one line ends and the next begins —
 * the ported HTML forms relied on placeholder text alone for that, which
 * disappears the moment a field has a value. No own margin — spacing between
 * cards is the parent grid/flex container's `gap-*`, same convention as
 * BtnCard, so it stays even whether the parent renders one column or a
 * multi-column grid.
 *
 * Each field is `<div className="w-*"><FieldLabel/><select|input/></div>` —
 * the width lives on that wrapper div, not the control itself (a caller
 * that reused a bare `<select>`/`<input>` from the old unlabelled rows
 * dropped their own `w-*` class in the move, so a plain number input fell
 * back to the browser's intrinsic ~15rem width and silently overflowed its
 * narrow wrapper). `[&>div>select]`/`[&>div>input]` force any such direct
 * child back to 100% of its wrapper so this can't regress per call site;
 * SearchPick's own input sits one div deeper (its own wrapper), so it's
 * unaffected and keeps using its own `w-full`.
 */
export function LineCard({ children, onRemove }) {
    return (
        <div className="group relative rounded-card border border-line bg-card p-3 pr-9 shadow-elevate-1 transition-shadow duration-150 hover:shadow-elevate-2">
            <div className="flex gap-2 [&>div>input]:w-full [&>div>select]:w-full">{children}</div>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Remove line"
                    className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border-none bg-panel p-0 text-muted transition-colors duration-150 hover:bg-danger-bg hover:text-danger-ink"
                >
                    <X size={13} strokeWidth={2.2} />
                </button>
            )}
        </div>
    );
}

/** Small caption above a field inside a LineCard — `w-*`/`flex-1` etc go on
 * the wrapping <div>, not this, so field widths stay the caller's call. */
export function FieldLabel({ children }) {
    return (
        <label className="mb-1 block text-[0.68rem] font-semibold uppercase tracking-[0.04em] text-muted">
            {children}
        </label>
    );
}
