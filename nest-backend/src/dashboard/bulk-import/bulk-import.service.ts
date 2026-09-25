import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service.js";
import { TableCacheService } from "../../reference-data/table-cache.service.js";
import type { BulkDataset } from "./bulk-import.types.js";
import { buildTemplate, runBulk } from "./bulk-import.engine.js";
import { stockItemPriceDataset } from "./datasets/stock-item-price.js";
import { stockItemParDataset } from "./datasets/stock-item-par.js";
import { productionParDataset } from "./datasets/production-par.js";
import { defrostParDataset } from "./datasets/defrost-par.js";
import { supplierItemDataset } from "./datasets/supplier-item.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BULK_DATASETS: BulkDataset<any>[] = [productionParDataset, stockItemParDataset, stockItemPriceDataset, supplierItemDataset, defrostParDataset];

/**
 * The single bulk-edit workflow: Download Template -> edit in Excel -> Upload -> Validate -> Preview -> Apply.
 * Each dashboard section only supplies a dataset; this service is the same for all of them:
 *  - template/preview never write anything;
 *  - apply re-reads the SAME file inside one transaction, re-validates against the data as it is now, refuses if any
 *    row has a problem or if the previewed changes are no longer what would be written, and only then writes — all of
 *    it or (on any error) none of it.
 */
@Injectable()
export class BulkImportService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly tableCache: TableCacheService,
    ) {}

    private dataset(id: string) {
        const ds = BULK_DATASETS.find((d) => d.id === id);
        if (!ds) throw new NotFoundException(`Unknown bulk update "${id}".`);
        return ds;
    }

    list() {
        return { datasets: BULK_DATASETS.map((d) => ({ id: d.id, label: d.label, description: d.description, showOn: d.showOn })) };
    }

    async template(id: string) {
        const ds = this.dataset(id);
        const ctx = await ds.load(this.prisma);
        return { fileName: ds.fileName, fileBase64: buildTemplate(ds, ctx).toString("base64") };
    }

    async preview(id: string, fileBase64: string) {
        const ds = this.dataset(id);
        const ctx = await ds.load(this.prisma);
        return runBulk(ds, ctx, Buffer.from(fileBase64, "base64")).preview;
    }

    async apply(id: string, fileBase64: string, token: string) {
        const ds = this.dataset(id);
        const buffer = Buffer.from(fileBase64, "base64");
        const result = await this.prisma.$transaction(
            async (tx) => {
                const ctx = await ds.load(tx);
                const { preview, changes } = runBulk(ds, ctx, buffer);
                if (!preview.canApply) throw new BadRequestException(preview.fileErrors[0] ?? "The file has problems, so nothing was saved. Upload it again to see them.");
                if (preview.token !== token) throw new BadRequestException("The data has changed since you previewed this file, so nothing was saved. Upload the file again to see the current changes.");
                await ds.apply(tx, changes, ctx);
                return { changed: preview.summary.changed, created: preview.summary.new, total: changes.length };
            },
            { timeout: 60000, maxWait: 15000 },
        );
        for (const t of ds.invalidates) this.tableCache.invalidate(t);
        return result;
    }
}
