"use client";

/**
 * Data Tables — the generic, schema-driven CRUD grid engine backing every
 * table in `table_schema` (see backend/dashboard/DataTables.js). Ported
 * from the plain frontend's pages/dashboard/tables.html (2665 lines) almost
 * verbatim: this is deliberately kept as plain, imperative DOM/Tabulator
 * code (not React state) rather than rewritten into idiomatic React —
 * Tabulator already owns its own DOM subtree and the original's dirty-
 * tracking/filter/popup/modal logic is intricate and load-bearing, so a
 * faithful near-1:1 port is lower-risk than a from-scratch React rewrite.
 * The only React touchpoint is the `<title>` bridge (onTitleChange) and the
 * DashboardShell unsaved-changes guard (see createTablesPageController's
 * return value) — everything else here is framework-agnostic and mounts
 * itself directly into a container element via createTablesPageController.
 *
 * Pure Tailwind utility classNames for every element THIS module creates —
 * see tabulator-theme.css for the one exception (Tabulator's own
 * auto-generated header/row/cell chrome, which we don't render ourselves).
 */

import { TabulatorFull as Tabulator } from "tabulator-tables";
import { apiCall } from "@/lib/api";
import { confirmModal } from "@/components/ConfirmModal";
import { makeSearchPick } from "./vanillaSearchPick";

// --- Session-lifetime caches (module-level — shared across every mount of
// this page within the browser tab, matching the original's "cleared only
// by a real page reload" intent). Row data is NOT cached here — always
// fetched fresh; see DataGrid#load. ---------------------------------------

let SCHEMA_CACHE = {}; // table_name -> fields[]
let REF_CACHES = {}; // ref_table -> { id: fullRow }
let ENUM_CACHES = {}; // enum_source -> [{value, label}]
let TABLE_META_CACHE = {}; // table_name -> table_schema row
let CHILD_TABLE_CACHE = {}; // child table name -> Promise<bootstrap_data_table response>
let ENUM_OPTION_ALL_ROWS = null; // every enum_option row, all types

// --- Shared button className constants (complete literal strings, not
// composed fragments, so Tailwind's static extraction can see them) -------

// max-[720px]:min-h-[2.75rem] on every button below is a real touch-target
// fix, not decoration — 44px is the accepted minimum comfortable tap
// target (WCAG 2.5.5 / iOS HIG), and these buttons' desktop padding alone
// (py-1.5/py-1 plus line-height) lands well under that.
// shadow-elevate-1/hover:shadow-elevate-2 + active:scale gives every
// button a tactile press feel instead of a flat color swap — the
// transition timing itself comes from globals.css's base `button` rule.
// Browsers don't fire :hover/:active on disabled form elements, so plain
// hover:/active: variants (no need for a Tailwind "enabled:" variant,
// which doesn't exist) are already safe here.
//
// Sizing matches the compact scale every other dashboard toolbar (KpiFilters,
// PillButton, the shared RefreshButton) already uses — this toolbar was
// still on the original larger py-[0.6rem]/text-[0.9rem] sizing from before
// that convention existed, which is why it read oversized next to
// everything else on the page.
const DASH_BTN =
    "rounded-lg border-none bg-accent text-accent-ink px-2.5 py-1.5 text-[0.78rem] font-semibold cursor-pointer shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50 disabled:cursor-default max-[720px]:min-h-[2.75rem]";
const DASH_BTN_MUTED =
    "rounded-lg border border-line bg-card text-ink px-2.5 py-1.5 text-[0.78rem] font-medium cursor-pointer hover:border-accent/40 hover:text-accent active:scale-[0.97] disabled:opacity-50 disabled:cursor-default max-[720px]:min-h-[2.75rem]";
// Destructive actions (delete, not discard-an-unsaved-edit) get this
// instead of DASH_BTN_MUTED — red is reserved for buttons that actually
// remove stored data, so it stays a meaningful signal instead of just
// another button color.
const DASH_BTN_DANGER =
    "rounded-lg border-none bg-danger-ink text-white px-2.5 py-1.5 text-[0.78rem] font-semibold cursor-pointer shadow-elevate-1 hover:bg-danger-ink/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50 disabled:cursor-default max-[720px]:min-h-[2.75rem]";
const DASH_BTN_SMALL =
    "rounded-lg border-none bg-accent text-accent-ink px-2 py-1 text-[0.72rem] font-semibold cursor-pointer shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50 disabled:cursor-default max-[720px]:min-h-[2.75rem]";
const MODAL_FIELD = "mb-[0.8rem]";
// flex-[1_1_100%] on mobile forces one field per row — a deliberate,
// explicit single-column form on small screens, not just "happens to wrap"
// once two 12rem fields no longer fit.
const MODAL_FIELD_GRID = "mb-[0.8rem] flex-[1_1_12rem] min-w-[12rem] max-[720px]:flex-[1_1_100%]";
const MODAL_FIELD_LABEL = "mb-[0.25rem] block text-[0.85rem] text-muted";

// Below 720px every dialog (row detail/edit, add-row, confirm) becomes a
// bottom sheet — full width, anchored to the bottom edge, rounded top
// corners only — instead of a small floating card centered in the middle
// of the screen. That's the standard mobile pattern (reachable near the
// thumb, uses the full width for form fields) and matches what
// ConfirmModal.js and the Action Inbox detail modal also do.
const MODAL_OVERLAY =
    "fixed inset-0 z-50 flex items-center justify-center bg-[rgba(20,24,30,0.45)] backdrop-blur-[2px] max-[720px]:items-end";
const modalBoxClass = (widthClass) =>
    `${widthClass} max-w-[calc(100vw-2rem)] max-h-[calc(100vh-4rem)] overflow-y-auto rounded-card bg-card p-[1.4rem] shadow-elevate-3 ` +
    "max-[720px]:w-full max-[720px]:max-w-full max-[720px]:max-h-[88vh] max-[720px]:rounded-b-none max-[720px]:rounded-t-[1.2rem] max-[720px]:p-[1.1rem]";

const COLUMN_FILTER_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M1.5 2h13l-5 6.2v5.3l-3 1.5V8.2z"/></svg>';
const COLUMN_MANAGE_ICON_SVG =
    '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="8" cy="8" r="2.6"/><path d="M8 1.3v2M8 12.7v2M1.3 8h2M12.7 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/></svg>';

/** Populates SCHEMA_CACHE/REF_CACHES/ENUM_CACHES from a response shaped
 * like bootstrapDataTable's (fields/references/enums) — shared by a
 * table's own first load and the page's very first load
 * (bootstrap_tables_page returns the same shape). */
function cacheBootstrapResponse(res, tableName) {
    if (!res.ok) return res;
    SCHEMA_CACHE[tableName] = res.fields;
    TABLE_META_CACHE[tableName] = res.meta || {};
    Object.keys(res.references || {}).forEach((t) => {
        const idField = t + "_id";
        const byId = {};
        (res.references[t] || []).forEach((r) => {
            byId[r[idField]] = r;
        });
        REF_CACHES[t] = byId;
    });
    Object.keys(res.enums || {}).forEach((e) => {
        ENUM_CACHES[e] = res.enums[e] || [];
    });
    return res;
}

/**
 * Correctness half of the caching above: called with the table that just
 * changed on the server (a real save, never a discard). Clears every
 * session-lifetime cache entry that write could have made stale —
 * "destroy the cache for whatever the action actually touched", not a
 * blanket clear-everything, so tables nobody wrote to keep their cache.
 */
function invalidateCachesFor(tableName) {
    // Other tables' cached "id -> row" lookup into this one (dropdown
    // labels, detail-view joins) — see cacheBootstrapResponse.
    delete REF_CACHES[tableName];

    if (tableName === "enum_option") {
        // Every table's cached dropdown options could reference any
        // enum_type, and we don't cheaply know which ones this batch
        // touched — clear all of them rather than risk showing a stale
        // option list or a since-renamed label.
        ENUM_CACHES = {};
        ENUM_OPTION_ALL_ROWS = null;
    }

    if (tableName === "field_schema") {
        // field_schema rows describe every OTHER table's own bootstrap
        // (fields/required/min/max/...) — a save here can affect any of
        // them, and again we don't cheaply know which table_name(s) this
        // batch touched, so clear every cached schema, not just this one.
        SCHEMA_CACHE = {};
    }

    if (tableName === "table_schema") {
        // table_schema rows are each table's own label/description/
        // hard_delete/has_detail_view — safe to clear in full for the
        // same reason as field_schema above.
        TABLE_META_CACHE = {};
    }
}

/** Kicks off a background fetch for every type=sub_table child declared on
 * a table's schema, deduped via CHILD_TABLE_CACHE — called once, only for
 * the page-level grid. */
function prefetchSubTableChildren_(fields) {
    fields.filter((f) => f.type === "sub_table").forEach((f) => {
        const childTable = f.sub_table;
        if (CHILD_TABLE_CACHE[childTable]) return;
        CHILD_TABLE_CACHE[childTable] = apiCall("bootstrap_data_table", { table: childTable }).then((res) => {
            if (!res.ok) {
                delete CHILD_TABLE_CACHE[childTable];
                return null;
            }
            cacheBootstrapResponse(res, childTable);
            return res;
        });
    });
}

/** Per-type matching logic for one active column filter. */
function columnFilterMatches(f, rawValue, state) {
    if (f.type === "integer" || f.type === "decimal" || f.type === "money") {
        const num = rawValue === "" || rawValue === null || rawValue === undefined ? null : Number(rawValue);
        if (num === null || isNaN(num)) return false;
        if (state.op === "between") return num >= Number(state.value) && num <= Number(state.value2);
        if (state.op === "gt") return num > Number(state.value);
        if (state.op === "lt") return num < Number(state.value);
        return num === Number(state.value);
    }
    if (f.type === "date") {
        const val = String(rawValue || "");
        if (!val) return false;
        if (state.op === "between") return val >= state.value && val <= state.value2;
        if (state.op === "before") return val < state.value;
        if (state.op === "after") return val > state.value;
        return val === state.value;
    }
    if (f.type === "boolean") {
        return rawValue === (state.value === "true");
    }
    if (f.type === "enum") {
        return state.values.includes(rawValue);
    }
    if (f.type === "enum_list") {
        const rowValues = String(rawValue || "").split(",").map((v) => v.trim());
        return state.values.some((v) => rowValues.includes(v));
    }
    if (f.type === "reference" && state.values) {
        return state.values.includes(String(rawValue));
    }
    let label = rawValue;
    if (f.type === "reference") {
        const cache = REF_CACHES[f.ref_table] || {};
        const row = cache[rawValue];
        label = row ? row[f.ref_label_field] : rawValue;
    }
    const hay = String(label ?? "").toLowerCase();
    const needle = String(state.value ?? "").toLowerCase();
    if (state.op === "equals") return hay === needle;
    if (state.op === "starts") return hay.startsWith(needle);
    if (state.op === "ends") return hay.endsWith(needle);
    return hay.includes(needle);
}

