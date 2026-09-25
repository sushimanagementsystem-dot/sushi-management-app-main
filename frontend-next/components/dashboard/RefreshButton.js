"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { apiCall } from "@/lib/api";

/**
 * Clears the backend's whole-table cache (TableCacheService) first, then
 * refetches this page's own query — so "Refresh" genuinely means fresh
 * data end to end, not just a React Query refetch that could still hit a
 * warm backend cache. Every write path already invalidates its own
 * table on save, so this only matters for data that changed outside the
 * app's normal write paths; it's a manual escape hatch, not something
 * pages need to reach for after a normal save (those already refetch).
 */
export default function RefreshButton({ onRefetch, className = "" }) {
    const [spinning, setSpinning] = useState(false);

    async function handleClick() {
        setSpinning(true);
        try {
            await apiCall("refresh_cache", {});
        } catch {
            // Best-effort — still refetch even if the cache-clear call itself failed.
        }
        try {
            await onRefetch();
        } finally {
            setSpinning(false);
        }
    }

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={spinning}
            title="Refresh data — also clears the backend cache"
            className={
                "flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2 py-1 text-[0.72rem] font-medium text-ink shadow-elevate-1 hover:border-accent/40 hover:bg-panel hover:text-accent disabled:opacity-50 " +
                className
            }
        >
            <RefreshCw size={15} strokeWidth={2.25} className={spinning ? "animate-spin" : ""} />
            Refresh
        </button>
    );
}
