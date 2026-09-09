import { IsBoolean, IsString } from "class-validator";

export class SetSiteConfigActiveDto {
    @IsString() category!: string;
    @IsBoolean() isActive!: boolean;
}
