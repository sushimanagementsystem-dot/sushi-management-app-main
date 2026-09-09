import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { MonthlyAuditService } from "./monthly-audit.service.js";
import type { Kiosk } from "@prisma/client";

@UseGuards(KioskTokenGuard)
@Controller()
export class MonthlyAuditController {
    constructor(private readonly service: MonthlyAuditService) {}

    @Post("bootstrap_monthly_audit")
    bootstrap(@CurrentKiosk() kiosk: Kiosk) {
        return this.service.getBootstrapData(kiosk);
    }
}
