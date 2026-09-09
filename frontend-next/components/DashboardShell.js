"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
    LayoutDashboard,
    AlertOctagon,
    Inbox,
    ListChecks,
    Scale,
    Package,
    AlertTriangle,
    Tag,
    UtensilsCrossed,
    TrendingUp,
    FileBarChart2,
    Table2,
    Settings as SettingsIcon,
    Globe,
    PanelLeftClose,
    PanelLeft,
} from "lucide-react";
import { requireRole } from "@/lib/api";
import { confirmModal } from "./ConfirmModal";

/**
 * DashboardShell — ported from assets/dashboard-common.js's initDashboard()
 * and dashboard.css's sidebar rules, using pure Tailwind utility classes
 * (no custom CSS). Runs the requireRole("dashboard") gate every dashboard
 * page needs, then renders the sidebar (highlighting the active section)
 * and reveals the content — which stays hidden until access is confirmed,
 * same reveal-after-auth pattern as the kiosk home page's menu.
 *
 * href is null for a section that hasn't been built yet, rendering it as a
 * disabled "soon" item instead of a link — kept for parity even though
 * every section currently has a real page.
 *
 * Sidebar is a light, bordered panel (not a dark filled block) with a
 * restrained active state — a pale accent tint + a thin left accent bar,
 * never a solid bright pill — so the current section reads as "selected"
 * without shouting.
 */
// shortLabel is only for the mobile bottom tab bar (max-[720px]) — six
// equal-width flex-1 tabs at that width don't have room for "Kiosk
// Comparison" or "Stock Usage View" without truncating into something
// unreadable, so the mobile bar gets its own short, unambiguous label
// instead of ellipsis-cutting the desktop one.
//
// Grouped (not one flat 14-item list) so the sidebar itself communicates
// what each section is for at a glance — same grouped-menu pattern the
// kiosk home page already uses (MENU_GROUPS in KioskHomeContent.js).
// Groups are desktop-only signal (see the render loop below): the mobile
// bottom tab bar stays one flat scrollable icon strip, same as before.
const DASHBOARD_GROUPS = [
    {
        label: "Main",
        sections: [
            { key: "overview", Icon: LayoutDashboard, label: "Overview", shortLabel: "Overview", href: "/dashboard" },
            { key: "issues", Icon: AlertOctagon, label: "Issues", shortLabel: "Issues", href: "/dashboard/issues" },
            { key: "inbox", Icon: Inbox, label: "Action Inbox", shortLabel: "Inbox", href: "/dashboard/inbox" },
            { key: "submissions", Icon: ListChecks, label: "All Submissions", shortLabel: "Submitted", href: "/dashboard/submissions" },
        ],
    },
    {
        label: "Insights",
        sections: [
            { key: "kiosk-comparison", Icon: Scale, label: "Kiosk Comparison", shortLabel: "Compare", href: "/dashboard/kiosk-comparison" },
            { key: "stock-usage", Icon: Package, label: "Stock Usage View", shortLabel: "Stock", href: "/dashboard/stock-usage" },
            { key: "stock-variances", Icon: AlertTriangle, label: "Stock Variances", shortLabel: "Variances", href: "/dashboard/stock-variances" },
            { key: "staff-food", Icon: UtensilsCrossed, label: "Staff Food", shortLabel: "Food", href: "/dashboard/staff-food" },
            { key: "profit", Icon: TrendingUp, label: "Profit", shortLabel: "Profit", href: "/dashboard/profit" },
            { key: "reports", Icon: FileBarChart2, label: "Reports", shortLabel: "Reports", href: "/dashboard/reports" },
        ],
    },
    {
        label: "Manage",
        sections: [
            { key: "product-prices", Icon: Tag, label: "Product Prices", shortLabel: "Prices", href: "/dashboard/product-prices" },
            { key: "tables", Icon: Table2, label: "Data Tables", shortLabel: "Tables", href: "/dashboard/tables" },
            { key: "settings", Icon: SettingsIcon, label: "Settings", shortLabel: "Settings", href: "/dashboard/settings" },
            { key: "site-config", Icon: Globe, label: "Site Configuration", shortLabel: "Site Config", href: "/dashboard/site-config" },
        ],
    },
];

const DASH_COLLAPSE_KEY = "dash_sidebar_collapsed";

const UnsavedGuardContext = createContext(() => {});

/** Registers a predicate ("are there unsaved changes right now?") that both
 * the sidebar's own link clicks and the browser's native reload/close
 * prompt check before letting navigation through. Call with null to clear
 * it (e.g. right after a confirmed leave, or a successful save). */
export function useUnsavedGuard() {
    return useContext(UnsavedGuardContext);
}

