import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { DashboardSettingsService } from "./dashboard-settings.service.js";
import { SaveSettingsDto } from "./dto/save-settings.dto.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { SettingsService } from "../../reference-data/settings.service.js";

// Owner-role gated, matching backend/api/Api.js's isOwnerRole_() check on
// every dashboard action. Session auth is the default (no @Public()).
@Roles("ADMIN", "DEVELOPER")
@Controller()
export class DashboardSettingsController {
    constructor(
        private readonly service: DashboardSettingsService,
        private readonly tableCache: TableCacheService,
        private readonly settings: SettingsService,
    ) {}

    @Post("bootstrap_settings_page")
    bootstrap() {
        return this.service.getBootstrapData();
    }

    @Post("save_settings")
    async save(@Body() dto: SaveSettingsDto) {
        await this.service.save(dto.changes);
        return {};
    }

    /**
     * Manual escape hatch behind every dashboard page's Refresh button —
     * every write path already invalidates the exact table it touched
     * (see DataTablesService.invalidateFor, AuthService.login), so this is
     * never needed for correctness under normal use. It exists for the
     * case that isn't covered by that: something changed the DB outside
     * the app (a manual query, a future external integration) between
     * requests. Clearing everything is deliberately blunt — it's a rare,
     * explicit, owner-triggered action, not a hot path worth optimizing
     * into per-table selectivity.
     */
    @Post("refresh_cache")
    refreshCache() {
        this.tableCache.invalidateAll();
        this.settings.invalidate();
        return {};
    }
}
