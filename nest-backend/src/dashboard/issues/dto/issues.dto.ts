import { IsIn, IsInt, IsOptional, Min } from "class-validator";
import { DATE_RANGE_KEYS, type DateRangeKey } from "../../../common/date-range.util.js";

export class IssuesDto {
    @IsOptional()
    @IsInt()
    @Min(0)
    offset?: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    limit?: number;

    @IsOptional()
    @IsIn(DATE_RANGE_KEYS)
    range?: DateRangeKey;
}
