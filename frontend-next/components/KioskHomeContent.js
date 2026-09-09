"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
    Trash2,
    Snowflake,
    UtensilsCrossed,
    Scale,
    Camera,
    FileText,
    LifeBuoy,
    ArrowLeftRight,
    ClipboardList,
    ClipboardCheck,
    Wrench,
} from "lucide-react";
import { getStoredSessionToken, requireKioskToken } from "@/lib/api";
import { useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import BtnCard from "@/components/kiosk/BtnCard";

const MENU_GROUPS = [
    {
        label: "Daily tasks",
        note: "Complete each of these tasks every day.",
        items: [
            { page: "morning-waste", Icon: Trash2, label: "Morning Waste" },
            { page: "fridge-count", Icon: Snowflake, label: "Morning Fridge Count" },
            { page: "staff-food", Icon: UtensilsCrossed, label: "Staff Food" },
        ],
    },
    {
        label: "As needed",
        note: "Complete the relevant task whenever the event occurs.",
        items: [
            { page: "food-waste", Icon: Scale, label: "Food Waste" },
            { page: "damaged-product", Icon: Camera, label: "Damaged Product Log" },
            { page: "delivery-invoices", Icon: FileText, label: "Delivery Invoices" },
            { page: "help-issues", Icon: LifeBuoy, label: "Help / Issues" },
            { page: "move-stock", Icon: ArrowLeftRight, label: "Move Stock Between Kiosks" },
        ],
    },
    {
        label: "Scheduled",
        note: "Weekly and monthly routines.",
        items: [
            { page: "weekly-stocktake", Icon: ClipboardList, label: "Weekly Stocktake" },
            { page: "monthly-audit", Icon: ClipboardCheck, label: "Monthly Audit" },
            { page: "audit-corrections", Icon: Wrench, label: "Audit Corrections" },
        ],
    },
];

/**
 * Kiosk home/menu — ported from pages/kiosk/home.html. Rendered at both
 * /[slug] and /[slug]/home (the original vercel.json rewrote both URLs to
 * the same home.html; every "back to menu" link in this app points at the
 * .../home form specifically, so both routes need to serve this).
 */
export default function KioskHomeContent() {
    const { slug } = useParams();
    const [token, setToken] = useState(null);
    const [signedIn, setSignedIn] = useState(false);

    useEffect(() => {
        const t = requireKioskToken();
        if (!t) return;
        if (!getStoredSessionToken()) {
            window.location.replace("/login?return=" + slug);
            return;
        }
        setToken(t);
        setSignedIn(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    const { data: boot } = useBootstrap("kiosk_info", token && { token }, { enabled: signedIn });

    const invalid = boot && (!boot.ok || !boot.kiosk);
    const kioskName = invalid ? "Invalid kiosk link" : boot ? boot.kiosk.name + " — Staff Forms" : "Loading…";
    const showMenu = !!boot && !invalid;

    return (
        <>
            <PageTitle title={kioskName === "Loading…" ? "Staff Forms" : kioskName} />
            <KioskTopbar title={kioskName} />
            {/* Wider than Wrap's default 30rem — that cap keeps the linear
                task forms deliberately narrow and focused, but this is a
                menu, not a form: on a laptop-width screen it should use the
                room to lay tiles out in a grid instead of staying a single
                narrow column stretched down the middle of the page. */}
            <Wrap className="sm:max-w-2xl md:max-w-4xl lg:max-w-5xl">
                {showMenu &&
                    MENU_GROUPS.map((group) => (
                        <div key={group.label}>
                            <div className="mb-[0.3rem] mt-[1.4rem] text-xs font-bold uppercase tracking-[0.12em] text-muted">
                                {group.label}
                            </div>
                            <div className="-mt-[0.3rem] mb-[0.6rem] text-[0.8rem] text-muted">{group.note}</div>
                            {/* One column (a scrollable list) below sm, a
                                grid of tiles at and above it — BtnCard
                                itself switches shape at the same breakpoint. */}
                            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                {group.items.map((item) => (
                                    <BtnCard key={item.page} href={"/" + slug + "/" + item.page} Icon={item.Icon}>
                                        {item.label}
                                    </BtnCard>
                                ))}
                            </div>
                        </div>
                    ))}
            </Wrap>
        </>
    );
}
