import { Global, Module } from "@nestjs/common";
import { UploadService } from "./upload.service.js";
import { UploadController } from "./upload.controller.js";

@Global()
@Module({
    controllers: [UploadController],
    providers: [UploadService],
    exports: [UploadService],
})
export class UploadModule {}
