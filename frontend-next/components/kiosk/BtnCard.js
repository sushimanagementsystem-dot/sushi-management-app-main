import Link from "next/link";
import { ChevronRight } from "lucide-react";

/**
 * Shared tappable card link (kiosk menu items, index.html's kiosk picker).
 * Ported from the `.btn-card` class. Uses next/link, not a plain <a> —
 * every kiosk menu tap previously did a full page reload (fresh SSR
 * render, every in-memory cache thrown away) instead of a client-side
 * transition, same class of bug as the dashboard sidebar's.
 *
 * `Icon` is a lucide-react component, not a string — one consistent line-
 * icon set across every form tile instead of mismatched emoji glyphs that
 * render differently per OS/browser.
 *
 * Two layouts in one component, switched at `sm:` (640px) — below that,
 * a full-width row (icon-left, label, chevron: the natural shape for a
 * thumb-scrolled list on a phone); at and above it, a centered tile
 * (icon-on-top, label-below, no chevron: the shape that reads right sitting
 * in a multi-column grid instead of a single vertical list). No own
 * margin-bottom — spacing between cards is the parent layout's job (a
 * `gap-*` on a flex/grid container), so it stays even in both a stacked
 * list and a multi-column grid instead of doubling up with a grid gap.
 */
export default function BtnCard({ href, Icon, children, onClick }) {
    return (
        <Link
            href={href}
            onClick={onClick}
            className="group relative flex w-full items-center gap-3.5 overflow-hidden rounded-card border border-line bg-card p-4 text-[0.95rem] font-medium text-ink no-underline shadow-elevate-1 transition-all duration-150 hover:-translate-y-px hover:border-accent/30 hover:shadow-elevate-2 active:translate-y-0 active:scale-[0.985] active:bg-panel sm:h-full sm:flex-col sm:items-center sm:gap-2.5 sm:p-5 sm:text-center sm:hover:-translate-y-1"
        >
            {/* Accent edge — a left bar sliding down for the list row, a
                top bar sliding in for the grid tile (same "this card is
                alive" cue the dashboard's KpiTile uses). */}
            <span className="absolute inset-y-0 left-0 w-[3px] origin-top scale-y-0 bg-accent transition-transform duration-150 group-hover:scale-y-100 sm:hidden" />
            <span className="absolute inset-x-0 top-0 hidden h-[3px] origin-left scale-x-0 bg-accent transition-transform duration-150 group-hover:scale-x-100 sm:block" />

            {Icon && (
                <span
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-panel text-muted transition-colors duration-150 group-hover:bg-accent-soft group-hover:text-accent sm:h-12 sm:w-12"
                    aria-hidden
                >
                    <Icon size={18} strokeWidth={1.9} className="sm:hidden" />
                    <Icon size={22} strokeWidth={1.8} className="hidden sm:block" />
                </span>
            )}
            <span className="flex-1 sm:flex-none sm:text-[0.88rem] sm:leading-snug">{children}</span>
            <ChevronRight
                size={17}
                strokeWidth={2}
                className="flex-shrink-0 text-muted transition-transform duration-150 group-hover:translate-x-[2px] group-hover:text-accent sm:hidden"
            />
        </Link>
    );
}
