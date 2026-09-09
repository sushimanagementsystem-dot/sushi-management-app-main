/**
 * api.js — shared helpers for every page, ported from the plain frontend's
 * assets/common.js. Kiosk identity lives in the URL path (the dynamic
 * [slug] segment) exactly like the old Vercel rewrites did; the slug
 * itself is just a label (lowercased kiosk_id) with no authority — the
 * real credential is the kiosk token from the ?token= link, verified once
 * on /enter and kept in the auth store (lib/store/useAuthStore.js).
 *
 * Auth *state* (session token, per-kiosk tokens, allowed-slug cache) lives
 * in that Zustand store, not here — this file only has the plain
 * functions that read/write it. Components that need to re-render when
 * that state changes should use the useAuthStore() hook directly instead
 * of these; these are for imperative call sites (a page's mount effect
 * needing a synchronous "do we have a token, if not redirect" check)
 * where a hook subscription isn't the right tool.
 */

import { useAuthStore } from "./store/useAuthStore";

// NestJS backend (see ../../nest-backend) — one route per action
// (BACKEND_URL + "/" + action), replacing the old Apps Script single
// endpoint + action-in-body dispatch. NEXT_PUBLIC_BACKEND_URL overrides
// for non-local environments; defaults to the local dev server.
export const BACKEND_URL =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

/**
 * Every call automatically carries the stored session token (if any) —
 * "login" and kiosk_info ignore it server-side, everything else requires
 * it. A successful response's own sessionToken (if present) is re-stored
 * automatically too — that's the 30-day sliding refresh, it just happens
 * on every call without any page needing to think about it. Kept as a
 * plain function (not a hook) so it works the same inside React Query's
 * queryFn/mutationFn as anywhere else.
 */
export function apiCall(action, data) {
    const body = Object.assign({ sessionToken: getStoredSessionToken() }, data);
    return fetch(`${BACKEND_URL}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
        .then((res) => res.json())
        .then((out) => {
            if (out && out.sessionToken) storeSessionToken(out.sessionToken);
            return out;
        });
}

/**
 * Reads a File for upload — downscales+recompresses it if it's an image
 * (canvas-based, ~1600px max dimension, ~70% JPEG quality by default),
 * passes anything else (e.g. Help/Issues' video) through raw and
 * untouched. Resolves { base64, mimeType, name }.
 */
export function readFileForUpload(file, maxDimension, quality) {
    maxDimension = maxDimension || 1600;
    quality = quality || 0.7;

    const readRaw = () =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
                resolve({
                    base64: reader.result.split(",")[1],
                    mimeType: file.type,
                    name: file.name,
                });
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    if (!file.type.startsWith("image/")) return readRaw();

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(
                    1,
                    maxDimension / Math.max(img.width, img.height),
                );
                const canvas = document.createElement("canvas");
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas
                    .getContext("2d")
                    .drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                resolve({
                    base64: dataUrl.split(",")[1],
                    mimeType: "image/jpeg",
                    name: file.name,
                });
            };
            img.onerror = reject;
            img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Fire-and-forget nudge, called right after a successful submit: hits the
 * Vercel relay (app/api/process-now/route.js), which calls back into GAS
 * server-side to run processPendingSubmissions() immediately instead of
 * waiting for the sweep. Never awaited by callers, never surfaces an error.
 */
export function kickProcessing() {
    fetch("/api/process-now", { method: "POST" }).catch(() => {});
}

/** First path segment: "/k01/home" -> "k01". "" if the URL is unexpected.
 * Inside a [slug] route, prefer useParams() instead — this exists for
 * call sites (like requireKioskToken below) that run outside any
 * particular route's component tree context. */
export function getSlugFromPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] || "";
}

/**
 * Call at the top of every kiosk form page's client component. Returns the
 * stored kiosk token for this URL's slug, or null after redirecting to
 * /forbidden (caller should stop initializing anything else when it gets
 * null back — the redirect doesn't halt execution by itself).
 */
export function requireKioskToken() {
    const slug = getSlugFromPath();
    const token = slug ? useAuthStore.getState().getKioskToken(slug) : null;
    if (!token) {
        window.location.replace("/forbidden?reason=kiosk");
        return null;
    }
    return token;
}

/** name is optional — /enter passes it, callers that only have the token
 * (e.g. re-verifying) can omit it and the cached name stays as-is. */
export function storeKioskToken(slug, token, name) {
    useAuthStore.getState().storeKioskToken(slug, token, name);
}

export function getStoredKioskToken(slug) {
    return useAuthStore.getState().getKioskToken(slug);
}

/** Cached display name for a stored kiosk, or null if never saved — callers
 * should fall back to the slug. */
export function getStoredKioskName(slug) {
    return useAuthStore.getState().getKioskName(slug);
}

/** Slugs with a kiosk token already stored on this device (any order). */
export function listStoredKiosks() {
    return useAuthStore.getState().listKioskSlugs();
}

/**
 * Where to send the browser right after a successful sign-in: back to
 * whatever sent them there (?return=slug — a kiosk slug or a restricted
 * area like "dashboard"), or — if opened directly — whatever's already
 * stored on this device.
 */
export function redirectAfterSignIn(router) {
    const ret = new URLSearchParams(window.location.search).get("return");
    if (ret) {
        router.replace("/" + ret);
        return;
    }
    const stored = listStoredKiosks();
    if (stored.length === 1) {
        router.replace("/" + stored[0]);
    } else {
        router.replace("/");
    }
}

/** True once requireRole(slug) has confirmed access on this device before —
 * a cache, not a live check. */
export function hasAllowedSlug(slug) {
    return useAuthStore.getState().isSlugAllowed(slug);
}

/**
 * Gate for role-restricted areas (e.g. /dashboard): redirects to /login if
 * not signed in, /forbidden if signed in but not permitted, otherwise
 * resolves true once access is confirmed. A cached "already checked" flag
 * skips the round trip on repeat visits — a UX shortcut only. It's never
 * the real authorization: every actual data-bearing call still
 * re-verifies the session (and role) server-side on its own.
 */
export function requireRole(slug, router) {
    if (!getStoredSessionToken()) {
        router.replace("/login?return=" + slug);
        return Promise.resolve(false);
    }
    if (hasAllowedSlug(slug)) {
        return Promise.resolve(true);
    }
    return apiCall("whoami", {}).then((res) => {
        if (!res.ok) {
            router.replace("/login?return=" + slug);
            return false;
        }
        if (res.role !== "ADMIN" && res.role !== "DEVELOPER") {
            router.replace("/forbidden?reason=role");
            return false;
        }
        useAuthStore.getState().markSlugAllowed(slug);
        return true;
    });
}

/**
 * Our own session token (see Auth.js on the backend for how it's minted/
 * verified) — device-wide, one sign-in covers every kiosk on this phone,
 * separate from the per-kiosk token above. No client-side validity check
 * here, since the server re-verifies it on every real call anyway and
 * refreshes it automatically (see apiCall above).
 */
export function getStoredSessionToken() {
    if (typeof window === "undefined") return null;
    return useAuthStore.getState().sessionToken;
}

export function storeSessionToken(token) {
    useAuthStore.getState().setSessionToken(token);
}
