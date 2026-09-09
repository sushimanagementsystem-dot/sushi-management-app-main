"use client";

import Script from "next/script";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getStoredSessionToken, redirectAfterSignIn } from "@/lib/api";
import { useApiMutation } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import Wrap from "@/components/kiosk/Wrap";

// Must match the backend's GOOGLE_CLIENT_ID (nest-backend/src/auth/auth.service.ts
// verifies ID tokens against this same client) and have this frontend's origin
// listed under that client's Authorized JavaScript origins in Google Cloud Console.
const GSI_CLIENT_ID = "622557455047-g94ndk9q21dhubdb37u3t4itamu1vvua.apps.googleusercontent.com";

export default function LoginPage() {
    const router = useRouter();

    const loginMutation = useApiMutation("login", {
        onSuccess: (res) => {
            if (res.ok) redirectAfterSignIn(router);
        },
    });

    useEffect(() => {
        // Already signed in on this device (e.g. this page was opened
        // directly, or revisited) — skip the button entirely.
        if (getStoredSessionToken()) {
            redirectAfterSignIn(router);
        }
    }, [router]);

    useEffect(() => {
        // GSI's data-callback fires once the user completes sign-in.
        // Exchanges the (short-lived) Google credential for our own
        // longer-lived session token; apiCall stores it automatically.
        window.handleCredentialResponse = (response) => {
            loginMutation.mutate({ idToken: response.credential });
        };
        return () => {
            delete window.handleCredentialResponse;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const err = loginMutation.data && !loginMutation.data.ok ? loginMutation.data.error : null;

    return (
        <>
            <PageTitle title="Sign in — Staff Forms" />
            <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
            <Wrap className="pt-16 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-2xl">🍣</div>
                <h2 className="mb-[0.4rem] mt-4 text-lg font-semibold tracking-[-0.01em] text-ink">Sign in</h2>
                <p className="mb-6 text-[0.9rem] text-muted">
                    Sign in with your registered Google account to open your kiosk&apos;s forms.
                </p>
                <div className="mx-auto flex max-w-[20rem] flex-col items-center rounded-card border border-line bg-card p-6 shadow-elevate-1">
                    <div id="g_id_onload" data-client_id={GSI_CLIENT_ID} data-callback="handleCredentialResponse" />
                    <div className="g_id_signin inline-block" data-type="standard" />
                    {err && <p className="mt-4 text-[0.85rem] text-danger-ink">{err}</p>}
                </div>
            </Wrap>
        </>
    );
}
