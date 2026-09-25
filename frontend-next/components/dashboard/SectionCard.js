/**
 * Groups a labeled section of a dashboard page (a KpiTileGrid, a table, a
 * settings block) inside a single visually-distinct panel — bordered,
 * softly shadowed, its own bg-card surface — instead of a plain uppercase
 * label floating directly on the page's grey background with tiles
 * underneath it. This is the difference between "a page with some
 * headings on it" and "a dashboard made of panels," which is how every
 * real product dashboard (Stripe, Linear, Vercel) actually structures a
 * page: a stack of discrete panels, not one continuous scroll of labels
 * and cards.
 */
import HelpTip from "./HelpTip";

export default function SectionCard({ title, description, actions, children, className = "", help }) {
    // bg-panel, not bg-card (pure white) — so nested white KpiTiles
    // still read as distinct cards floating inside the panel, instead of
    // both surfaces being the same white and the border being the only
    // thing separating them.
    return (
        <section className={"mb-5 rounded-card border border-line bg-panel p-4 shadow-elevate-1 sm:p-5 " + className}>
            {(title || actions) && (
                <div className="mb-3.5 flex flex-wrap items-start justify-between gap-2">
                    <div>
                        {title && (
                            <h2 className="text-[0.78rem] font-bold uppercase tracking-[0.06em] text-muted">
                                {title}
                                {help && <HelpTip id={help} />}
                            </h2>
                        )}
                        {description && <p className="mt-0.5 text-[0.8rem] text-muted">{description}</p>}
                    </div>
                    {actions && <div className="flex-shrink-0">{actions}</div>}
                </div>
            )}
            {children}
        </section>
    );
}
