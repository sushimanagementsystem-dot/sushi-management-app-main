"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import PageTitle from "@/components/PageTitle";
import Wrap from "@/components/kiosk/Wrap";

const REASONS = {
    role: "You're signed in, but you don't have access to this page. Contact the owner if you think this is a mistake.",
    kiosk: "This page needs to be opened through your kiosk's QR code or link, not typed directly. Scan the code posted at your kiosk, or use the link you were given.",
    link: "This kiosk link is not recognised. Please use the QR code / link for your kiosk, or contact the owner.",
};

function ForbiddenInner() {
    const searchParams = useSearchParams();
    const reason = searchParams.get("reason");
    const msg =
        REASONS[reason] ||
        "You don't have access to this. Contact the owner if you think this is a mistake.";

    return (
        <Wrap className="pt-12 text-center">
            <PageTitle title="Access denied" />
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-bg text-2xl">🚫</div>
            <h2 className="mb-[0.4rem] mt-4 text-lg font-semibold tracking-[-0.01em] text-ink">Access denied</h2>
            <p className="mx-auto max-w-[26rem] text-[0.9rem] text-muted">{msg}</p>
            <p className="mt-6">
                <Link href="/" className="text-[0.9rem] font-medium text-accent hover:underline">
                    ← Back
                </Link>
            </p>
        </Wrap>
    );
}

export default function ForbiddenPage() {
    return (
        <Suspense fallback={null}>
            <ForbiddenInner />
        </Suspense>
    );
}
