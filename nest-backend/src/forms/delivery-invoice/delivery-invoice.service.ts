import { Injectable } from "@nestjs/common";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";
import type { Supplier } from "@prisma/client";

@Injectable()
export class DeliveryInvoiceService {
    constructor(
        private readonly enumOptions: EnumOptionService,
        private readonly tableCache: TableCacheService,
    ) {}

    async getBootstrapData() {
        const [suppliers, documentTypes] = await Promise.all([
            this.tableCache.getAll<Supplier>("supplier"),
            this.enumOptions.getOptions("document_type"),
        ]);
        return {
            businessDate: toDateStr(startOfTodayUtc()),
            suppliers: suppliers.map((s) => ({ id: s.supplier_id, name: s.name })),
            documentTypes,
        };
    }
}
