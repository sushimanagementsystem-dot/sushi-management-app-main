/**
 * The one compact <select> size used across the dashboard's filter rows —
 * KpiFilters' kiosk picker, the Action Inbox's status/category/priority/
 * kiosk filters, and anywhere else a plain dropdown belongs next to the
 * date-range presets. Plain <select> falls back to the global base-layer
 * sizing (input/select/button { padding: 0.7rem }), which is right for
 * kiosk staff forms (touch targets) but reads oversized in this dense,
 * desktop-oriented filter-row context — this is the one override, reused
 * instead of repeated per page.
 */
export default function DashSelect({ className = "", ...props }) {
    return (
        <select
            {...props}
            className={
                "w-auto py-1 pl-2 pr-6 text-[0.72rem] max-[720px]:min-h-[2.75rem] max-[720px]:w-full max-[720px]:py-[0.7rem] max-[720px]:pr-[2.2rem] max-[720px]:text-base " +
                className
            }
        />
    );
}
