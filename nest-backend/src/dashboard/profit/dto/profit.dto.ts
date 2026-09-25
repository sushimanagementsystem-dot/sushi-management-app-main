import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

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

/** Fixed and misc costs are saved one at a time from the Profit table; whichever is sent is set, the other is left alone. */
export class SaveWeeklyCostsDto {
    @IsString()
    kioskId!: string;

    @IsDateString()
    weekOf!: string;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    fixedCosts?: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    miscCosts?: number;
}

export class ParseLabourReportDto {
    @IsString()
    fileBase64!: string;

    @IsOptional()
    @IsString()
    fileName?: string;

    /** The payroll export has no week column of its own — every row in the file is read as this week. */
    @IsDateString()
    weekOf!: string;
}

export class LabourRowDto {
    @IsString()
    kioskId!: string;

    @IsDateString()
    weekStart!: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    hours!: number;

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    hourlyRate?: number | null;

    /** Can be negative: a kiosk's meal-deduction lines can outweigh a small Shifts total in an edge case. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    labourCost?: number | null;
}

export class SaveWeeklyLabourDto {
    @IsArray()
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => LabourRowDto)
    rows!: LabourRowDto[];

    @IsOptional()
    @IsString()
    fileName?: string;
}
