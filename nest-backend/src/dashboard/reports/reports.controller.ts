import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ReportsService } from "./reports.service.js";
import { ReportsRangeDto, SendReportEmailDto } from "./dto/reports.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class ReportsController {
    constructor(private readonly service: ReportsService) {}

    @Post("bootstrap_production_report")
    bootstrapProduction(@Body() dto: ReportsRangeDto) {
        return this.service.bootstrapProductionReport(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }

    @Post("bootstrap_trends_report")
    bootstrapTrends(@Body() dto: ReportsRangeDto) {
        return this.service.bootstrapTrends(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }

    @Post("send_report_email")
    sendReportEmail(@Body() dto: SendReportEmailDto) {
        return this.service.sendReportEmail(dto.to, dto.subject, dto.html);
    }
}
