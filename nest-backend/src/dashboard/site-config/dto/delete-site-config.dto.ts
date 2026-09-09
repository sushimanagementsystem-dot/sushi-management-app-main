import { IsString } from "class-validator";

export class DeleteSiteConfigDto {
    @IsString() category!: string;
}
