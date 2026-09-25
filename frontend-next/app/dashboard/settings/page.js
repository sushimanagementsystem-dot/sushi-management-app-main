"use client";

import { useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import SectionCard from "@/components/dashboard/SectionCard";
import SearchPick from "@/components/SearchPick";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { useApiMutation, useBootstrap } from "@/lib/queries";

// Hand-built, not schema-driven like Data Tables — several of these settings
// need a real picker (component/product references), not a generic grid
// text cell, and the section grouping/order below is the same logical
// grouping the settings already had in the source workbook, not derived
// from anything.
const SETTINGS_SECTIONS = [
    {
        title: "Rice & Batching",
        keys: [
            "RICE_BATCH_DRY_G", "RICE_BATCH_SEASONED_YIELD_G", "RICE_BATCH_COOKED_PLAIN_G",
            "RICE_BATCH_VINEGAR_G", "RICE_NO_COOK_THRESHOLD_G", "RICE_PER_FULL_ROLL_G",
            "FULL_ROLL_PIECES", "RICE_PER_MAKI_G", "MAKI_PIECES", "RICE_PER_NIGIRI_G",
            "PLAIN_RICE_BATCH_DRY_G", "PLAIN_RICE_BATCH_YIELD_G", "RICE_PER_BOWL_G",
            "PLAIN_RICE_MIN_PORTIONS", "PLAIN_RICE_REMAINDER_MIN_G", "LOW_VOLUME_COMBINED_TARGET",
        ],
    },
    { title: "Component Batching", keys: ["PRAWN_KATSU_ROLLS_PER_BAG", "PRAWN_KATSU_COMPONENT_ID"] },
    { title: "Secondary Item Allocation", keys: ["SECONDARY_HISTORY_LOOKBACK_DAYS", "SANDO_STEP_PRODUCT_IDS", "SANDO_UNITS_PER_PREP"] },
    // Only "Packaging" needs a pick list now — the Food Waste item list is
    // the Stock Take list (see stocktake-items.util.ts), toggled per item via
    // Stock Item → "Available for Food Waste"; anything not picked here as
    // Packaging shows as Food. No separate "Food categories" setting to keep
    // in sync with Stock Take any more.
    { title: "Food Waste — Packaging Category", keys: ["FOOD_WASTE_PACKAGING_CATEGORIES"] },
    { title: "Sampling", keys: ["SAMPLING_DAYS", "SAMPLING_SUSHI", "SAMPLING_KARAAGE_PER_FLAVOUR"] },
    { title: "Defrost & Waste Attribution", keys: ["DEFROST_MEDIAN_WEEKS", "WASTE_ATTRIBUTION_DAYS_DEFAULT", "WASTE_ATTRIBUTION_DAYS_KCRB"] },
    { title: "Damage Review Thresholds", keys: ["DAMAGE_REVIEW_UNITS_PER_100", "DAMAGE_REVIEW_PRODUCT_WEEK_UNITS", "DAMAGE_REVIEW_SUBMITTER_WEEK"] },
    { title: "Stocktake", keys: ["STOCKTAKE_STALE_DAYS", "STOCKTAKE_VARIANCE_PCT", "STOCKTAKE_VARIANCE_MIN_UNITS"] },
    { title: "Monthly Audit", keys: ["AUDIT_PASS_PCT", "AUDIT_ATTENTION_PCT", "AUDIT_CORRECTION_DAYS", "AUDIT_CRITICAL_CORRECTION_DAYS"] },
    { title: "Help / Issue Deadlines", keys: ["REQUEST_DEADLINE_KIOSK_ISSUE_DAYS", "REQUEST_DEADLINE_HELP_DAYS", "REQUEST_DEADLINE_FEEDBACK_DAYS"] },
    { title: "Purchasing & Products", keys: ["CASTLEBAY_SALMON_ORDER_BOXES", "KARAAGE_BALANCING_PRODUCT", "RICE_BOWL_SUBSTITUTES"] },
];

// Everything not listed here renders as a plain number input.
const SETTINGS_TYPES = {
    SAMPLING_DAYS: "weekdays",
    SAMPLING_SUSHI: "component_qty_list",
    KARAAGE_BALANCING_PRODUCT: "product_picker",
    RICE_BOWL_SUBSTITUTES: "product_multi_picker",
    PRAWN_KATSU_COMPONENT_ID: "component_picker",
    SANDO_STEP_PRODUCT_IDS: "product_multi_picker",
    FOOD_WASTE_PACKAGING_CATEGORIES: "stock_category_multi_picker",
};

const WEEKDAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

// SAMPLING_SUSHI storage: JSON [{componentId, qty}, ...] — no legacy-text
// fallback. If the stored value isn't a valid JSON array (e.g. it's still
// the old free-text format from before this page existed), the line list
// just starts empty rather than attempting to reinterpret it — no
// name-matching, no silent-drop risk, nothing to get subtly wrong.
function parseSamplingValue(value) {
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {
        /* not JSON — start fresh */
    }
    return [];
}

function normalizeWeekdays(value) {
    const state = new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean));
    return WEEKDAY_ORDER.filter((d) => state.has(d)).join(",");
}

