"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Store, LayoutDashboard } from "lucide-react";
import { getStoredKioskName, hasAllowedSlug, listStoredKiosks } from "@/lib/api";
import PageTitle from "@/components/PageTitle";
import Wrap from "@/components/kiosk/Wrap";
import BtnCard from "@/components/kiosk/BtnCard";

/**
 * Kiosk / dashboard picker — ported from pages/auth/index.html. This app is
 * opened through a kiosk's QR code or link, not this page directly; if this
 * device already has a kiosk (or dashboard access) remembered, skip the
 * dead-end message and go straight there instead of making staff dig up
 * the link/QR code again.
 */
export default function Home() {
    const router = useRouter();
    const [options, setOptions] = useState(null);
    const [redirecting, setRedirecting] = useState(false);

    useEffect(() => {
        const opts = listStoredKiosks()
            .slice()
            .sort()
            .map((slug) => ({
                href: "/" + slug + "/home",
                label: getStoredKioskName(slug) || slug.toUpperCase(),
                Icon: Store,
            }));
        if (hasAllowedSlug("dashboard")) {
            opts.push({ href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard });
        }

        if (opts.length === 1) {
            // A kiosk device is often bookmarked straight to "/" for this
            // auto-forward, so a full reload here (window.location) hits
            // on every single app open, not just once — router.replace
            // keeps it client-side, same as the sidebar/menu link fixes.
            setRedirecting(true);
            router.replace(opts[0].href);
        } else {
            setOptions(opts);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <PageTitle title="Sushi Management System" />
            {renderBody(redirecting, options)}
        </>
    );
}

function renderBody(redirecting, options) {
    if (redirecting || options === null) {
        return (
            <Wrap className="pt-12 text-center">
                <div className="text-5xl">🍣</div>
            </Wrap>
        );
    }

    if (options.length > 1) {
        return (
            <Wrap className="pt-12 text-center">
                <div className="text-5xl">🍣</div>
                <h2 className="mb-[0.4rem] mt-[0.6rem] text-lg font-semibold tracking-[-0.01em] text-ink">Continue to…</h2>
                <p className="text-[0.95rem] text-muted">This device has more than one option saved.</p>
                <div className="mt-[1.2rem] flex flex-col gap-2.5 text-left">
                    {options.map((opt) => (
                        <BtnCard key={opt.href} href={opt.href} Icon={opt.Icon}>
                            {opt.label}
                        </BtnCard>
                    ))}
                </div>
            </Wrap>
        );
    }

    return (
        <Wrap className="pt-12 text-center">
            <div className="text-5xl">🍣</div>
            <h2 className="mb-[0.4rem] mt-[0.6rem] text-lg font-semibold tracking-[-0.01em] text-ink">Open your kiosk&apos;s link</h2>
            <p className="mx-auto max-w-[26rem] text-[0.95rem] text-muted">
                This app is opened through your kiosk&apos;s QR code or link, not this page
                directly — each kiosk has its own. Scan the code posted at your kiosk,
                or use the link you were given.
            </p>
            <p className="mt-6 text-[0.85rem] text-muted">
                Don&apos;t have your kiosk&apos;s link? Contact the owner.
            </p>
        </Wrap>
    );
}
