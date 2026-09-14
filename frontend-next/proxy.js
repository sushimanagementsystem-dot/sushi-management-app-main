import { NextResponse } from "next/server";

// Top-level routes that are never a kiosk slug — everything else under
// "/" falls to the [slug] dynamic route. Mirrors the literal-routes-
// before-catch-all scheme the old vercel.json used for the plain
// frontend (see CLAUDE.md), now enforced by Next.js's own router.
const RESERVED_SEGMENTS = new Set(["api", "dashboard", "enter", "forbidden", "login"]);

/**
 * Kiosk links are shared using the kiosk's real `kiosk_id` casing (e.g.
 * "K01"), but /enter always stores the kiosk token under
 * kiosk_id.toLowerCase() (see app/enter/page.js), and every kiosk page
 * reads the slug straight from the URL via useParams()/getSlugFromPath()
 * with no normalization. A staff member opening their real (uppercase)
 * kiosk link then hits an unrecoverable "Access denied" — the token they
 * need genuinely was stored, just under a different-case key, and no
 * amount of clearing local storage or signing in again fixes that on its
 * own, since the next visit to the same link reproduces the exact same
 * mismatch. Normalizing the URL itself here means every downstream
 * reader (useParams(), getSlugFromPath()) sees the same lowercase slug
 * the token was stored under, without every kiosk page needing to
 * remember to call .toLowerCase() itself.
 */
export function proxy(request) {
    const { pathname } = request.nextUrl;
    const segments = pathname.split("/").filter(Boolean);
    const slug = segments[0];
    const isKioskSlug = slug && !RESERVED_SEGMENTS.has(slug);

    if (isKioskSlug && slug !== slug.toLowerCase()) {
        const url = request.nextUrl.clone();
        segments[0] = slug.toLowerCase();
        url.pathname = "/" + segments.join("/");
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