function normalizeMulti(value) {
    const ids = new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean));
    return Array.from(ids).join(",");
}

function normalizeComponentQty(value) {
    return JSON.stringify(
        parseSamplingValue(value)
            .filter((it) => it.componentId)
            .map((it) => ({ componentId: it.componentId, qty: Number(it.qty) || 0 })),
    );
}

export default function SettingsPage() {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_settings_page", {});

    const [editMode, setEditMode] = useState(false);
    const [pending, setPending] = useState({});
    const [generation, setGeneration] = useState(0);
    const [saveError, setSaveError] = useState("");

    const settingsByKey = useMemo(() => {
        const m = {};
        (res?.settings || []).forEach((s) => (m[s.key] = s));
        return m;
    }, [res]);
    const components = res?.components || [];
    const products = res?.products || [];
    const stockCategories = res?.stockCategories || [];

    const saveMutation = useApiMutation("save_settings", {
        onSuccess: (out) => {
            if (!out.ok) {
                setSaveError(out.error || "Save failed.");
                return;
            }
            setEditMode(false);
            refetch();
        },
        onError: () => setSaveError("Save failed."),
    });

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");

    function setField(key, value) {
        setPending((p) => ({ ...p, [key]: value }));
    }

    function typeFor(key) {
        return SETTINGS_TYPES[key] || "number";
    }

    function enterEdit() {
        const p = {};
        SETTINGS_SECTIONS.forEach((section) => {
            section.keys.forEach((key) => {
                const setting = settingsByKey[key];
                if (!setting) return;
                const type = typeFor(key);
                if (type === "weekdays") p[key] = normalizeWeekdays(setting.value);
                else if (type === "component_qty_list") p[key] = normalizeComponentQty(setting.value);
                else if (type === "product_multi_picker" || type === "stock_category_multi_picker") p[key] = normalizeMulti(setting.value);
                else if (type === "number") p[key] = String(setting.value);
                else p[key] = setting.value;
            });
        });
        setPending(p);
        setSaveError("");
        setGeneration((g) => g + 1);
        setEditMode(true);
    }

    function cancelEdit() {
        setEditMode(false);
        setSaveError("");
    }

    function save() {
        setSaveError("");
        saveMutation.mutate({ changes: pending });
    }

    return (
        <>
            <PageTitle title="Dashboard — Settings" />
            <DashboardShell activeKey="settings">
                {/* One scroll region for the whole page — PageHeader is sticky
                    inside it, not a static sibling above a separately
                    scrolling content box. */}
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                <PageHeader
                    title="Settings"
                    description="Production-planning constants, batching rules, and sampling/defrost configuration."
                    actions={
                        <>
                            <RefreshButton onRefetch={refetch} />
                            {!editMode && (
                                <button
                                    className="rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97]"
                                    onClick={enterEdit}
                                >
                                    Edit
                                </button>
                            )}
                            {editMode && (
                                <>
                                    <button
                                        disabled={saveMutation.isPending}
                                        className="rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50"
                                        onClick={save}
                                    >
                                        Save
                                    </button>
                                    <button
                                        disabled={saveMutation.isPending}
                                        className="rounded-lg border-none bg-line px-4 py-[0.6rem] text-[0.9rem] font-semibold text-ink hover:bg-[#ddd7c8] active:scale-[0.97] disabled:opacity-50"
                                        onClick={cancelEdit}
                                    >
                                        Cancel
                                    </button>
                                </>
                            )}
                        </>
                    }
                />

                {loading && (
                    <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                )}
                {error && <div className="text-danger-ink">{error}</div>}
                {saveError && <div className="mb-3 text-danger-ink">{saveError}</div>}

                {!loading &&
                    res?.ok &&
                    SETTINGS_SECTIONS.map((section) => {
                        const knownKeys = section.keys.filter((k) => settingsByKey[k]);
                        if (!knownKeys.length) return null;
                        return (
                            <SectionCard key={section.title} title={section.title}>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-[1.2rem] max-[720px]:grid-cols-1">
                                    {knownKeys.map((key) => (
                                        <SettingField
                                            key={key + ":" + generation}
                                            settingKey={key}
                                            setting={settingsByKey[key]}
                                            type={typeFor(key)}
                                            editMode={editMode}
                                            pendingValue={pending[key]}
                                            onChange={(v) => setField(key, v)}
                                            components={components}
                                            products={products}
                                            stockCategories={stockCategories}
                                        />
                                    ))}
                                </div>
                            </SectionCard>
                        );
                    })}
                </div>
            </DashboardShell>
        </>
    );
}

