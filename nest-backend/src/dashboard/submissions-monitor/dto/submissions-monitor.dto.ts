import { IsDateString, IsOptional } from "class-validator";

export class SubmissionsMonitorDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}
