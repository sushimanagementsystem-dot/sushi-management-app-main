"use client";

import { useEffect, useRef, useState } from "react";
import "tabulator-tables/dist/css/tabulator.min.css";
import "@/components/dashboard/tables/tabulator-theme.css";
import PageTitle from "@/components/PageTitle";
import DashboardShell, { useUnsavedGuard } from "@/components/DashboardShell";
import { createTablesPageController } from "@/components/dashboard/tables/DataTablesController";

/**
 * /dashboard/tables, /dashboard/tables/<table>, and
 * /dashboard/tables/<table>/detail/<rowId> all resolve here (optional
 * catch-all) — DataTablesController reads/writes the exact URL itself via
 * window.location/history, matching the original plain-HTML page's own
 * routing, so this component doesn't need to read the [slug] param at all.
 */
export default function DataTablesPage() {
    const [title, setTitle] = useState("Dashboard — Data Tables");

    return (
        <>
            <PageTitle title={title} />
            <DashboardShell activeKey="tables">
                <TablesPageContent onTitleChange={setTitle} />
            </DashboardShell>
        </>
    );
}

/** Rendered as DashboardShell's child (not a sibling) specifically so
 * useUnsavedGuard() resolves the real registration function from
 * DashboardShell's UnsavedGuardContext.Provider, not the no-op default a
 * component above/outside DashboardShell would get. */
function TablesPageContent({ onTitleChange }) {
    const mountRef = useRef(null);
    const registerUnsavedGuard = useUnsavedGuard();

    useEffect(() => {
        if (!mountRef.current) return;
        const controller = createTablesPageController(mountRef.current, {
            onTitleChange: onTitleChange,
        });
        registerUnsavedGuard(() => controller.hasUnsavedChanges());
        return () => {
            registerUnsavedGuard(null);
            controller.destroy();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // overflow-y-auto here — not on the header/grid individually — makes
    // this one element the page's whole scroll region: the sticky header
    // built in DataTablesController.js pins to its top while everything
    // below (table pills, toolbar under it via toolbarHost, and the grid
    // itself, now unbounded) scrolls together underneath it.
    return <div ref={mountRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" />;
}
