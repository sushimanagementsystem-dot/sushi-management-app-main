import { IsString } from "class-validator";

export class AuditResultDto {
    @IsString()
    auditResponseId!: string;
}
