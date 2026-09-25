import { Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { ProductPricesService } from "./product-prices.service.js";

/** The Stock Item list for the Product Prices page. Bulk price updates from Excel go through the shared bulk-import workflow. */
@Roles("ADMIN", "DEVELOPER")
@Controller()
export class ProductPricesController {
    constructor(private readonly service: ProductPricesService) {}

    @Post("bootstrap_stock_item_prices")
    stockItemRows() {
        return this.service.stockItemRows();
    }
}