/**
 * Shared plumbing for both the column-filter popup and the
 * enum-option-manage popup: position near anchorEl, close on outside click
 * or Escape.
 */
function makeFloatingPopup(popup, anchorEl, canCloseFn, onClose) {
    document.body.appendChild(popup);
    const rect = anchorEl.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const maxLeft = window.scrollX + document.documentElement.clientWidth - popupRect.width - 8;
    popup.style.position = "fixed";
    popup.style.zIndex = "60";
    popup.style.left = Math.max(8, Math.min(rect.left + window.scrollX, maxLeft)) + "px";
    popup.style.top = rect.bottom + window.scrollY + 4 + "px";

    function close() {
        popup.remove();
        document.removeEventListener("mousedown", onOutside, true);
        document.removeEventListener("keydown", onKey, true);
        if (onClose) onClose();
    }
    function attemptClose() {
        if (canCloseFn && !canCloseFn()) {
            confirmModal("Discard unsaved changes?").then((yes) => yes && close());
            return;
        }
        close();
    }
    function onOutside(e) {
        if (!popup.contains(e.target) && e.target !== anchorEl) attemptClose();
    }
    function onKey(e) {
        if (e.key === "Escape") attemptClose();
    }
    setTimeout(() => {
        document.addEventListener("mousedown", onOutside, true);
        document.addEventListener("keydown", onKey, true);
    }, 0);
    return close;
}

function popupEl(extra) {
    const el = document.createElement("div");
    el.className =
        "flex min-w-[12rem] flex-col gap-2 rounded-lg border border-line bg-card p-[0.7rem] shadow-elevate-2 " +
        (extra || "");
    return el;
}

function checklistWrap() {
    const el = document.createElement("div");
    el.className = "flex max-h-[12rem] flex-col gap-[0.3rem] overflow-y-auto";
    return el;
}

function checklistLabel() {
    const el = document.createElement("label");
    el.className = "flex cursor-pointer items-center gap-[0.4rem] text-[0.85rem] font-normal";
    return el;
}

function filterActionsRow() {
    const el = document.createElement("div");
    el.className = "mt-[0.2rem] flex justify-between gap-2";
    return el;
}

function clearBtnEl(text) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "border-none bg-transparent px-2 py-[0.3rem] text-[0.85rem] text-muted hover:text-ink";
    b.textContent = text;
    return b;
}

function buildTextFilterForm(popup, state) {
    const opSelect = document.createElement("select");
    [
        ["contains", "Contains"],
        ["equals", "Equals"],
        ["starts", "Starts with"],
        ["ends", "Ends with"],
    ].forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        opSelect.appendChild(o);
    });
    opSelect.value = (state && state.op) || "contains";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Value…";
    input.value = (state && state.value) || "";
    popup.append(opSelect, input);
    setTimeout(() => input.focus(), 0);
    return () => (input.value ? { op: opSelect.value, value: input.value } : null);
}

function buildNumberFilterForm(popup, state) {
    const opSelect = document.createElement("select");
    [
        ["eq", "Equals"],
        ["gt", "Greater than"],
        ["lt", "Less than"],
        ["between", "Between"],
    ].forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        opSelect.appendChild(o);
    });
    opSelect.value = (state && state.op) || "eq";
    const input1 = document.createElement("input");
    input1.type = "number";
    input1.placeholder = "Value…";
    input1.value = state && state.value !== undefined ? state.value : "";
    const input2 = document.createElement("input");
    input2.type = "number";
    input2.placeholder = "and…";
    input2.value = state && state.value2 !== undefined ? state.value2 : "";
    input2.style.display = opSelect.value === "between" ? "" : "none";
    opSelect.addEventListener("change", () => {
        input2.style.display = opSelect.value === "between" ? "" : "none";
    });
    popup.append(opSelect, input1, input2);
    setTimeout(() => input1.focus(), 0);
    return () => {
        if (input1.value === "") return null;
        if (opSelect.value === "between" && input2.value === "") return null;
        return { op: opSelect.value, value: input1.value, value2: input2.value };
    };
}

function buildDateFilterForm(popup, state) {
    const opSelect = document.createElement("select");
    [
        ["on", "On"],
        ["before", "Before"],
        ["after", "After"],
        ["between", "Between"],
    ].forEach(([v, label]) => {
        const o = document.createElement("option");
        o.value = v;
        o.textContent = label;
        opSelect.appendChild(o);
    });
    opSelect.value = (state && state.op) || "on";
    const input1 = document.createElement("input");
    input1.type = "date";
    input1.value = (state && state.value) || "";
    const input2 = document.createElement("input");
    input2.type = "date";
    input2.value = (state && state.value2) || "";
    input2.style.display = opSelect.value === "between" ? "" : "none";
    opSelect.addEventListener("change", () => {
        input2.style.display = opSelect.value === "between" ? "" : "none";
    });
    popup.append(opSelect, input1, input2);
    return () => {
        if (!input1.value) return null;
        if (opSelect.value === "between" && !input2.value) return null;
        return { op: opSelect.value, value: input1.value, value2: input2.value };
    };
}

function buildBooleanFilterForm(popup, state) {
    const wrap = document.createElement("div");
    wrap.className = "flex flex-col gap-[0.3rem]";
    const current = state ? state.value : "any";
    [
        ["any", "Any"],
        ["true", "True"],
        ["false", "False"],
    ].forEach(([v, label]) => {
        const lab = checklistLabel();
        const radio = document.createElement("input");
        radio.type = "radio";
        radio.name = "col-filter-bool";
        radio.value = v;
        radio.checked = current === v;
        lab.append(radio, document.createTextNode(" " + label));
        wrap.appendChild(lab);
    });
    popup.appendChild(wrap);
    return () => {
        const checked = wrap.querySelector("input:checked");
        const v = checked ? checked.value : "any";
        return v === "any" ? null : { value: v };
    };
}

function buildEnumFilterForm(popup, f, state) {
    const options = ENUM_CACHES[f.enum_source] || [];
    const checkedValues = new Set((state && state.values) || []);
    const wrap = checklistWrap();
    options.forEach((o) => {
        const lab = checklistLabel();
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = o.value;
        cb.checked = checkedValues.has(o.value);
        lab.append(cb, document.createTextNode(" " + o.label));
        wrap.appendChild(lab);
    });
    popup.appendChild(wrap);
    return () => {
        const values = Array.from(wrap.querySelectorAll("input:checked")).map((cb) => cb.value);
        return values.length ? { values: values } : null;
    };
}

// Small lookup tables (e.g. kiosk, 4 rows) get the checkbox-multi-select
// treatment; large reference tables (product, stock_item — 70+) stay on
// the plain text filter.
const REFERENCE_CHECKLIST_MAX_OPTIONS = 20;

function referenceOptionCount_(f) {
    return Object.keys(REF_CACHES[f.ref_table] || {}).length;
}

function buildReferenceFilterForm(popup, f, state) {
    const cache = REF_CACHES[f.ref_table] || {};
    const options = Object.keys(cache)
        .map((id) => ({ value: id, label: cache[id][f.ref_label_field] || id }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label)));
    const checkedValues = new Set((state && state.values) || []);
    const wrap = checklistWrap();
    options.forEach((o) => {
        const lab = checklistLabel();
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = o.value;
        cb.checked = checkedValues.has(o.value);
        lab.append(cb, document.createTextNode(" " + o.label));
        wrap.appendChild(lab);
    });
    popup.appendChild(wrap);
    return () => {
        const values = Array.from(wrap.querySelectorAll("input:checked")).map((cb) => cb.value);
        return values.length ? { values: values } : null;
    };
}

// --- Enum-option manage popup ---------------------------------------------

function loadEnumOptionRows_() {
    if (ENUM_OPTION_ALL_ROWS) return Promise.resolve(ENUM_OPTION_ALL_ROWS);
    return apiCall("list_table_rows", { table: "enum_option" }).then((res) => {
        if (res.ok) ENUM_OPTION_ALL_ROWS = res.rows;
        return res.ok ? ENUM_OPTION_ALL_ROWS : null;
    });
}

function enumOptionKey_(r) {
    return r.enum_type + "||" + r.value;
}

/**
 * Optimistic, same model as the main grid: opens instantly from cache,
 * every toggle/reorder/add edits a local working copy — nothing reaches the
 * server here, not even on Apply (it queues into shared.enumOptionDirtyBox,
 * actually sent only by the next whole-table Save).
 */
function openEnumManagePopup(f, anchorEl, shared) {
    document.querySelectorAll(".col-filter-popup-marker, .enum-manage-popup-marker").forEach((el) => el.remove());
    const popup = popupEl("w-64 max-w-[calc(100vw-1rem)] enum-manage-popup-marker");
    const status = document.createElement("p");
    status.className = "text-[0.85rem] text-muted";
    status.textContent = "Loading…";
    popup.appendChild(status);
    const dirty = {};
    const close = makeFloatingPopup(popup, anchorEl);
    loadEnumOptionRows_().then((allRows) => {
        if (!allRows) {
            popup.innerHTML = "";
            const err = document.createElement("p");
            err.className = "text-[0.85rem] text-muted";
            err.textContent = "Could not load options.";
            popup.appendChild(err);
            return;
        }
        const filtered = allRows
            .filter((r) => r.enum_type === f.enum_source)
            .sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
        const originalRows = JSON.parse(JSON.stringify(filtered));
        const workingRows = JSON.parse(JSON.stringify(filtered));
        renderEnumManagePopup(popup, f, close, workingRows, dirty, originalRows, shared);
    });
}

function renderEnumManagePopup(popup, f, close, workingRows, dirty, originalRows, shared) {
    popup.innerHTML = "";
    const title = document.createElement("div");
    title.className = "mb-2 text-[0.85rem] font-semibold";
    title.textContent = "Manage: " + (f.label || f.column_name);
    popup.appendChild(title);

    const rerender = () => renderEnumManagePopup(popup, f, close, workingRows, dirty, originalRows, shared);

    const list = document.createElement("div");
    list.className = "mb-[0.6rem] flex max-h-[14rem] flex-col gap-[0.15rem] overflow-y-auto";
    workingRows.forEach((opt, i) => {
        list.appendChild(buildEnumOptionRow(opt, i, workingRows, dirty, originalRows, rerender));
    });
    popup.appendChild(list);
    popup.appendChild(buildEnumAddForm(f, workingRows, dirty, rerender));

    const actions = document.createElement("div");
    actions.className = "mt-[0.6rem] flex justify-between gap-2";
    const dirtyCount = Object.keys(dirty).length;
    const cancelBtn = clearBtnEl("Cancel");
    cancelBtn.title = "Close without applying";
    cancelBtn.addEventListener("click", close);
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = DASH_BTN_SMALL;
    applyBtn.disabled = dirtyCount === 0;
    applyBtn.textContent = dirtyCount ? "Apply (" + dirtyCount + ")" : "Apply";
    applyBtn.title = dirtyCount
        ? "Queue " + dirtyCount + " change(s) — not sent to the server until you Save the table"
        : "No changes to apply";
    applyBtn.addEventListener("click", () => applyEnumManagePopup(f, close, workingRows, dirty, shared));
    actions.append(cancelBtn, applyBtn);
    popup.appendChild(actions);
}

