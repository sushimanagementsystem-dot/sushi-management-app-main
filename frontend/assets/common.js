/**
 * common.js — shared helpers for every page.
 *
 * Kiosk identity lives in the URL path via Vercel rewrites (vercel.json):
 * a real visit to /k01/home keeps that exact URL in the browser while
 * actually serving home.html — window.location.pathname still reads
 * "/k01/home" from inside the page, which is how we recover the slug.
 *
 * The slug itself is just a label (lowercased kiosk_id, e.g. "k01") for
 * pretty URLs — it carries no authority. The real credential is the kiosk
 * token from the ?token= link, verified once on enter.html and then kept
 * in localStorage per slug. Direct-visiting a slug URL with nothing stored
 * for it blocks the page, same shape as the login-gate design elsewhere in
 * this project: the page shell can render freely, but nothing that reads
 * or writes real data via the API works without the actual token backing it.
 */

const BACKEND_URL =
    "https://script.google.com/macros/s/AKfycbyP8nKEEqD4eo9ZXwW40qj56i9yL386Ii8muinYCw95Lx4uWmvXveQVTh__Vu1M_UYkew/exec";

/**
 * Every call automatically carries the stored session token (if any) —
 * "login" and kiosk_info ignore it server-side, everything else requires
 * it. A successful response's own sessionToken (if present)
 * is re-stored automatically too — that's the 30-day sliding refresh, it
 * just happens on every call without any page needing to think about it.
 */
function apiCall(action, data) {
    const body = Object.assign(
        { action: action, sessionToken: getStoredSessionToken() },
        data,
    );
    return fetch(BACKEND_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
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
 * untouched, since compression only makes sense for static images. A full
 * camera photo (several MB) shrinks to the low hundreds of KB, which
 * matters directly: every evidence photo gets its own sequential
 * DriveApp.createFile() call server-side (see Upload.js/saveUpload_) —
 * smaller payloads mean faster network transfer AND faster Drive writes,
 * which is what actually made a multi-photo Monthly Audit submission take
 * 2+ minutes. Resolves { base64, mimeType, name } — the same shape every
 * form already built by hand, so call sites barely change.
 */
function readFileForUpload(file, maxDimension, quality) {
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
 * Vercel relay (frontend/api/process-now.js), which calls back into GAS
 * server-side to run processPendingSubmissions() immediately instead of
 * waiting for the 10-minute sweep. Never awaited by callers, never surfaces
 * an error to the user — if it silently fails, the sweep is the fallback.
 */
function kickProcessing() {
    fetch("/api/process-now", { method: "POST" }).catch(() => {});
}

/** First path segment: "/k01/home" -> "k01". "" if the URL is unexpected. */
function getSlugFromPath() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    return parts[0] || "";
}

function tokenStorageKey(slug) {
    return "kiosk_token_" + slug;
}

function kioskNameStorageKey(slug) {
    return "kiosk_name_" + slug;
}

/** name is optional — enter.html passes it, callers that only have the
 * token (e.g. re-verifying) can omit it and the cached name stays as-is. */
function storeKioskToken(slug, token, name) {
    localStorage.setItem(tokenStorageKey(slug), token);
    if (name) localStorage.setItem(kioskNameStorageKey(slug), name);
}

/** Cached display name for a stored kiosk, or null if never saved (e.g.
 * stored before this existed) — callers should fall back to the slug. */
function getStoredKioskName(slug) {
    return localStorage.getItem(kioskNameStorageKey(slug));
}

/** Slugs with a kiosk token already stored on this device (any order). */
function listStoredKiosks() {
    const slugs = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.indexOf("kiosk_token_") === 0) {
            slugs.push(key.slice("kiosk_token_".length));
        }
    }
    return slugs;
}

