import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { SubmissionsMonitorService } from "./submissions-monitor.service.js";
import { SubmissionsMonitorDto } from "./dto/submissions-monitor.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class SubmissionsMonitorController {
    constructor(private readonly service: SubmissionsMonitorService) {}

    @Post("bootstrap_submissions_monitor")
    bootstrap(@Body() dto: SubmissionsMonitorDto) {
        return this.service.bootstrap(dto.startDate ? new Date(dto.startDate) : undefined, dto.endDate ? new Date(dto.endDate) : undefined);
    }
}
