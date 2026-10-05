import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { InvoicesListService } from "./invoices-list.service.js";
import { InvoiceDetailDto, InvoicesListDto } from "./dto/invoices-list.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class InvoicesListController {
    constructor(private readonly service: InvoicesListService) {}

    @Post("bootstrap_invoices_list")
    bootstrap(@Body() dto: InvoicesListDto) {
        return this.service.bootstrap(dto.kioskId || undefined, dto.from ? new Date(dto.from) : undefined, dto.to ? new Date(dto.to) : undefined);
    }

    @Post("bootstrap_invoice_detail")
    detail(@Body() dto: InvoiceDetailDto) {
        return this.service.detail(dto.deliveryHeaderId);
    }

    @Post("delete_invoice")
    async delete(@Body() dto: InvoiceDetailDto) {
        await this.service.deleteInvoice(dto.deliveryHeaderId);
        return {};
    }
}
