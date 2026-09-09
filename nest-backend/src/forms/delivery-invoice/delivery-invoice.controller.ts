import { Controller, Post, UseGuards } from "@nestjs/common";
import { KioskTokenGuard } from "../../common/guards/kiosk-token.guard.js";
import { DeliveryInvoiceService } from "./delivery-invoice.service.js";

@UseGuards(KioskTokenGuard)
@Controller()
export class DeliveryInvoiceController {
    constructor(private readonly service: DeliveryInvoiceService) {}

    @Post("bootstrap_delivery_invoice")
    bootstrap() {
        return this.service.getBootstrapData();
    }
}
