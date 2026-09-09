"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import SearchPick from "@/components/SearchPick";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FieldLabel, LineCard } from "@/components/kiosk/LineCard";
import { FormActions, FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

let lineSeq = 0;
const newLine = () => ({ key: ++lineSeq, category: "", name: "", grams: "" });

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function FoodWastePage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [lines, setLines] = useState([newLine()]);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());
    const gramsRefs = useRef({});

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_food_waste", token && { token }, { enabled: !!token });

    const byName = useMemo(() => {
        const m = {};
        (boot?.items || []).forEach((p) => (m[p.name] = p.id));
        return m;
    }, [boot]);

    const categories = useMemo(
        () => [...new Set((boot?.items || []).map((p) => p.cat))].sort(),
        [boot],
    );

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Food waste recorded.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    const addLine = () => setLines((prev) => [...prev, newLine()]);
    const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
    const updateLine = (key, patch) =>
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    function submitWaste() {
        setFormError("");
        const payloadLines = [];
        for (const l of lines) {
            if (!l.name.trim() && !l.grams) continue;
            const id = byName[l.name.trim()];
            if (!id) return setFormError(`Unknown item: "${l.name}". Pick from the list.`);
            const grams = Number(l.grams);
            if (!Number.isFinite(grams) || grams <= 0)
                return setFormError(`${l.name}: weight must be a number greater than 0 grams.`);
            payloadLines.push({ stock_item_id: id, grams: grams });
        }
        if (!payloadLines.length) return setFormError("Add at least one item.");

        submitMutation.mutate({
            token: token,
            formType: "FOOD_WASTE",
            payload: { client_key: clientKey.current, business_date: boot.businessDate, lines: payloadLines },
        });
    }

    return (
        <>
            <PageTitle title="Food Waste" />
            <KioskTopbar icon="⚖️" title="Food Waste" menuHref={menuHref} />
            <Wrap className="sm:max-w-2xl md:max-w-3xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>
                            Ingredients or prepared food placed in the bin, weighed in grams. Not
                            for expired finished products — use Morning Waste.
                        </FormNote>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {lines.map((l) => (
                                <LineCard key={l.key} onRemove={() => removeLine(l.key)}>
                                    <div className="w-[6.5rem] flex-none">
                                        <FieldLabel>Category</FieldLabel>
                                        <select
                                            value={l.category}
                                            onChange={(e) => updateLine(l.key, { category: e.target.value, name: "" })}
                                        >
                                            <option value="">All</option>
                                            {categories.map((c) => (
                                                <option key={c} value={c}>
                                                    {c}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <FieldLabel>Item</FieldLabel>
                                        <SearchPick
                                            value={l.name}
                                            placeholder="Search item…"
                                            getItems={(q) => {
                                                const taken = new Set(
                                                    lines.filter((o) => o.key !== l.key).map((o) => o.name.trim()).filter((v) => byName[v]),
                                                );
                                                return (boot?.items || [])
                                                    .filter(
                                                        (p) =>
                                                            !taken.has(p.name) &&
                                                            (!l.category || p.cat === l.category) &&
                                                            (!q || p.name.toLowerCase().includes(q)),
                                                    )
                                                    .sort((a, b) => a.name.localeCompare(b.name))
                                                    .map((p) => ({ id: p.id, label: p.name }));
                                            }}
                                            onSelect={(it) => {
                                                updateLine(l.key, { name: it.label });
                                                gramsRefs.current[l.key]?.focus();
                                            }}
                                        />
                                    </div>
                                    <div className="w-20 flex-none">
                                        <FieldLabel>Grams</FieldLabel>
                                        <input
                                            type="number"
                                            min="1"
                                            step="any"
                                            inputMode="decimal"
                                            placeholder="0"
                                            value={l.grams}
                                            ref={(el) => (gramsRefs.current[l.key] = el)}
                                            onChange={(e) => updateLine(l.key, { grams: e.target.value })}
                                        />
                                    </div>
                                </LineCard>
                            ))}
                        </div>

                        {!loading && (
                            <FormActions>
                                <button
                                    className="mt-[0.6rem] flex w-full items-center justify-center gap-1.5 font-bold transition-colors duration-150 hover:border-accent/40 hover:text-accent sm:mx-auto sm:max-w-sm"
                                    onClick={addLine}
                                >
                                    <Plus size={16} strokeWidth={2.4} />
                                    Add item
                                </button>
                            </FormActions>
                        )}
                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} />}
            </Wrap>

            {!loading && !success && (
                <StickyActionBar>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0 sm:mx-auto sm:max-w-sm"
                        onClick={submitWaste}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
