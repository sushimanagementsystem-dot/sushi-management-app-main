/**
 * Settings.js — owner-facing editor for the `setting` table (spec M-13:
 * "Central owner-editable constants... Code reads these, never
 * hardcodes."). Bootstraps the raw setting rows plus the reference lists
 * (components, products, stock categories) a few settings need for a real
 * picker instead of a plain text cell — e.g. SAMPLING_SUSHI (component +
 * qty list), KARAAGE_BALANCING_PRODUCT / RICE_BOWL_SUBSTITUTES (product
 * references), FOOD_WASTE_FOOD_CATEGORIES / FOOD_WASTE_PACKAGING_CATEGORIES
 * (stock_category references). The section/field layout itself lives in
 * frontend/pages/dashboard/settings.html as a hand-built (not
 * schema-driven) page — see that file's header comment for why.
 */

function bootstrapSettingsPage() {
    const settings = getRows(TABLES.SETTING).map((s) => ({
        key: s.setting_key,
        value: s.value,
        description: s.description,
        label: s.label,
    }));
    const components = getRows(TABLES.COMPONENT, (c) => c.active === true)
        .map((c) => ({ id: c.component_id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const products = getRows(TABLES.PRODUCT, (p) => p.active === true)
        .map((p) => ({ id: p.product_id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    const stockCategories = getEnumOptions("stock_category").map((o) => ({
        id: o.value,
        name: o.label,
    }));

    return {
        ok: true,
        settings: settings,
        components: components,
        products: products,
        stockCategories: stockCategories,
    };
}

/** changes: {setting_key: newValue, ...}. Writes every key present —
 * settings.html always sends the full current set on Save (see its own
 * "seed every control's pending value on build" comment), so there's no
 * need to diff against the stored value here. */
function saveSettings(changes) {
    return withLock(() => {
        Object.keys(changes || {}).forEach((key) => {
            updateRow_(TABLES.SETTING, ["setting_key"], { setting_key: key, value: String(changes[key]) });
        });
        return { ok: true };
    });
}
