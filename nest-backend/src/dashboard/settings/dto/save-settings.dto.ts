import { IsObject } from "class-validator";

export class SaveSettingsDto {
    @IsObject()
    changes!: Record<string, unknown>;
}
