import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { HelpIssueService } from "./help-issue.service.js";

@UseGuards(KioskTokenGuard)
@Controller()
export class HelpIssueController {
    constructor(private readonly service: HelpIssueService) {}

    @Post("bootstrap_help_issue")
    bootstrap() {
        return this.service.getBootstrapData();
    }
}
