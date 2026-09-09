import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { IssuesService } from "./issues.service.js";
import { IssuesDto } from "./dto/issues.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class IssuesController {
    constructor(private readonly service: IssuesService) {}

    @Post("bootstrap_issues")
    bootstrap(@Body() dto: IssuesDto) {
        return this.service.bootstrap(dto.offset, dto.limit);
    }
}
