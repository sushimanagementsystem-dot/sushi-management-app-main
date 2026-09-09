"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import SearchPick from "@/components/SearchPick";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import PhotoBox from "@/components/kiosk/PhotoBox";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function DamagedProductPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [category, setCategory] = useState("");
    const [productId, setProductId] = useState("");
    const [productName, setProductName] = useState("");
    const [qty, setQty] = useState("1");
    const [photo, setPhoto] = useState(null);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());
    const qtyRef = useRef(null);

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_damaged_product", token && { token }, { enabled: !!token });

    const categories = useMemo(
        () => [...new Set((boot?.products || []).map((p) => p.cat))].sort(),
        [boot],
    );

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Damage recorded.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    function submitDamage() {
        setFormError("");
        if (!productId) return setFormError("Select the product.");
        const q = Number(qty);
        if (!Number.isInteger(q) || q < 1) return setFormError("Quantity must be a whole number, at least 1.");
        if (!photo) return setFormError("A photo is required.");

        submitMutation.mutate({
            token: token,
            formType: "DAMAGED_PRODUCT",
            payload: {
                client_key: clientKey.current,
                business_date: boot.businessDate,
                product_id: productId,
                qty: q,
                photo: photo,
            },
        });
    }

    function logAnother() {
        window.location.reload();
    }

    return (
        <>
            <PageTitle title="Damaged Product" />
            <KioskTopbar icon="📸" title="Damaged Product" menuHref={menuHref} />
            <Wrap>
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>
                            For finished products accidentally made unsellable — not expired
                            stock, that&apos;s Morning Waste. A photo is required.
                        </FormNote>

                        {!loading && (
                            <div>
                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">Category</label>
                                <select
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
                                                qtyRef.current?.focus();
                                            }}
                                        />
                                    ) : (
                                        <input type="text" disabled placeholder="Select category first…" className="w-full" />
                                    )}
                                </div>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">Quantity</label>
                                <input
                                    ref={qtyRef}
                                    type="number"
                                    min="1"
                                    step="1"
                                    inputMode="numeric"
                                    className="mb-[0.7rem] w-full"
                                    value={qty}
                                    onChange={(e) => setQty(e.target.value)}
                                />

                                <PhotoBox value={photo} onChange={setPhoto} />
                            </div>
                        )}

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} onLogAnother={logAnother} />}
            </Wrap>

            {!loading && !success && (
                <StickyActionBar>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0 sm:mx-auto sm:max-w-sm"
                        onClick={submitDamage}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
