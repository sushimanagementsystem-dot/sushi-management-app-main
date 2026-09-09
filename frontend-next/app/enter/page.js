"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiCall, storeKioskToken } from "@/lib/api";
import PageTitle from "@/components/PageTitle";

function EnterInner() {
    const searchParams = useSearchParams();
    const [msg, setMsg] = useState("Opening your kiosk…");

    useEffect(() => {
        const token = searchParams.get("token") || "";
        if (!token) {
            window.location.replace("/forbidden?reason=link");
            return;
        }
        apiCall("kiosk_info", { token: token })
            .then((res) => {
                if (!res.ok || !res.kiosk) {
                    window.location.replace("/forbidden?reason=link");
                    return;
                }
                const slug = String(res.kiosk.kiosk_id).toLowerCase();
                storeKioskToken(slug, token, res.kiosk.name);
                window.location.replace("/" + slug + "/home");
            })
            .catch((err) => {
                setMsg("Could not verify link: " + err.message);
            });
    }, [searchParams]);

    return (
        <div className="px-6 pt-12 text-center">
            <PageTitle title="Opening…" />
            <p>{msg}</p>
        </div>
    );
}

export default function EnterPage() {
    return (
        <Suspense fallback={null}>
            <EnterInner />
        </Suspense>
    );
}
