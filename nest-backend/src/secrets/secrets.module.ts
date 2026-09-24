import { Global, Module } from "@nestjs/common";
import { SecretsService } from "./secrets.service.js";

// @Global: the mailer, Site Configuration and the AI config all read secrets stored in site_config.
@Global()
@Module({
    providers: [SecretsService],
    exports: [SecretsService],
})
export class SecretsModule {}
