"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Plus, Send, ShieldCheck } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import SearchPick from "@/components/SearchPick";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FieldLabel, LineCard } from "@/components/kiosk/LineCard";
import { FormActions, FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

let lineSeq = 0;
const newLine = (name, qty) => ({ key: ++lineSeq, category: "", name: name || "", qty: qty ?? "" });

export default function MorningWastePage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [lines, setLines] = useState([]);
    const [seeded, setSeeded] = useState(false);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const qtyRefs = useRef({});

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_morning_waste", token && { token }, { enabled: !!token });

    // Seed the editable `lines` state once from the loaded bootstrap data
    // (existing today's submission if any, otherwise one blank line) — a
    // one-time derivation, not something React Query's cache should own.
    useEffect(() => {
        if (!boot || !boot.ok || seeded) return;
        if (boot.alreadySubmitted && !boot.wasNoWaste) {
            setLines(
                boot.existingLines.map((ln) => {
                    const p = boot.products.find((p) => p.id === ln.product_id);
                    return newLine(p ? p.name : ln.product_id, ln.qty);
                }),
            );
        } else {
            setLines([newLine()]);
        }
        setSeeded(true);
    }, [boot, seeded]);

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res, variables) => {
            if (res.ok) {
                setSuccess(variables.payload.no_waste ? "No-waste recorded for today." : "Waste recorded.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const byName = useMemo(() => {
        const m = {};
        (boot?.products || []).forEach((p) => (m[p.name] = p.id));
        return m;
    }, [boot]);

    const categories = useMemo(
        () => [...new Set((boot?.products || []).map((p) => p.cat))].sort(),
        [boot],
    );

    const resubmitBanner = boot?.alreadySubmitted && !boot?.wasNoWaste;
    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    const addLine = () => setLines((prev) => [...prev, newLine()]);
    const removeLine = (key) => setLines((prev) => prev.filter((l) => l.key !== key));
    const updateLine = (key, patch) =>
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

    const hasContent = lines.some((l) => l.name.trim() !== "" || String(l.qty).trim() !== "");

    function submitWaste(noWaste) {
        setFormError("");
        const payloadLines = [];
        if (!noWaste) {
            for (const l of lines) {
                if (!l.name.trim() && !l.qty) continue;
                const id = byName[l.name.trim()];
                if (!id) return setFormError(`Unknown product: "${l.name}". Pick from the list.`);
                const qty = Number(l.qty);
                if (!Number.isInteger(qty) || qty < 1)
                    return setFormError(`${l.name}: quantity must be a whole number, at least 1.`);
                payloadLines.push({ product_id: id, qty: qty });
            }
            if (!payloadLines.length)
                return setFormError("Add at least one product, or use No waste today.");
        } else if (!window.confirm("Confirm: no expired products were removed today?")) {
            return;
        }

        submitMutation.mutate({
            token: token,
            formType: "MORNING_WASTE",
            payload: { business_date: boot.businessDate, no_waste: noWaste, lines: payloadLines },
        });
    }

    return (
        <>
            <PageTitle title="Morning Waste" />
            <KioskTopbar icon="🗑️" title="Morning Waste" menuHref={menuHref} />
            {/* Wider than Wrap's default 30rem on larger screens — a single
                narrow column of stacked lines makes sense on a phone, but
                on a laptop it just wastes the width; letting the lines grid
                up into columns there means more of the form is visible and
                fillable at once. */}
            <Wrap className="sm:max-w-2xl md:max-w-3xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {resubmitBanner && (
                            <ResubmitBanner>
                                Today already has a submission. Your earlier lines are loaded
                                below — edit and resubmit; this <b>replaces</b> today&apos;s record.
                            </ResubmitBanner>
                        )}
                        <FormNote>
                            Log only out of date products here. Make sure to include the correct
                            product and quantity.
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
                                        <FieldLabel>Product</FieldLabel>
                                        <SearchPick
                                            value={l.name}
                                            placeholder="Search product…"
                                            getItems={(q) => {
                                                const taken = new Set(
                                                    lines.filter((o) => o.key !== l.key).map((o) => o.name.trim()).filter((v) => byName[v]),
                                                );
                                                return (boot?.products || [])
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
                                                // Category here is just a search filter, never
                                                // submitted (payloadLines only carries product_id/
                                                // qty — the dashboard derives category from the
                                                // product record itself) — but staff were leaving
                                                // it on "All" since picking a product doesn't
                                                // require touching it first, which reads as if the
                                                // category wasn't recorded. Snapping it to the
                                                // picked product's own category removes that
                                                // confusion without changing what's stored.
                                                const picked = (boot?.products || []).find((p) => p.id === it.id);
                                                updateLine(l.key, { name: it.label, category: picked?.cat ?? l.category });
                                                qtyRefs.current[l.key]?.focus();
                                            }}
                                        />
                                    </div>
                                    <div className="w-[4.2rem] flex-none">
                                        <FieldLabel>Qty</FieldLabel>
                                        <input
                                            type="number"
                                            min="1"
                                            step="1"
                                            placeholder="0"
                                            value={l.qty}
                                            ref={(el) => (qtyRefs.current[l.key] = el)}
                                            onChange={(e) => updateLine(l.key, { qty: e.target.value })}
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
                                    Add product
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

            {/* Only the primary submit action lives in the sticky bar —
                "Add product" is used repeatedly while composing lines, so it
                stays inline; the sticky bar is for the action you need
                reachable no matter how far down the line list you've
                scrolled. No progress prop here (unlike Fridge Count/
                Stocktake) — lines are freely added/removed, there's no
                fixed "total" to track completion against. */}
            {!loading && !success && (
                <StickyActionBar>
                    <div className="sm:mx-auto sm:max-w-sm">
                        <button
                            className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
                            onClick={() => submitWaste(false)}
                        >
                            <Send size={15} strokeWidth={2.2} />
                            Submit waste
                        </button>
                        {!hasContent && (
                            <button
                                className="mt-[0.5rem] flex w-full items-center justify-center gap-1.5 border-ink bg-ink font-bold text-white transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
                                onClick={() => submitWaste(true)}
                            >
                                <ShieldCheck size={15} strokeWidth={2.2} />
                                No waste today
                            </button>
                        )}
                    </div>
                </StickyActionBar>
            )}
        </>
    );
}
