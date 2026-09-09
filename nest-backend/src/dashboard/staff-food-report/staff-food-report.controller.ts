import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { StaffFoodReportService } from "./staff-food-report.service.js";
import { StaffFoodReportDto } from "./dto/staff-food-report.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class StaffFoodReportController {
    constructor(private readonly service: StaffFoodReportService) {}

    @Post("bootstrap_staff_food_report")
    bootstrap(@Body() dto: StaffFoodReportDto) {
        return this.service.bootstrap(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }
}