function findOriginalEnumOption_(originalRows, key) {
    return originalRows.find((r) => enumOptionKey_(r) === key);
}

function enumOptionRowsEqual_(a, b) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
        if (String(a[k] ?? "") !== String(b[k] ?? "")) return false;
    }
    return true;
}

function markEnumOptionDirty_(dirty, row, originalRows) {
    const key = enumOptionKey_(row);
    const wasNew = !!(dirty[key] && dirty[key].isNew);
    if (!wasNew) {
        const original = findOriginalEnumOption_(originalRows, key);
        if (original && enumOptionRowsEqual_(row, original)) {
            delete dirty[key];
            return;
        }
    }
    dirty[key] = { isNew: wasNew, data: row };
}

function buildEnumOptionRow(opt, index, workingRows, dirty, originalRows, rerender) {
    const row = document.createElement("div");
    row.className = "flex items-center gap-[0.35rem] py-[0.2rem]";

    const reorder = (toIndex) => {
        const other = workingRows[toIndex];
        const tmp = opt.sort_order;
        opt.sort_order = other.sort_order;
        other.sort_order = tmp;
        workingRows.sort((a, b) => Number(a.sort_order) - Number(b.sort_order));
        markEnumOptionDirty_(dirty, opt, originalRows);
        markEnumOptionDirty_(dirty, other, originalRows);
        rerender();
    };
    const arrowClass =
        "border-none bg-transparent px-[0.15rem] py-[0.1rem] text-[0.65rem] leading-none text-muted enabled:hover:text-ink disabled:cursor-default disabled:opacity-30";
    const upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = arrowClass;
    upBtn.textContent = "▲";
    upBtn.disabled = index === 0;
    upBtn.addEventListener("click", () => reorder(index - 1));
    const downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = arrowClass;
    downBtn.textContent = "▼";
    downBtn.disabled = index === workingRows.length - 1;
    downBtn.addEventListener("click", () => reorder(index + 1));

    const label = document.createElement("span");
    label.className = "flex-1 truncate text-[0.85rem]" + (opt.active !== true ? " text-muted line-through" : "");
    label.textContent = opt.label + " (" + opt.value + ")";

    const toggle = document.createElement("span");
    toggle.innerHTML = boolSwitchHtml(opt.active === true, true);
    toggle.firstElementChild.title = opt.active === true ? "Deactivate" : "Activate";
    toggle.addEventListener("click", () => {
        opt.active = opt.active !== true;
        markEnumOptionDirty_(dirty, opt, originalRows);
        rerender();
    });

    row.append(upBtn, downBtn, label, toggle);
    return row;
}

function buildEnumAddForm(f, workingRows, dirty, rerender) {
    const form = document.createElement("div");
    form.className = "flex gap-[0.3rem] border-t border-line pt-2";
    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.placeholder = "Value";
    valueInput.className = "min-w-0 flex-1 text-[0.8rem]";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "Label";
    labelInput.className = "min-w-0 flex-1 text-[0.8rem]";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = DASH_BTN_SMALL;
    addBtn.textContent = "Add";
    addBtn.title = "Add a new option (not saved until you click Save)";
    addBtn.addEventListener("click", () => {
        if (!valueInput.value.trim() || !labelInput.value.trim()) return;
        const maxOrder = workingRows.reduce((m, o) => Math.max(m, Number(o.sort_order) || 0), 0);
        const newRow = {
            enum_type: f.enum_source,
            value: valueInput.value.trim(),
            label: labelInput.value.trim(),
            sort_order: maxOrder + 1,
            active: true,
        };
        workingRows.push(newRow);
        dirty[enumOptionKey_(newRow)] = { isNew: true, data: newRow };
        rerender();
    });
    form.append(valueInput, labelInput, addBtn);
    return form;
}

function applyEnumManagePopup(f, close, workingRows, dirty, shared) {
    Object.assign(shared.enumOptionDirtyBox.value, dirty);
    ENUM_OPTION_ALL_ROWS = (ENUM_OPTION_ALL_ROWS || []).filter((r) => r.enum_type !== f.enum_source).concat(workingRows);
    ENUM_CACHES[f.enum_source] = workingRows
        .filter((o) => o.active === true)
        .slice()
        .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
        .map((o) => ({ value: o.value, label: o.label }));
    shared.liveGridInstances.forEach((inst) => {
        if (inst.schema.some((sf) => sf.enum_source === f.enum_source)) {
            inst.rebuildColumns();
        }
    });
    close();
}

// --- Grid-wide shared helpers ----------------------------------------------

function enumListLabel(raw, options) {
    const values = String(raw || "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!values.length) return "";
    return values
        .map((v) => {
            const opt = options.find((o) => o.value === v);
            return opt ? opt.label : v;
        })
        .join(", ");
}

function formatCellValue(f, value) {
    if (f.type === "reference") {
        const cache = REF_CACHES[f.ref_table] || {};
        const row = cache[value];
        return row ? row[f.ref_label_field] : value;
    }
    if (f.type === "enum") {
        const options = ENUM_CACHES[f.enum_source] || [];
        const opt = options.find((o) => o.value === value);
        return opt ? opt.label : value;
    }
    if (f.type === "enum_list") {
        return enumListLabel(value, ENUM_CACHES[f.enum_source] || []);
    }
    if (f.type === "money") {
        return value === "" || value === null || value === undefined ? "" : "€" + Number(value).toFixed(2);
    }
    if (f.type === "boolean") {
        return value === true ? "Yes" : "No";
    }
    return value === null || value === undefined ? "" : String(value);
}

/** A foreign-key reference value ("YO!", "Sushi Circle", a supplier name,
 * …) as a small neutral pill instead of bare text — same visual language
 * as Product Prices' brand badge, so a reference column reads as "this
 * links elsewhere" at a glance rather than blending into every plain-text
 * column next to it. Empty values render as an em-dash, not an empty pill. */
function refBadgeHtml(label) {
    const text = label === null || label === undefined || label === "" ? "—" : String(label);
    return (
        '<span class="inline-flex items-center rounded-full bg-panel px-2 py-0.5 text-[0.78rem] font-medium text-ink">' + text + "</span>"
    );
}

function boolSwitchHtml(on, disabled) {
    const cls = on
        ? "inline-block relative w-[34px] h-[18px] rounded-full align-middle cursor-pointer transition-colors duration-150 bg-accent after:content-[''] after:absolute after:top-[2px] after:left-[18px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(0,0,0,0.3)] after:transition-[left] after:duration-150" +
          (disabled ? " opacity-[0.55] cursor-default" : "")
        : "inline-block relative w-[34px] h-[18px] rounded-full align-middle cursor-pointer transition-colors duration-150 bg-[#ddd7c8] after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:w-[14px] after:h-[14px] after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(0,0,0,0.3)] after:transition-[left] after:duration-150" +
          (disabled ? " opacity-[0.55] cursor-default" : "");
    return '<span class="' + cls + '"></span>';
}

/** Builds a bare input control (no label) for one field's current value,
 * calling onChange with the new value on every change. Shared by the
 * detail-view parent-fields editor and the Add-row modal. */
function buildFieldInput(f, currentValue, onChange) {
    if (f.type === "reference") {
        const wrap = document.createElement("div");
        const cache = REF_CACHES[f.ref_table] || {};
        const picker = makeSearchPick(wrap, {
            placeholder: "Search " + (f.label || f.column_name).toLowerCase() + "…",
            getItems: (q) =>
                Object.keys(cache)
                    .map((id) => ({ id: id, label: cache[id][f.ref_label_field] }))
                    .filter((it) => !q || it.label.toLowerCase().includes(q))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            onSelect: (item) => onChange(item.id),
        });
        if (currentValue && cache[currentValue]) picker.setLabel(cache[currentValue][f.ref_label_field]);
        return wrap;
    }
    if (f.type === "enum") {
        const options = ENUM_CACHES[f.enum_source] || [];
        const select = document.createElement("select");
        select.innerHTML =
            '<option value="">Select…</option>' +
            options
                .map((o) => '<option value="' + o.value + '"' + (o.value === currentValue ? " selected" : "") + ">" + o.label + "</option>")
                .join("");
        select.addEventListener("change", () => onChange(select.value || undefined));
        return select;
    }
    if (f.type === "enum_list") {
        const options = ENUM_CACHES[f.enum_source] || [];
        const current = String(currentValue || "").split(",").map((v) => v.trim()).filter(Boolean);
        const select = document.createElement("select");
        select.multiple = true;
        select.style.minHeight = "6rem";
        options.forEach((o) => {
            const opt = document.createElement("option");
            opt.value = o.value;
            opt.textContent = o.label;
            opt.selected = current.includes(o.value);
            select.appendChild(opt);
        });
        select.addEventListener("change", () => {
            onChange(Array.from(select.selectedOptions).map((o) => o.value).join(","));
        });
        return select;
    }
    if (f.type === "boolean") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.style.width = "auto";
        input.checked = currentValue === true;
        input.addEventListener("change", () => onChange(input.checked));
        return input;
    }
    const inputType = f.type === "integer" || f.type === "decimal" || f.type === "money" ? "number" : f.type === "date" ? "date" : "text";
    const input = document.createElement("input");
    input.type = inputType;
    input.value = currentValue ?? "";
    input.addEventListener("input", () => onChange(input.value));
    return input;
}

function rowsEqual(a, b) {
    const keys = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const k of keys) {
        if (String(a[k] ?? "") !== String(b[k] ?? "")) return false;
    }
    return true;
}

/**
 * Floating checkbox-list popup for an enum_list cell — Tabulator doesn't
 * grow a row's height to fit a custom editor, and .tabulator's own
 * overflow:hidden clips anything taller than the row, so the real UI lives
 * in document.body via makeFloatingPopup, same as everything else that
 * needs to escape that clipping.
 */
function enumListEditor(cell, onRendered, success, cancel, editorParams) {
    const options = editorParams.options || [];
    const current = String(cell.getValue() || "").split(",").map((v) => v.trim()).filter(Boolean);

    const placeholder = document.createElement("div");
    placeholder.className = "flex h-full w-full items-center overflow-hidden text-ellipsis whitespace-nowrap text-muted";
    placeholder.textContent = enumListLabel(cell.getValue(), options) || "—";

    const popup = popupEl("col-filter-popup-marker");
    const list = checklistWrap();
    options.forEach((o) => {
        const lab = checklistLabel();
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.value = o.value;
        cb.checked = current.includes(o.value);
        lab.append(cb, document.createTextNode(" " + o.label));
        list.appendChild(lab);
    });
    popup.appendChild(list);

    const actions = filterActionsRow();
    const cancelBtn = clearBtnEl("Cancel");
    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = DASH_BTN_SMALL;
    doneBtn.textContent = "Done";
    actions.append(cancelBtn, doneBtn);
    popup.appendChild(actions);

    onRendered(() => {
        let resolved = false;
        const close = makeFloatingPopup(popup, placeholder, null, () => {
            if (!resolved) {
                resolved = true;
                cancel();
            }
        });
        cancelBtn.addEventListener("click", close);
        doneBtn.addEventListener("click", () => {
            resolved = true;
            success(Array.from(list.querySelectorAll("input:checked")).map((cb) => cb.value).join(","));
            close();
        });
    });

    return placeholder;
}

