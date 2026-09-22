"use client";

import { useMemo, useState } from "react";
import { Tag, Package, Check, X, Pencil, Search } from "lucide-react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import PillButton from "@/components/dashboard/PillButton";
import { useBootstrap, useApiMutation } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { moneyStr } from "@/lib/kpiUtils";
import { productMargin } from "@/lib/pricing";

/**
 * Product Prices — a focused view over `product` / `stock_item` columns
 * the generic Data Tables page already exposes (all editable there too —
 * this makes the ones this page cares about easy to find without wading
 * through a 10+ column technical grid).
 *
 * Deliberately reuses the existing, already-tested list_table_rows /
 * save_table_row actions directly rather than adding parallel backend
 * logic — a value set here is not a second, differently-computed number:
 * it's read automatically everywhere else in the app, no re-entry needed.
 *
 * Finished Products get four money fields:
 *   - Cost (`current_unit_cost`) — what Waste, Damage, Staff Food and the
 *     KPI/Profit tabs already value those movements at. Existed before.
 *   - Selling Price, Recipe Cost, Packaging Cost — what the customer pays
 *     and what it costs to make (ingredients vs. packaging, split so they
 *     can be reviewed separately). New — nothing in the system reads these
 *     yet beyond the Margin column computed right here (see lib/pricing.js);
 *     they exist so the numbers have somewhere to live and be seen.
 * Stock Items only ever had the one Cost field — that's unchanged.
 */
const SECTIONS = [
    { key: "product", label: "Finished Products", idField: "product_id", Icon: Package },
    { key: "stock_item", label: "Stock Items / Ingredients", idField: "stock_item_id", Icon: Tag },
];

const MONEY_FIELDS = {
    product: [
        { key: "current_unit_cost", label: "Cost" },
        { key: "selling_price", label: "Selling Price" },
        { key: "recipe_cost", label: "Recipe Cost" },
        { key: "packaging_cost", label: "Packaging Cost" },
    ],
    stock_item: [{ key: "current_unit_cost", label: "Cost" }],
};

export default function ProductPricesPage() {
    const [sectionKey, setSectionKey] = useState("product");
    const [brandFilter, setBrandFilter] = useState(null); // null = All brands
    const section = SECTIONS.find((s) => s.key === sectionKey);

    // Only Finished Products carry a brand_id (stock_item/ingredients are
    // shared across brands) — same names recur across brands (e.g. both
    // YO! and Sushi Circle sell a "Chicken Gyoza") at different costs, so
    // without a brand split the list shows two identically-named rows with
    // no way to tell which is which.
    const { data: brandRes } = useBootstrap("list_table_rows", sectionKey === "product" ? { table: "brand" } : null);
    const brands = brandRes?.rows || [];
    const brandById = useMemo(() => new Map(brands.map((b) => [b.brand_id, b.name])), [brands]);

    return (
        <>
            <PageTitle title="Dashboard — Product Prices" />
            <DashboardShell activeKey="product-prices">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Product Prices"
                        description="Set the cost, selling price, recipe cost and packaging cost for every product — these feed Waste, Damage, Staff Food, Profit, and the margin shown here automatically, no re-entry needed anywhere else."
                    />

                    <div className="mb-2.5 flex flex-wrap gap-1.5">
                        {SECTIONS.map((s) => (
                            <PillButton
                                key={s.key}
                                active={sectionKey === s.key}
                                onClick={() => {
                                    setSectionKey(s.key);
                                    setBrandFilter(null);
                                }}
                                icon={s.Icon}
                            >
                                {s.label}
                            </PillButton>
                        ))}
                    </div>

                    {sectionKey === "product" && brands.length > 0 && (
                        <div className="mb-4 flex flex-wrap gap-1.5">
                            <PillButton active={brandFilter === null} onClick={() => setBrandFilter(null)}>
                                All brands
                            </PillButton>
                            {brands.map((b) => (
                                <PillButton key={b.brand_id} active={brandFilter === b.brand_id} onClick={() => setBrandFilter(b.brand_id)}>
                                    {b.name}
                                </PillButton>
                            ))}
                        </div>
                    )}

                    <PriceTable
                        table={section.key}
                        idField={section.idField}
                        fields={MONEY_FIELDS[section.key]}
                        showMargin={section.key === "product"}
                        label={label(section, brandFilter, brands)}
                        brandId={sectionKey === "product" ? brandFilter : null}
                        brandById={brandById}
                    />
                </div>
            </DashboardShell>
        </>
    );
}

