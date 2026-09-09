import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../common/guards/kiosk-token.guard.js";
import { CurrentKiosk } from "../common/decorators/current-kiosk.decorator.js";
import { CurrentUser } from "../common/decorators/current-user.decorator.js";
import { SubmissionService } from "../pipeline/submission.service.js";
import { SubmitDto } from "./dto/submit.dto.js";
import type { Kiosk } from "@prisma/client";
import type { AuthenticatedUser } from "../auth/auth.types.js";

// Single shared `submit` route for every form type, matching the old
// backend's contract exactly (body.formType dispatches internally) — see
// backend/api/Api.js's "submit" case. Session-gated by default (no
// @Public()) plus the kiosk token, same combination bootstrap_* uses.
@Controller()
export class FormsController {
    constructor(private readonly submissionService: SubmissionService) {}

    @UseGuards(KioskTokenGuard)
    @Post("submit")
    async submit(@Body() dto: SubmitDto, @CurrentKiosk() kiosk: Kiosk, @CurrentUser() user: AuthenticatedUser) {
        await this.submissionService.intake({
            kiosk,
            formType: dto.formType,
            rawPayload: dto.payload ?? {},
            userId: user.user_id,
            email: user.email,
        });
        return { queued: true };
    }
}
