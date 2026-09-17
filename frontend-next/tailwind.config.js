/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
    theme: {
        extend: {
            // Global color tokens — single source of truth for the app's
            // palette. Reference these everywhere via Tailwind utilities
            // (bg-accent, text-ink, border-line, …) instead of hardcoded
            // hex values or new ad-hoc CSS — every color in the app should
            // trace back to one of these.
            //
            // Palette: a warm-neutral base (paper, not slate-blue) with a
            // deep forest-emerald brand color — "calm, trustworthy,
            // business-oriented" rather than a bright consumer-app color.
            // Semantic colors (success/warn/danger) are deliberately their
            // own hues, distinct from the brand green, so status meaning
            // never gets confused with brand identity. `teal` is a
            // secondary accent used sparingly (data visualization, a
            // handful of tertiary UI moments) so the app doesn't read as
            // "everything is emerald."
            colors: {
                bg: "#faf9f6", // warm off-white — page background
                panel: "#f2f0e8", // warm neutral, one step up from bg so a
                // white card nested inside a panel still reads as its own
                // surface (see SectionCard.js)
                card: "#ffffff",
                ink: "#20221f", // near-black with a faint warm cast — primary text
                muted: "#6c6b62", // warm slate — secondary text
                line: "#e7e3d8", // warm, very subtle border/divider
                accent: {
                    DEFAULT: "#0e5c45", // deep forest emerald — the one brand
                    // color, used for primary actions, active/selected
                    // states, links and focus rings. Nowhere else.
                    hover: "#0a4735", // darker emerald for hover/press
                    soft: "#e8f1ec", // pale emerald tint — active-nav
                    // background, subtle badges — never used as a solid fill
                    ink: "#ffffff",
                },
                teal: {
                    DEFAULT: "#3f7d76", // muted secondary accent — used
                    // sparingly (sparkline bars, a handful of tertiary
                    // accents) so it reads as a deliberate second color,
                    // not brand-adjacent noise
                    soft: "#eaf3f1",
                },
                success: {
                    bg: "#eefaf1",
                    ink: "#1a7a42",
                    border: "#c1e8cd",
                },
                warn: {
                    bg: "#fff8ec",
                    ink: "#9c5b0a",
                    border: "#f0ddac",
                },
                danger: {
                    bg: "#fdf2f1",
                    ink: "#b3261e",
                    border: "#efcdc8",
                },
                // Icon-chip colors — the kiosk home menu's only use of a
                // wider palette than the rest of the app. Each is a soft
                // pastel bg + a medium-saturation ink, same two-tone shape
                // as success/warn/danger above, so a task's icon reads as
                // its own color at a glance (staff scanning 11 tiles) while
                // staying within the app's restrained, non-neon tone. Kept
                // separate from accent/teal, which stay reserved for brand
                // and data-viz per the notes above.
                chip: {
                    rose: { bg: "#fff1f2", ink: "#e11d48" },
                    sky: { bg: "#f0f9ff", ink: "#0284c7" },
                    amber: { bg: "#fffbeb", ink: "#d97706" },
                    orange: { bg: "#fff7ed", ink: "#ea580c" },
                    fuchsia: { bg: "#fdf4ff", ink: "#c026d3" },
                    indigo: { bg: "#eef2ff", ink: "#4f46e5" },
                    red: { bg: "#fef2f2", ink: "#dc2626" },
                    violet: { bg: "#f5f3ff", ink: "#7c3aed" },
                    blue: { bg: "#eff6ff", ink: "#2563eb" },
                    slate: { bg: "#f1f5f9", ink: "#475569" },
                },
            },
            // A restrained radius scale — one step for controls (inputs,
            // buttons — also available as the plain Tailwind `rounded-lg`
            // utility), one for cards. Deliberately smaller than a
            // "friendly consumer app" radius: enough to feel soft, not so
            // much it reads as a rounded pill/bubble UI.
            borderRadius: {
                DEFAULT: "8px",
                card: "12px",
            },
            // One typeface for the whole app, including headings — real
            // ops/B2B SaaS products (Linear, Vercel, Stripe Dashboard)
            // commit to a single clean sans rather than pairing in a
            // serif for headings, which reads more editorial/consumer
            // than "trustworthy business tool." Hierarchy comes from
            // weight, size and color instead of switching typefaces.
            fontFamily: {
                sans: ["var(--font-inter)", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
            },
            // Consistent elevation scale — two shadows per level so edges
            // stay crisp while the ambient glow stays soft. Tinted off the
            // ink color (warm near-black) rather than a generic cool
            // grey/blue, and kept deliberately faint — "restrained
            // shadows" per the brief, not the heavier indigo-era scale.
            boxShadow: {
                "elevate-1": "0 1px 2px rgba(32,34,31,0.05)",
                "elevate-2": "0 4px 10px rgba(32,34,31,0.06), 0 1px 3px rgba(32,34,31,0.05)",
                "elevate-3": "0 14px 28px rgba(32,34,31,0.11), 0 3px 8px rgba(32,34,31,0.06)",
            },
            keyframes: {
                spin: {
                    to: { transform: "rotate(360deg)" },
                },
            },
        },
    },
    plugins: [],
};