function fieldValidator(f) {
    return (cell, value) => {
        if (f.required === true && (value === "" || value === null || value === undefined)) {
            return false;
        }
        if ((f.type === "integer" || f.type === "decimal" || f.type === "money") && value !== "" && value !== null && value !== undefined) {
            const num = Number(value);
            if (isNaN(num)) return false;
            if (f.type === "integer" && !Number.isInteger(num)) return false;
            if (f.min !== "" && f.min !== null && f.min !== undefined && num < Number(f.min)) return false;
            if (f.max !== "" && f.max !== null && f.max !== undefined && num > Number(f.max)) return false;
        }
        return true;
    };
}

/**
 * The detail modal's parent-fields section — a single row's own fields,
 * view + edit + independent save. opts: { tableName, schema, keyFields,
 * rowData, onSaved(updatedRow) }. Returns { hasUnsavedChanges() }.
 */
function buildParentFieldsEditor(container, opts) {
    let editing = false;
    let saving = false;
    let dirty = false;
    let workingRow = Object.assign({}, opts.rowData);
    let saveBtn, errorEl;

    function updateSaveButton() {
        saveBtn.disabled = !dirty || saving;
    }

    function doSave() {
        saving = true;
        errorEl.textContent = "";
        updateSaveButton();
        apiCall("save_table_row", { table: opts.tableName, isNew: false, row: workingRow }).then((res) => {
            saving = false;
            if (!res.ok) {
                errorEl.textContent = res.error || "Could not save.";
                updateSaveButton();
                return;
            }
            opts.rowData = Object.assign({}, workingRow);
            dirty = false;
            editing = false;
            invalidateCachesFor(opts.tableName);
            opts.onSaved(opts.rowData);
            render();
        });
    }

    function render() {
        container.innerHTML = "";

        const header = document.createElement("div");
        header.className = "mb-[0.8rem] flex justify-end gap-[0.6rem]";

        const editBtn = document.createElement("button");
        editBtn.className = DASH_BTN_MUTED;
        editBtn.textContent = "Edit";
        editBtn.style.display = editing ? "none" : "";
        editBtn.addEventListener("click", () => {
            editing = true;
            render();
        });
        header.appendChild(editBtn);

        const cancelBtn = document.createElement("button");
        cancelBtn.className = DASH_BTN_MUTED;
        cancelBtn.textContent = "Cancel";
        cancelBtn.style.display = editing ? "" : "none";
        cancelBtn.addEventListener("click", () => {
            const proceed = () => {
                workingRow = Object.assign({}, opts.rowData);
                dirty = false;
                editing = false;
                render();
            };
            if (dirty) {
                confirmModal("Discard unsaved changes?").then((yes) => yes && proceed());
            } else {
                proceed();
            }
        });
        header.appendChild(cancelBtn);

        saveBtn = document.createElement("button");
        saveBtn.className = DASH_BTN;
        saveBtn.textContent = "Save";
        saveBtn.style.display = editing ? "" : "none";
        saveBtn.disabled = !dirty || saving;
        saveBtn.addEventListener("click", doSave);
        header.appendChild(saveBtn);

        container.appendChild(header);

        const fieldsWrap = document.createElement("div");
        fieldsWrap.className = "flex flex-wrap gap-x-[1.5rem] gap-y-[0.2rem]";
        container.appendChild(fieldsWrap);

        opts.schema
            .filter((f) => f.hidden !== true && f.type !== "sub_table")
            .forEach((f) => {
                const isKey = opts.keyFields.includes(f);
                const canEdit = editing && !isKey && f.editable_on_update === true;
                const value = workingRow[f.column_name];

                if (canEdit) {
                    const wrap = document.createElement("div");
                    wrap.className = MODAL_FIELD_GRID;
                    const label = document.createElement("label");
                    label.className = MODAL_FIELD_LABEL;
                    label.textContent = f.label || f.column_name;
                    wrap.appendChild(label);
                    wrap.appendChild(
                        buildFieldInput(f, value, (newVal) => {
                            workingRow[f.column_name] = newVal;
                            dirty = !rowsEqual(workingRow, opts.rowData);
                            updateSaveButton();
                        }),
                    );
                    fieldsWrap.appendChild(wrap);
                    return;
                }

                const display = formatCellValue(f, value);
                if (display === "" || display === null || display === undefined) return;
                const wrap = document.createElement("div");
                wrap.className = MODAL_FIELD_GRID;
                wrap.innerHTML = '<label class="' + MODAL_FIELD_LABEL + '">' + (f.label || f.column_name) + "</label><div>" + display + "</div>";
                fieldsWrap.appendChild(wrap);
            });

        errorEl = document.createElement("div");
        errorEl.className = "mt-[0.6rem] text-[0.85rem] text-danger-ink";
        container.appendChild(errorEl);
    }

    render();

    return {
        hasUnsavedChanges: () => dirty,
    };
}

// --- DataGrid: one independent grid instance --------------------------
//
// One instance owns one Tabulator grid, its own toolbar, and all of its own
// edit/filter/save state. The page-level tab is one instance; a detail-view
// modal instantiates one more per embedded sub_table child, each with its
// own container. `shared` ({ enumOptionDirtyBox: {value}, liveGridInstances:
// Set }) is created once per page mount (see createTablesPageController)
// and threaded through every instance — enum-option edits and the
// sidebar-toggle redraw are page-session-global, not per-table.

class DataGrid {
    /**
     * @param {Object} opts
     * @param {HTMLElement} opts.container
     * @param {string} opts.tableName
     * @param {Object} [opts.parentScope] - {column, value}. Only set for a
     *   grid embedded under a specific parent row (a detail-view child
     *   section).
     * @param {Object} opts.shared - { enumOptionDirtyBox, liveGridInstances }
     * @param {Function} [opts.onRendered] - called with (this) after every
     *   successful renderFromData. Only wired up for the page-level grid.
     * @param {HTMLElement} [opts.toolbarHost] - only set for the top-level
     *   page grid. When present, the toolbar mounts there (a sticky region
     *   shared with the page title/tabs) instead of inside this grid's own
     *   panel, and the grid itself grows to fit its content (the page
     *   scrolls as a whole, pagination already caps rows per page) instead
     *   of getting a fixed height with its own internal scrollbar.
     *   Detail-modal sub-table grids omit this — they stay bounded inside
     *   the modal's own scroll area, which is the correct place for that.
     */
    constructor({ container, tableName, parentScope, shared, onRendered, toolbarHost }) {
        this.container = container;
        this.tableName = tableName;
        this.meta = {};
        this.parentScope = parentScope || null;
        this.shared = shared;
        this.onRendered = onRendered || null;
        this.toolbarHost = toolbarHost || null;

        this.schema = [];
        this.keyFields = [];
        this.tabulator = null;
        this.tableReady = Promise.resolve();
        this.searchText = "";
        this.columnFilters = {};
        this.editMode = false;
        this.originalRows = [];
        this.dirty = {};
        this.destroyed = false;

        this._buildScaffold();
        this.shared.liveGridInstances.add(this);
    }

    _buildScaffold() {
        this.toolbarEl = document.createElement("div");
        this.toolbarEl.className = "mb-3 hidden flex-wrap items-center justify-end gap-1.5";
        this.spinnerEl = document.createElement("div");
        this.spinnerEl.className = "mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line";
        this.spinnerEl.style.borderTopColor = "#0e5c45";
        this.gridEl = document.createElement("div");

        if (this.toolbarHost) {
            // Page-level grid: toolbar mounts in the page's sticky header
            // region (shared with the title/tabs — see
            // createTablesPageController), not inside this panel — and the
            // panel is NOT height-bounded, so the grid grows to fit its
            // (already paginated, max ~100-row) content and the whole page
            // scrolls, rather than the grid getting its own fixed-height
            // internal scrollbar.
            this.toolbarHost.append(this.toolbarEl);
            this.gridEl.className = "hidden min-w-0";
            const panelEl = document.createElement("div");
            panelEl.className = "rounded-card border border-line bg-panel p-4 shadow-elevate-1 sm:p-5";
            panelEl.append(this.spinnerEl, this.gridEl);
            this.container.append(panelEl);
        } else {
            // Embedded sub-table (a detail modal's child section) — stays
            // bounded inside the modal's own scroll area, toolbar included,
            // same as before.
            this.gridEl.className = "hidden min-h-0 min-w-0 flex-1";
            const panelEl = document.createElement("div");
            panelEl.className = "flex min-h-0 flex-1 flex-col rounded-card border border-line bg-panel p-4 shadow-elevate-1 sm:p-5";
            panelEl.append(this.toolbarEl, this.spinnerEl, this.gridEl);
            this.container.append(panelEl);
        }
    }

    destroy() {
        this.destroyed = true;
        this.shared.liveGridInstances.delete(this);
        if (this.tabulator) {
            this.tabulator.destroy();
            this.tabulator = null;
        }
        this.container.innerHTML = "";
        // toolbarEl lives in a page-level sticky host outside this.container
        // when toolbarHost is set — clear it separately, or a stale toolbar
        // from a destroyed grid (e.g. an old sub-table row's detail modal)
        // would linger.
        if (this.toolbarHost) this.toolbarHost.innerHTML = "";
    }

    hasUnsavedChanges() {
        return Object.keys(this.dirty).length > 0;
    }

    rowKeyStr(row) {
        return this.keyFields.map((f) => row[f.column_name]).join("||");
    }

    findOriginalRow(key) {
        return this.originalRows.find((r) => this.rowKeyStr(r) === key);
    }

    findRowComponent(pkValue) {
        const pkField = this.keyFields[0];
        if (!pkField) return null;
        return this.tabulator.getRows().find((r) => String(r.getData()[pkField.column_name]) === String(pkValue)) || null;
    }

    load() {
        this.toolbarEl.classList.add("hidden");
        this.gridEl.classList.add("hidden");
        this.spinnerEl.classList.remove("hidden");

        const dataPromise = SCHEMA_CACHE[this.tableName]
            ? apiCall("list_table_rows", { table: this.tableName }).then((res) => ({
                  ok: res.ok,
                  error: res.error,
                  fields: SCHEMA_CACHE[this.tableName],
                  meta: TABLE_META_CACHE[this.tableName],
                  rows: res.rows,
              }))
            : apiCall("bootstrap_data_table", { table: this.tableName }).then((res) => cacheBootstrapResponse(res, this.tableName));

        dataPromise.then((res) => {
            if (this.destroyed) return;
            this.renderFromData(res);
        });
    }

