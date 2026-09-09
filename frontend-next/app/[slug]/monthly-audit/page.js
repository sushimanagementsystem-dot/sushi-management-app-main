"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Send } from "lucide-react";
import { kickProcessing, readFileForUpload, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResubmitBanner, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

export default function MonthlyAuditPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [answers, setAnswers] = useState({}); // qid -> { answer, photoData, existingPhotoRef }
    const [missing, setMissing] = useState(new Set());
    const [currentSection, setCurrentSection] = useState(0);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const cardRefs = useRef({});
    const seeded = useRef(false);

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_monthly_audit", token && { token }, { enabled: !!token });

    useEffect(() => {
        if (!boot || !boot.ok || seeded.current) return;
        seeded.current = true;
        const init = {};
        (boot.questions || []).forEach((q) => {
            const prev = boot.existingAnswers && boot.existingAnswers[q.id];
            init[q.id] = {
                answer: prev ? prev.answer : "",
                photoData: null,
                existingPhotoRef: prev ? prev.evidencePhotoReference || "" : "",
            };
        });
        setAnswers(init);
    }, [boot]);

    const sections = useMemo(() => {
        if (!boot) return [];
        const bySection = {};
        boot.questions.forEach((q) => {
            (bySection[q.sectionId] = bySection[q.sectionId] || []).push(q);
        });
        return boot.sections
            .map((sec) => ({ id: sec.id, name: sec.name, questions: bySection[sec.id] || [] }))
            .filter((s) => s.questions.length);
    }, [boot]);

    const answeredCount = Object.values(answers).filter((a) => a.answer).length;
    const totalCount = boot?.questions?.length || 0;

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Audit submitted for owner review.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || (boot?.ok === false ? boot.error : null) || (bootError && "Could not load: " + bootError.message);

    function selectAnswer(qid, val) {
        setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], answer: val } }));
        setMissing((prev) => {
            if (!prev.has(qid)) return prev;
            const next = new Set(prev);
            next.delete(qid);
            return next;
        });
    }

    function onPhotoChosen(qid, e) {
        const file = e.target.files[0];
        if (!file) return;
        readFileForUpload(file).then((data) => {
            setAnswers((prev) => ({ ...prev, [qid]: { ...prev[qid], photoData: data } }));
        });
    }

    function sectionIndexOf(qid) {
        return sections.findIndex((s) => s.questions.some((q) => q.id === qid));
    }

    function submitAudit() {
        setFormError("");
        const payloadAnswers = {};
        const missingIds = [];

        (boot?.questions || []).forEach((q) => {
            const row = answers[q.id] || {};
            if (!row.answer) {
                missingIds.push(q.id);
                return;
            }
            const hasEvidence = row.photoData || row.existingPhotoRef;
            if (q.evidenceRequired && row.answer !== "NA" && !hasEvidence) {
                missingIds.push(q.id);
                return;
            }
            const a = { answer: row.answer };
            if (row.photoData) a.photo = row.photoData;
            else if (row.existingPhotoRef) a.evidence_photo_reference = row.existingPhotoRef;
            payloadAnswers[q.id] = a;
        });

        if (missingIds.length) {
            setMissing(new Set(missingIds));
            const idx = sectionIndexOf(missingIds[0]);
            const switchedSection = idx !== -1 && idx !== currentSection;
            if (switchedSection) setCurrentSection(idx);
            setTimeout(
                () => cardRefs.current[missingIds[0]]?.scrollIntoView({ behavior: "smooth", block: "center" }),
                switchedSection ? 300 : 0,
            );
            setFormError(`${missingIds.length} question(s) need an answer or a required photo.`);
            return;
        }

        submitMutation.mutate({
            token: token,
            formType: "MONTHLY_AUDIT",
            payload: { business_date: boot.businessDate, answers: payloadAnswers },
        });
    }

    if (!loading && boot?.ok && boot.locked) {
        return (
            <>
                <PageTitle title="Monthly Audit" />
                <KioskTopbar icon="🔍" title="Monthly Audit" menuHref={menuHref} />
                <Wrap>
                    <ResubmitBanner>{boot.lockedReason}</ResubmitBanner>
                    <Link href={menuHref} className="text-accent">
                        Back to menu
                    </Link>
                </Wrap>
            </>
        );
    }

    return (
        <>
            <PageTitle title="Monthly Audit" />
            <KioskTopbar icon="🔍" title="Monthly Audit" menuHref={menuHref} />
            {/* Widened + gridded on larger screens, same pattern as the
                other long list-style forms — a laptop/tablet can answer two
                questions per row instead of one at a time, cutting how much
                scrolling/paging a 59-question audit takes. Capped at 2
                columns (not 3) — a 3rd column left too little room for the
                Yes/No/NA buttons and evidence-photo box to stay readable. */}
            <Wrap className="sm:max-w-2xl md:max-w-3xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        {boot?.alreadySubmitted && (
                            <ResubmitBanner>
                                Today already has an audit in progress. Your earlier answers are
                                loaded — edit and resubmit; this <b>replaces</b> them.
                            </ResubmitBanner>
                        )}
                        <FormNote>Answer every question. Photos are required where marked.</FormNote>

                        {!loading && sections.length > 1 && (
                            <div className="my-[0.4rem] mb-4 flex items-center gap-[0.6rem]">
                                <button
                                    disabled={currentSection === 0}
                                    onClick={() => setCurrentSection((i) => Math.max(0, i - 1))}
                                    className="rounded-lg border border-line bg-card px-[0.9rem] py-[0.6rem] font-bold disabled:opacity-40"
                                >
                                    ‹ Prev
                                </button>
                                <span className="flex-1 text-center text-[0.85rem] text-muted">
                                    {sections[currentSection]?.name} ({currentSection + 1}/{sections.length})
                                </span>
                                <button
                                    disabled={currentSection === sections.length - 1}
                                    onClick={() => setCurrentSection((i) => Math.min(sections.length - 1, i + 1))}
                                    className="rounded-lg border border-line bg-card px-[0.9rem] py-[0.6rem] font-bold disabled:opacity-40"
                                >
                                    Next ›
                                </button>
                            </div>
                        )}

                        {!loading &&
                            sections.map((sec, idx) => (
                                <div key={sec.id} className={idx === currentSection ? "block" : "hidden"}>
                                    <div className="mb-[0.6rem] border-b border-line pb-[0.3rem] text-[0.8rem] font-bold uppercase tracking-[0.08em] text-muted">
                                        {sec.name}
                                    </div>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    {sec.questions.map((q) => {
                                        const row = answers[q.id] || {};
                                        const isMissing = missing.has(q.id);
                                        const opts = ["YES", "NO"].concat(q.naAllowed ? ["NA"] : []);
                                        return (
                                            <div
                                                key={q.id}
                                                ref={(el) => (cardRefs.current[q.id] = el)}
                                                className={
                                                    "rounded-card border bg-card p-[0.8rem] " +
                                                    (isMissing ? "border-danger-border" : "border-line")
                                                }
                                            >
                                                <div className="mb-[0.6rem] text-[0.95rem]">
                                                    {q.critical && (
                                                        <span className="mr-[0.3rem] text-[0.7rem] font-bold uppercase text-danger-ink">
                                                            Critical
                                                        </span>
                                                    )}
                                                    {q.text}
                                                </div>
                                                <div className="flex gap-[0.4rem]">
                                                    {opts.map((a) => {
                                                        const selected = row.answer === a;
                                                        const selColor =
                                                            a === "YES"
                                                                ? "border-success-ink bg-success-bg"
                                                                : a === "NO"
                                                                  ? "border-danger-ink bg-danger-bg"
                                                                  : "border-muted bg-panel";
                                                        return (
                                                            <button
                                                                key={a}
                                                                onClick={() => selectAnswer(q.id, a)}
                                                                className={
                                                                    "flex-1 rounded-lg border-2 p-[0.6rem] font-bold " +
                                                                    (selected ? selColor : "border-line bg-white")
                                                                }
                                                            >
                                                                {a === "NA" ? "N/A" : a}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                                {q.evidenceRequired && (
                                                    <>
                                                        <div
                                                            onClick={() =>
                                                                document.getElementById(`photo-${q.id}`)?.click()
                                                            }
                                                            className="mt-[0.6rem] cursor-pointer rounded-lg border-2 border-dashed border-line bg-panel/40 p-[0.6rem] text-center text-[0.8rem] text-muted transition-colors duration-150 hover:border-accent/50 hover:bg-accent-soft/40"
                                                        >
                                                            {row.photoData ? (
                                                                <img
                                                                    src={
                                                                        "data:" +
                                                                        row.photoData.mimeType +
                                                                        ";base64," +
                                                                        row.photoData.base64
                                                                    }
                                                                    alt=""
                                                                    className="mx-auto block max-h-[8rem] max-w-full rounded-md"
                                                                />
                                                            ) : row.existingPhotoRef ? (
                                                                "✓ Photo already attached — tap to replace"
                                                            ) : (
                                                                "Tap to add evidence photo (required)"
                                                            )}
                                                        </div>
                                                        <input
                                                            id={`photo-${q.id}`}
                                                            type="file"
                                                            accept="image/*"
                                                            capture="environment"
                                                            className="hidden"
                                                            onChange={(e) => onPhotoChosen(q.id, e)}
                                                        />
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                    </div>
                                </div>
                            ))}

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} />}
            </Wrap>

            {!loading && !success && (
                <StickyActionBar filled={answeredCount} total={totalCount}>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 rounded-card border border-accent bg-accent p-[0.8rem] text-base font-bold text-accent-ink sm:mx-auto sm:max-w-sm"
                        onClick={submitAudit}
                    >
                        <Send size={16} strokeWidth={2.2} />
                        Submit audit
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
