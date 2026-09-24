import { IsOptional, IsString } from "class-validator";

export class TestAnthropicConnectionDto {
    // Blank = test whatever key is already saved (mirrors the "leave blank to keep" convention on Save).
    @IsOptional() @IsString() apiKey?: string;
    @IsOptional() @IsString() model?: string;
}