    renderFromData(res) {
        if (!res.ok) {
            this.spinnerEl.classList.add("hidden");
            this.gridEl.classList.remove("hidden");
            this.gridEl.textContent = res.error || "Could not load this table.";
            return;
        }
        this.schema = res.fields;
        this.meta = res.meta || {};
        this.keyFields = this.schema.filter((f) => f.primary_key === true);
        let rows = res.rows;
        if (this.parentScope) {
            rows = rows.filter((r) => String(r[this.parentScope.column]) === String(this.parentScope.value));
        }
        this.originalRows = rows;

        this.buildToolbar();
        this.spinnerEl.classList.add("hidden");
        this.toolbarEl.classList.remove("hidden");
        this.toolbarEl.classList.add("flex");
        this.gridEl.classList.remove("hidden");
        this.gridEl.classList.add("flex");
        this.renderGrid(this.originalRows);
        if (this.onRendered) this.onRendered(this);
    }

    // --- Toolbar: search + add/edit/save/cancel -------------------

    buildToolbar() {
        this.toolbarEl.innerHTML = "";

        if (this.schema.some((f) => f.searchable === true)) {
            const search = document.createElement("input");
            search.type = "search";
            search.placeholder = "Search…";
            search.className = "mr-auto max-w-[16rem] py-1.5 px-2.5 text-[0.8rem]";
            search.addEventListener("input", () => {
                this.searchText = search.value.trim().toLowerCase();
                this.tabulator.setFilter((row) => this.rowMatchesFilters(row));
                this.updateSelectAllCheckbox_();
            });
            this.toolbarEl.appendChild(search);
        }

        this.refreshBtn = document.createElement("button");
        this.refreshBtn.className = DASH_BTN_MUTED + " flex items-center gap-1.5";
        this.refreshBtn.title = "Refetch this table's data — also clears the backend's whole-table cache first";
        // Same RefreshCw glyph the shared RefreshButton.js component uses
        // elsewhere in the dashboard (raw SVG, not JSX, since this whole
        // controller is vanilla DOM) — spins via the spin-icon class below
        // while the refresh is in flight, matching that component's feel
        // instead of just disabling the button with no visible feedback.
        this.refreshBtn.innerHTML =
            '<svg class="refresh-spin-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg><span>Refresh</span>';
        this.refreshBtn.addEventListener("click", () => {
            this.refreshBtn.disabled = true;
            this.refreshBtn.querySelector(".refresh-spin-icon")?.classList.add("animate-spin");
            // Backend cache (TableCacheService) first, THEN reload —
            // otherwise the reload could race a still-warm cache and show
            // the same data this button was clicked to get rid of. Every
            // write path already invalidates its own table on save (see
            // invalidateCachesFor below and DataTablesService.
            // invalidateFor), so this manual path only matters for data
            // that changed outside the app's own write paths.
            //
            // No explicit re-enable here — load() rebuilds the whole
            // toolbar (a fresh, enabled button) once the reload lands, and
            // the toolbar is hidden behind the full-page spinner for the
            // entire wait either way. If this button is ever reused
            // somewhere that DOESN'T rebuild the toolbar around it, add a
            // .finally(() => { this.refreshBtn.disabled = false; ... })
            // here — leaving it disabled with no re-enable path was
            // exactly the bug this comment is here to keep from recurring.
            apiCall("refresh_cache", {})
                .catch(() => {})
                .then(() => {
                    delete SCHEMA_CACHE[this.tableName];
                    delete TABLE_META_CACHE[this.tableName];
                    delete CHILD_TABLE_CACHE[this.tableName];
                    invalidateCachesFor(this.tableName);
                    this.load();
                });
        });
        this.toolbarEl.appendChild(this.refreshBtn);

        this.addBtn = document.createElement("button");
        this.addBtn.className = DASH_BTN;
        this.addBtn.textContent = "+ Add row";
        this.addBtn.addEventListener("click", () => this.openAddModal());
        this.toolbarEl.appendChild(this.addBtn);

        this.editBtn = document.createElement("button");
        this.editBtn.className = DASH_BTN_MUTED + " flex items-center gap-1.5";
        // Same Pencil glyph used everywhere else a row/cell becomes
        // editable (Product Prices' PriceRow, e.g.) — the bare "Edit" text
        // button next to an already-iconed Refresh read as unfinished.
        this.editBtn.innerHTML =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg><span>Edit</span>';
        this.editBtn.addEventListener("click", () => this.toggleEditMode());
        this.toolbarEl.appendChild(this.editBtn);

        this.cancelBtn = document.createElement("button");
        this.cancelBtn.className = DASH_BTN_MUTED;
        this.cancelBtn.textContent = "Cancel";
        this.cancelBtn.addEventListener("click", () => this.cancelEdits());
        this.toolbarEl.appendChild(this.cancelBtn);

        this.saveBtn = document.createElement("button");
        this.saveBtn.className = DASH_BTN;
        this.saveBtn.textContent = "Save";
        this.saveBtn.addEventListener("click", () => this.saveDirtyRows());
        this.toolbarEl.appendChild(this.saveBtn);

        this.bulkDeleteBtn = document.createElement("button");
        this.bulkDeleteBtn.className = DASH_BTN_DANGER;
        this.bulkDeleteBtn.addEventListener("click", () => this.handleBulkDelete());
        this.toolbarEl.appendChild(this.bulkDeleteBtn);

        this.updateToolbarButtons();
    }

    updateToolbarButtons() {
        const dirtyCount = Object.keys(this.dirty).length + Object.keys(this.shared.enumOptionDirtyBox.value).length;

        this.editBtn.style.display = this.editMode ? "none" : "";
        this.cancelBtn.style.display = this.editMode ? "" : "none";
        this.saveBtn.style.display = this.editMode ? "" : "none";
        this.saveBtn.disabled = dirtyCount === 0;
        this.saveBtn.textContent = dirtyCount ? "Save (" + dirtyCount + ")" : "Save";
        this.addBtn.style.display = this.editMode ? "" : "none";

        const selectedCount = this.editMode && this.meta.hard_delete === true && this.tabulator ? this.tabulator.getSelectedRows().length : 0;
        this.bulkDeleteBtn.style.display = selectedCount > 0 ? "" : "none";
        this.bulkDeleteBtn.textContent = "Delete Selected (" + selectedCount + ")";
    }

    updateSelectAllCheckbox_() {
        if (!this.selectAllCheckboxEl || !this.tabulator) return;
        const activeRows = this.tabulator.getRows("active");
        const selectedActive = activeRows.filter((r) => r.isSelected());
        this.selectAllCheckboxEl.checked = activeRows.length > 0 && selectedActive.length === activeRows.length;
        this.selectAllCheckboxEl.indeterminate = selectedActive.length > 0 && selectedActive.length < activeRows.length;
    }

    rebuildColumns() {
        return this.tableReady
            .then(() => this.tabulator.setColumns(this.buildColumns()))
            .then(() => {
                this.attachColumnFilterIcons();
                this.attachColumnManageIcons();
                this.updateToolbarButtons();
            });
    }

    toggleEditMode() {
        this.editMode = true;
        this.rebuildColumns();
    }

    cancelEdits() {
        const proceed = () => {
            this.dirty = {};
            this.editMode = false;
            this.tableReady
                .then(() => this.tabulator.replaceData(JSON.parse(JSON.stringify(this.originalRows))))
                .then(() => this.tabulator.setFilter((row) => this.rowMatchesFilters(row)))
                .then(() => this.rebuildColumns());
        };
        if (Object.keys(this.dirty).length) {
            confirmModal("Discard all unsaved changes?").then((yes) => yes && proceed());
        } else {
            proceed();
        }
    }

    showTableSaveError(message) {
        if (this.tabulator) {
            this.tabulator.destroy();
            this.tabulator = null;
        }
        this.toolbarEl.classList.add("hidden");
        this.gridEl.classList.remove("hidden");
        this.gridEl.innerHTML = "";
        const box = document.createElement("div");
        box.className = "mx-auto my-12 max-w-[30rem] text-center";
        const p = document.createElement("p");
        p.className = "mb-4 whitespace-pre-line text-ink";
        p.textContent = message;
        box.appendChild(p);
        const reloadBtn = document.createElement("button");
        reloadBtn.className = DASH_BTN;
        reloadBtn.textContent = "Reload table";
        reloadBtn.addEventListener("click", () => {
            this.gridEl.innerHTML = "";
            this.load();
        });
        box.appendChild(reloadBtn);
        this.gridEl.appendChild(box);
    }

    saveDirtyRows() {
        const entries = Object.entries(this.dirty);
        const enumEntries = Object.entries(this.shared.enumOptionDirtyBox.value);
        if (!entries.length && !enumEntries.length) return;

        const deleteKeys = new Set(entries.filter(([, d]) => d.isDelete).map(([key]) => key));
        const survivingRows = this.tabulator.getData().filter((row) => !deleteKeys.has(this.rowKeyStr(row)));

        this.dirty = {};
        this.shared.enumOptionDirtyBox.value = {};
        this.editMode = false;
        this.originalRows = JSON.parse(JSON.stringify(survivingRows));
        delete CHILD_TABLE_CACHE[this.tableName];
        // This table's own rows just changed on the server — any OTHER
        // table's cached reference lookup into it (REF_CACHES[tableName])
        // is now stale, as is the schema/meta cache if the edited table
        // was itself field_schema/table_schema (which describe every other
        // table's bootstrap). Cleared here, not just on this grid's own
        // reload, so the next time any of those is opened it refetches
        // instead of silently showing what's now wrong.
        invalidateCachesFor(this.tableName);
        if (enumEntries.length) invalidateCachesFor("enum_option");
        this.tableReady.then(() => this.tabulator.replaceData(JSON.parse(JSON.stringify(this.originalRows)))).then(() => this.rebuildColumns());

        const tableName = this.tableName;
        const toChange = (key, d) => ({ key: key, isNew: !!d.isNew, isDelete: !!d.isDelete, row: d.data });
        const batches = [];
        if (entries.length) {
            batches.push(
                apiCall("bulk_save_table_rows", { table: tableName, changes: entries.map(([key, d]) => toChange(key, d)) }).then((res) => ({
                    table: tableName,
                    res: res,
                })),
            );
        }
        if (enumEntries.length) {
            batches.push(
                apiCall("bulk_save_table_rows", { table: "enum_option", changes: enumEntries.map(([key, d]) => toChange(key, d)) }).then((res) => ({
                    table: "enum_option",
                    res: res,
                })),
            );
        }

        Promise.all(batches).then((batchResults) => {
            const failures = [];
            batchResults.forEach((br) => {
                if (!br.res.ok) {
                    failures.push({ table: br.table, error: br.res.error || "Unknown error" });
                    return;
                }
                (br.res.results || []).forEach((r) => {
                    if (!r.ok) failures.push({ table: br.table, error: (r.key || "") + ": " + (r.error || "Unknown error") });
                });
            });
            if (!failures.length) return;

            const message = "Some changes could not be saved:\n" + failures.map((f) => f.table + ": " + f.error).join("\n") + "\n\nReload to see the table's real current state.";
            if (!this.destroyed) {
                this.showTableSaveError(message);
            } else {
                alert(message + "\n\n(You've since switched away from " + tableName + ".)");
            }
        });
    }

