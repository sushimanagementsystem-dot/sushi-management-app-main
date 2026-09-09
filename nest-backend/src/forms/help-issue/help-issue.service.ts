import { Injectable } from "@nestjs/common";
import { EnumOptionService } from "../../reference-data/enum-option.service.js";
import { startOfTodayUtc, toDateStr } from "../../common/date.util.js";

@Injectable()
export class HelpIssueService {
    constructor(private readonly enumOptions: EnumOptionService) {}

    async getBootstrapData() {
        return {
            businessDate: toDateStr(startOfTodayUtc()),
            categories: await this.enumOptions.getOptions("request_category"),
        };
    }
}
