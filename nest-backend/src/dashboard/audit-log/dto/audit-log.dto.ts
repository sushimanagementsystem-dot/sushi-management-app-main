import { IsString, MinLength } from "class-validator";

export class UndoDeleteDto {
    @IsString()
    @MinLength(1)
    auditLogId!: string;
}
