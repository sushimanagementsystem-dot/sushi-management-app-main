import { IsBoolean, IsObject, IsOptional, IsString } from "class-validator";

export class SaveSiteConfigDto {
    @IsString() category!: string;

    // Both merge onto the existing row (not replace) — so omitting a
    // secret field (a blank password) keeps whatever is already saved.
    @IsOptional() @IsObject() config?: Record<string, unknown>;
    @IsOptional() @IsObject() secrets?: Record<string, unknown>;

    @IsOptional() @IsBoolean() isActive?: boolean;
}
