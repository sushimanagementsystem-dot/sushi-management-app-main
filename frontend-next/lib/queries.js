"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { apiCall } from "./api";

/**
 * Generic React Query wrapper around a backend read action (any
 * "bootstrap_*" action, "kiosk_info", etc). Every page's data-fetch uses
 * this instead of a hand-rolled useEffect + useState(loading/error/data)
 * trio — React Query gives isPending/isError/error/data/refetch for free
 * and dedupes identical in-flight requests.
 *
 * queryKey should include every value the response depends on (token,
 * date range, table name, …) so React Query knows when to refetch.
 */
export function useBootstrap(action, params, options = {}) {
    const { enabled = true, ...rest } = options;
    return useQuery({
        queryKey: [action, params],
        queryFn: () => apiCall(action, params),
        enabled: enabled && params != null,
        ...rest,
    });
}

/**
 * Generic mutation wrapper for a write action ("submit", "login",
 * dashboard table edits, …). Callers get isPending/isError/mutate(Async)
 * for free instead of manual busy-state juggling.
 */
export function useApiMutation(action, options = {}) {
    return useMutation({
        mutationFn: (data) => apiCall(action, data),
        ...options,
    });
}
