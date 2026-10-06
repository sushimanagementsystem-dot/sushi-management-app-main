"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Searchable picker for long lists (native <select> has no search on any
 * platform), ported from assets/search-pick.js. getItems(query) applies
 * its own filtering (category, already-picked, etc); query is lowercased.
 * Pure Tailwind utility classes, no custom CSS.
 *
 * The results list is rendered through a portal into document.body,
 * positioned by the input's own on-screen rect, instead of as a plain
 * absolutely-positioned child. Several uses of this picker (the Invoice
 * Review and Stocktake line editors) sit inside a horizontally-scrolling
 * table wrapper (`overflow-x-auto`) — per the CSS overflow spec, setting
 * overflow-x alone forces the computed overflow-y to `auto` too, so that
 * wrapper silently became a clipping container and cropped the dropdown
 * instead of letting it float over the rest of the page. A portal escapes
 * that ancestor entirely, the same reason BulkImport's modal uses one.
 */
export default function SearchPick({ getItems, onSelect, placeholder, value }) {
    const [query, setQuery] = useState(value || "");
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState(null);
    const inputRef = useRef(null);

    useEffect(() => {
        setQuery(value || "");
    }, [value]);

    useEffect(() => {
        if (!open) return;
        const measure = () => {
            const r = inputRef.current?.getBoundingClientRect();
            if (!r) return;
            // Always noticeably wider than the input itself, not just "at least as wide" — several call sites
            // (Food Waste, Move Stock) keep this search box narrow since Category/Grams share the same row,
            // which used to make the dropdown just as narrow and wrap long item names onto 2-3 lines (e.g.
            // "BAMBOO ROLLING MAT"). A wider floating panel reads fine overlapping whatever's beside the input —
            // it's a portal, not part of the row's layout — but it's clamped to the viewport width (minus a
            // margin) so it can never run off either edge or force horizontal scroll on a narrow phone.
            const MARGIN = 8;
            const EXTRA_WIDTH = 80;
            const MIN_WIDTH = 260;
            const maxAvailableWidth = window.innerWidth - MARGIN * 2;
            const width = Math.min(Math.max(r.width + EXTRA_WIDTH, MIN_WIDTH), maxAvailableWidth);
            const maxLeft = window.innerWidth - width - MARGIN;
            const left = Math.max(MARGIN, Math.min(r.left, maxLeft));
            setRect({ top: r.bottom + 2, left, width });
        };
        measure();
        // Scrolling (the page, or the table's own horizontal scroll container) or resizing would leave a
        // stale-positioned dropdown floating in the wrong place — closing is simpler and safer than
        // re-tracking every possible scroll ancestor.
        const close = () => setOpen(false);
        window.addEventListener("scroll", close, true);
        window.addEventListener("resize", close);
        return () => {
            window.removeEventListener("scroll", close, true);
            window.removeEventListener("resize", close);
        };
    }, [open]);

    const items = open ? getItems(query.trim().toLowerCase()).slice(0, 40) : [];

    return (
        <div className="relative min-w-0 flex-1">
            <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                placeholder={placeholder || "Search…"}
                value={query}
                className="w-full"
                onChange={(e) => {
                    setQuery(e.target.value);
                    setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
            />
            {items.length > 0 &&
                rect &&
                createPortal(
                    <div
                        style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
                        className="z-50 max-h-[40vh] overflow-y-auto rounded border border-line bg-white shadow-[0_6px_16px_rgba(16,24,40,0.12)]"
                    >
                        {items.map((it) => (
                            <div
                                key={it.id}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    setQuery(it.label);
                                    setOpen(false);
                                    onSelect(it);
                                }}
                                className="border-b border-line px-[0.8rem] py-[0.7rem] last:border-b-0 active:bg-panel"
                            >
                                {it.label}
                            </div>
                        ))}
                    </div>,
                    document.body,
                )}
        </div>
    );
}
