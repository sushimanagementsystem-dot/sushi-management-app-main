"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import SearchPick from "@/components/SearchPick";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import { FormActions, FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

export default function StaffFoodPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [category, setCategory] = useState("");
    const [productId, setProductId] = useState("");
    const [productName, setProductName] = useState("");
    const [seeded, setSeeded] = useState(false);
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
    } = useBootstrap("bootstrap_staff_food", token && { token }, { enabled: !!token });

    useEffect(() => {
        if (!boot || !boot.ok || seeded) return;
        if (boot.existing) {
            const p = boot.products.find((x) => x.id === boot.existing.product_id);
            if (p) {
                setCategory(p.cat);
                setProductId(p.id);
                setProductName(p.name);
            }
        }
        setSeeded(true);
    }, [boot, seeded]);

    const categories = useMemo(
        () => [...new Set((boot?.products || []).map((p) => p.cat))].sort(),
        [boot],
    );

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Staff food recorded.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    function submitFood() {
        setFormError("");
        if (!productId) return setFormError("Select a product.");
        submitMutation.mutate({
            token: token,
            formType: "STAFF_FOOD",
            payload: { business_date: boot.businessDate, product_id: productId },
        });
    }

    return (
        <>
            <PageTitle title="Staff Food" />
            <KioskTopbar icon="🍱" title="Staff Food" menuHref={menuHref} />
            <Wrap>
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>Record your own authorised meal — one product per person per shift.</FormNote>

                        {boot?.existing && (
                            <ResubmitBanner>
                                You already logged food today — this <b>replaces</b> that entry.
                            </ResubmitBanner>
                        )}

                        {!loading && (
                            <div>
                                <label htmlFor="cat" className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Category
                                </label>
                                <select
                                    id="cat"
                                    className="mb-[0.7rem] w-full"
                                    value={category}
                                    onChange={(e) => {
                                        setCategory(e.target.value);
                                        setProductId("");
                                        setProductName("");
                                    }}
                                >
                                    <option value="">Select category…</option>
                                    {categories.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </select>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">Product</label>
                                <div className="mb-[0.7rem] w-full">
                                    {category ? (
                                        <SearchPick
                                            value={productName}
                                            placeholder="Search product…"
                                            getItems={(q) =>
                                                (boot?.products || [])
                                                    .filter(
                                                        (p) =>
                                                            p.cat === category &&
                                                            (!q || p.name.toLowerCase().includes(q)),
                                                    )
                                                    .sort((a, b) => a.name.localeCompare(b.name))
                                                    .map((p) => ({ id: p.id, label: p.name }))
                                            }
                                            onSelect={(it) => {
                                                setProductId(it.id);
                                                setProductName(it.label);
                                            }}
                                        />
                                    ) : (
                                        <input type="text" disabled placeholder="Select category first…" className="w-full" />
                                    )}
                                </div>
                            </div>
                        )}

                        {!loading && (
                            <FormActions>
                                <button
                                    className="mt-[0.6rem] flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
                                    onClick={submitFood}
                                >
                                    <Send size={15} strokeWidth={2.2} />
                                    Submit
                                </button>
                            </FormActions>
                        )}
                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} />}
            </Wrap>
        </>
    );
}
