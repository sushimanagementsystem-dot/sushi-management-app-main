import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../../common/decorators/current-kiosk.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { StaffFoodService } from "./staff-food.service.js";
import type { Kiosk } from "@prisma/client";
import type { AuthenticatedUser } from "../../auth/auth.types.js";

@UseGuards(KioskTokenGuard)
@Controller()
export class StaffFoodController {
    constructor(private readonly staffFoodService: StaffFoodService) {}

    @Post("bootstrap_staff_food")
    bootstrap(@CurrentKiosk() kiosk: Kiosk, @CurrentUser() user: AuthenticatedUser) {
        return this.staffFoodService.getBootstrapData(kiosk, user.user_id);
    }
}
