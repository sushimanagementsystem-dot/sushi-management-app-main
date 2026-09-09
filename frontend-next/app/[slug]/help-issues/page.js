"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send } from "lucide-react";
import { kickProcessing, requireKioskToken } from "@/lib/api";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import PageTitle from "@/components/PageTitle";
import KioskTopbar from "@/components/kiosk/KioskTopbar";
import Wrap from "@/components/kiosk/Wrap";
import PhotoBox from "@/components/kiosk/PhotoBox";
import StickyActionBar from "@/components/kiosk/StickyActionBar";
import { FormNote, ResultError, Spinner, SuccessPanel } from "@/components/kiosk/FormBits";

const TYPES = [
    { type: "KIOSK_ISSUE", label: "Kiosk Issue", note: "Something's broken or not working. Reviewed within 3 days.", urgent: false },
    { type: "HELP_NEEDED", label: "Help Needed", note: "You need support with something. Reviewed within 7 days.", urgent: false },
    { type: "FEEDBACK", label: "Feedback / Suggestion", note: "An idea or comment for the owner. Reviewed within 14 days.", urgent: false },
    { type: "URGENT", label: "Urgent Issue", note: "Needs attention right away.", urgent: true },
];

function makeClientKey() {
    return typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now()) + "-" + Math.random().toString(36).slice(2);
}

export default function HelpIssuesPage() {
    const { slug } = useParams();
    const menuHref = "/" + slug + "/home";
    const [token, setToken] = useState(null);
    const [type, setType] = useState(null);
    const [category, setCategory] = useState("");
    const [title, setTitle] = useState("");
    const [details, setDetails] = useState("");
    const [photo, setPhoto] = useState(null);
    const [formError, setFormError] = useState("");
    const [success, setSuccess] = useState(null);
    const clientKey = useRef(makeClientKey());

    useEffect(() => {
        const t = requireKioskToken();
        if (t) setToken(t);
    }, []);

    const {
        data: boot,
        isPending: loading,
        error: bootError,
    } = useBootstrap("bootstrap_help_issue", token && { token }, { enabled: !!token });

    const submitMutation = useApiMutation("submit", {
        onSuccess: (res) => {
            if (res.ok) {
                setSuccess("Report submitted.");
                kickProcessing();
            } else {
                setFormError(res.error);
            }
        },
        onError: (e) => setFormError("Submit failed: " + e.message),
    });

    const error = formError || boot?.error || (bootError && "Could not load: " + bootError.message);

    function submitReport() {
        setFormError("");
        if (!type) return setFormError("Pick what kind of report this is.");
        const t = title.trim();
        const d = details.trim();
        if (!t) return setFormError("Give it a short title.");
        if (!d) return setFormError("Add details.");
        if (!photo) return setFormError("A photo or video is required.");

        submitMutation.mutate({
            token: token,
            formType: "HELP_ISSUE",
            payload: {
                client_key: clientKey.current,
                business_date: boot.businessDate,
                request_type: type,
                category: category,
                title: t,
                details: d,
                photo: photo,
            },
        });
    }

    function logAnother() {
        window.location.reload();
    }

    return (
        <>
            <PageTitle title="Help / Issues" />
            <KioskTopbar icon="🆘" title="Help / Issues" menuHref={menuHref} />
            <Wrap className="sm:max-w-2xl">
                {!success && (
                    <div className={submitMutation.isPending ? "pointer-events-none opacity-60" : ""}>
                        <FormNote>
                            This form is not an emergency service — if there&apos;s danger, take
                            immediate safe action first.
                        </FormNote>

                        {!loading && (
                            <div>
                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                    {TYPES.map((t) => (
                                        <button
                                            key={t.type}
                                            onClick={() => setType(t.type)}
                                            className={
                                                "block w-full rounded-card border-2 bg-card p-4 text-left font-semibold transition-colors duration-150 " +
                                                (type === t.type
                                                    ? t.urgent
                                                        ? "border-danger-ink"
                                                        : "border-accent"
                                                    : "border-line hover:border-accent/40")
                                            }
                                        >
                                            {t.label}
                                            <small className="mt-[0.2rem] block font-normal text-muted">{t.note}</small>
                                        </button>
                                    ))}
                                </div>

                                {type && (
                                    <div className="mt-[0.6rem]">
                                        {boot?.categories?.length > 0 && (
                                            <>
                                                <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                                    Category (optional)
                                                </label>
                                                <select
                                                    className="mb-[0.7rem] w-full"
                                                    value={category}
                                                    onChange={(e) => setCategory(e.target.value)}
                                                >
                                                    <option value="">Select category…</option>
                                                    {boot.categories.map((c) => (
                                                        <option key={c.value} value={c.value}>
                                                            {c.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </>
                                        )}

                                        <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                            Short title
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Fridge not cooling"
                                            className="mb-[0.7rem] w-full"
                                            value={title}
                                            onChange={(e) => setTitle(e.target.value)}
                                        />

                                        <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">
                                            Details
                                        </label>
                                        <textarea
                                            placeholder="What's going on?"
                                            className="mb-[0.7rem] min-h-[6rem] w-full resize-y"
                                            value={details}
                                            onChange={(e) => setDetails(e.target.value)}
                                        />

                                        <PhotoBox
                                            value={photo}
                                            onChange={setPhoto}
                                            accept="image/*,video/*"
                                            label="Photo or video"
                                            placeholder="Tap to take or choose a photo or video"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        <Spinner loading={loading} />
                        <ResultError>{error}</ResultError>
                        {!loading && type && <StickyActionBar.Spacer />}
                    </div>
                )}

                {success && <SuccessPanel message={success} menuHref={menuHref} onLogAnother={logAnother} />}
            </Wrap>

            {!loading && !success && type && (
                <StickyActionBar>
                    <button
                        className="flex w-full items-center justify-center gap-1.5 border-accent bg-accent font-bold text-accent-ink shadow-elevate-1 transition-transform duration-150 hover:-translate-y-px active:translate-y-0 sm:mx-auto sm:max-w-sm"
                        onClick={submitReport}
                    >
                        <Send size={15} strokeWidth={2.2} />
                        Submit report
                    </button>
                </StickyActionBar>
            )}
        </>
    );
}
