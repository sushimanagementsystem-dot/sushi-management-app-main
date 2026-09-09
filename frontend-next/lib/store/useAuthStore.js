"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Central auth state for the whole app, persisted to localStorage (so it
 * survives reloads/new tabs, same as the plain frontend's scattered
 * localStorage.* calls did) but reactive: components subscribed via the
 * useAuthStore() hook re-render when this changes, instead of needing a
 * manual refetch/rerender trigger after every localStorage write.
 *
 * - sessionToken: the device-wide Google-sign-in session (see Auth.js on
 *   the backend). One sign-in covers every kiosk on this device.
 * - kiosks: per-kiosk-slug { token, name } — the *kiosk* token from the
 *   ?token= link, separate from the session above. Verified once on
 *   /enter, kept here so a kiosk page's data-bearing calls can use it.
 * - allowedSlugs: a slug -> true cache of "requireRole(slug) already
 *   confirmed access on this device before". A UX shortcut only — every
 *   real data-bearing call still re-verifies role server-side regardless.
 *
 * Imperative (non-component) call sites use useAuthStore.getState()/
 * .setState() directly — e.g. requireKioskToken() in lib/api.js needs a
 * synchronous read-or-redirect at the top of a page's mount effect, not a
 * React hook subscription.
 */
export const useAuthStore = create(
    persist(
        (set, get) => ({
            sessionToken: null,
            kiosks: {},
            allowedSlugs: {},

            setSessionToken: (token) => set({ sessionToken: token }),
            clearSessionToken: () => set({ sessionToken: null }),

            storeKioskToken: (slug, token, name) =>
                set((state) => ({
                    kiosks: {
                        ...state.kiosks,
                        [slug]: { token, name: name ?? state.kiosks[slug]?.name ?? null },
                    },
                })),

            getKioskToken: (slug) => get().kiosks[slug]?.token ?? null,
            getKioskName: (slug) => get().kiosks[slug]?.name ?? null,
            listKioskSlugs: () => Object.keys(get().kiosks),

            markSlugAllowed: (slug) =>
                set((state) => ({ allowedSlugs: { ...state.allowedSlugs, [slug]: true } })),
            isSlugAllowed: (slug) => !!get().allowedSlugs[slug],
        }),
        {
            name: "sushi-auth-store",
            storage: createJSONStorage(() => localStorage),
        },
    ),
);
