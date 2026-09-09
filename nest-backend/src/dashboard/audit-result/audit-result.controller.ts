import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { AuditResultService } from "./audit-result.service.js";
import { AuditResultDto } from "./dto/audit-result.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class AuditResultController {
    constructor(private readonly service: AuditResultService) {}

    @Post("bootstrap_audit_result")
    bootstrap(@Body() dto: AuditResultDto) {
        return this.service.bootstrap(dto.auditResponseId);
    }
}
