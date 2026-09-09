import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { MoveStockService } from "./move-stock.service.js";
import type { Kiosk } from "@prisma/client";

@UseGuards(KioskTokenGuard)
@Controller()
export class MoveStockController {
    constructor(private readonly service: MoveStockService) {}

    @Post("bootstrap_move_stock")
    bootstrap(@CurrentKiosk() kiosk: Kiosk) {
        return this.service.getBootstrapData(kiosk);
    }
}
