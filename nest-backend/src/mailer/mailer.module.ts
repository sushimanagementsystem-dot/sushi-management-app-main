import { Global, Module } from "@nestjs/common";
import { MailerService } from "./mailer.service.js";

// @Global since both the pipeline (production-plan email) and dashboard
// (developer error notifications) send mail — same rationale as
// ReferenceDataModule.
@Global()
@Module({
    providers: [MailerService],
    exports: [MailerService],
})
export class MailerModule {}