/**
 * Where to send the browser right after a successful sign-in (called from
 * login.html): back to whatever sent them there (?return=slug — a kiosk
 * slug or a restricted-area slug like "dashboard"), or — if opened
 * directly — whatever's already stored on this device. Never append
 * "/home" here: "/k01" already resolves to the kiosk's home page via
 * vercel.json's /:slug rewrite, but "/dashboard" (and any future
 * restricted area) is a real static file and must be hit directly —
 * "/dashboard/home" would wrongly resolve through the /:slug/:page
 * rewrite and get read as kiosk slug "dashboard".
 */
function redirectAfterSignIn() {
    const ret = new URLSearchParams(window.location.search).get("return");
    if (ret) {
        window.location.replace("/" + ret);
        return;
    }
    const stored = listStoredKiosks();
    if (stored.length === 1) {
        window.location.replace("/" + stored[0]);
    } else {
        window.location.replace("/");
    }
}

/**
 * Call at the top of every real page's script. Returns the stored kiosk
 * token for this URL's slug, or null after redirecting to /forbidden
 * (caller should stop initializing anything else when it gets null back —
 * the redirect doesn't halt execution by itself).
 */
function requireKioskToken() {
    const slug = getSlugFromPath();
    const token = slug ? localStorage.getItem(tokenStorageKey(slug)) : null;
    if (!token) {
        window.location.replace("/forbidden?reason=kiosk");
        return null;
    }
    return token;
}

function allowedSlugStorageKey(slug) {
    return "allowed_slug_" + slug;
}

/** True once requireRole(slug) has confirmed access on this device before —
 * a cache, not a live check. Used to decide whether to show a
 * role-restricted area (e.g. Dashboard) in index.html's picker at all. */
function hasAllowedSlug(slug) {
    return localStorage.getItem(allowedSlugStorageKey(slug)) === "1";
}

/**
 * Gate for role-restricted areas (e.g. /dashboard): redirects to /login if
 * not signed in, /forbidden if signed in but not permitted, otherwise
 * resolves true once access is confirmed. A cached "already checked" flag
 * skips the round trip on repeat visits — same shape as the kiosk token
 * above, a UX shortcut only. It's never the real authorization: every
 * actual data-bearing call still re-verifies the session (and, once
 * dashboard endpoints exist, role) server-side on its own.
 */
function requireRole(slug) {
    if (!getStoredSessionToken()) {
        window.location.replace("/login?return=" + slug);
        return Promise.resolve(false);
    }
    if (hasAllowedSlug(slug)) {
        return Promise.resolve(true);
    }
    return apiCall("whoami", {}).then((res) => {
        if (!res.ok) {
            window.location.replace("/login?return=" + slug);
            return false;
        }
        if (res.role !== "ADMIN" && res.role !== "DEVELOPER") {
            window.location.replace("/forbidden?reason=role");
            return false;
        }
        localStorage.setItem(allowedSlugStorageKey(slug), "1");
        return true;
    });
}

/**
 * Shared boilerplate for every form page: verify the kiosk token and wire
 * every [data-menu-link] element's href to this kiosk's home page. Returns
 * the token, or null (already blocked) if it's missing — callers should
 * skip the rest of their init when they get null back.
 */
function initPage() {
    const token = requireKioskToken();
    if (!token) return null;
    const slug = getSlugFromPath();
    document.querySelectorAll("[data-menu-link]").forEach((el) => {
        el.href = "/" + slug + "/home";
    });
    return token;
}

/**
 * Our own session token (see Auth.js on the backend for how it's minted/
 * verified) — device-wide, one sign-in covers every kiosk on this phone,
 * separate from the per-kiosk token above. Storage only; no client-side
 * validity check here, since the server re-verifies it on every real call
 * anyway and refreshes it automatically (see apiCall above) — a stale or
 * missing one just surfaces as a NOT_SIGNED_IN response.
 */
function getStoredSessionToken() {
    return localStorage.getItem("session_token");
}

function storeSessionToken(token) {
    localStorage.setItem("session_token", token);
}
