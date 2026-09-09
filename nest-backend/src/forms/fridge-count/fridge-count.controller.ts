import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { FridgeCountService } from "./fridge-count.service.js";
import type { Kiosk } from "@prisma/client";

@UseGuards(KioskTokenGuard)
@Controller()
export class FridgeCountController {
    constructor(private readonly service: FridgeCountService) {}

    @Post("bootstrap_fridge_count")
    bootstrap(@CurrentKiosk() kiosk: Kiosk) {
        return this.service.getBootstrapData(kiosk);
    }
}
