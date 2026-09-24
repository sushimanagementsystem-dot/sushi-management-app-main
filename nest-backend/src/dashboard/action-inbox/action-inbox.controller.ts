import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "../../auth/auth.types.js";
import { ActionInboxService } from "./action-inbox.service.js";
import { StocktakeReviewService } from "./stocktake-review.service.js";
import { StockTransferReviewService } from "./stock-transfer-review.service.js";
import { InvoiceReviewService } from "./invoice-review.service.js";
import { InvoiceAiService } from "../../production-engine/invoice-ai.service.js";
import { AuditReviewService } from "./audit-review.service.js";
import {
    BootstrapActionInboxDto,
    DeliveryHeaderIdDto,
    InvoiceLineIdDto,
    OwnerActionIdDto,
    ReviewAuditAnswerDto,
    ReviewAuditCorrectionDto,
    SaveInvoiceLineDto,
    SaveStocktakeLineDto,
    StocktakeHeaderIdDto,
    StocktakeLineIdDto,
    TransferIdsDto,
    UpdateOwnerActionDto,
    UpdateRequestDto,
    UpdateStockTransferDto,
} from "./dto/action-inbox.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class ActionInboxController {
    constructor(
        private readonly inbox: ActionInboxService,
        private readonly stocktake: StocktakeReviewService,
        private readonly transfers: StockTransferReviewService,
        private readonly invoices: InvoiceReviewService,
        private readonly audits: AuditReviewService,
        private readonly invoiceAi: InvoiceAiService,
    ) {}

    @Post("bootstrap_action_inbox")
    bootstrap(@Body() dto: BootstrapActionInboxDto) {
        return this.inbox.bootstrap(dto);
    }

    @Post("get_action_detail")
    getDetail(@Body() dto: OwnerActionIdDto) {
        return this.inbox.getActionDetail(dto.ownerActionId);
    }

    @Post("update_owner_action")
    updateOwnerAction(@Body() dto: UpdateOwnerActionDto, @CurrentUser() user: AuthenticatedUser) {
        return this.inbox.updateOwnerAction(dto.ownerActionId, dto.changes, user.user_id);
    }

    @Post("update_request")
    updateRequest(@Body() dto: UpdateRequestDto, @CurrentUser() user: AuthenticatedUser) {
        return this.inbox.updateRequest(dto.requestId, dto.changes, dto.ownerActionId, user.user_id);
    }

    @Post("save_stocktake_line")
    saveStocktakeLine(@Body() dto: SaveStocktakeLineDto) {
        return this.stocktake.saveLine(dto.stocktakeHeaderId, !!dto.isNew, dto.line);
    }

    @Post("delete_stocktake_line")
    async deleteStocktakeLine(@Body() dto: StocktakeLineIdDto) {
        await this.stocktake.deleteLine(dto.stocktakeLineId);
        return {};
    }

    @Post("confirm_stocktake")
    async confirmStocktake(@Body() dto: StocktakeHeaderIdDto, @CurrentUser() user: AuthenticatedUser) {
        await this.stocktake.confirm(dto.stocktakeHeaderId, user.user_id);
        return {};
    }

    @Post("decline_stocktake")
    async declineStocktake(@Body() dto: StocktakeHeaderIdDto, @CurrentUser() user: AuthenticatedUser) {
        await this.stocktake.decline(dto.stocktakeHeaderId, user.user_id);
        return {};
    }

    @Post("update_stock_transfer")
    updateStockTransfer(@Body() dto: UpdateStockTransferDto) {
        return this.transfers.update(dto.transferId, dto.changes);
    }

    @Post("approve_stock_transfers")
    async approveStockTransfers(@Body() dto: TransferIdsDto, @CurrentUser() user: AuthenticatedUser) {
        return { results: await this.transfers.approve(dto.transferIds, user.user_id) };
    }

    @Post("decline_stock_transfers")
    async declineStockTransfers(@Body() dto: TransferIdsDto, @CurrentUser() user: AuthenticatedUser) {
        return { results: await this.transfers.decline(dto.transferIds, user.user_id) };
    }

    @Post("apply_stock_transfers")
    async applyStockTransfers(@Body() dto: TransferIdsDto, @CurrentUser() user: AuthenticatedUser) {
        return { results: await this.transfers.apply(dto.transferIds, user.user_id) };
    }

    @Post("save_invoice_line")
    saveInvoiceLine(@Body() dto: SaveInvoiceLineDto) {
        return this.invoices.saveLine(dto.deliveryHeaderId, !!dto.isNew, dto.line);
    }

    @Post("delete_invoice_line")
    async deleteInvoiceLine(@Body() dto: InvoiceLineIdDto) {
        await this.invoices.deleteLine(dto.invoiceLineId);
        return {};
    }

    /** Runs the AI on an invoice's stored files again — for invoices whose first attempt failed (see InvoiceAiService.reextract). */
    @Post("rerun_invoice_ai")
    rerunInvoiceAi(@Body() dto: DeliveryHeaderIdDto) {
        return this.invoiceAi.reextract(dto.deliveryHeaderId);
    }

    @Post("confirm_invoice_review")
    async confirmInvoiceReview(@Body() dto: DeliveryHeaderIdDto, @CurrentUser() user: AuthenticatedUser) {
        await this.invoices.confirm(dto.deliveryHeaderId, user.user_id);
        return {};
    }

    @Post("undo_invoice_review")
    async undoInvoiceReview(@Body() dto: DeliveryHeaderIdDto, @CurrentUser() user: AuthenticatedUser) {
        return this.invoices.undo(dto.deliveryHeaderId, user.user_id);
    }

    @Post("decline_invoice_review")
    async declineInvoiceReview(@Body() dto: DeliveryHeaderIdDto, @CurrentUser() user: AuthenticatedUser) {
        await this.invoices.decline(dto.deliveryHeaderId, user.user_id);
        return {};
    }

    @Post("review_audit_answer")
    async reviewAuditAnswer(@Body() dto: ReviewAuditAnswerDto, @CurrentUser() user: AuthenticatedUser) {
        await this.audits.reviewAnswer(dto.auditAnswerId, dto.decision, dto.note, user.user_id);
        return {};
    }

    @Post("review_audit_correction")
    async reviewAuditCorrection(@Body() dto: ReviewAuditCorrectionDto, @CurrentUser() user: AuthenticatedUser) {
        await this.audits.reviewCorrection(dto.auditCorrectionId, dto.decision, user.user_id);
        return {};
    }
}
