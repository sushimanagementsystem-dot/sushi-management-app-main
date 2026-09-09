import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Min } from "class-validator";

export class TestMailConnectionDto {
    @IsString() host!: string;
    @IsInt() @Min(1) port!: number;
    @IsBoolean() secure!: boolean;
    @IsString() username!: string;
    // Blank = use whatever password is already saved (mirrors the "leave
    // blank to keep" convention on Save).
    @IsOptional() @IsString() password?: string;
    @IsString() fromName!: string;
    @IsEmail() fromEmail!: string;
    @IsEmail() sendTestTo!: string;
}
