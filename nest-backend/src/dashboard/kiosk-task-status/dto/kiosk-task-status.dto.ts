import { IsDateString, IsIn, IsOptional, IsString } from "class-validator";

export class KioskTaskStatusDto {
    @IsOptional()
    @IsDateString()
    date?: string;
}

export class KioskTaskDetailDto {
    @IsString()
    kioskId!: string;

    @IsDateString()
    date!: string;

    @IsIn(["FRIDGE_COUNT", "MORNING_WASTE", "STAFF_FOOD", "PRODUCTION"])
    taskKey!: string;
}
