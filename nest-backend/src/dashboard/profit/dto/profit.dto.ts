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

    /** Used for every row when the sheet has no "Week starting" column. */
    @IsOptional()
    @IsDateString()
    weekOf?: string;

    /** Euro per hour, applied to sheets that give hours only. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    hourlyRate?: number;
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

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
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
