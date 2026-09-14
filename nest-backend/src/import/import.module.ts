import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller.js";
import { ImportDatabaseController } from "./import-database.controller.js";
import { ImportService } from "./import.service.js";
import { ImportSessionService } from "./import-session.service.js";

@Module({
    controllers: [ImportController, ImportDatabaseController],
    providers: [ImportService, ImportSessionService],
})
export class ImportModule {}
