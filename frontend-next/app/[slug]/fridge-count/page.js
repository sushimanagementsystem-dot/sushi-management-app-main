"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

export default function FridgeCountPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [counts, setCounts] = useState({});
    const [carryover, setCarryover] = useState("0");
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
    } = useBootstrap("bootstrap_fridge_count", token && { token }, { enabled: !!token });

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
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Count saved — the production plan email will arrive in a minute.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    const total = boot?.products?.length || 0;
    const filled = (boot?.products || []).filter((p) => (counts[p.id] ?? "").trim() !== "").length;

    function submitCounts() {
        setFormError("");
        const finalCounts = {};
        const invalid = new Set();
        (boot?.products || []).forEach((p) => {
            const v = (counts[p.id] ?? "").trim();
            if (v === "") {
                finalCounts[p.id] = 0;
                return;
            }
            const q = Number(v);
            if (!Number.isInteger(q) || q < 0) invalid.add(p.id);
            else finalCounts[p.id] = q;
        });
        setInvalidIds(invalid);
        if (invalid.size) {
            return setFormError("Some counts are not valid whole numbers.");
        }
        submitMutation.mutate({
            token: token,
            formType: "FRIDGE_COUNT",
            payload: {
                business_date: boot.businessDate,
                counts: finalCounts,
                plainRiceCarryoverGrams: Number(carryover) || 0,
            },
        });
    }

    return (
        <>
            <PageTitle title="Morning Fridge Count" />
            <KioskTopbar icon="🧊" title="Morning Fridge Count" menuHref={menuHref} />
            {/* Widened + gridded on larger screens — this list used to be
                every fridge product stacked one per row, which on a long
                product catalogue meant an enormous amount of scrolling on
                anything but a phone (the same shape of problem behind V1's
                multi-hour stocktake pain). A laptop/tablet can show several
                products per row instead. */}
            <Wrap className="sm:max-w-2xl md:max-w-4xl lg:max-w-5xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {boot?.alreadySubmitted && (
                            <ResubmitBanner>
                                Today already has a count. Your earlier numbers are loaded — edit
                                and resubmit; this <b>replaces</b> today&apos;s count and re-sends
                                the production plan.
                            </ResubmitBanner>
                        )}
                        <FormNote>
                            Submit all products in the customer display fridge AFTER out of date
                            and any damaged products are logged.
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
                                                        min="0"
                                                        step="1"
                                                        inputMode="numeric"
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

                        <div className="mb-[0.4rem] mt-[1.2rem] text-xs font-bold uppercase tracking-[0.1em] text-muted">
                            Plain Rice
                        </div>
                        <div className="mb-[0.4rem] flex items-center gap-2 rounded border border-line bg-card px-[0.7rem] py-[0.55rem] sm:max-w-sm">
                            <span className="min-w-0 flex-1 text-[0.95rem]">
                                Plain rice left over from yesterday (grams)
                            </span>
                            <input
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                className="w-[4.2rem] flex-none rounded-lg text-center"
                                value={carryover}
                                onChange={(e) => setCarryover(e.target.value)}
                            />
                        </div>

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} />}
            </Wrap>

            {!loading && !success && (
                <StickyActionBar filled={filled} total={total}>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 rounded border border-accent bg-accent p-[0.8rem] text-base font-bold text-accent-ink sm:mx-auto sm:max-w-sm"
                        onClick={submitCounts}
                    >
                        <Send size={16} strokeWidth={2.2} />
                        Submit count
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
