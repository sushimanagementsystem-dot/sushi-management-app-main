import { Module } from "@nestjs/common";
import { PurchasingScanService } from "./purchasing-scan.service.js";

// The @Cron-decorated weekly scan just needs this module imported once in
// AppModule to register — nothing else currently needs to inject
// PurchasingScanService directly (ActionInboxService's live kioskBreakdown
// re-derivation uses the shared computeItemTrigger util directly, not this
// service).
@Module({
    providers: [PurchasingScanService],
    exports: [PurchasingScanService],
})
export class PurchasingModule {}
