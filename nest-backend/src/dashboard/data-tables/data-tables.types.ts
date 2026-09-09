export type FieldSchemaRow = {
    table_name: string;
    column_name: string;
    label: string;
    type: string; // text | integer | decimal | money | boolean | date | enum | enum_list | reference | sub_table
    sub_table: string | null;
    ref_table: string | null;
    ref_label_field: string | null;
    sub_table_join_column: string | null;
    is_title_column: boolean | null;
    enum_source: string | null;
    manage_options: boolean | null;
    min: number | null;
    max: number | null;
    primary_key: boolean | null;
    required: boolean | null;
    searchable: boolean | null;
    hidden: boolean | null;
    editable_on_update: boolean | null;
    editable_on_create: boolean | null;
};

export type RowChange = {
    key: string;
    isNew: boolean;
    isDelete: boolean;
    row: Record<string, unknown>;
};

export type RowChangeResult = { key: string; ok: true; row?: Record<string, unknown> } | { key: string; ok: false; error: string };
