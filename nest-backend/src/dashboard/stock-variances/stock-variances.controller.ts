import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { StockVariancesService } from "./stock-variances.service.js";
import { StockVariancesDto } from "./dto/stock-variances.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class StockVariancesController {
    constructor(private readonly service: StockVariancesService) {}

    @Post("bootstrap_stock_variances")
    bootstrap(@Body() dto: StockVariancesDto) {
        return this.service.bootstrap(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }
}
