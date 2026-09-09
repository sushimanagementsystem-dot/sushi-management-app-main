import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { KpiService } from "./kpi.service.js";
import { KioskComparisonDto, KpiDashboardDto, StockUsageDto } from "./dto/kpi.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class KpiController {
    constructor(private readonly service: KpiService) {}

    @Post("bootstrap_kpi_dashboard")
    kpiDashboard(@Body() dto: KpiDashboardDto) {
        return this.service.bootstrapKpiDashboard(dto.kioskId, dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }

    @Post("bootstrap_kiosk_comparison")
    kioskComparison(@Body() dto: KioskComparisonDto) {
        return this.service.bootstrapKioskComparison(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }

    @Post("bootstrap_stock_usage")
    stockUsage(@Body() dto: StockUsageDto) {
        return this.service.bootstrapStockUsage(dto.kioskId, dto.openingStocktakeHeaderId, dto.closingStocktakeHeaderId);
    }
}
