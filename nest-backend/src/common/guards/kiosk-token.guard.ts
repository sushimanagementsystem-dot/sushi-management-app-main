import { Injectable, type CanActivate, type ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import type { Kiosk } from "@prisma/client";

// Kiosk identity comes from the secret `token` baked into the kiosk's URL
// link — never staff input, no session required (staff haven't signed in
// yet at that point). See CLAUDE.md's Auth model / backend/core/Auth.js.
// Applied explicitly per-route (kiosk_info, bootstrap_*, submit) alongside
// @Public() on the same routes, since it's a completely separate
// credential from the staff session, not a replacement guard for it.
//
// Runs on every single kiosk-facing request — the highest-frequency read
// in the system — so this reads the shared kiosk cache (in-memory lookup)
// instead of a live Postgres query per request. Kiosks are owner-edited
// via Data Tables only, which invalidates this same cache on write (see
// DataTablesService.invalidateFor), so a token change/deactivation takes
// effect on the very next request.
@Injectable()
export class KioskTokenGuard implements CanActivate {
    constructor(private readonly tableCache: TableCacheService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest();
        const token: unknown = request.body?.token;
        if (typeof token !== "string" || !token) {
            throw new UnauthorizedException("Missing kiosk token.");
        }

        const kiosks = await this.tableCache.getAll<Kiosk>("kiosk");
        const kiosk = kiosks.find((k) => k.token === token);
        if (!kiosk || !kiosk.active) {
            throw new UnauthorizedException("Invalid kiosk token.");
        }

        request.kiosk = kiosk;
        return true;
    }
}
