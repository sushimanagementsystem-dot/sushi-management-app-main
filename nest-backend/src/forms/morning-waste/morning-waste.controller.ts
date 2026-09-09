import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { MorningWasteService } from "./morning-waste.service.js";
import type { Kiosk } from "@prisma/client";

@UseGuards(KioskTokenGuard)
@Controller()
export class MorningWasteController {
    constructor(private readonly service: MorningWasteService) {}

    @Post("bootstrap_morning_waste")
    bootstrap(@CurrentKiosk() kiosk: Kiosk) {
        return this.service.getBootstrapData(kiosk);
    }
}
