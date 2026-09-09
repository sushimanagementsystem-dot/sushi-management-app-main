import { IsDateString, IsEmail, IsOptional, IsString, MaxLength } from "class-validator";

export class ReportsRangeDto {
    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;
}

export class SendReportEmailDto {
    @IsEmail()
    to!: string;

    @IsString()
    @MaxLength(200)
    subject!: string;

    @IsString()
    html!: string;
}
