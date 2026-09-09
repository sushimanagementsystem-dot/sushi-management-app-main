"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Wraps the app in a single React Query client. Data-fetching pages use
 * useQuery for reads (bootstrap_* actions) and useMutation for writes
 * (submit, login, …) instead of hand-rolled loading/error/success state —
 * see lib/queries.js for the shared query/mutation definitions.
 *
 * staleTime/gcTime are conservative defaults for this app: every read here
 * goes straight to the same Apps Script backend every other client hits
 * too, so cached data can go stale from someone else's change at any time.
 * Individual queries override these where a longer cache is safe/useful.
 */
export default function QueryProvider({ children }) {
    const [client] = useState(
        () =>
            new QueryClient({
                defaultOptions: {
                    queries: {
                        staleTime: 30_000,
                        gcTime: 5 * 60_000,
                        retry: 1,
                        refetchOnWindowFocus: false,
                    },
                    mutations: {
                        retry: 0,
                    },
                },
            }),
    );

    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
