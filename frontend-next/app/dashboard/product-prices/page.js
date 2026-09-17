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

/**
 * Product Prices — a focused, name+price-only view over the same
 * `product.current_unit_cost` / `stock_item.current_unit_cost` columns
 * the generic Data Tables page already exposes (both were already
 * editable there — this doesn't add new capability, it makes the one
 * capability the request cares about easy to find and use without
 * wading through a 10+ column technical grid to get to it).
 *
 * Deliberately reuses the existing, already-tested list_table_rows /
 * save_table_row actions directly rather than adding parallel backend
 * logic — this is the exact same write path the generic Data Tables page
 * itself uses, so a price set here is not a second, differently-computed
 * number: it's the one number Waste, Damage, Staff Food, and (through
 * those) Profit already read automatically, no re-entry anywhere else.
 */
const SECTIONS = [
    { key: "product", label: "Finished Products", idField: "product_id", Icon: Package },
    { key: "stock_item", label: "Stock Items / Ingredients", idField: "stock_item_id", Icon: Tag },
];

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
                        description="Set the cost of every product and stock item — these feed Waste, Damage, Staff Food, and Profit automatically, no re-entry needed anywhere else."
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

function PriceTable({ table, idField, label, brandId, brandById }) {
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
                        <span className="font-semibold text-ink">{pricedCount}</span> of {totalActive} priced
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
                                    <th className="w-40 whitespace-nowrap border-b border-line bg-panel px-[0.9rem] py-2.5 text-left text-[0.7rem] font-semibold uppercase tracking-[0.05em] text-muted">
                                        Price
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <PriceRow
                                        key={row[idField]}
                                        row={row}
                                        table={table}
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
                                        <td colSpan={2} className="px-[0.9rem] py-6 text-center text-muted">
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

function PriceRow({ row, table, brandName, onSaved }) {
    const [editing, setEditing] = useState(false);
    const [value, setValue] = useState("");
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
        setValue(row.current_unit_cost !== null && row.current_unit_cost !== undefined ? String(row.current_unit_cost) : "");
        setSaveError("");
        setEditing(true);
    }

    function save() {
        const num = Number(value);
        if (value.trim() === "" || Number.isNaN(num) || num < 0) {
            setSaveError("Enter a valid price.");
            return;
        }
        setSaveError("");
        // Whole-row save (not a partial patch) — save_table_row validates
        // every field_schema-required column on the row, not just the one
        // that changed, so the untouched fields must ride along unchanged.
        saveMutation.mutate({ table, isNew: false, row: { ...row, current_unit_cost: num } });
    }

    if (editing) {
        return (
            <tr>
                <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 font-medium text-ink">
                    <NameCell name={row.name} brandName={brandName} />
                </td>
                <td className="border-b border-line px-[0.9rem] py-2">
                    <div className="flex items-center gap-1.5">
                        <input
                            type="number"
                            step="0.01"
                            min="0"
                            autoFocus
                            placeholder="0.00"
                            className="w-24 py-1.5 text-[0.85rem]"
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && save()}
                        />
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
                    </div>
                    {saveError && <div className="mt-1 text-[0.75rem] text-danger-ink">{saveError}</div>}
                </td>
            </tr>
        );
    }

    const hasPrice = row.current_unit_cost !== null && row.current_unit_cost !== undefined;
    return (
        <tr className="transition-colors duration-100 hover:bg-panel/70">
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5 text-ink">
                <NameCell name={row.name} brandName={brandName} />
            </td>
            <td className="whitespace-nowrap border-b border-line px-[0.9rem] py-2.5">
                <button
                    type="button"
                    onClick={startEdit}
                    title={hasPrice ? "Edit price" : "Set price"}
                    className="group flex items-center gap-1.5 rounded-lg border-none bg-transparent p-0 text-left text-[0.85rem] hover:text-accent"
                >
                    {hasPrice ? (
                        <span className="tabular-nums text-ink">{moneyStr(Number(row.current_unit_cost))}</span>
                    ) : (
                        <span className="text-muted">Set price</span>
                    )}
                    <Pencil size={12} strokeWidth={2} className="flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
            </td>
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
