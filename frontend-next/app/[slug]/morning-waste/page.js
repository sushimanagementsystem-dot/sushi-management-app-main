"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Send, ShieldCheck } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

export default function MorningWastePage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [counts, setCounts] = useState({});
    const [invalidIds, setInvalidIds] = useState(new Set());
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_morning_waste", token && { token }, { enabled: !!token });

    // Seed the qty inputs once from today's existing submission, if any —
    // same one-time-derivation pattern as Fridge Count (not something React
    // Query's cache should re-run on every refetch).
    useEffect(() => {
        if (!boot || !boot.ok) return;
        setCounts((prev) => {
            if (Object.keys(prev).length) return prev;
            const init = {};
            boot.products.forEach((p) => {
                if (boot.existingCounts[p.id] !== undefined) init[p.id] = String(boot.existingCounts[p.id]);
            });
            return init;
        });
    }, [boot]);

    const byCat = useMemo(() => {
        const m = {};
        (boot?.products || []).forEach((p) => {
            m[p.cat] = m[p.cat] || [];
            m[p.cat].push(p);
        });
        Object.values(m).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
        return m;
    }, [boot]);

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

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);
    const resubmitBanner = boot?.alreadySubmitted && !boot?.wasNoWaste;

    const hasContent = Object.values(counts).some((v) => (v ?? "").trim() !== "");

    function submitWaste(noWaste) {
        setFormError("");
        if (noWaste) {
            if (!window.confirm("Confirm: no expired products were removed today?")) return;
            submitMutation.mutate({
                token: token,
                formType: "MORNING_WASTE",
                payload: { business_date: boot.businessDate, no_waste: true, lines: [] },
            });
            return;
        }

        const invalid = new Set();
        const payloadLines = [];
        (boot?.products || []).forEach((p) => {
            const v = (counts[p.id] ?? "").trim();
            if (v === "") return;
            const qty = Number(v);
            if (!Number.isInteger(qty) || qty < 1) invalid.add(p.id);
            else payloadLines.push({ product_id: p.id, qty });
        });
        setInvalidIds(invalid);
        if (invalid.size) return setFormError("Some quantities are not valid whole numbers (at least 1).");
        if (!payloadLines.length) return setFormError("Add at least one product, or use No waste today.");

        submitMutation.mutate({
            token: token,
            formType: "MORNING_WASTE",
            payload: { business_date: boot.businessDate, no_waste: false, lines: payloadLines },
        });
    }

    return (
        <>
            <PageTitle title="Morning Waste" />
            <KioskTopbar icon="🗑️" title="Morning Waste" menuHref={menuHref} />
            {/* Same all-items-listed grid as Morning Fridge Count — staff only
                enter a quantity for products that were actually wasted/out of
                date, leaving everything else blank, instead of searching for
                and adding one line per product. */}
            <Wrap className="sm:max-w-2xl md:max-w-4xl lg:max-w-5xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {resubmitBanner && (
                            <ResubmitBanner>
                                Today already has a submission. Your earlier quantities are loaded
                                below — edit and resubmit; this <b>replaces</b> today&apos;s record.
                            </ResubmitBanner>
                        )}
                        <FormNote>
                            Log only out of date products. Leave everything else blank — enter a
                            quantity only for products that were actually wasted/out of date today.
                        </FormNote>

                        <div>
                            {Object.keys(byCat)
                                .sort()
                                .map((cat) => (
                                    <div key={cat}>
                                        <div className="mb-[0.4rem] mt-[1.2rem] text-xs font-bold uppercase tracking-[0.1em] text-muted">
                                            {cat}
                                        </div>
                                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                            {byCat[cat].map((p) => (
                                                <div
                                                    key={p.id}
                                                    className={
                                                        "flex items-center gap-2 rounded border bg-card px-[0.7rem] py-[0.55rem] " +
                                                        (invalidIds.has(p.id) ? "border-danger-border" : "border-line")
                                                    }
                                                >
                                                    <span className="min-w-0 flex-1 text-[0.95rem]">{p.name}</span>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        step="1"
                                                        inputMode="numeric"
                                                        placeholder="0"
                                                        className="w-[4.2rem] flex-none rounded-lg text-center"
                                                        value={counts[p.id] ?? ""}
                                                        onChange={(e) =>
                                                            setCounts((prev) => ({ ...prev, [p.id]: e.target.value }))
                                                        }
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                        </div>

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} />}
            </Wrap>

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
