import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import { ProfitService } from "./profit.service.js";
import { ProfitPageDto, SaveWeeklySalesDto } from "./dto/profit.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class ProfitController {
    constructor(private readonly service: ProfitService) {}

    @Post("bootstrap_profit_page")
    bootstrapProfitPage(@Body() dto: ProfitPageDto) {
        return this.service.bootstrapProfitPage(dto.kioskId, dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }

    @Post("save_weekly_sales")
    saveWeeklySales(@Body() dto: SaveWeeklySalesDto, @CurrentUser() user: AuthenticatedUser) {
        return this.service.saveWeeklySales(dto.kioskId, new Date(dto.weekOf), dto.salesAmount, dto.note, user.user_id);
    }
}
