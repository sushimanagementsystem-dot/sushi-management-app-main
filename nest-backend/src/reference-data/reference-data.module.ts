import { Global, Module } from "@nestjs/common";
import { SettingsService } from "./settings.service.js";
import { EnumOptionService } from "./enum-option.service.js";
import { TableCacheService } from "./table-cache.service.js";

// @Global since nearly every feature module (forms, pipeline processors,
// the production engine, dashboard) reads settings/enum options — same
// rationale as PrismaModule.
@Global()
@Module({
    providers: [SettingsService, EnumOptionService, TableCacheService],
    exports: [SettingsService, EnumOptionService, TableCacheService],
})
export class ReferenceDataModule {}
