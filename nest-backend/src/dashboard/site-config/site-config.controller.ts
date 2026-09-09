import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import { SiteConfigService } from "./site-config.service.js";
import { SaveSiteConfigDto } from "./dto/save-site-config.dto.js";
import { SetSiteConfigActiveDto } from "./dto/set-site-config-active.dto.js";
import { DeleteSiteConfigDto } from "./dto/delete-site-config.dto.js";
import { TestMailConnectionDto } from "./dto/test-mail-connection.dto.js";

// Owner-role gated, same as every other dashboard-only action.
@Roles("ADMIN", "DEVELOPER")
@Controller()
export class SiteConfigController {
    constructor(private readonly service: SiteConfigService) {}

    @Post("bootstrap_site_config")
    bootstrap() {
        return this.service.getBootstrapData();
    }

    @Post("save_site_config")
    async save(@Body() dto: SaveSiteConfigDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.save(dto, user.user_id);
        return {};
    }

    @Post("set_site_config_active")
    async setActive(@Body() dto: SetSiteConfigActiveDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.setActive(dto.category, dto.isActive, user.user_id);
        return {};
    }

    @Post("delete_site_config")
    async delete(@Body() dto: DeleteSiteConfigDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.delete(dto.category, user.user_id);
        return {};
    }

    @Post("test_mail_connection")
    async testMailConnection(@Body() dto: TestMailConnectionDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.testMailConnection(dto, user.user_id);
        return {};
    }
}
