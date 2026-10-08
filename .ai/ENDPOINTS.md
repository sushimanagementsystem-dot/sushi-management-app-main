# ENDPOINTS.md

Full route list for `nest-backend`, extracted directly from `@Post(...)`/`@Get(...)` decorators
across `src/**/*.controller.ts` (verified 2026-10-08, 85 routes). Grouped by controller/area.
Auth defaults per `AUTH.md` unless noted; check the actual controller file for `@Public()`/
`@Roles()` before assuming.

## Auth (`auth/auth.controller.ts`)
- `POST /login` — `@Public()`. Exchanges a Google ID token for a session JWT.
- `POST /whoami` — current session's user info.

## Kiosk (`kiosk/kiosk.controller.ts`)
- `POST /kiosk_info` — `@Public()`-equivalent (kiosk-token gated, not session gated).

## Forms — bootstrap + submit (`forms/*/*.controller.ts`, `forms/forms.controller.ts`)
Kiosk-token gated (`KioskTokenGuard`), not session gated:
- `POST /bootstrap_damaged_product`
- `POST /bootstrap_delivery_invoice`
- `POST /bootstrap_food_waste`
- `POST /bootstrap_fridge_count`
- `POST /bootstrap_help_issue`
- `POST /bootstrap_monthly_audit`
- `POST /bootstrap_morning_waste`
- `POST /bootstrap_move_stock`
- `POST /bootstrap_staff_food`
- `POST /bootstrap_stocktake`
- `POST /bootstrap_audit_correction`
- `POST /submit` — shared submit route for every form type (`forms.controller.ts`), queues a
  `Submission` row for async pipeline processing.

## Pipeline (`pipeline/pipeline.controller.ts`)
- `POST /process_now` — server-side nudge to process the async submission queue immediately
  (called by `frontend-next/app/api/process-now/`, mirrors legacy `process-now.js`).

## Upload (`upload/upload.controller.ts`)
- `GET /uploads/:id` — serves an uploaded file.

## Action Inbox (`dashboard/action-inbox/action-inbox.controller.ts`) — owner, `@Roles("ADMIN","DEVELOPER")`
- `POST /run_purchasing_scan`
- `POST /bootstrap_action_inbox`
- `POST /get_action_detail`
- `POST /update_owner_action`
- `POST /update_request`
- `POST /save_stocktake_line`
- `POST /delete_stocktake_line`
- `POST /confirm_stocktake`
- `POST /decline_stocktake`
- `POST /update_stock_transfer` — qty/source/dest edit, `PENDING` or `APPROVED` only (see
  `DECISIONS.md`)
- `POST /approve_stock_transfers`
- `POST /decline_stock_transfers`
- `POST /apply_stock_transfers` — the only place that posts real `TRANSFER_IN`/`TRANSFER_OUT`
  `stock_movement` rows
- `POST /save_invoice_line`
- `POST /delete_invoice_line`
- `POST /rerun_invoice_ai`
- `POST /reupload_invoice_file`
- `POST /confirm_invoice_review` — posts `DELIVERY_IN` stock movements
- `POST /undo_invoice_review` — refused if a later stocktake already reconciled against these
  movements (see `BUSINESS_LOGIC.md`)
- `POST /decline_invoice_review`
- `POST /correct_invoice_line` — fixes an `APPROVED` line's qty/cost without reopening the
  invoice; posts a `DELIVERY_CORRECTION` movement (see `DECISIONS.md`)
- `POST /review_audit_answer`
- `POST /review_audit_correction`

## Audit Log / Undo (`dashboard/audit-log/audit-log.controller.ts`)
- `POST /undo_delete` — reverses a tracked hard-delete (plain or Force) using its `AuditLog`
  snapshot. No UI browse page for this beyond the 20s post-delete toast — see `KNOWN_ISSUES.md`.

## Audit Result (`dashboard/audit-result/audit-result.controller.ts`)
- `POST /bootstrap_audit_result`

