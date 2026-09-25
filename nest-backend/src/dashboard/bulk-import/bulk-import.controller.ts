import { Body, Controller, Post } from "@nestjs/common";
import { IsString, MaxLength } from "class-validator";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { BulkImportService } from "./bulk-import.service.js";

class DatasetDto {
    @IsString()
    dataset!: string;
}

class PreviewDto extends DatasetDto {
    @IsString()
    fileBase64!: string;
}

class ApplyDto extends PreviewDto {
    /** The fingerprint the preview returned; Apply refuses if the changes are no longer exactly those. */
    @IsString()
    @MaxLength(128)
    token!: string;
}

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class BulkImportController {
    constructor(private readonly service: BulkImportService) {}

    @Post("bulk_import_datasets")
    list() {
        return this.service.list();
    }

    @Post("bulk_import_template")
    template(@Body() dto: DatasetDto) {
        return this.service.template(dto.dataset);
    }

    @Post("bulk_import_preview")
    preview(@Body() dto: PreviewDto) {
        return this.service.preview(dto.dataset, dto.fileBase64);
    }

    @Post("bulk_import_apply")
    apply(@Body() dto: ApplyDto) {
        return this.service.apply(dto.dataset, dto.fileBase64, dto.token);
    }
}
