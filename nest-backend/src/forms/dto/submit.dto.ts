import { IsObject, IsOptional, IsString, MinLength } from "class-validator";

export class SubmitDto {
    @IsString()
    @MinLength(1)
    token!: string;

    @IsString()
    @MinLength(1)
    formType!: string;

    // payload shape is form-specific — each processor's own validate()
    // does the real check; the DTO only guarantees the envelope is sane.
    // Needs a decorator or ValidationPipe's whitelist:true silently drops it.
    @IsOptional()
    @IsObject()
    payload?: unknown;
}
