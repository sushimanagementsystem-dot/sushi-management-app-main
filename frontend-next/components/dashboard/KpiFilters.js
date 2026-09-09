import { useEffect, useRef } from "react";
import { KPI_PRESETS } from "@/lib/kpiUtils";
import PillButton from "./PillButton";
import DashSelect from "./DashSelect";

/** Kiosk select + date-range preset buttons + explicit date inputs — ported
 * from dashboard.html's buildKpiFilters_(). Shared by Overview, Kiosk
 * Comparison, and Stock Usage View. `filters` is { kioskId, startDate,
 * endDate }; `activePreset` (or null once a custom date is picked)
 * highlights the matching button. */
export default function KpiFilters({ kiosks, filters, activePreset, onKioskChange, onPreset, onStartDate, onEndDate }) {
    const scrollRef = useRef(null);

    // Presets live in one horizontally-scrolling row (never wrap to a
    // second line, which on a phone pushed the date inputs further down
    // and read as "broken" rather than "designed") — whichever preset is
    // selected scrolls itself to the center of that row, the same
    // auto-centering behavior as a native iOS segmented control or a
    // YouTube/Twitter category-tab strip.
    useEffect(() => {
        const active = scrollRef.current?.querySelector('[data-active="true"]');
        active?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }, [activePreset]);

    return (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {onKioskChange && (
                <DashSelect value={filters.kioskId} onChange={(e) => onKioskChange(e.target.value)}>
                    <option value="">All kiosks</option>
                    {(kiosks || []).map((k) => (
                        <option key={k.id} value={k.id}>
                            {k.name}
                        </option>
                    ))}
                </DashSelect>
            )}
            {/* One row, never wraps — overflow scrolls horizontally instead
                (invisible scrollbar; the row is short enough on desktop
                that nothing ever actually scrolls there). The kiosk select
                and date inputs below get their own full-width row on
                mobile — those were the controls genuinely cramped as small
                wrapped chips on a phone, not these. */}
            <div
                ref={scrollRef}
                className="flex flex-nowrap gap-1 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] max-[720px]:w-full [&::-webkit-scrollbar]:hidden"
            >
                {KPI_PRESETS.map((p) => (
                    <PillButton key={p.key} active={activePreset === p.key} onClick={() => onPreset(p.key)}>
                        {p.label}
                    </PillButton>
                ))}
            </div>
            <div className="flex items-center gap-1 max-[720px]:w-full">
                <input
                    type="date"
                    value={filters.startDate}
                    onChange={(e) => onStartDate(e.target.value)}
                    className="w-auto py-1 px-2 text-[0.72rem] max-[720px]:min-h-[2.75rem] max-[720px]:flex-1 max-[720px]:py-[0.7rem] max-[720px]:px-[0.7rem] max-[720px]:text-base"
                />
                <span className="text-[0.72rem] text-muted">to</span>
                <input
                    type="date"
                    value={filters.endDate}
                    onChange={(e) => onEndDate(e.target.value)}
                    className="w-auto py-1 px-2 text-[0.72rem] max-[720px]:min-h-[2.75rem] max-[720px]:flex-1 max-[720px]:py-[0.7rem] max-[720px]:px-[0.7rem] max-[720px]:text-base"
                />
            </div>
        </div>
    );
}