    // --- Filtering ---------------------------------------------------

    rowMatchesFilters(row) {
        const dirtyEntry = this.dirty[this.rowKeyStr(row)];
        if (dirtyEntry && dirtyEntry.isDelete) return false;
        if (this.searchText) {
            const matches = this.schema.filter((f) => f.searchable === true).some((f) => {
                let val = row[f.column_name];
                if (f.type === "reference") {
                    const cache = REF_CACHES[f.ref_table] || {};
                    val = cache[val] ? cache[val][f.ref_label_field] : val;
                } else if (f.type === "enum_list") {
                    val = enumListLabel(val, ENUM_CACHES[f.enum_source] || []);
                }
                return String(val ?? "").toLowerCase().includes(this.searchText);
            });
            if (!matches) return false;
        }
        for (const columnName in this.columnFilters) {
            const f = this.schema.find((s) => s.column_name === columnName);
            if (f && !columnFilterMatches(f, row[columnName], this.columnFilters[columnName])) {
                return false;
            }
        }
        return true;
    }

    attachColumnFilterIcons() {
        this.schema.filter((f) => f.searchable === true).forEach((f) => {
            const col = this.tabulator.getColumn(f.column_name);
            if (!col) return;
            const headerEl = col.getElement();
            const titleEl = headerEl.querySelector(".tabulator-col-title");
            if (!titleEl || titleEl.querySelector(".col-filter-icon")) return;
            const isActive = !!this.columnFilters[f.column_name];
            headerEl.classList.toggle("col-header-filtered", isActive);
            const btn = document.createElement("span");
            btn.className = "col-filter-icon inline-flex flex-shrink-0 cursor-pointer " + (isActive ? "text-accent" : "text-muted");
            btn.innerHTML = COLUMN_FILTER_ICON_SVG;
            btn.title = "Filter " + (f.label || f.column_name);
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                this.openColumnFilterPopup(f, btn);
            });
            titleEl.appendChild(btn);
        });
    }

    applyColumnFilter(f, result) {
        if (result) {
            this.columnFilters[f.column_name] = result;
        } else {
            delete this.columnFilters[f.column_name];
        }
        this.tableReady.then(() => this.tabulator.setFilter((row) => this.rowMatchesFilters(row))).then(() => this.updateSelectAllCheckbox_());
        const col = this.tabulator.getColumn(f.column_name);
        if (!col) return;
        const headerEl = col.getElement();
        headerEl.classList.toggle("col-header-filtered", !!result);
        const icon = headerEl.querySelector(".col-filter-icon");
        if (icon) {
            icon.classList.toggle("text-accent", !!result);
            icon.classList.toggle("text-muted", !result);
        }
    }

    openColumnFilterPopup(f, anchorEl) {
        document.querySelectorAll(".col-filter-popup-marker, .enum-manage-popup-marker").forEach((el) => el.remove());

        const popup = popupEl("col-filter-popup-marker");

        const state = this.columnFilters[f.column_name];
        let getResult;
        if (f.type === "integer" || f.type === "decimal" || f.type === "money") {
            getResult = buildNumberFilterForm(popup, state);
        } else if (f.type === "date") {
            getResult = buildDateFilterForm(popup, state);
        } else if (f.type === "boolean") {
            getResult = buildBooleanFilterForm(popup, state);
        } else if (f.type === "enum" || f.type === "enum_list") {
            getResult = buildEnumFilterForm(popup, f, state);
        } else if (f.type === "reference" && referenceOptionCount_(f) > 0 && referenceOptionCount_(f) <= REFERENCE_CHECKLIST_MAX_OPTIONS) {
            getResult = buildReferenceFilterForm(popup, f, state);
        } else {
            getResult = buildTextFilterForm(popup, state);
        }

        const actions = filterActionsRow();
        const clearBtn = clearBtnEl("Clear");
        const applyBtn = document.createElement("button");
        applyBtn.type = "button";
        applyBtn.className = DASH_BTN_SMALL;
        applyBtn.textContent = "Apply";
        actions.append(clearBtn, applyBtn);
        popup.appendChild(actions);

        const close = makeFloatingPopup(popup, anchorEl);
        clearBtn.addEventListener("click", () => {
            this.applyColumnFilter(f, null);
            close();
        });
        applyBtn.addEventListener("click", () => {
            this.applyColumnFilter(f, getResult());
            close();
        });
    }

    attachColumnManageIcons() {
        if (!this.editMode) return;
        const manageable = this.schema.filter((f) => (f.type === "enum" || f.type === "enum_list") && f.manage_options === true);
        if (manageable.length) loadEnumOptionRows_();
        manageable.forEach((f) => {
            const col = this.tabulator.getColumn(f.column_name);
            if (!col) return;
            const titleEl = col.getElement().querySelector(".tabulator-col-title");
            if (!titleEl || titleEl.querySelector(".col-manage-icon")) return;
            const btn = document.createElement("span");
            btn.className = "col-manage-icon inline-flex flex-shrink-0 cursor-pointer text-muted hover:text-ink";
            btn.innerHTML = COLUMN_MANAGE_ICON_SVG;
            btn.title = "Manage options for " + (f.label || f.column_name);
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                openEnumManagePopup(f, btn, this.shared);
            });
            titleEl.appendChild(btn);
        });
    }

    // --- Grid columns / row edits -------------------------------------

    buildColumns() {
        const visibleSchema = this.schema.filter(
            (f) => f.hidden !== true && f.type !== "sub_table" && !(this.parentScope && f.column_name === this.parentScope.column),
        );

        const dataColumns = visibleSchema.map((f) => {
            const editable = this.editMode && f.editable_on_update === true;
            const isNumeric = f.type === "integer" || f.type === "decimal" || f.type === "money";
            let width = 160;
            let minWidth = 120;
            if (f.type === "boolean") {
                width = 70;
                minWidth = 60;
            } else if (f.type === "date") {
                width = 110;
                minWidth = 100;
            } else if (isNumeric) {
                width = 100;
                minWidth = 80;
            }
            const col = {
                title: f.label || f.column_name,
                field: f.column_name,
                editable: editable,
                validator: fieldValidator(f),
                width: width,
                minWidth: minWidth,
            };
            if (editable) col.cssClass = "editable-cell";

            if (f.type === "reference") {
                // Badge, not plain text — a bare string reads as "just
                // another column," which is exactly what made two
                // identically-named products in different brands (see
                // Product Prices) hard to tell apart at a glance. The
                // sorter stays on the plain label (below), so this is
                // display-only.
                col.formatter = (cell) => refBadgeHtml(formatCellValue(f, cell.getValue()));
                col.sorter = (a, b) => String(formatCellValue(f, a)).localeCompare(String(formatCellValue(f, b)));
            } else if (f.type === "enum") {
                const options = ENUM_CACHES[f.enum_source] || [];
                col.formatter = (cell) => formatCellValue(f, cell.getValue());
                col.sorter = (a, b) => String(formatCellValue(f, a)).localeCompare(String(formatCellValue(f, b)));
                if (editable) {
                    col.editor = "list";
                    col.editorParams = {
                        values: options.reduce((acc, o) => {
                            acc[o.value] = o.label;
                            return acc;
                        }, {}),
                    };
                }
            } else if (f.type === "enum_list") {
                const options = ENUM_CACHES[f.enum_source] || [];
                col.formatter = (cell) => formatCellValue(f, cell.getValue());
                if (editable) {
                    col.editor = enumListEditor;
                    col.editorParams = { options: options };
                }
            } else if (isNumeric) {
                col.hozAlign = "right";
                if (f.type === "money") {
                    col.formatter = (cell) => formatCellValue(f, cell.getValue());
                }
                if (editable) {
                    col.editor = "number";
                    const params = {};
                    if (f.min !== "" && f.min !== null && f.min !== undefined) params.min = Number(f.min);
                    if (f.max !== "" && f.max !== null && f.max !== undefined) params.max = Number(f.max);
                    if (f.type === "integer") params.step = 1;
                    col.editorParams = params;
                }
            } else if (f.type === "boolean") {
                col.hozAlign = "center";
                col.editable = false;
                col.formatter = (cell) => boolSwitchHtml(cell.getValue() === true, !editable);
                if (editable) {
                    col.cellClick = (e, cell) => {
                        e.stopPropagation();
                        cell.setValue(cell.getValue() !== true);
                        this.markRowDirty(cell);
                    };
                }
            } else if (f.type === "date") {
                if (editable) col.editor = "date";
            } else {
                if (editable) col.editor = "input";
            }

            if (f.is_title_column === true && this.meta.has_detail_view === true && !this.editMode) {
                const baseFormatter = col.formatter || ((cell) => cell.getValue());
                col.formatter = (cell) => '<span class="row-detail-link text-accent cursor-pointer hover:underline">' + baseFormatter(cell) + "</span>";
                col.cellClick = (e, cell) => {
                    e.stopPropagation();
                    this.openDetailView(cell.getRow());
                };
            }
            return col;
        });
        return this.buildBulkDeleteColumn().concat(dataColumns, this.buildDeleteColumn());
    }

    buildBulkDeleteColumn() {
        if (!this.editMode || this.meta.hard_delete !== true) return [];
        return [
            {
                title: "",
                field: "__select",
                width: 40,
                hozAlign: "center",
                headerSort: false,
                headerHozAlign: "center",
                formatter: "rowSelection",
                cellClick: (e) => e.stopPropagation(),
                titleFormatter: () => {
                    const cb = document.createElement("input");
                    cb.type = "checkbox";
                    cb.className = "h-4 w-4";
                    cb.addEventListener("click", (e) => {
                        e.stopPropagation();
                        const activeRows = this.tabulator.getRows("active");
                        const allSelected = activeRows.length > 0 && activeRows.every((r) => r.isSelected());
                        if (allSelected) this.tabulator.deselectRow(activeRows);
                        else this.tabulator.selectRow(activeRows);
                    });
                    this.selectAllCheckboxEl = cb;
                    this.updateSelectAllCheckbox_();
                    return cb;
                },
            },
        ];
    }

    buildDeleteColumn() {
        if (!this.editMode || this.meta.hard_delete !== true) return [];
        return [
            {
                title: "",
                field: "__delete",
                width: 50,
                hozAlign: "center",
                headerSort: false,
                formatter: () => '<span class="cursor-pointer opacity-60 hover:opacity-100" title="Delete row">❌</span>',
                cellClick: (e, cell) => {
                    e.stopPropagation();
                    this.handleDeleteRow(cell.getRow());
                },
            },
        ];
    }

    openDetailView(rowComponent, opts) {
        const pushUrl = !opts || opts.pushUrl !== false;
        const rowData = rowComponent.getData();
        const pkField = this.keyFields[0];
        const rowId = rowData[pkField.column_name];
        const detailUrl = "/dashboard/tables/" + this.tableName + "/detail/" + rowId;
        if (pushUrl) history.pushState(null, "", detailUrl);

        const overlay = document.createElement("div");
        overlay.className = MODAL_OVERLAY;
        const box = document.createElement("div");
        box.className = modalBoxClass("w-[60rem]");
        overlay.appendChild(box);

        const title = document.createElement("h3");
        title.className = "mb-4 mt-0 text-lg font-bold tracking-[-0.01em]";
        title.textContent = this.meta.label || this.tableName;
        box.appendChild(title);

        const parentSection = document.createElement("div");
        box.appendChild(parentSection);
        const parentEditor = buildParentFieldsEditor(parentSection, {
            tableName: this.tableName,
            schema: this.schema,
            keyFields: this.keyFields,
            rowData: rowData,
            onSaved: (updatedRow) => {
                rowComponent.update(updatedRow);
                const key = this.rowKeyStr(updatedRow);
                const idx = this.originalRows.findIndex((r) => this.rowKeyStr(r) === key);
                if (idx !== -1) this.originalRows[idx] = Object.assign({}, updatedRow);
            },
        });

        const childInstances = [];
        this.schema.filter((f) => f.type === "sub_table").forEach((f) => {
            const section = document.createElement("div");
            section.className = "mt-6";
            const heading = document.createElement("h4");
            heading.className = "mb-[0.6rem] mt-0";
            heading.textContent = f.label || f.sub_table;
            section.appendChild(heading);
            const mount = document.createElement("div");
            mount.className = "flex h-[22rem] flex-col";
            mount.textContent = "Loading…";
            section.appendChild(mount);
            box.appendChild(section);

            const childTable = f.sub_table;
            const fetchPromise = CHILD_TABLE_CACHE[childTable] || Promise.resolve(null);
            fetchPromise.then((res) => {
                mount.textContent = "";
                if (!res) {
                    mount.textContent = "Could not load.";
                    return;
                }
                const child = new DataGrid({
                    container: mount,
                    tableName: childTable,
                    parentScope: { column: f.sub_table_join_column, value: rowData[pkField.column_name] },
                    shared: this.shared,
                });
                child.renderFromData(res);
                childInstances.push(child);
            });
        });

        const closeBtn = document.createElement("button");
        closeBtn.className = DASH_BTN + " mt-4";
        closeBtn.textContent = "Close";
        box.appendChild(closeBtn);

        document.body.appendChild(overlay);

        const modalHasUnsavedChanges = () => parentEditor.hasUnsavedChanges() || childInstances.some((c) => c.hasUnsavedChanges());

        const forceClose = () => {
            childInstances.forEach((c) => c.destroy());
            overlay.remove();
            this.onDetailModalClosed && this.onDetailModalClosed();
        };
        const closeViaButton = () => {
            const proceed = () => {
                forceClose();
                history.replaceState(null, "", "/dashboard/tables/" + this.tableName);
            };
            if (modalHasUnsavedChanges()) {
                confirmModal("Discard unsaved changes?").then((yes) => yes && proceed());
            } else {
                proceed();
            }
        };
        closeBtn.addEventListener("click", closeViaButton);
        overlay.addEventListener("mousedown", (e) => {
            if (e.target === overlay) closeViaButton();
        });

        this.shared.setActiveDetailModal({
            hasUnsavedChanges: modalHasUnsavedChanges,
            forceClose: forceClose,
            url: detailUrl,
        });
    }

    queueRowDelete_(rowComponent) {
        const rowData = rowComponent.getData();
        const key = this.rowKeyStr(rowData);
        const isUnsavedNewRow = this.dirty[key] && this.dirty[key].isNew;
        if (isUnsavedNewRow) {
            delete this.dirty[key];
        } else {
            this.dirty[key] = { isNew: false, isDelete: true, data: rowData };
        }
    }

    handleDeleteRow(rowComponent) {
        const rowData = rowComponent.getData();
        const key = this.rowKeyStr(rowData);
        const isUnsavedNewRow = this.dirty[key] && this.dirty[key].isNew;
        const message = isUnsavedNewRow ? "Remove this not-yet-saved row?" : "Delete this row? Won't happen until you hit Save.";
        confirmModal(message, isUnsavedNewRow ? "Remove" : "Delete", !isUnsavedNewRow).then((yes) => {
            if (!yes) return;
            this.queueRowDelete_(rowComponent);
            if (rowComponent.isSelected && rowComponent.isSelected()) this.tabulator.deselectRow(rowComponent);
            this.tabulator.setFilter((row) => this.rowMatchesFilters(row));
            this.updateToolbarButtons();
            this.updateSelectAllCheckbox_();
        });
    }

    handleBulkDelete() {
        const rows = this.tabulator.getSelectedRows();
        if (!rows.length) return;
        const allUnsavedNew = rows.every((r) => {
            const key = this.rowKeyStr(r.getData());
            return this.dirty[key] && this.dirty[key].isNew;
        });
        const message = allUnsavedNew ? "Remove " + rows.length + " not-yet-saved row(s)?" : "Delete " + rows.length + " row(s)? Won't happen until you hit Save.";
        confirmModal(message, allUnsavedNew ? "Remove" : "Delete", !allUnsavedNew).then((yes) => {
            if (!yes) return;
            rows.forEach((r) => this.queueRowDelete_(r));
            this.tabulator.deselectRow(rows);
            this.tabulator.setFilter((row) => this.rowMatchesFilters(row));
            this.updateToolbarButtons();
            this.updateSelectAllCheckbox_();
        });
    }

    markRowDirty(cell) {
        const rowData = cell.getRow().getData();
        const key = this.rowKeyStr(rowData);
        const wasNew = !!(this.dirty[key] && this.dirty[key].isNew);
        const original = wasNew ? null : this.findOriginalRow(key);

        const field = cell.getField();
        const changed = wasNew || !original || String(cell.getValue() ?? "") !== String(original[field] ?? "");
        cell.getElement().classList.toggle("cell-changed", changed);

        if (!wasNew && original && rowsEqual(rowData, original)) {
            delete this.dirty[key];
        } else {
            this.dirty[key] = { isNew: wasNew, data: rowData };
        }
        this.updateToolbarButtons();
    }

    renderGrid(rows) {
        if (this.tabulator) {
            this.tabulator.destroy();
            this.tabulator = null;
        }
        // Tabulator must own a plain element exclusively — it builds its own
        // internal header/tableholder box model on whatever element it's
        // given, and our own Tailwind `flex` utility on that same element
        // (needed to show/hide gridEl) collides with it: `display:flex` with
        // no flex-direction override defaults to row, which stretches the
        // header to the full container height instead of Tabulator's
        // intended column stacking, squashing the row area to ~0. Mounting
        // into a plain, Tailwind-class-free child of gridEl avoids that.
        this.gridEl.innerHTML = "";
        const mountEl = document.createElement("div");
        mountEl.className = this.toolbarHost ? "w-full" : "h-full w-full";
        this.gridEl.appendChild(mountEl);

        // Page-level grid: no fixed height — Tabulator sizes itself to fit
        // its (already paginated, max ~100-row) content and the page
        // scrolls as a whole. Embedded sub-table grids (inside a detail
        // modal, which is itself bounded) keep the old height:"100%" +
        // internal-scroll behavior, since the modal can't grow past the
        // viewport.
        this.tableReady = new Promise((resolve) => {
            this.tabulator = new Tabulator(mountEl, {
                data: JSON.parse(JSON.stringify(rows)),
                layout: "fitDataFill",
                ...(this.toolbarHost ? {} : { height: "100%" }),
                selectableRows: true,
                columns: this.buildColumns(),
                // Large tables (stock_movement, production_plan, etc.) can
                // run into the thousands of rows; pagination keeps the
                // pager/filter/scan interactions snappy without touching
                // fetch, sort, filter, or the dirty-row edit tracking —
                // it only changes which of the already-loaded `data` rows
                // are rendered per page.
                pagination: true,
                paginationMode: "local",
                paginationSize: 100,
                paginationSizeSelector: [50, 100, 250, 500, true],
                paginationCounter: "rows",
            });
            this.tabulator.on("cellEdited", (cell) => this.markRowDirty(cell));
            this.tabulator.on("rowSelectionChanged", () => {
                this.updateToolbarButtons();
                this.updateSelectAllCheckbox_();
            });
            this.tabulator.on("tableBuilt", () => {
                this.tabulator.setFilter((row) => this.rowMatchesFilters(row));
                this.attachColumnFilterIcons();
                this.attachColumnManageIcons();
                resolve();
            });
        });
    }

    // --- Add-new modal -------------------------------------------------

    openAddModal() {
        const valueFields = this.schema.filter(
            (f) => f.editable_on_create === true && !this.keyFields.includes(f) && !(this.parentScope && f.column_name === this.parentScope.column),
        );
        const formState = {};
        this.keyFields.filter((f) => f.type !== "reference").forEach((f) => {
            formState[f.column_name] = crypto.randomUUID();
        });
        if (this.parentScope) formState[this.parentScope.column] = this.parentScope.value;

        const overlay = document.createElement("div");
        overlay.className = MODAL_OVERLAY;
        const box = document.createElement("div");
        box.className = modalBoxClass("w-[26rem]");
        box.innerHTML = "<h3 class='mb-4 mt-0 text-lg font-bold tracking-[-0.01em]'>Add row</h3>";
        overlay.appendChild(box);

        if (this.parentScope) {
            const scopeField = this.schema.find((f) => f.column_name === this.parentScope.column);
            let display = this.parentScope.value;
            if (scopeField && scopeField.type === "reference") {
                const cache = REF_CACHES[scopeField.ref_table] || {};
                const row = cache[this.parentScope.value];
                display = row ? row[scopeField.ref_label_field] : this.parentScope.value;
            }
            const info = document.createElement("div");
            info.className = MODAL_FIELD;
            info.innerHTML =
                "<label class='" +
                MODAL_FIELD_LABEL +
                "'>" +
                (scopeField ? scopeField.label || scopeField.column_name : this.parentScope.column) +
                "</label><div>" +
                display +
                "</div>";
            box.appendChild(info);
        }

        const visibleKeyFields = this.keyFields.filter((f) => !(this.parentScope && f.column_name === this.parentScope.column));
        const referenceKeyFields = visibleKeyFields.filter((f) => f.type === "reference");

        const usedCombos = () => this.tabulator.getData();
        const norm = (v) => String(v ?? "").trim();

        const optionsFor = (field) => {
            const cache = REF_CACHES[field.ref_table] || {};
            return Object.keys(cache).filter((id) => {
                return !usedCombos().some((row) =>
                    this.keyFields.every((kf) => {
                        const candidate = kf.column_name === field.column_name ? id : formState[kf.column_name];
                        return norm(row[kf.column_name]) === norm(candidate);
                    }),
                );
            });
        };

        referenceKeyFields.forEach((f) => {
            const wrap = document.createElement("div");
            wrap.className = MODAL_FIELD;
            const label = document.createElement("label");
            label.className = MODAL_FIELD_LABEL;
            label.textContent = f.label || f.column_name;
            wrap.appendChild(label);
            const pickWrap = document.createElement("div");
            wrap.appendChild(pickWrap);
            box.appendChild(wrap);

            const cache = REF_CACHES[f.ref_table] || {};
            makeSearchPick(pickWrap, {
                placeholder: "Search " + (f.label || f.column_name).toLowerCase() + "…",
                getItems: (q) =>
                    optionsFor(f)
                        .map((id) => ({ id: id, label: cache[id] ? cache[id][f.ref_label_field] : id }))
                        .filter((it) => !q || it.label.toLowerCase().includes(q))
                        .sort((a, b) => a.label.localeCompare(b.label)),
                onSelect: (item) => {
                    formState[f.column_name] = item.id;
                },
            });
        });

        valueFields.forEach((f) => {
            const wrap = document.createElement("div");
            wrap.className = MODAL_FIELD;
            const label = document.createElement("label");
            label.className = MODAL_FIELD_LABEL;
            label.textContent = f.label || f.column_name;
            wrap.appendChild(label);
            wrap.appendChild(
                buildFieldInput(f, formState[f.column_name], (val) => {
                    formState[f.column_name] = val;
                }),
            );
            box.appendChild(wrap);
        });

        const errorEl = document.createElement("div");
        errorEl.className = "mt-[0.6rem] text-[0.85rem] text-danger-ink";
        box.appendChild(errorEl);

        const actions = document.createElement("div");
        actions.className = "mt-4 flex justify-end gap-[0.6rem]";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = DASH_BTN_MUTED;
        cancelBtn.textContent = "Cancel";
        const saveBtn = document.createElement("button");
        saveBtn.className = DASH_BTN;
        saveBtn.textContent = "Add";
        actions.append(cancelBtn, saveBtn);
        box.appendChild(actions);

        document.body.appendChild(overlay);

        cancelBtn.addEventListener("click", () => overlay.remove());
        saveBtn.addEventListener("click", () => {
            const missing = this.keyFields.concat(valueFields).find((f) => f.required === true && !formState[f.column_name]);
            if (missing) {
                errorEl.textContent = (missing.label || missing.column_name) + " is required.";
                return;
            }
            this.tabulator.addRow(formState);
            this.dirty[this.rowKeyStr(formState)] = { isNew: true, data: Object.assign({}, formState) };
            this.updateToolbarButtons();
            overlay.remove();
        });
    }
}