function label(section, brandFilter, brands) {
    if (!brandFilter) return section.label;
    const brand = brands.find((b) => b.brand_id === brandFilter);
    return section.label + " — " + (brand?.name || brandFilter);
}

function PriceTable({ table, idField, fields, showMargin, label, brandId, brandById }) {
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("list_table_rows", { table });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const rows = useMemo(() => {
        const all = (res?.rows || []).filter((r) => r.active !== false && (!brandId || r.brand_id === brandId));
        const q = search.trim().toLowerCase();
        const filtered = q ? all.filter((r) => String(r.name || "").toLowerCase().includes(q)) : all;
        return filtered.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }, [res, search, brandId]);

    // "Priced" tracks the primary Cost field only — that's the one every
    // downstream calculation (Waste/Damage/Staff Food/Profit) actually
    // requires; the newer fields are informational until something reads them.
    const totalActive = (res?.rows || []).filter((r) => r.active !== false && (!brandId || r.brand_id === brandId)).length;
    const pricedCount = (res?.rows || []).filter(
        (r) => r.active !== false && (!brandId || r.brand_id === brandId) && r.current_unit_cost !== null && r.current_unit_cost !== undefined,
    ).length;

    return (
        <SectionCard title={label} className="mb-0">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5">
                <div className="relative w-full max-w-[18rem]">
                    <Search size={14} strokeWidth={2.25} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input
                        type="search"
                        placeholder="Search…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full pl-8"
                    />
                </div>
                {!loading && !error && (
                    <span className="text-[0.78rem] text-muted">
                        <span className="font-semibold text-ink">{pricedCount}</span> of {totalActive} have a cost
                    </span>
                )}
            </div>

            {loading && (
                <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
            )}
            {error && <div className="text-danger-ink">{error}</div>}

            {!loading && !error && (
                <div className="overflow-hidden rounded-lg border border-line">
                    <div className="overflow-x-auto">
                        <table className="w-full border-collapse bg-card text-[0.85rem]">
                            <thead>
                                <tr>
                                    <th className="whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                        Name
                                    </th>
                                    {fields.map((f) => (
                                        <th
                                            key={f.key}
                                            className="w-32 whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted"
                                        >
                                            {f.label}
                                        </th>
                                    ))}
                                    {showMargin && (
                                        <th className="w-28 whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                            Margin
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <PriceRow
                                        key={row[idField]}
                                        row={row}
                                        table={table}
                                        fields={fields}
                                        showMargin={showMargin}
                                        // Only worth showing when brand isn't already
                                        // pinned by the active tab — otherwise every
                                        // row would repeat the same badge.
                                        brandName={!brandId ? brandById.get(row.brand_id) : null}
                                        onSaved={() => {
                                            refetch();
                                            queryClient.invalidateQueries({ queryKey: ["bootstrap_data_table", { table }] });
                                        }}
                                    />
                                ))}
                                {!rows.length && (
                                    <tr>
                                        <td colSpan={1 + fields.length + (showMargin ? 1 : 0)} className="px-[0.9rem] py-6 text-center text-muted">
                                            No matching items.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </SectionCard>
    );
}

function PriceRow({ row, table, fields, showMargin, brandName, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState({});
    const [saveError, setSaveError] = useState("");

    const saveMutation = useApiMutation("save_table_row", {
        onSuccess: (out) => {
            if (!out.ok) {
                setSaveError(out.error || "Save failed.");
                return;
            }
            setEditing(false);
            onSaved();
        },
        onError: () => setSaveError("Save failed."),
    });

    function startEdit() {
        const next = {};
        fields.forEach((f) => {
            next[f.key] = row[f.key] !== null && row[f.key] !== undefined ? String(row[f.key]) : "";
        });
        setValues(next);
        setSaveError("");
        setEditing(true);
    }

    function save() {
        const parsed = {};
        for (const f of fields) {
            const raw = (values[f.key] ?? "").trim();
            if (raw === "") {
                parsed[f.key] = null; // blank clears the field rather than being rejected
                continue;
            }
            const num = Number(raw);
            if (Number.isNaN(num) || num < 0) {
                setSaveError(`Enter a valid ${f.label.toLowerCase()}, or leave it blank.`);
                return;
            }
            parsed[f.key] = num;
        }
        setSaveError("");
        // Whole-row save (not a partial patch) — save_table_row validates
        // every field_schema-required column on the row, not just the ones
        // that changed, so the untouched fields must ride along unchanged.
        saveMutation.mutate({ table, isNew: false, row: { ...row, ...parsed } });
    }

    if (editing) {
        return (
            <tr>
                <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">
                    <NameCell name={row.name} brandName={brandName} />
                </td>
                {fields.map((f, i) => (
                    <td key={f.key} className="border-b border-line px-[0.9rem] py-2">
                        <div className="flex items-center gap-1.5">
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                autoFocus={i === 0}
                                placeholder="0.00"
                                className="w-20 py-1.5 text-[0.85rem]"
                                value={values[f.key] ?? ""}
                                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                                onKeyDown={(e) => e.key === "Enter" && save()}
                            />
                            {i === fields.length - 1 && (
                                <>
                                    <button
                                        type="button"
                                        disabled={saveMutation.isPending}
                                        onClick={save}
                                        title="Save"
                                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-accent text-accent-ink disabled:opacity-50"
                                    >
                                        <Check size={14} strokeWidth={2.5} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={saveMutation.isPending}
                                        onClick={() => setEditing(false)}
                                        title="Cancel"
                                        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border-none bg-line text-muted disabled:opacity-50"
                                    >
                                        <X size={14} strokeWidth={2.5} />
                                    </button>
                                </>
                            )}
                        </div>
                        {saveError && i === fields.length - 1 && (
                            <div className="mt-1 whitespace-nowrap text-[0.75rem] text-danger-ink">{saveError}</div>
                        )}
                    </td>
                ))}
                {showMargin && <td className="border-b border-line px-[0.9rem] py-2 text-muted">—</td>}
            </tr>
        );
    }

    const margin = showMargin
        ? productMargin({ sellingPrice: row.selling_price, recipeCost: row.recipe_cost, packagingCost: row.packaging_cost })
        : null;

    return (
        <tr className="transition-colors duration-100 hover:bg-panel/70">
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 text-ink">
                <NameCell name={row.name} brandName={brandName} />
            </td>
            {fields.map((f) => {
                const val = row[f.key];
                const hasVal = val !== null && val !== undefined;
                return (
                    <td key={f.key} className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">
                        <button
                            type="button"
                            onClick={startEdit}
                            title="Edit"
                            className="group flex items-center gap-1.5 rounded-lg border-none bg-transparent p-0 text-left text-[0.85rem] hover:text-accent"
                        >
                            {hasVal ? (
                                <span className="tabular-nums text-ink">{moneyStr(Number(val))}</span>
                            ) : (
                                <span className="text-muted">—</span>
                            )}
                            <Pencil size={12} strokeWidth={2} className="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                    </td>
                );
            })}
            {showMargin && (
                <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 tabular-nums">
                    {margin ? (
                        <span className={margin.pct !== null && margin.pct < 0 ? "text-danger-ink" : "text-ink"}>
                            {moneyStr(margin.profit)}
                            {margin.pct !== null && <span className="ml-1 text-muted">({Math.round(margin.pct)}%)</span>}
                        </span>
                    ) : (
                        <span className="text-muted">—</span>
                    )}
                </td>
            )}
        </tr>
    );
}

/** Product name plus a small brand badge — only rendered when the caller
 * passes a brandName (i.e. the "All brands" tab, where two differently-
 * priced products can otherwise share an identical name — see this file's
 * top comment). Once a brand tab narrows the list, the badge is redundant
 * (every row's brand is already the tab you're on) so callers pass null. */
function NameCell({ name, brandName }) {
    return (
        <span className="inline-flex items-center gap-1.5">
            {name}
            {brandName && (
                <span className="rounded-full bg-panel px-1.5 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.03em] text-muted">
                    {brandName}
                </span>
            )}
        </span>
    );
}
