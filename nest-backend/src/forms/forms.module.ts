import { Module } from "@nestjs/common";
import { PipelineModule } from "../pipeline/pipeline.module.js";
import { FormsController } from "./forms.controller.js";
import { StaffFoodController } from "./staff-food/staff-food.controller.js";
import { StaffFoodService } from "./staff-food/staff-food.service.js";
import { MorningWasteController } from "./morning-waste/morning-waste.controller.js";
import { MorningWasteService } from "./morning-waste/morning-waste.service.js";
import { FoodWasteController } from "./food-waste/food-waste.controller.js";
import { FoodWasteService } from "./food-waste/food-waste.service.js";
import { DamagedProductController } from "./damaged-product/damaged-product.controller.js";
import { DamagedProductService } from "./damaged-product/damaged-product.service.js";
import { HelpIssueController } from "./help-issue/help-issue.controller.js";
import { HelpIssueService } from "./help-issue/help-issue.service.js";
import { MoveStockController } from "./move-stock/move-stock.controller.js";
import { MoveStockService } from "./move-stock/move-stock.service.js";
import { WeeklyStocktakeController } from "./weekly-stocktake/weekly-stocktake.controller.js";
import { WeeklyStocktakeService } from "./weekly-stocktake/weekly-stocktake.service.js";
import { MonthlyAuditController } from "./monthly-audit/monthly-audit.controller.js";
import { MonthlyAuditService } from "./monthly-audit/monthly-audit.service.js";
import { AuditCorrectionController } from "./audit-correction/audit-correction.controller.js";
import { AuditCorrectionService } from "./audit-correction/audit-correction.service.js";
import { FridgeCountController } from "./fridge-count/fridge-count.controller.js";
import { FridgeCountService } from "./fridge-count/fridge-count.service.js";
import { DeliveryInvoiceController } from "./delivery-invoice/delivery-invoice.controller.js";
import { DeliveryInvoiceService } from "./delivery-invoice/delivery-invoice.service.js";

@Module({
    imports: [PipelineModule],
    controllers: [
        FormsController,
        StaffFoodController,
        MorningWasteController,
        FoodWasteController,
        DamagedProductController,
        HelpIssueController,
        MoveStockController,
        WeeklyStocktakeController,
        MonthlyAuditController,
        AuditCorrectionController,
        FridgeCountController,
        DeliveryInvoiceController,
    ],
    providers: [
        StaffFoodService,
        MorningWasteService,
        FoodWasteService,
        DamagedProductService,
        HelpIssueService,
        MoveStockService,
        WeeklyStocktakeService,
        MonthlyAuditService,
        AuditCorrectionService,
        FridgeCountService,
        DeliveryInvoiceService,
    ],
})
export class FormsModule {}
