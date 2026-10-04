import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import { StockVariancesService } from "./stock-variances.service.js";
import { StockVariancesDto, StockVarianceLineIdDto } from "./dto/stock-variances.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class StockVariancesController {
    constructor(private readonly service: StockVariancesService) {}

    @Post("bootstrap_stock_variances")
    bootstrap(@Body() dto: StockVariancesDto) {
        return this.service.bootstrap(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined, dto.includeDismissed);
    }

    @Post("dismiss_stock_variance")
    async dismiss(@Body() dto: StockVarianceLineIdDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.dismiss(dto.stocktakeLineId, user.user_id);
        return {};
    }

    @Post("undismiss_stock_variance")
    async undismiss(@Body() dto: StockVarianceLineIdDto) {
        await this.service.undismiss(dto.stocktakeLineId);
        return {};
    }
}
