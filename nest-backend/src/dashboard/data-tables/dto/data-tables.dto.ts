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

    /** Stock Item only, for now: true shows the Archived/Inactive view instead of the normal active-only list. */
    @IsOptional()
    @IsBoolean()
    includeInactive?: boolean;
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

    /** Skips the reference check and deletes every referencing row first — only sent after the owner saw that
     * breakdown (from a first, unforced attempt) and chose "Force delete anyway". */
    @IsOptional()
    @IsBoolean()
    force?: boolean;
}

export class BulkSaveTableRowsDto extends TableNameDto {
    @IsArray()
    changes!: { key: string; isNew: boolean; isDelete: boolean; row: Record<string, unknown>; force?: boolean }[];
}
