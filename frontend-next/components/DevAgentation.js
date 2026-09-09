"use client";

import dynamic from "next/dynamic";

// Visual-annotation overlay for AI coding agents (agentation.com) — click
// any element on the page, add a note, and it produces a CSS selector +
// file-path-friendly markdown block to hand to an agent. Dev tool only:
// gated behind NODE_ENV so `next build` tree-shakes both this import and
// the package itself out of the production bundle entirely, not just
// hidden behind a runtime check — a production owner dashboard has no
// business shipping a debug/annotation overlay (or its webhook/API
// surface) to real users.
const Agentation =
    process.env.NODE_ENV === "production" ? null : dynamic(() => import("agentation").then((m) => m.Agentation), { ssr: false });

export default function DevAgentation() {
    if (!Agentation) return null;
    return <Agentation />;
}
