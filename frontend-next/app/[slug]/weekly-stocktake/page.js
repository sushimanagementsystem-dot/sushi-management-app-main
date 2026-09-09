"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { confirmModal } from "@/components/ConfirmModal";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

export default function WeeklyStocktakePage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [counts, setCounts] = useState({});
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
    } = useBootstrap("bootstrap_stocktake", token && { token }, { enabled: !!token });

    useEffect(() => {
        if (!boot || !boot.ok) return;
        setCounts((prev) => {
            if (Object.keys(prev).length) return prev;
            const init = {};
            boot.items.forEach((p) => {
                if (boot.existingCounts[p.id] !== undefined) init[p.id] = String(boot.existingCounts[p.id]);
            });
            return init;
        });
    }, [boot]);

    const byCat = useMemo(() => {
        const m = {};
        (boot?.items || []).forEach((p) => {
            m[p.cat] = m[p.cat] || [];
            m[p.cat].push(p);
        });
        Object.values(m).forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));
        return m;
    }, [boot]);

    const total = boot?.items?.length || 0;
    const filled = (boot?.items || []).filter((p) => (counts[p.id] ?? "").trim() !== "").length;

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Stocktake saved.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    async function submitCounts() {
        setFormError("");
        const go = await confirmModal("Submit this stocktake?", "Submit");
        if (!go) return;

        const finalCounts = {};
        (boot?.items || []).forEach((p) => {
            const v = (counts[p.id] ?? "").trim();
            const q = Number(v);
            finalCounts[p.id] = Number.isFinite(q) && q >= 0 ? q : 0;
        });
        submitMutation.mutate({
            token: token,
            formType: "WEEKLY_STOCKTAKE",
            payload: { business_date: boot.businessDate, counts: finalCounts },
        });
    }

    return (
        <>
            <PageTitle title="Weekly Stocktake" />
            <KioskTopbar icon="📋" title="Weekly Stocktake" menuHref={menuHref} />
            {/* Widened + gridded on larger screens — every stock item used
                to be one stacked row regardless of screen size, which for
                the full catalogue is the same shape of problem behind V1's
                multi-hour stocktake pain. A laptop/tablet can show several
                items per row instead, so the whole count fits in far less
                scrolling. */}
            <Wrap className="sm:max-w-2xl md:max-w-4xl lg:max-w-5xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {boot?.alreadySubmitted && (
                            <ResubmitBanner>
                                Today already has a stocktake. Your earlier numbers are loaded —
                                edit and resubmit; this <b>replaces</b> today&apos;s stocktake
                                completely.
                            </ResubmitBanner>
                        )}
                        <FormNote>Decimals are fine for weight units.</FormNote>

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
                                                    className="flex items-center gap-2 rounded border border-line bg-card px-[0.7rem] py-[0.55rem]"
                                                >
                                                    <span className="min-w-0 flex-1 text-[0.95rem]">{p.name}</span>
                                                    <span className="flex-none text-[0.8rem] text-muted">{p.unit}</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="any"
                                                        inputMode="decimal"
                                                        className="w-[4.6rem] flex-none rounded-lg text-center"
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
                <StickyActionBar filled={filled} total={total}>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 rounded border border-accent bg-accent p-[0.8rem] text-base font-bold text-accent-ink sm:mx-auto sm:max-w-sm"
                        onClick={submitCounts}
                    >
                        <Send size={16} strokeWidth={2.2} />
                        Submit stocktake
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
