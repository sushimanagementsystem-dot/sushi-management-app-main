"use client";

import { useEffect, useState } from "react";

/**
 * Searchable picker for long lists (native <select> has no search on any
 * platform), ported from assets/search-pick.js. getItems(query) applies
 * its own filtering (category, already-picked, etc); query is lowercased.
 * Pure Tailwind utility classes, no custom CSS.
 */
export default function SearchPick({ getItems, onSelect, placeholder, value }) {
    const [query, setQuery] = useState(value || "");
    const [open, setOpen] = useState(false);

    useEffect(() => {
        setQuery(value || "");
    }, [value]);

    const items = open ? getItems(query.trim().toLowerCase()).slice(0, 40) : [];

    return (
        <div className="relative min-w-0 flex-1">
            <input
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
            {items.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+2px)] z-30 max-h-[40vh] overflow-y-auto rounded border border-line bg-white shadow-[0_6px_16px_rgba(16,24,40,0.12)]">
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
                </div>
            )}
        </div>
    );
}
