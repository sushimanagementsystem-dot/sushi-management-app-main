import { Global, Module } from "@nestjs/common";
import { ProductionEngineService } from "./production-engine.service.js";
import { SecondaryAllocationService } from "./secondary-allocation.service.js";
import { InvoiceAiService } from "./invoice-ai.service.js";
import { AnthropicConfigService } from "./anthropic-config.service.js";
import { ProductionEmailService } from "./production-email.service.js";

@Global()
@Module({
    providers: [ProductionEngineService, SecondaryAllocationService, InvoiceAiService, AnthropicConfigService, ProductionEmailService],
    exports: [ProductionEngineService, InvoiceAiService, AnthropicConfigService, ProductionEmailService],
})
export class ProductionEngineModule {}
