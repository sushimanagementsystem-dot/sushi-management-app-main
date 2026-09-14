import {
    BadRequestException,
    Controller,
    Headers,
    Post,
    UnauthorizedException,
    UploadedFile,
    UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { ImportService, summarizeImportResults } from "./import.service.js";
import { Public } from "../common/decorators/public.decorator.js";

/**
 * POST /import/excel — the "client uploads their own database at
 * handover" feature. Same shared-secret pattern the original Apps
 * Script backend uses for its own one-off admin actions (redeploy,
 * process_now — see backend/api/Api.js), not the per-user session auth
 * every regular action needs, since this runs once at go-live before
 * any real users/sessions necessarily exist yet.
 *
 * Upserts every sheet (see import-config.ts for the exact table list and
 * dependency order) — safe to re-run, existing rows are synced rather
 * than duplicated.
 */
@Controller("import")
export class ImportController {
    constructor(
        private readonly importService: ImportService,
        private readonly config: ConfigService,
    ) {}

    @Public()
    @Post("excel")
    @UseInterceptors(FileInterceptor("file"))
    async importExcel(@UploadedFile() file: Express.Multer.File, @Headers("x-import-secret") secret: string) {
        const expected = this.config.getOrThrow<string>("IMPORT_SECRET");
        if (secret !== expected) {
            throw new UnauthorizedException("Invalid or missing import secret.");
        }
        if (!file) {
            throw new BadRequestException("No file uploaded — send it as multipart form field 'file'.");
        }

        const results = await this.importService.importFromBuffer(file.buffer);
        return { totals: summarizeImportResults(results), tables: results };
    }
}
