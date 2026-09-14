import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../common/decorators/roles.decorator.js";
import { ImportSessionService } from "./import-session.service.js";
import { StartImportDatabaseDto } from "./dto/start-import-database.dto.js";
import { StepImportDatabaseDto } from "./dto/step-import-database.dto.js";

/**
 * Dashboard-facing counterpart to ImportController's POST /import/excel.
 * That one is the zero-auth, shared-secret handover endpoint used before
 * any admin session necessarily exists (see import.controller.ts); this
 * one is for re-running the same sync later from inside the app, by a
 * signed-in owner — normal session + role gating (no @Public(), no
 * secret header), same convention every other dashboard action uses.
 *
 * Split into start + step (one table per call) instead of one big
 * request so the Upload Data page can show the full sheet list up front
 * and light each one up as it finishes, rather than one spinner for the
 * whole workbook — see ImportSessionService for how the parsed workbook
 * is held between steps.
 *
 * Takes the file as base64 in the JSON body rather than multipart, like
 * every kiosk form's photo/video upload (see readFileForUpload in
 * frontend-next/lib/api.js) — the global SessionAuthGuard reads
 * sessionToken off the raw JSON body, and guards run before any
 * multipart interceptor would get a chance to parse one, so multipart
 * would leave this route unable to authenticate a normal session.
 */
@Roles("ADMIN", "DEVELOPER")
@Controller()
export class ImportDatabaseController {
    constructor(private readonly sessions: ImportSessionService) {}

    @Post("import_database_excel_start")
    start(@Body() dto: StartImportDatabaseDto) {
        const buffer = Buffer.from(dto.fileBase64, "base64");
        return this.sessions.start(buffer);
    }

    @Post("import_database_excel_step")
    async step(@Body() dto: StepImportDatabaseDto) {
        return this.sessions.step(dto.importId, dto.index);
    }
}
