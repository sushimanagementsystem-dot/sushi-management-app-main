"use client";

import { useEffect, useRef } from "react";
import { createHelpButton } from "@/lib/help/popover";

/**
 * The dashboard's "?" Help icon. `id` is a key in lib/help/content.js — all the wording lives there, in one place, so
 * every explanation is written and reviewed the same way. Hover or click/tap the "?" to read it.
 *
 * The button itself is built by lib/help/popover.js (shared with the Data Tables grid, which is not React), and mounted
 * into a fixed-size placeholder so it never shifts the layout while it appears.
 */
export default function HelpTip({ id, className = "" }) {
    const holder = useRef(null);

    useEffect(() => {
        const el = holder.current;
        if (!el) return undefined;
        const button = createHelpButton(id);
        if (!button) return undefined;
        el.appendChild(button);
        return () => button.remove();
    }, [id]);

    return <span ref={holder} data-help-slot={id} className={"ml-1.5 inline-flex h-[1.1rem] w-[1.1rem] flex-none items-center justify-center align-middle " + className} />;
}
