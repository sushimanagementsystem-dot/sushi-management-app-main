import { IsOptional, IsString } from "class-validator";

export class StartImportDatabaseDto {
    @IsString()
    fileBase64!: string;

    @IsOptional()
    @IsString()
    fileName?: string;
}
