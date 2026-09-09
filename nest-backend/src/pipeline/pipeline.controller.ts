import { Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PipelineService } from "./pipeline.service.js";
import { Public } from "../common/decorators/public.decorator.js";

/**
 * POST /process_now — called server-side only by the Vercel relay right
 * after a real kiosk submit (see frontend's kickProcessing()), never by
 * the browser directly. Same one-off shared-secret pattern as
 * ImportController, matching the old backend's PROCESS_SECRET action.
 */
@Controller()
export class PipelineController {
    constructor(
        private readonly pipeline: PipelineService,
        private readonly config: ConfigService,
    ) {}

    @Public()
    @Post("process_now")
    async processNow(@Headers("x-process-secret") secret: string) {
        if (secret !== this.config.getOrThrow<string>("PROCESS_SECRET")) {
            throw new UnauthorizedException("Invalid or missing process secret.");
        }
        return this.pipeline.sweep();
    }
}
