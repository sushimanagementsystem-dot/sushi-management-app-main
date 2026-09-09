import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { WeeklyStocktakeService } from "./weekly-stocktake.service.js";
import type { Kiosk } from "@prisma/client";

@UseGuards(KioskTokenGuard)
@Controller()
export class WeeklyStocktakeController {
    constructor(private readonly service: WeeklyStocktakeService) {}

    @Post("bootstrap_stocktake")
    bootstrap(@CurrentKiosk() kiosk: Kiosk) {
        return this.service.getBootstrapData(kiosk);
    }
}
