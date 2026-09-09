import { Module } from "@nestjs/common";
import { SubmissionService } from "./submission.service.js";
import { PipelineService } from "./pipeline.service.js";
import { PipelineController } from "./pipeline.controller.js";
import { SUBMISSION_PROCESSORS } from "./submission-processor.interface.js";
import { StaffFoodProcessor } from "./processors/staff-food.processor.js";
import { MorningWasteProcessor } from "./processors/morning-waste.processor.js";
import { FoodWasteProcessor } from "./processors/food-waste.processor.js";
import { DamagedProductProcessor } from "./processors/damaged-product.processor.js";
import { HelpIssueProcessor } from "./processors/help-issue.processor.js";
import { MoveStockProcessor } from "./processors/move-stock.processor.js";
import { WeeklyStocktakeProcessor } from "./processors/weekly-stocktake.processor.js";
import { MonthlyAuditProcessor } from "./processors/monthly-audit.processor.js";
import { AuditCorrectionProcessor } from "./processors/audit-correction.processor.js";
import { FridgeCountProcessor } from "./processors/fridge-count.processor.js";
import { DeliveryInvoiceProcessor } from "./processors/delivery-invoice.processor.js";

// Every SubmissionProcessor implementation is registered here as a single
// keyed array provider — add a new form type by adding its class to this
// list, not by editing SubmissionService/PipelineService.
const PROCESSORS = [
    StaffFoodProcessor,
    MorningWasteProcessor,
    FoodWasteProcessor,
    DamagedProductProcessor,
    HelpIssueProcessor,
    MoveStockProcessor,
    WeeklyStocktakeProcessor,
    MonthlyAuditProcessor,
    AuditCorrectionProcessor,
    FridgeCountProcessor,
    DeliveryInvoiceProcessor,
];

@Module({
    controllers: [PipelineController],
    providers: [
        SubmissionService,
        PipelineService,
        ...PROCESSORS,
        {
            provide: SUBMISSION_PROCESSORS,
            useFactory: (...processors: unknown[]) => processors,
            inject: PROCESSORS,
        },
    ],
    exports: [SubmissionService],
})
export class PipelineModule {}
