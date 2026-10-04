import { IsBoolean, IsDateString, IsOptional, IsString, MinLength } from "class-validator";

export class StockVariancesDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsBoolean()
    includeDismissed?: boolean;
}

export class StockVarianceLineIdDto {
    @IsString()
    @MinLength(1)
    stocktakeLineId!: string;
}
