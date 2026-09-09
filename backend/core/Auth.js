/**
 * Auth.js — resolves where a submission comes from (kiosk) and who filed it.
 *
 * Kiosk identity comes from the secret token in the web app URL, never from
 * staff input (M-01). User identity comes from the signed-in Google email,
 * matched against the `user` allowlist (any active role may open the app;
 * ADMIN/DEVELOPER-only features are gated separately, later).
 */

/** Kiosk row for a URL token, or null if unknown/inactive. */
function getKioskByToken(token) {
    if (!token) return null;
    return getRow(TABLES.KIOSK, (r) => r.token === token && r.active === true);
}

/** user row matched by verified email, or null (blank emails never match). */
function findUserByEmail(email) {
    if (!email) return null;
    return getRow(
        TABLES.USER,
        (r) =>
            r.active === true &&
            String(r.email || "")
                .trim()
                .toLowerCase() === email,
    );
}

/** user row matched by email regardless of active status, or null. */
function findAnyUserByEmail(email) {
    if (!email) return null;
    return getRow(
        TABLES.USER,
        (r) =>
            String(r.email || "")
                .trim()
                .toLowerCase() === email,
    );
}

/**
 * True for roles allowed into the owner dashboard. The frontend's own
 * requireRole() check (common.js) is a UX shortcut only — this is the
 * real gate, and every dashboard-only backend action must call it itself,
 * same as "whoami" does. A valid session token alone is not enough; a
 * signed-in STAFF user must not be able to reach dashboard actions just
 * by knowing the action name.
 */
function isOwnerRole_(role) {
    return role === "ADMIN" || role === "DEVELOPER";
}

/**
 * Adds a new, inactive STAFF row for an email that has never signed in
 * before (no row at all — see findAnyUserByEmail). Never touches an
 * existing row, so a deliberately-deactivated former staff member is never
 * duplicated or overwritten. Evan reassigns role/activates from the (not
 * yet built) staff editor.
 */
function registerUnknownUser_(email, name) {
    return insertRow(TABLES.USER, {
        user_id: newId(),
        name: name || "",
        email: email,
        role: "STAFF",
        active: false,
    });
}

/** Active STAFF-role users, for name dropdowns (e.g. Staff Food). Never includes emails. */
function getActiveStaff() {
    return getRows(TABLES.USER, (r) => r.active === true && r.role === "STAFF")
        .map((r) => ({ id: r.user_id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Must match the Client ID configured on the Vercel frontend (home.html) —
 * there's no shared config between the two separate deployments, so if this
 * ever changes, update it in both places.
 */
const GSI_CLIENT_ID_ =
    "267995313560-0mllsvc5d4iqpc75sajnffl9vujc4v9t.apps.googleusercontent.com";

/**
 * Verifies a Google Identity Services ID token server-side: genuinely
 * signed by Google, not expired, and issued for OUR app specifically (the
 * audience check — without it, a token from a completely different Google
 * OAuth client could be replayed here). Returns { email, name }, or null
 * if anything about the token doesn't check out.
 */
function verifyIdToken_(idToken) {
    if (!idToken) return null;
    try {
        const res = UrlFetchApp.fetch(
            "https://oauth2.googleapis.com/tokeninfo?id_token=" +
                encodeURIComponent(idToken),
            { muteHttpExceptions: true },
        );
        if (res.getResponseCode() !== 200) return null;
        const claims = JSON.parse(res.getContentText());
        if (claims.aud !== GSI_CLIENT_ID_) return null;
        if (claims.email_verified !== "true" && claims.email_verified !== true)
            return null;
        return {
            email: String(claims.email || "")
                .trim()
                .toLowerCase(),
            name: String(claims.name || "").trim(),
        };
    } catch (err) {
        console.error("verifyIdToken_ failed:", (err && err.stack) || err);
        return null;
    }
}

/**
 * Our own long-lived session, minted once after a GSI token verifies. Format:
 * base64url(JSON payload) + "." + base64url(HMAC-SHA256 signature) — signed
 * with SESSION_SECRET (Script Properties), so verifying it later is a local
 * signature check, no network call to Google needed on every request like
 * the raw GSI token requires. 30-day sliding expiry: refreshed on every
 * successful use (see Api.js), so an active user never actually hits it —
 * an abandoned session just quietly expires on its own.
 */
const SESSION_LIFETIME_MS_ = 30 * 24 * 60 * 60 * 1000;

/** Mints a fresh session token for a `user` row. */
function mintSessionToken_(user) {
    const secret =
        PropertiesService.getScriptProperties().getProperty("SESSION_SECRET");
    if (!secret)
        throw new Error("Script property SESSION_SECRET is not set.");
    const payload = JSON.stringify({
        uid: user.user_id,
        iat: Date.now(),
        exp: Date.now() + SESSION_LIFETIME_MS_,
    });
    const payloadB64 = Utilities.base64EncodeWebSafe(payload);
    const sigB64 = Utilities.base64EncodeWebSafe(
        Utilities.computeHmacSha256Signature(payloadB64, secret),
    );
    return payloadB64 + "." + sigB64;
}

/**
 * Verifies a session token: signature, expiry, and — re-checked every time,
 * not just at mint time — that the user row is still active. That's what
 * makes deactivating someone take effect immediately rather than waiting
 * for their token to age out. Returns the `user` row, or null.
 */
function verifySessionToken_(token) {
    if (!token || token.indexOf(".") === -1) return null;
    const secret =
        PropertiesService.getScriptProperties().getProperty("SESSION_SECRET");
    if (!secret) return null;

    const parts = token.split(".");
    const payloadB64 = parts[0];
    const sigB64 = parts[1];
    const expectedSigB64 = Utilities.base64EncodeWebSafe(
        Utilities.computeHmacSha256Signature(payloadB64, secret),
    );
    if (sigB64 !== expectedSigB64) return null;

    let payload;
    try {
        payload = JSON.parse(
            Utilities.newBlob(
                Utilities.base64DecodeWebSafe(payloadB64),
            ).getDataAsString(),
        );
    } catch (err) {
        return null;
    }
    if (!payload.exp || payload.exp < Date.now()) return null;

    return getRow(
        TABLES.USER,
        (r) => r.user_id === payload.uid && r.active === true,
    );
}
