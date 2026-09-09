import { Type } from "class-transformer";
import { IsDateString, IsNumber, IsOptional, IsString } from "class-validator";

export class ProfitPageDto {
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

export class SaveWeeklySalesDto {
    @IsString()
    kioskId!: string;

    /** Any date inside the target week — the service normalizes it to that
     * week's Monday, so the frontend never has to compute the anchor itself. */
    @IsDateString()
    weekOf!: string;

    @Type(() => Number)
    @IsNumber()
    salesAmount!: number;

    @IsOptional()
    @IsString()
    note?: string;
}