export default function DashboardShell({ activeKey, children }) {
    const router = useRouter();
    const [allowed, setAllowed] = useState(false);
    const [collapsed, setCollapsed] = useState(false);
    const guardRef = useRef(null);
    const mobileNavRef = useRef(null);

    // The mobile bottom bar now scrolls horizontally (8 sections is too
    // many to cram into equal-width tabs on a phone — see the nav's own
    // comment below) — position it so the active tab is centered, so
    // opening a page deep in the list (e.g. Settings) doesn't land with
    // its own tab scrolled off-screen. Every dashboard page mounts its
    // own DashboardShell (no shared layout hosting one persistent
    // instance), so this effect genuinely re-runs on every navigation,
    // not just first load — an ANIMATED scroll here (as KpiFilters' preset
    // pills use) was visibly jarring on every single tap, including
    // tapping a tab already in view. Setting scrollLeft directly (no
    // `behavior: "smooth"`) positions it before the bar is ever painted,
    // so there's nothing to see move.
    useEffect(() => {
        const container = mobileNavRef.current;
        const active = container?.querySelector('[data-active="true"]');
        if (!container || !active) return;
        // A manual scrollLeft computation, not scrollIntoView — this
        // container's ancestor (<nav>) is position:fixed, which throws off
        // scrollIntoView's ancestor-scroll-chain math in some browsers (it
        // undershoots instead of centering). offsetLeft/clientWidth
        // arithmetic doesn't depend on that at all.
        const target = active.offsetLeft - container.clientWidth / 2 + active.offsetWidth / 2;
        // scrollTo(..., { behavior: "instant" }), not a plain `scrollLeft =`
        // assignment — this container has CSS `scroll-behavior: smooth`
        // (Tailwind's scroll-smooth, for the user's own swipe/drag), and
        // Chrome applies that to EVERY programmatic scroll including a
        // direct scrollLeft set, not just explicit scrollTo() calls. A bare
        // assignment here was silently getting animated and then never
        // actually landing. `behavior: "instant"` is the one thing that
        // reliably overrides the CSS setting for this positioning call —
        // tried gating this behind an "already visible, skip it" check plus
        // `behavior: "smooth"` to soften it, but that broke the centering
        // itself in real testing, so it stays instant. Any "should feel
        // smoother" polish belongs in the tab's own hover/active CSS
        // transition, not here.
        container.scrollTo({ left: Math.max(0, target), behavior: "instant" });
    }, [activeKey]);

    useEffect(() => {
        // Applied immediately, not gated behind the (async) role check —
        // it's a stored UI preference with no permission implications, so
        // doing it here (post-mount, once) avoids an SSR/client markup
        // mismatch while still avoiding a visible flash of the expanded
        // sidebar before this runs.
        if (localStorage.getItem(DASH_COLLAPSE_KEY) === "1") setCollapsed(true);
    }, []);

    useEffect(() => {
        let cancelled = false;
        requireRole("dashboard", router).then((ok) => {
            if (!cancelled) setAllowed(ok);
        });
        return () => {
            cancelled = true;
        };
    }, [router]);

    useEffect(() => {
        const handler = (e) => {
            if (!guardRef.current || !guardRef.current()) return;
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, []);

    const toggleSidebar = () => {
        setCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem(DASH_COLLAPSE_KEY, next ? "1" : "0");
            // The sidebar's width transition changes the main pane's actual
            // width without a window resize event firing, so anything
            // sizing itself off its container (e.g. a Tabulator grid)
            // needs an explicit nudge.
            window.dispatchEvent(new CustomEvent("dash-sidebar-toggled"));
            return next;
        });
    };

    // Plain <a href> tags here previously fell through to a full browser
    // navigation on every sidebar click whenever nothing blocked it (the
    // guard only ever called preventDefault on the unsaved-changes path) —
    // a full page reload (fresh SSR render, JS re-parse, every in-memory
    // cache — React Query, TableCacheService's warm connections — thrown
    // away) on every single dashboard section switch. router.push keeps
    // navigation client-side like the rest of the app.
    const handleNavClick = (e, href) => {
        e.preventDefault();
        if (guardRef.current && guardRef.current()) {
            confirmModal("You have unsaved changes. Leave without saving?").then((leave) => {
                if (leave) {
                    guardRef.current = null;
                    router.push(href);
                }
            });
            return;
        }
        router.push(href);
    };

    return (
        // print:h-auto/overflow-visible — a viewport-height flex column with
        // overflow-hidden is exactly what clips a printout to one screen's
        // worth of content; any dashboard page should be able to print/
        // "Save as PDF" its full content, not just what's currently
        // scrolled into view.
        <div className="flex h-screen bg-bg max-[720px]:h-auto max-[720px]:min-h-screen max-[720px]:flex-col print:h-auto print:overflow-visible">
            <nav
                className={
                    // print:hidden — the sidebar has no place in a printout.
                    "print:hidden " +
                    // overflow-hidden, not overflow-y-auto — the brand
                    // header below stays put; only the nav-items list (its
                    // own flex-1 overflow-y-auto further down) scrolls, so
                    // a short viewport with 11 sections doesn't scroll the
                    // logo out of view along with the list.
                    "flex flex-shrink-0 flex-col overflow-hidden border-r border-line bg-card py-4 transition-[width] duration-150 ease-in-out " +
                    // Below 720px the sidebar becomes a FIXED BOTTOM TAB BAR —
                    // the standard mobile-app nav pattern (thumb-reachable).
                    // Eight sections is too many to divide evenly across a
                    // phone's width (that math bottomed out at ~47px per
                    // tab — icon+label unreadable), so the tab row itself
                    // scrolls horizontally instead (see the inner div
                    // below), with the active tab auto-centered on load —
                    // same "current selection scrolls into view" pattern
                    // KpiFilters' preset pills use, not a cramped equal-
                    // width row.
                    "max-[720px]:fixed max-[720px]:inset-x-0 max-[720px]:bottom-0 max-[720px]:top-auto max-[720px]:z-40 " +
                    "max-[720px]:w-full max-[720px]:overflow-visible max-[720px]:border-r-0 max-[720px]:border-t max-[720px]:border-line max-[720px]:p-0 max-[720px]:pb-[env(safe-area-inset-bottom)] " +
                    (collapsed ? "w-[4.4rem] px-2" : "w-60 px-3")
                }
            >
                {/* Brand — a small emerald monogram mark + wordmark, the kind
                    of restrained "this is a real product" identity element a
                    template dashboard skips. */}
                <div
                    className={
                        "mb-3 flex items-center border-b border-line pb-4 max-[720px]:hidden " +
                        (collapsed ? "justify-center px-0" : "justify-between pl-1 pr-0.5")
                    }
                >
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent text-[0.85rem] font-bold text-accent-ink">
                            S
                        </span>
                        {!collapsed && (
                            <span className="overflow-hidden text-ellipsis whitespace-nowrap text-[0.95rem] font-semibold tracking-[-0.01em] text-ink">
                                Owner Dashboard
                            </span>
                        )}
                    </div>
                    {!collapsed && (
                        <button
                            type="button"
                            title="Collapse sidebar"
                            onClick={toggleSidebar}
                            className="flex-shrink-0 rounded-lg border-none bg-transparent p-1.5 leading-none text-muted hover:bg-panel hover:text-ink"
                        >
                            <PanelLeftClose size={17} strokeWidth={1.9} />
                        </button>
                    )}
                </div>
                {collapsed && (
                    <button
                        type="button"
                        title="Expand sidebar"
                        onClick={toggleSidebar}
                        className="mb-2 flex-shrink-0 self-center rounded-lg border-none bg-transparent p-1.5 leading-none text-muted hover:bg-panel hover:text-ink max-[720px]:hidden"
                    >
                        <PanelLeft size={17} strokeWidth={1.9} />
                    </button>
                )}

                <div
                    ref={mobileNavRef}
                    className={
                        // flex-1 overflow-y-auto — this list is the sidebar's
                        // own scrolling region (see the nav's overflow-hidden
                        // above); scrollbar-custom keeps a thin visible
                        // scrollbar here specifically, opting out of the
                        // global hide-scrollbar rule since "there's more
                        // below" is useful signal in a nav list.
                        "flex flex-1 flex-col gap-[0.15rem] overflow-y-auto scrollbar-custom pr-1 " +
                        "max-[720px]:w-full max-[720px]:flex-none max-[720px]:flex-row max-[720px]:items-stretch max-[720px]:justify-start max-[720px]:gap-0 max-[720px]:pr-0 " +
                        "max-[720px]:overflow-x-auto max-[720px]:overflow-y-hidden max-[720px]:scroll-smooth " +
                        // !-important: guarantees these win over
                        // .scrollbar-custom's own ::-webkit-scrollbar rule
                        // regardless of which one lands later in the
                        // compiled stylesheet — the mobile bottom tab bar
                        // was always meant to have no visible scrollbar at
                        // all (it's a horizontally-scrolling icon strip,
                        // not a list with a "there's more" affordance).
                        "max-[720px]:[scrollbar-width:none]! max-[720px]:[-ms-overflow-style:none]! max-[720px]:[&::-webkit-scrollbar]:hidden!"
                    }
                >
                    {DASHBOARD_GROUPS.map((group, groupIndex) => (
                        // display:contents — this wrapper is invisible to the
                        // parent's flex layout (vertical list on desktop,
                        // horizontal strip on mobile), so the group label and
                        // its items both participate directly in that flex
                        // context instead of being nested one level deep.
                        <div key={group.label} className="contents">
                            {collapsed ? (
                                // Collapsed to the icon-only rail — the text
                                // label has nowhere to go, so a thin rule
                                // takes over as the group divider instead of
                                // just vanishing.
                                groupIndex > 0 && <div className="mx-2 my-1.5 h-px flex-shrink-0 bg-line max-[720px]:hidden" />
                            ) : (
                                <div
                                    className={
                                        "flex-shrink-0 px-2.5 text-[0.68rem] font-bold uppercase tracking-[0.08em] text-muted/70 max-[720px]:hidden " +
                                        (groupIndex === 0 ? "mb-1" : "mb-1 mt-3")
                                    }
                                >
                                    {group.label}
                                </div>
                            )}
                            {group.sections.map((s) => {
                                const active = s.key === activeKey;
                                const Icon = s.Icon;
                                const itemClass =
                                    "group relative flex flex-shrink-0 items-center gap-2.5 rounded-lg text-[0.875rem] no-underline transition-colors duration-200 ease-out " +
                                    "max-[720px]:min-h-[3.4rem] max-[720px]:w-[4.75rem] max-[720px]:flex-shrink-0 max-[720px]:flex-col max-[720px]:justify-center max-[720px]:gap-[0.2rem] max-[720px]:rounded-none max-[720px]:px-[0.3rem] max-[720px]:py-[0.4rem] max-[720px]:text-center " +
                                    (collapsed ? "justify-center p-2.5" : "px-2.5 py-2") +
                                    (active ? " bg-accent-soft text-accent font-semibold" : " font-medium text-muted hover:bg-panel hover:text-ink");
                                return s.href ? (
                                    <Link
                                        key={s.key}
                                        href={s.href}
                                        data-active={active}
                                        className={itemClass}
                                        title={s.label}
                                        onClick={(e) => handleNavClick(e, s.href)}
                                    >
                                        {/* Thin left accent bar — the "current section"
                                            signal, deliberately not a filled pill. */}
                                        {active && (
                                            <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-full bg-accent max-[720px]:inset-x-3 max-[720px]:bottom-0 max-[720px]:top-auto max-[720px]:h-[2.5px] max-[720px]:w-auto" />
                                        )}
                                        <Icon size={18} strokeWidth={1.9} className="flex-shrink-0" />
                                        {!collapsed && (
                                            <>
                                                <span className="overflow-hidden whitespace-nowrap max-[720px]:hidden">{s.label}</span>
                                                <span className="hidden max-[720px]:block max-[720px]:text-[0.65rem] max-[720px]:font-medium max-[720px]:leading-tight">
                                                    {s.shortLabel}
                                                </span>
                                            </>
                                        )}
                                    </Link>
                                ) : (
                                    <div
                                        key={s.key}
                                        className={itemClass + " cursor-default text-muted opacity-45 hover:bg-transparent max-[720px]:pointer-events-none"}
                                        title={s.label + " (coming soon)"}
                                    >
                                        <Icon size={18} strokeWidth={1.9} className="flex-shrink-0" />
                                        {!collapsed && (
                                            <>
                                                <span className="overflow-hidden whitespace-nowrap max-[720px]:hidden">{s.label}</span>
                                                <span className="hidden max-[720px]:block max-[720px]:text-[0.65rem] max-[720px]:leading-tight">
                                                    {s.shortLabel}
                                                </span>
                                                <span className="ml-auto text-[0.65rem] uppercase tracking-[0.05em] max-[720px]:hidden">soon</span>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </nav>

            <main
                className="flex min-w-0 flex-1 flex-col overflow-hidden px-10 pt-4 pb-2 max-[720px]:overflow-visible max-[720px]:p-[1.2rem] max-[720px]:pb-[calc(4.6rem+env(safe-area-inset-bottom))] print:overflow-visible print:p-0"
                style={{ display: allowed ? "flex" : "none" }}
            >
                {allowed && (
                    <div className="mx-auto flex w-full min-h-0 max-w-[90rem] flex-1 flex-col">
                        <UnsavedGuardContext.Provider value={(fn) => (guardRef.current = fn)}>
                            {children}
                        </UnsavedGuardContext.Provider>
                    </div>
                )}
            </main>
        </div>
    );
}
