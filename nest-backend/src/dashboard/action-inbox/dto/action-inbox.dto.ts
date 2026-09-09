import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class BootstrapActionInboxDto {
    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    category?: string;

    @IsOptional()
    @IsString()
    priority?: string;

    @IsOptional()
    @IsString()
    kioskId?: string;

    @IsOptional()
    @IsBoolean()
    includeClosed?: boolean;

    @IsOptional()
    @IsInt()
    @Min(1)
    page?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(200)
    pageSize?: number;
}

export class OwnerActionIdDto {
    @IsString()
    @MinLength(1)
    ownerActionId!: string;
}

export class UpdateOwnerActionDto extends OwnerActionIdDto {
    @IsObject()
    changes!: Record<string, unknown>;
}

export class UpdateRequestDto {
    @IsString()
    @MinLength(1)
    requestId!: string;

    @IsObject()
    changes!: Record<string, unknown>;

    @IsOptional()
    @IsString()
    ownerActionId?: string;
}

export class StocktakeHeaderIdDto {
    @IsString()
    @MinLength(1)
    stocktakeHeaderId!: string;
}

export class SaveStocktakeLineDto extends StocktakeHeaderIdDto {
    @IsOptional()
    isNew?: boolean;

    @IsObject()
    line!: Record<string, unknown>;
}

export class StocktakeLineIdDto {
    @IsString()
    @MinLength(1)
    stocktakeLineId!: string;
}

export class TransferIdDto {
    @IsString()
    @MinLength(1)
    transferId!: string;
}

export class UpdateStockTransferDto extends TransferIdDto {
    @IsObject()
    changes!: Record<string, unknown>;
}

export class TransferIdsDto {
    @IsArray()
    @IsString({ each: true })
    transferIds!: string[];
}

export class DeliveryHeaderIdDto {
    @IsString()
    @MinLength(1)
    deliveryHeaderId!: string;
}

export class SaveInvoiceLineDto extends DeliveryHeaderIdDto {
    @IsOptional()
    isNew?: boolean;

    @IsObject()
    line!: Record<string, unknown>;
}

export class InvoiceLineIdDto {
    @IsString()
    @MinLength(1)
    invoiceLineId!: string;
}

export class ReviewAuditAnswerDto {
    @IsString()
    @MinLength(1)
    auditAnswerId!: string;

    @IsIn(["ACCEPT", "OVERRIDE_PASS", "OVERRIDE_FAIL", "EVIDENCE_INSUFFICIENT"])
    decision!: string;

    @IsOptional()
    @IsString()
    note?: string;
}

export class ReviewAuditCorrectionDto {
    @IsString()
    @MinLength(1)
    auditCorrectionId!: string;

    @IsIn(["ACCEPT", "REJECT"])
    decision!: string;
}
