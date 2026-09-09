import { IsDateString, IsOptional } from "class-validator";

export class StaffFoodReportDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}
