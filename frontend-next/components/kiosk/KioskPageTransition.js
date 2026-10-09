import { ViewTransition } from "react";

/**
 * Wraps a kiosk page's content (everything below KioskTopbar) so menu <->
 * form navigation gets a directional slide instead of an instant swap.
 * Direction is tagged by the navigating <Link> itself — BtnCard (menu ->
 * form) carries transitionTypes={["nav-forward"]}, KioskTopbar's "‹ Menu"
 * link carries ["nav-back"]. router.back()/the browser back button carry
 * no type and fall through to `default`, which is deliberately "none" —
 * see the vercel-react-view-transitions skill's note on this.
 *
 * Placed inside each page's own return (not a layout) — kiosk pages have
 * no shared layout today, and a layout-level wrapper would block page-
 * level enter/exit from firing even if one were added later.
 */
export default function KioskPageTransition({ children }) {
    return (
        <ViewTransition
            enter={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
            exit={{ "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" }}
            default="none"
        >
            {children}
        </ViewTransition>
    );
}