## Bulk Import (`dashboard/bulk-import/bulk-import.controller.ts`)
- `POST /bulk_import_datasets`
- `POST /bulk_import_template`
- `POST /bulk_import_preview`
- `POST /bulk_import_apply`

## Data Tables — generic grid engine (`dashboard/data-tables/data-tables.controller.ts`)
- `POST /bootstrap_data_table`
- `POST /bootstrap_tables_page`
- `POST /list_table_rows`
- `POST /save_table_row`
- `POST /bulk_save_table_rows`
- `POST /delete_table_row` — supports `force: true` (cascade delete, see `DECISIONS.md`)

## Invoices List (`dashboard/invoices-list/invoices-list.controller.ts`)
- `POST /bootstrap_invoices_list`
- `POST /bootstrap_invoice_detail`
- `POST /delete_invoice`

## Issues (`dashboard/issues/issues.controller.ts`)
- `POST /bootstrap_issues`

## Kiosk Task Status (`dashboard/kiosk-task-status/kiosk-task-status.controller.ts`)
- `POST /bootstrap_kiosk_task_status`
- `POST /get_kiosk_task_detail`

## KPI (`dashboard/kpi/kpi.controller.ts`)
- `POST /bootstrap_kpi_dashboard`
- `POST /bootstrap_stock_usage`

## Product Prices (`dashboard/product-prices/product-prices.controller.ts`)
- `POST /bootstrap_stock_item_prices`
- `POST /bootstrap_food_waste_item_prices`

## Profit (`dashboard/profit/profit.controller.ts`)
- `POST /bootstrap_profit_page`

## Reports (`dashboard/reports/reports.controller.ts`)
- `POST /bootstrap_production_report`
- `POST /bootstrap_trends_report`
- `POST /preview_labour_report`
- `POST /send_report_email`

## Settings (`dashboard/settings/dashboard-settings.controller.ts`)
- `POST /bootstrap_settings_page`
- `POST /save_settings`
- `POST /refresh_cache` — invalidates `TableCacheService`; the established way to make a direct
  DB or bulk-import change visible without a server restart
- `POST /test_anthropic_connection`
- `POST /test_mail_connection`

## Site Config (`dashboard/site-config/site-config.controller.ts`)
- `POST /bootstrap_site_config`
- `POST /save_site_config`
- `POST /delete_site_config`
- `POST /set_site_config_active`

## Staff Food Report (`dashboard/staff-food-report/staff-food-report.controller.ts`)
- `POST /bootstrap_staff_food_report`

## Stock Variances (`dashboard/stock-variances/stock-variances.controller.ts`)
- `POST /bootstrap_stock_variances`
- `POST /dismiss_stock_variance`
- `POST /undismiss_stock_variance`

## Submissions Monitor (`dashboard/submissions-monitor/submissions-monitor.controller.ts`)
- `POST /bootstrap_submissions_monitor`

## Kiosk Comparison
`POST /bootstrap_kiosk_comparison` — UNKNOWN exact controller file, not traced to a specific
file this pass (route confirmed to exist via frontend route `app/dashboard/kiosk-comparison/`
and the grep sweep; verify controller location before editing).

## Import (`import/import.controller.ts`, `import/import-database.controller.ts`)
- `POST /import/excel`
- `POST /import_database_excel_start`
- `POST /import_database_excel_step`
- `POST /export_database_excel`

## Weekly costs/labour/sales
`POST /save_weekly_costs`, `POST /save_weekly_labour`, `POST /save_weekly_sales` — UNKNOWN exact
controller file, not traced this pass; confirmed to exist via the route grep sweep only.

---
**Method of extraction**: `grep -rhn '@Post("\|@Get("' nest-backend/src --include=*.ts` (excluding
`*.spec.ts`). If a route doesn't match this grep pattern exactly (e.g. uses a path variable or a
different decorator style), it may be missing from this list — treat this as a strong starting
point, not a guaranteed-exhaustive one, and re-grep before relying on completeness for a
security-sensitive task.
