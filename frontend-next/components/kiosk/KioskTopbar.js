import Link from "next/link";

/**
 * Shared kiosk-form topbar (icon + title on the left, "‹ Menu" link on the
 * right), pure Tailwind utility classes — no custom CSS. Ported from the
 * `.topbar` class shared by every pages/kiosk/*.html page. Uses next/link
 * — this "‹ Menu" link is on every single kiosk form page, so a plain <a>
 * here meant every "back to menu" tap did a full page reload.
 */
export default function KioskTopbar({ icon, title, menuHref }) {
    return (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-ink px-4 py-[0.85rem] text-white">
            <span className="flex items-center gap-2 text-[1rem] font-semibold tracking-[-0.01em]">
                <span aria-hidden className="text-[1.05rem] leading-none opacity-90">
                    {icon}
                </span>
                {title}
            </span>
            {menuHref && (
                <Link
                    href={menuHref}
                    className="max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap text-[0.8rem] font-medium text-white/70 hover:text-white/95"
                >
                    ‹ Menu
                </Link>
            )}
        </div>
    );
}
