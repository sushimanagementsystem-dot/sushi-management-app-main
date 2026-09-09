import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { KioskTaskStatusService, type TaskKey } from "./kiosk-task-status.service.js";
import { KioskTaskDetailDto, KioskTaskStatusDto } from "./dto/kiosk-task-status.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class KioskTaskStatusController {
    constructor(private readonly service: KioskTaskStatusService) {}

    @Post("bootstrap_kiosk_task_status")
    bootstrap(@Body() dto: KioskTaskStatusDto) {
        return this.service.bootstrap(dto.date ? new Date(dto.date) : undefined);
    }

    @Post("get_kiosk_task_detail")
    detail(@Body() dto: KioskTaskDetailDto) {
        return this.service.detail(dto.kioskId, new Date(dto.date), dto.taskKey as TaskKey);
    }
}
