import { IsDateString, IsOptional } from "class-validator";

export class StockVariancesDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}