function SettingField({ settingKey, setting, type, editMode, pendingValue, onChange, components, products, stockCategories }) {
    return (
        <div>
            <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">{setting.label || settingKey}</label>
            {setting.description && <div className="mb-[0.35rem] text-[0.78rem] text-muted">{setting.description}</div>}
            {type === "weekdays" && <WeekdaysControl value={setting.value} editMode={editMode} onChange={onChange} />}
            {type === "component_qty_list" && (
                <ComponentQtyControl value={setting.value} editMode={editMode} onChange={onChange} components={components} />
            )}
            {type === "product_picker" && <PickerControl value={setting.value} editMode={editMode} onChange={onChange} options={products} />}
            {type === "component_picker" && <PickerControl value={setting.value} editMode={editMode} onChange={onChange} options={components} />}
            {type === "product_multi_picker" && <MultiControl value={setting.value} editMode={editMode} onChange={onChange} options={products} />}
            {type === "stock_category_multi_picker" && (
                <MultiControl value={setting.value} editMode={editMode} onChange={onChange} options={stockCategories} />
            )}
            {type === "number" && (
                <input
                    type="number"
                    step="any"
                    className="w-full"
                    value={editMode ? (pendingValue ?? "") : setting.value}
                    disabled={!editMode}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
}

function PickerControl({ value, editMode, onChange, options }) {
    return (
        <select className="w-full" defaultValue={value} disabled={!editMode} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
                <option key={o.id} value={o.id}>
                    {o.name} ({o.id})
                </option>
            ))}
        </select>
    );
}

function WeekdaysControl({ value, editMode, onChange }) {
    const [state, setState] = useState(() => new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean)));

    function toggle(day) {
        const next = new Set(state);
        if (next.has(day)) next.delete(day);
        else next.add(day);
        setState(next);
        onChange(WEEKDAY_ORDER.filter((d) => next.has(d)).join(","));
    }

    return (
        <div className="flex max-h-[9rem] flex-wrap gap-x-[0.8rem] gap-y-[0.15rem] overflow-y-auto rounded-lg border border-line px-[0.7rem] py-2">
            {WEEKDAY_ORDER.map((day) => (
                <label key={day} className="flex items-center gap-[0.3rem] whitespace-nowrap text-[0.85rem] font-normal">
                    <input type="checkbox" checked={state.has(day)} disabled={!editMode} onChange={() => toggle(day)} />
                    {day.slice(0, 3)}
                </label>
            ))}
        </div>
    );
}

function MultiControl({ value, editMode, onChange, options }) {
    const [selected, setSelected] = useState(() => new Set(String(value || "").split(",").map((s) => s.trim()).filter(Boolean)));

    function toggle(id) {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
        onChange(Array.from(next).join(","));
    }

    return (
        <div className="flex max-h-[9rem] flex-wrap gap-x-[0.8rem] gap-y-[0.15rem] overflow-y-auto rounded-lg border border-line px-[0.7rem] py-2">
            {options.map((o) => (
                <label key={o.id} className="flex items-center gap-[0.3rem] whitespace-nowrap text-[0.85rem] font-normal">
                    <input type="checkbox" checked={selected.has(o.id)} disabled={!editMode} onChange={() => toggle(o.id)} />
                    {o.name}
                </label>
            ))}
        </div>
    );
}

function ComponentQtyControl({ value, editMode, onChange, components }) {
    const [items, setItems] = useState(() => parseSamplingValue(value));

    function emit(next) {
        setItems(next);
        onChange(JSON.stringify(next.filter((it) => it.componentId).map((it) => ({ componentId: it.componentId, qty: Number(it.qty) || 0 }))));
    }

    function componentName(id) {
        const c = components.find((c) => c.id === id);
        return c ? c.name : "";
    }

    return (
        <div className="rounded-lg border border-line px-[0.7rem] py-[0.6rem]">
            {items.map((item, idx) => (
                <div key={idx} className="mb-[0.4rem] flex items-center gap-[0.4rem]">
                    <input
                        type="number"
                        min="0"
                        className="w-16 flex-none"
                        value={item.qty}
                        disabled={!editMode}
                        onChange={(e) => {
                            const next = items.slice();
                            next[idx] = { ...next[idx], qty: e.target.value };
                            emit(next);
                        }}
                    />
                    <span>x</span>
                    {editMode ? (
                        <SearchPick
                            value={componentName(item.componentId)}
                            placeholder="Search components…"
                            getItems={(q) => components.filter((c) => c.name.toLowerCase().includes(q)).map((c) => ({ id: c.id, label: c.name }))}
                            onSelect={(picked) => {
                                const next = items.slice();
                                next[idx] = { ...next[idx], componentId: picked.id };
                                emit(next);
                            }}
                        />
                    ) : (
                        <div className="min-w-0 flex-1 text-[0.9rem] text-muted">{componentName(item.componentId) || "(none chosen)"}</div>
                    )}
                    <button
                        type="button"
                        disabled={!editMode}
                        className="flex-none border-none bg-transparent px-[0.4rem] py-[0.2rem] text-[0.9rem] text-muted disabled:opacity-30"
                        onClick={() => emit(items.filter((_, i) => i !== idx))}
                    >
                        ✕
                    </button>
                </div>
            ))}
            <button
                type="button"
                disabled={!editMode}
                className="rounded-full border border-line bg-card px-[0.9rem] py-[0.4rem] text-[0.85rem] font-semibold text-muted disabled:opacity-50"
                onClick={() => emit([...items, { componentId: "", qty: 1 }])}
            >
                + Add line
            </button>
        </div>
    );
}
