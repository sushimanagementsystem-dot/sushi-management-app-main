import { Body, Controller, Post } from "@nestjs/common";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { DataTablesService } from "./data-tables.service.js";
import { BootstrapTablesPageDto, BulkSaveTableRowsDto, DeleteTableRowDto, SaveTableRowDto, TableNameDto } from "./dto/data-tables.dto.js";

@Roles("ADMIN", "DEVELOPER")
@Controller()
export class DataTablesController {
    constructor(private readonly service: DataTablesService) {}

    @Post("bootstrap_tables_page")
    bootstrapPage(@Body() dto: BootstrapTablesPageDto) {
        return this.service.bootstrapTablesPage(dto.preferredTable);
    }

    @Post("list_table_rows")
    listRows(@Body() dto: TableNameDto) {
        return this.service.listTableRows(dto.table);
    }

    @Post("bootstrap_data_table")
    bootstrapTable(@Body() dto: TableNameDto) {
        return this.service.bootstrapDataTable(dto.table);
    }

    @Post("save_table_row")
    saveRow(@Body() dto: SaveTableRowDto) {
        return this.service.saveTableRow(dto.table, dto.isNew, dto.row);
    }

    @Post("delete_table_row")
    async deleteRow(@Body() dto: DeleteTableRowDto) {
        await this.service.deleteTableRow(dto.table, dto.row);
        return {};
    }

    @Post("bulk_save_table_rows")
    async bulkSave(@Body() dto: BulkSaveTableRowsDto) {
        return { results: await this.service.bulkSaveTableRows(dto.table, dto.changes) };
    }
}
