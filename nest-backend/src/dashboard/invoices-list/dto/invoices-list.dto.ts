import { IsDateString, IsOptional, IsString, MinLength } from "class-validator";

export class InvoiceDetailDto {
    @IsString()
    @MinLength(1)
    deliveryHeaderId!: string;
}

export class InvoicesListDto {
    @IsOptional()
    @IsString()
    kioskId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;
}
