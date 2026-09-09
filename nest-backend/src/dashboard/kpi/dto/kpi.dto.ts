import { IsDateString, IsOptional, IsString } from "class-validator";

export class KpiDashboardDto {
    @IsOptional()
    @IsString()
    kioskId?: string;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export class KioskComparisonDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export class StockUsageDto {
    @IsOptional()
    @IsString()
    kioskId?: string;

    @IsOptional()
    @IsString()
    openingStocktakeHeaderId?: string;

    @IsOptional()
    @IsString()
    closingStocktakeHeaderId?: string;
}
