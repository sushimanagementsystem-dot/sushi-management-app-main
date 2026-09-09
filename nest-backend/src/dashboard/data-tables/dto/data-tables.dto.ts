import { IsArray, IsBoolean, IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class BootstrapTablesPageDto {
    @IsOptional()
    @IsString()
    preferredTable?: string;
}

// Field name is `table` (not `tableName`) to match the exact wire contract
// frontend-next's DataTablesController.js already sends — verified
// against the old backend's Api.js (body.table), the authoritative source.
export class TableNameDto {
    @IsString()
    @MinLength(1)
    table!: string;
}

export class SaveTableRowDto extends TableNameDto {
    @IsBoolean()
    isNew!: boolean;

    @IsObject()
    row!: Record<string, unknown>;
}

export class DeleteTableRowDto extends TableNameDto {
    @IsObject()
    row!: Record<string, unknown>;
}

export class BulkSaveTableRowsDto extends TableNameDto {
    @IsArray()
    changes!: { key: string; isNew: boolean; isDelete: boolean; row: Record<string, unknown> }[];
}
