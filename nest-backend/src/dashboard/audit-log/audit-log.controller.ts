import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import { AuditLogService } from "./audit-log.service.js";
import { UndoDeleteDto } from "./dto/audit-log.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class AuditLogController {
    constructor(private readonly service: AuditLogService) {}

    @Post("undo_delete")
    async undoDelete(@Body() dto: UndoDeleteDto, @CurrentUser() user: AuthenticatedUser) {
        await this.service.undo(dto.auditLogId, user.user_id);
        return {};
    }
}
