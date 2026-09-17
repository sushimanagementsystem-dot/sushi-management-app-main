/**
 * Shared page-header band — title + optional description on the left,
 * actions (Refresh button, etc.) on the right, a bottom rule separating
 * it from the page body. Every dashboard page used to just drop a bare
 * <h1> + button in a flex row directly on the page background; this
 * gives every page the same real "header" — the kind of consistent
 * chrome a designed product has, not a document with a heading tag at
 * the top.
 *
 * sticky top-0 — this must be rendered as the first child inside the
 * page's own scrolling container (see each page's outer
 * `overflow-y-auto` wrapper), not outside it, so the whole page body
 * (cards, tables, everything) scrolls as ONE region underneath a header
 * that stays pinned, instead of any individual card getting its own
 * fixed height + internal scrollbar.
 */
export default function PageHeader({ title, description, icon: Icon, actions, children }) {
    return (
        <div className="sticky top-0 z-20 mb-2 border-b border-line bg-bg pt-0.5">
            {/* No flex-wrap here on purpose — the title/description block
                (min-w-0 + flex-1) shrinks and wraps its own text across
                lines when the header gets narrow; actions (flex-shrink-0)
                stay put on the right on the same row instead of dropping
                below, which is what flex-wrap on this row used to do. */}
            <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                    {/* Optional — most pages don't pass one (a bare title has
                        always been the norm here), so this stays opt-in
                        rather than becoming a new requirement every caller
                        has to fill in. */}
                    {Icon && (
                        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                            <Icon size={23} strokeWidth={1.9} />
                        </span>
                    )}
                    <div className="min-w-0 flex-1">
                        <h1 className="text-[1.4rem] font-semibold tracking-[-0.015em] text-ink">{title}</h1>
                        {description && <p className="mt-1 text-[0.875rem] leading-relaxed text-muted">{description}</p>}
                    </div>
                </div>
                {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
            </div>
            {children && <div className="mt-3">{children}</div>}
        </div>
    );
}
