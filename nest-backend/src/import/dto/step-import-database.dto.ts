import { IsInt, IsString, Min } from "class-validator";

export class StepImportDatabaseDto {
    @IsString()
    importId!: string;

    @IsInt()
    @Min(0)
    index!: number;
}
