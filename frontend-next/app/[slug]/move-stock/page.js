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
import PhotoBox from "@/components/kiosk/PhotoBox";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FieldLabel, LineCard } from "@/components/kiosk/LineCard";
import { FormActions, FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

let lineSeq = 0;
const newLine = () => ({ key: ++lineSeq, category: "", name: "", qty: "" });

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function MoveStockPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [source, setSource] = useState("");
    const [dest, setDest] = useState("");
    const [seededKiosks, setSeededKiosks] = useState(false);
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const [photo, setPhoto] = useState(null);
    const [lines, setLines] = useState([newLine()]);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());
    const qtyRefs = useRef({});

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_move_stock", token && { token }, { enabled: !!token });

    useEffect(() => {
        if (!boot || !boot.ok || seededKiosks) return;
        setSource(boot.thisKiosk.id);
        setSeededKiosks(true);
    }, [boot, seededKiosks]);

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
                setSuccess("Transfer request sent for owner approval.");
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

    function submitTransfer() {
        setFormError("");
        if (!source && !dest)
            return setFormError("Select at least one kiosk — where it's coming from, or going to.");

        const payloadLines = [];
        for (const l of lines) {
            if (!l.name.trim() && !l.qty) continue;
            const id = byName[l.name.trim()];
            if (!id) return setFormError(`Unknown item: "${l.name}". Pick from the list.`);
            const qty = Number(l.qty);
            if (!Number.isFinite(qty) || qty <= 0)
                return setFormError(`${l.name}: quantity must be a number greater than 0.`);
            payloadLines.push({ stock_item_id: id, qty: qty });
        }
        if (!payloadLines.length) return setFormError("Add at least one item.");
        if (!photo) return setFormError("A photo is required.");

        submitMutation.mutate({
            token: token,
            formType: "MOVE_STOCK",
            payload: {
                client_key: clientKey.current,
                business_date: boot.businessDate,
                source_kiosk_id: source,
                destination_kiosk_id: dest,
                reason: reason,
                note: note,
                lines: payloadLines,
                photo: photo,
            },
        });
    }

    function logAnother() {
        window.location.reload();
    }

    const kiosksFor = (excludeId) => (boot?.kiosks || []).filter((k) => k.id !== excludeId);

    return (
        <>
            <PageTitle title="Move Stock" />
            <KioskTopbar icon="🔄" title="Move Stock" menuHref={menuHref} />
            <Wrap className="sm:max-w-2xl md:max-w-3xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>
                            This creates a request only — stock isn&apos;t moved until the owner
                            approves it. A photo of what&apos;s being transferred is required.
                        </FormNote>

                        {!loading && (
                            <>
                                <div className="mb-[0.9rem] flex items-center gap-[0.6rem] sm:mx-auto sm:max-w-md">
                                    <div className="flex-1 rounded-lg border border-line bg-card p-[0.7rem] text-center">
                                        <div className="text-[0.7rem] uppercase tracking-[0.05em] text-muted">From</div>
                                        <select
                                            className="m-0"
                                            value={source}
                                            onChange={(e) => setSource(e.target.value)}
                                        >
                                            <option value="">Not sure — owner will decide</option>
                                            {kiosksFor(dest).map((k) => (
                                                <option key={k.id} value={k.id}>
                                                    {k.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="text-[1.3rem] text-muted">→</div>
                                    <div className="flex-1 rounded-lg border border-line bg-card p-[0.7rem] text-center">
                                        <div className="text-[0.7rem] uppercase tracking-[0.05em] text-muted">To</div>
                                        <select className="m-0" value={dest} onChange={(e) => setDest(e.target.value)}>
                                            <option value="">Not sure — owner will decide</option>
                                            {kiosksFor(source).map((k) => (
                                                <option key={k.id} value={k.id}>
                                                    {k.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

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
                                                        qtyRefs.current[l.key]?.focus();
                                                    }}
                                                />
                                            </div>
                                            <div className="w-[4.6rem] flex-none">
                                                <FieldLabel>Qty</FieldLabel>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    step="any"
                                                    inputMode="decimal"
                                                    placeholder="0"
                                                    value={l.qty}
                                                    ref={(el) => (qtyRefs.current[l.key] = el)}
                                                    onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                                                />
                                            </div>
                                        </LineCard>
                                    ))}
                                </div>

                                <div className="sm:mx-auto sm:max-w-md">
                                    {boot?.reasons?.length > 0 && (
                                        <>
                                            <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                                Reason (optional)
                                            </label>
                                            <select
                                                className="mb-[0.7rem] w-full"
                                                value={reason}
                                                onChange={(e) => setReason(e.target.value)}
                                            >
                                                <option value="">Select reason…</option>
                                                {boot.reasons.map((r) => (
                                                    <option key={r.value} value={r.value}>
                                                        {r.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </>
                                    )}
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

                                    <PhotoBox value={photo} onChange={setPhoto} label="Photo (required)" />
                                </div>
                            </>
                        )}

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

                {success && <SuccessPanel message={success} menuHref={menuHref} onLogAnother={logAnother} />}
            </Wrap>

            {!loading && !success && (
                <StickyActionBar>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0 sm:mx-auto sm:max-w-sm"
                        onClick={submitTransfer}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit request
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
