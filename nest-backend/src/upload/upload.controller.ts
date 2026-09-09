import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator.js";
import { UploadService } from "./upload.service.js";

/**
 * Serves whatever UploadService.save() wrote to local disk — this route
 * simply didn't exist before, so every evidence/damage/invoice/help-issue
 * photo referenced by its `/uploads/<id>` URL 404'd silently (the frontend
 * previews were also still written for the OLD Apps Script backend's
 * Google Drive share-links, a second, compounding bug fixed alongside this
 * one — see DrivePreview in the dashboard Action Inbox page).
 *
 * @Public() — the id is an unguessable UUID-based filename, so the URL
 * itself is the access control, same trust model the old Drive share-links
 * used. A plain <img>/<iframe> src can't send a session token in a POST
 * body anyway (this app's session auth is body-based, not header-based),
 * so gating this behind SessionAuthGuard isn't practically possible
 * without a parallel token-in-query-string scheme — not worth building for
 * a resource that's already only as secret as its UUID.
 */
@Controller()
export class UploadController {
    constructor(private readonly upload: UploadService) {}

    @Public()
    @Get("uploads/:id")
    async serve(@Param("id") id: string, @Res() res: Response) {
        const file = await this.upload.read(id);
        res.set({
            "Content-Type": file.mimeType,
            // Filenames are content-addressed (random UUID, never reused
            // or overwritten), so caching forever is safe.
            "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.send(file.buffer);
    }
}
