/**
 * The one small rounded toggle-button used everywhere a short list of
 * mutually-exclusive choices needs a "filled pill = selected" picker —
 * KpiFilters' date-range presets, the Submissions page's kiosk picker,
 * Product Prices' Finished Products/Stock Items switch, and anywhere else
 * this shape shows up. Was copy-pasted with slightly different sizing in
 * each place (some of which drifted large); this is the one definition so
 * a size or color tweak lands everywhere at once.
 */
export default function PillButton({ active, onClick, icon: Icon, children, className = "" }) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-active={active}
            className={
                "flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-[0.2rem] text-[0.72rem] font-semibold transition-colors duration-100 " +
                "max-[720px]:min-h-[2.75rem] max-[720px]:px-[0.9rem] max-[720px]:py-[0.4rem] max-[720px]:text-[0.85rem] " +
                (active
                    ? "border-accent bg-accent text-accent-ink shadow-elevate-1"
                    : "border-line bg-card text-muted hover:border-accent/40 hover:text-ink hover:shadow-elevate-1") +
                " " +
                className
            }
        >
            {Icon && <Icon size={15} strokeWidth={2.25} />}
            {children}
        </button>
    );
}
