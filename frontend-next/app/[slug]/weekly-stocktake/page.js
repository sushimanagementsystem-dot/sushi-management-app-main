"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { makeFormDraft } from "@/lib/kioskDraft";
import { confirmModal } from "@/components/ConfirmModal";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import KioskPageTransition from "@/components/kiosk/KioskPageTransition";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

// Counts used to live only in React state — a page reload, accidental back-navigation, or tab close
// halfway through a count wiped everything typed so far. Saved to the browser's own storage on every
// change and restored on load instead (see lib/kioskDraft), same fix as Monthly Audit; cleared only once
// the stocktake actually submits.
const draft = makeFormDraft("weekly_stocktake");

export default function WeeklyStocktakePage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [counts, setCounts] = useState({});
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const seeded = useRef(false);

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
        if (!boot || !boot.ok || seeded.current) return;
        seeded.current = true;
        (async () => {
            const saved = await draft.load(slug, boot.businessDate);
            if (saved?.counts) {
                setCounts(saved.counts);
                return;
            }
            const init = {};
            boot.items.forEach((p) => {
                if (boot.existingCounts[p.id] !== undefined) init[p.id] = String(boot.existingCounts[p.id]);
            });
            setCounts(init);
        })();
    }, [boot, slug]);

    // Every change (a count typed in) is persisted immediately — cheap, infrequent, user-driven writes,
    // not a hot loop, so no debouncing is needed.
    useEffect(() => {
        if (!seeded.current || !boot?.businessDate) return;
        draft.save(slug, boot.businessDate, { counts });
    }, [counts, slug, boot?.businessDate]);

    // Sections follow the stock_category list's own order (catOrder, from
    // the backend), items within a section follow the client's master
    // stock sheet row position (sortOrder) — not alphabetical. An item with
    // no sortOrder yet sinks to the end of its section, sorted by name.
    const FAR = 999999;
    const { byCat, catsInOrder } = useMemo(() => {
        const m = {};
        const catOrderByLabel = {};
        (boot?.items || []).forEach((p) => {
            m[p.cat] = m[p.cat] || [];
            m[p.cat].push(p);
            catOrderByLabel[p.cat] = p.catOrder ?? FAR;
        });
        Object.values(m).forEach((list) => list.sort((a, b) => (a.sortOrder ?? FAR) - (b.sortOrder ?? FAR) || a.name.localeCompare(b.name)));
        const cats = Object.keys(m).sort((a, b) => catOrderByLabel[a] - catOrderByLabel[b] || a.localeCompare(b));
        return { byCat: m, catsInOrder: cats };
    }, [boot]);

    const total = boot?.items?.length || 0;
    const filled = (boot?.items || []).filter((p) => (counts[p.id] ?? "").trim() !== "").length;

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Stocktake saved.");
                draft.clear(slug);
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
            <KioskPageTransition>
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
                            {catsInOrder.map((cat) => (
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
            </KioskPageTransition>

            {!loading && !success && (
                <StickyActionBar filled={filled} total={total}>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 rounded border border-accent bg-accent p-[0.8rem] text-base font-bold text-accent-ink sm:mx-auto sm:max-w-sm"
                        onClick={submitCounts}
                        disabled={submitMutation.isPending}
                    >
                        <Send size={16} strokeWidth={2.2} />
                        Submit stocktake
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