// --- Page-level orchestration ---------------------------------------------

function tableSlugFromUrl() {
    return window.location.pathname.split("/").filter(Boolean)[2] || "";
}

function detailRowIdFromUrl() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return segments[3] === "detail" ? segments[4] || "" : "";
}

/**
 * Mounts the whole Data Tables page (tabs, heading, toolbar, grid) into
 * `container` and wires up URL-driven tab/detail deep-linking — the
 * React-facing entry point for this module, called once DashboardShell has
 * confirmed dashboard access (see app/dashboard/tables/[[...slug]]/page.js).
 *
 * @param {HTMLElement} container
 * @param {Object} opts
 * @param {(title: string) => void} opts.onTitleChange - bridges into
 *   React's <PageTitle> (this module is vanilla DOM, so it can't render
 *   JSX itself).
 * @returns {{ destroy(): void, hasUnsavedChanges(): boolean }}
 */
export function createTablesPageController(container, opts) {
    let tablesList = [];
    let activeTable = "";
    let pageGrid = null;
    let activeDetailModal = null;
    let destroyed = false;

    const shared = {
        enumOptionDirtyBox: { value: {} },
        liveGridInstances: new Set(),
        setActiveDetailModal: (modal) => {
            activeDetailModal = modal;
        },
    };

    // --- Scaffold ---
    // One row, never wraps to a second line — overflow scrolls
    // horizontally instead (scrollbar hidden; nothing to scroll on
    // desktop, where the row fits). The active table's pill auto-centers
    // itself in the row on switch — see buildTableTabs().
    const tabsEl = document.createElement("div");
    tabsEl.className =
        "mt-4 hidden flex-nowrap gap-[0.4rem] overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
    const titleEl = document.createElement("h1");
    titleEl.className = "text-[1.4rem] font-semibold tracking-[-0.015em] text-ink";
    const descEl = document.createElement("p");
    descEl.className = "mt-1 text-[0.875rem] leading-relaxed text-muted";
    const toolbarHostEl = document.createElement("div");
    toolbarHostEl.className = "mt-3";
    // Title + description + table-switcher pills + the active table's own
    // toolbar (search/add/edit/refresh — appended into toolbarHostEl by
    // DataGrid, see its toolbarHost option) all share ONE sticky header
    // band, pinned to the top of the page's own scroll — container itself
    // is the scroll region (see the React wrapper's className), not a
    // bounded per-grid box, so the whole page scrolls under this header
    // instead of the grid getting its own separate internal scrollbar.
    const headerEl = document.createElement("div");
    headerEl.className = "sticky top-0 z-20 mb-6 border-b border-line bg-bg pb-5 pt-0.5";
    headerEl.append(titleEl, descEl, tabsEl, toolbarHostEl);
    const loadSpinnerEl = document.createElement("div");
    loadSpinnerEl.className = "mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line";
    loadSpinnerEl.style.borderTopColor = "#0e5c45";
    const gridMountEl = document.createElement("div");
    gridMountEl.className = "flex flex-col";
    container.append(headerEl, loadSpinnerEl, gridMountEl);

    function hasUnsavedChanges() {
        return (
            (pageGrid && pageGrid.hasUnsavedChanges()) ||
            (activeDetailModal && activeDetailModal.hasUnsavedChanges()) ||
            Object.keys(shared.enumOptionDirtyBox.value).length > 0
        );
    }

    function buildTableTabs() {
        tabsEl.classList.toggle("hidden", tablesList.length <= 1);
        tabsEl.classList.toggle("flex", tablesList.length > 1);
        tabsEl.innerHTML = "";
        let activeBtn = null;
        tablesList.forEach((t) => {
            const btn = document.createElement("button");
            btn.type = "button";
            const active = t.table_name === activeTable;
            btn.className =
                "flex-shrink-0 cursor-pointer rounded-full border px-[0.9rem] py-[0.4rem] text-[0.85rem] font-semibold shadow-elevate-1 " +
                (active
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-line bg-card text-muted hover:border-accent/40 hover:text-ink");
            btn.textContent = t.label || t.table_name;
            btn.addEventListener("click", () => switchTable(t.table_name));
            tabsEl.appendChild(btn);
            if (active) activeBtn = btn;
        });
        // Auto-centers the active table's pill in the scrollable row —
        // same behavior as KpiFilters.js's date-preset pills.
        activeBtn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }

    function activateTable(tableName, pushUrl) {
        activeTable = tableName;
        shared.enumOptionDirtyBox.value = {};
        if (activeDetailModal) activeDetailModal.forceClose();
        if (pushUrl) history.pushState(null, "", "/dashboard/tables/" + tableName);
        buildTableTabs();

        const meta = tablesList.find((t) => t.table_name === tableName) || {};
        opts.onTitleChange("Dashboard — " + (meta.label || tableName));
        titleEl.textContent = meta.label || tableName;
        descEl.textContent = meta.description || "";

        if (pageGrid) pageGrid.destroy();
        pageGrid = new DataGrid({
            container: gridMountEl,
            tableName: tableName,
            shared: shared,
            toolbarHost: toolbarHostEl,
            onRendered: (grid) => prefetchSubTableChildren_(grid.schema),
        });
        pageGrid.load();
    }

    function switchTable(tableName) {
        if (tableName === activeTable) return;
        const proceed = () => activateTable(tableName, true);
        if (hasUnsavedChanges()) {
            confirmModal("Discard unsaved changes and switch tables?").then((yes) => yes && proceed());
        } else {
            proceed();
        }
    }

    function onPopState() {
        if (destroyed) return;
        const slug = tableSlugFromUrl();

        if (activeDetailModal && slug === activeTable && !detailRowIdFromUrl()) {
            if (activeDetailModal.hasUnsavedChanges()) {
                const modalUrl = activeDetailModal.url;
                confirmModal("Discard unsaved changes and close?").then((yes) => {
                    if (yes) {
                        activeDetailModal.forceClose();
                    } else {
                        history.pushState(null, "", modalUrl);
                    }
                });
            } else {
                activeDetailModal.forceClose();
            }
            return;
        }

        if (!slug || slug === activeTable || !tablesList.some((t) => t.table_name === slug)) {
            return;
        }
        if (hasUnsavedChanges()) {
            confirmModal("Discard unsaved changes and switch tables?").then((yes) => {
                if (yes) {
                    activateTable(slug, false);
                } else {
                    history.pushState(null, "", "/dashboard/tables/" + activeTable);
                }
            });
        } else {
            activateTable(slug, false);
        }
    }

    function onSidebarToggled() {
        shared.liveGridInstances.forEach((inst) => {
            if (inst.tabulator) inst.tabulator.redraw(true);
        });
    }

    window.addEventListener("popstate", onPopState);
    window.addEventListener("dash-sidebar-toggled", onSidebarToggled);

    apiCall("bootstrap_tables_page", { preferredTable: tableSlugFromUrl() })
        .then((res) => {
            if (destroyed) return;
            loadSpinnerEl.classList.add("hidden");
            if (!res.ok || !res.tables || !res.tables.length) {
                gridMountEl.textContent = res.error || "No tables configured yet.";
                return;
            }
            tablesList = res.tables;
            activeTable = res.activeTable;
            const meta = tablesList.find((t) => t.table_name === activeTable) || {};
            const initialDetailId = detailRowIdFromUrl();
            history.replaceState(null, "", "/dashboard/tables/" + activeTable + (initialDetailId ? "/detail/" + initialDetailId : ""));
            opts.onTitleChange("Dashboard — " + (meta.label || activeTable));
            titleEl.textContent = meta.label || activeTable;
            descEl.textContent = meta.description || "";

            buildTableTabs();
            pageGrid = new DataGrid({
                container: gridMountEl,
                tableName: activeTable,
                shared: shared,
                toolbarHost: toolbarHostEl,
                onRendered: (grid) => prefetchSubTableChildren_(grid.schema),
            });
            pageGrid.renderFromData(cacheBootstrapResponse(res, activeTable));

            if (initialDetailId) {
                pageGrid.tableReady.then(() => {
                    if (destroyed) return;
                    const rowComp = pageGrid.findRowComponent(initialDetailId);
                    if (rowComp) pageGrid.openDetailView(rowComp, { pushUrl: false });
                });
            }
        })
        .catch(() => {
            if (destroyed) return;
            loadSpinnerEl.classList.add("hidden");
            gridMountEl.textContent = "Failed to load.";
        });

    return {
        hasUnsavedChanges,
        destroy() {
            destroyed = true;
            window.removeEventListener("popstate", onPopState);
            window.removeEventListener("dash-sidebar-toggled", onSidebarToggled);
            if (activeDetailModal) activeDetailModal.forceClose();
            if (pageGrid) pageGrid.destroy();
            document.querySelectorAll(".col-filter-popup-marker, .enum-manage-popup-marker").forEach((el) => el.remove());
            container.innerHTML = "";
        },
    };
}
