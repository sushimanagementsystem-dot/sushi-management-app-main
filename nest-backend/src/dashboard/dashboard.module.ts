import { Module } from "@nestjs/common";
import { DataTablesController } from "./data-tables/data-tables.controller.js";
import { DataTablesService } from "./data-tables/data-tables.service.js";
import { DashboardSettingsController } from "./settings/dashboard-settings.controller.js";
import { DashboardSettingsService } from "./settings/dashboard-settings.service.js";
import { KpiController } from "./kpi/kpi.controller.js";
import { KpiService } from "./kpi/kpi.service.js";
import { WasteRateService } from "./kpi/waste-rate.service.js";
import { ProfitController } from "./profit/profit.controller.js";
import { ProfitService } from "./profit/profit.service.js";
import { ProductPricesController } from "./product-prices/product-prices.controller.js";
import { ProductPricesService } from "./product-prices/product-prices.service.js";
import { SubmissionsMonitorController } from "./submissions-monitor/submissions-monitor.controller.js";
import { SubmissionsMonitorService } from "./submissions-monitor/submissions-monitor.service.js";
import { StaffFoodReportController } from "./staff-food-report/staff-food-report.controller.js";
import { StaffFoodReportService } from "./staff-food-report/staff-food-report.service.js";
import { StockVariancesController } from "./stock-variances/stock-variances.controller.js";
import { StockVariancesService } from "./stock-variances/stock-variances.service.js";
import { KioskTaskStatusController } from "./kiosk-task-status/kiosk-task-status.controller.js";
import { KioskTaskStatusService } from "./kiosk-task-status/kiosk-task-status.service.js";
import { IssuesController } from "./issues/issues.controller.js";
import { IssuesService } from "./issues/issues.service.js";
import { RateAlertsService } from "./issues/rate-alerts.service.js";
import { ReportsController } from "./reports/reports.controller.js";
import { ReportsService } from "./reports/reports.service.js";
import { ActionInboxController } from "./action-inbox/action-inbox.controller.js";
import { ActionInboxService } from "./action-inbox/action-inbox.service.js";
import { OwnerActionStateService } from "./action-inbox/owner-action-state.service.js";
import { StocktakeReviewService } from "./action-inbox/stocktake-review.service.js";
import { StockTransferReviewService } from "./action-inbox/stock-transfer-review.service.js";
import { InvoiceReviewService } from "./action-inbox/invoice-review.service.js";
import { InvoiceFileService } from "./action-inbox/invoice-file.service.js";
import { AuditReviewService } from "./action-inbox/audit-review.service.js";
import { AuditResultController } from "./audit-result/audit-result.controller.js";
import { AuditResultService } from "./audit-result/audit-result.service.js";
import { SiteConfigController } from "./site-config/site-config.controller.js";
import { SiteConfigService } from "./site-config/site-config.service.js";
import { BulkImportController } from "./bulk-import/bulk-import.controller.js";
import { BulkImportService } from "./bulk-import/bulk-import.service.js";
import { PurchasingModule } from "../purchasing/purchasing.module.js";

@Module({
    imports: [PurchasingModule],
    controllers: [
        DataTablesController,
        DashboardSettingsController,
        SiteConfigController,
        KpiController,
        ProfitController,
        ProductPricesController,
        SubmissionsMonitorController,
        StaffFoodReportController,
        StockVariancesController,
        KioskTaskStatusController,
        IssuesController,
        ReportsController,
        AuditResultController,
        ActionInboxController,
        BulkImportController,
    ],
    providers: [
        DataTablesService,
        BulkImportService,
        DashboardSettingsService,
        KpiService,
        WasteRateService,
        ProfitService,
        ProductPricesService,
        SubmissionsMonitorService,
        StaffFoodReportService,
        StockVariancesService,
        KioskTaskStatusService,
        IssuesService,
        RateAlertsService,
        ReportsService,
        ActionInboxService,
        OwnerActionStateService,
        StocktakeReviewService,
        StockTransferReviewService,
        InvoiceReviewService,
        InvoiceFileService,
        AuditReviewService,
        AuditResultService,
        SiteConfigService,
    ],
})
export class DashboardModule {}
