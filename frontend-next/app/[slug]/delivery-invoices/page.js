"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, readFileForUpload, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function DeliveryInvoicesPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [supplierId, setSupplierId] = useState("");
    const [docType, setDocType] = useState("");
    const [asExpected, setAsExpected] = useState(false);
    const [invNum, setInvNum] = useState("");
    const [note, setNote] = useState("");
    const [files, setFiles] = useState([]);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());
    const fileInputRef = useRef(null);

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_delivery_invoice", token && { token }, { enabled: !!token });

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Delivery document submitted for review.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    function onFileChosen(e) {
        const file = e.target.files[0];
        if (!file) return;
        readFileForUpload(file).then((data) => {
            setFiles((prev) => [
                ...prev,
                { ...data, previewUrl: "data:" + data.mimeType + ";base64," + data.base64 },
            ]);
        });
        e.target.value = "";
    }

    function removeFile(i) {
        setFiles((prev) => prev.filter((_, idx) => idx !== i));
    }

    function submitDelivery() {
        setFormError("");
        if (!supplierId) return setFormError("Select the supplier.");
        if (!docType) return setFormError("Select the document type.");
        if (!files.length) return setFormError("Add at least one page/photo.");

        submitMutation.mutate({
            token: token,
            formType: "DELIVERY_INVOICE",
            payload: {
                client_key: clientKey.current,
                business_date: boot.businessDate,
                supplier_id: supplierId,
                document_type: docType,
                as_expected: asExpected,
                staff_invoice_number: invNum,
                delivery_note: note,
                files: files.map((f) => ({ base64: f.base64, mimeType: f.mimeType, name: f.name })),
            },
        });
    }

    function logAnother() {
        window.location.reload();
    }

    const suppliers = (boot?.suppliers || []).slice().sort((a, b) => a.name.localeCompare(b.name));

    return (
        <>
            <PageTitle title="Delivery Invoices" />
            <KioskTopbar icon="📄" title="Delivery Invoices" menuHref={menuHref} />
            <Wrap>
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>
                            One response per supplier document — if it&apos;s several pages (e.g.
                            a multi-page invoice), add all the pages here together.
                        </FormNote>

                        {!loading && (
                            <div>
                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">Supplier</label>
                                <select
                                    className="mb-[0.7rem] w-full"
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                >
                                    <option value="">Select supplier…</option>
                                    {suppliers.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Document type
                                </label>
                                <select
                                    className="mb-[0.7rem] w-full"
                                    value={docType}
                                    onChange={(e) => setDocType(e.target.value)}
                                >
                                    <option value="">Select type…</option>
                                    {(boot?.documentTypes || []).map((t) => (
                                        <option key={t.value} value={t.value}>
                                            {t.label}
                                        </option>
                                    ))}
                                </select>

                                <div className="mb-[0.9rem] flex items-center gap-2 text-[0.95rem]">
                                    <input
                                        id="asExpected"
                                        type="checkbox"
                                        className="h-[1.2rem] w-[1.2rem]"
                                        checked={asExpected}
                                        onChange={(e) => setAsExpected(e.target.checked)}
                                    />
                                    <label htmlFor="asExpected" className="m-0">
                                        Delivery matched what was ordered
                                    </label>
                                </div>

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Invoice number (optional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="As printed on the document"
                                    className="mb-[0.7rem] w-full"
                                    value={invNum}
                                    onChange={(e) => setInvNum(e.target.value)}
                                />

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Note (optional)
                                </label>
                                <input
                                    type="text"
                                    placeholder="Anything else to add"
                                    className="mb-[0.7rem] w-full"
                                    value={note}
                                    onChange={(e) => setNote(e.target.value)}
                                />

                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                    Pages / photos
                                </label>
                                <div className="mb-[0.7rem] flex flex-wrap gap-2">
                                    {files.map((f, i) => {
                                        const isImage = (f.mimeType || "").startsWith("image/");
                                        return (
                                            <div key={i} className="relative h-20 w-20">
                                                {isImage ? (
                                                    <img
                                                        src={f.previewUrl}
                                                        alt=""
                                                        className="h-full w-full rounded-lg border border-line object-cover"
                                                    />
                                                ) : (
                                                    <div className="h-full w-full rounded-lg border border-line bg-line" />
                                                )}
                                                <span className="absolute bottom-0.5 left-0.5 rounded-md bg-black/60 px-[5px] py-px text-[0.65rem] text-white">
                                                    {i + 1}
                                                </span>
                                                <button
                                                    onClick={() => removeFile(i)}
                                                    className="absolute -right-1.5 -top-1.5 h-[1.4rem] w-[1.4rem] rounded-full border-none bg-ink text-[0.8rem] leading-none text-white"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div
                                    onClick={() => fileInputRef.current?.click()}
                                    className="mb-[0.7rem] cursor-pointer rounded-card border-2 border-dashed border-line bg-panel/40 p-[1.2rem] text-center text-[0.9rem] text-muted transition-colors duration-150 hover:border-accent/50 hover:bg-accent-soft/40"
                                >
                                    Tap to add a page photo
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,application/pdf"
                                    capture="environment"
                                    className="hidden"
                                    onChange={onFileChosen}
                                />
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
                        onClick={submitDelivery}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
