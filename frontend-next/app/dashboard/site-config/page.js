"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PageTitle from "@/components/PageTitle";
import DashboardShell from "@/components/DashboardShell";
import PageHeader from "@/components/dashboard/PageHeader";
import HelpTip from "@/components/dashboard/HelpTip";
import SectionCard from "@/components/dashboard/SectionCard";
import RefreshButton from "@/components/dashboard/RefreshButton";
import { useApiMutation, useBootstrap } from "@/lib/queries";
import { confirmModal } from "@/components/ConfirmModal";

// Sonnet is what invoice reading has always used (fast, cheapest); Opus reads
// messy/tilted photos more reliably at a higher price per invoice.
const AI_MODELS = [
    { value: "claude-sonnet-5", label: "Claude Sonnet 5 — fast and cheapest (recommended)" },
    { value: "claude-opus-5", label: "Claude Opus 5 — most accurate, for messy photos" },
];

const inputCls = "w-full";
const saveBtnCls =
    "rounded-lg border-none bg-accent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-accent-ink shadow-elevate-1 hover:bg-accent/90 hover:shadow-elevate-2 active:scale-[0.97] disabled:opacity-50";

// A ConfigToggle flips a category row's is_active column immediately
// (its own action, not bundled into Save) — lets the admin turn a group
// off without losing its saved data, e.g. pause outbound email while
// keeping the SMTP credentials in place.
function ConfigToggle({ active, onToggle, pending }) {
    return (
        <button
            type="button"
            disabled={pending}
            onClick={onToggle}
            className={
                "flex items-center gap-2 rounded-full border-none px-2.5 py-1 text-[0.72rem] font-semibold disabled:opacity-50 " +
                (active ? "bg-success-bg text-success-ink" : "bg-line text-muted")
            }
            title={active ? "Active — click to disable" : "Inactive — click to enable"}
        >
            <span className={"h-2 w-2 rounded-full " + (active ? "bg-success-ink" : "bg-muted")} />
            {active ? "Active" : "Inactive"}
        </button>
    );
}

export default function SiteConfigPage() {
    const { data: res, isPending: loading, error: bootError, refetch } = useBootstrap("bootstrap_site_config", {});

    // category -> {id, category, isActive, config, secretsSet, lastTestedAt,
    // lastTestResult, lastTestError, createdAt, createdBy, updatedAt, updatedBy}
    const configByCategory = useMemo(() => {
        const m = {};
        (res?.config || []).forEach((c) => (m[c.category] = c));
        return m;
    }, [res]);

    // Every field is directly editable (no page-wide Edit gate) — each
    // section owns its own Save, matching a real SMTP settings page
    // instead of one big form. Local state is hydrated from the first
    // successful bootstrap only, so a background refetch (after Save)
    // doesn't clobber whatever the admin is mid-typing in another section.
    const hydrated = useRef(false);

    const [adminEmail, setAdminEmail] = useState("");
    const [adminSaved, setAdminSaved] = useState(false);
    const [adminError, setAdminError] = useState("");

    const [smtp, setSmtp] = useState({
        host: "",
        port: "587",
        username: "",
        password: "",
        fromName: "",
        fromEmail: "",
        secure: false,
    });
    const [smtpSaved, setSmtpSaved] = useState(false);
    const [smtpError, setSmtpError] = useState("");

    const [testTo, setTestTo] = useState("");
    const [testError, setTestError] = useState("");
    const [testOk, setTestOk] = useState(false);

    // The key field is write-only: it starts empty, is cleared after every
    // save/test, and the server never sends the saved key back — only its
    // last 4 characters (res.ai.keyHint).
    const [ai, setAi] = useState({ apiKey: "", model: "claude-sonnet-5" });
    const [aiSaved, setAiSaved] = useState(false);
    const [aiError, setAiError] = useState("");
    const [aiTestOk, setAiTestOk] = useState("");
    const [aiTestError, setAiTestError] = useState("");

    useEffect(() => {
        if (hydrated.current || !res?.ok) return;
        hydrated.current = true;
        setAi((a) => ({ ...a, model: configByCategory.ANTHROPIC?.config?.model || res.ai?.model || a.model }));
        setAdminEmail(configByCategory.ADMIN?.config?.email || "");
        setSmtp({
            host: configByCategory.SMTP?.config?.host || "",
            port: String(configByCategory.SMTP?.config?.port ?? "587"),
            username: configByCategory.SMTP?.config?.username || "",
            password: "",
            fromName: configByCategory.SMTP?.config?.fromName || "",
            fromEmail: configByCategory.SMTP?.config?.fromEmail || "",
            secure: Boolean(configByCategory.SMTP?.config?.secure),
        });
        setTestTo(configByCategory.ADMIN?.config?.email || "");
    }, [res, configByCategory]);

    const toggleActiveMutation = useApiMutation("set_site_config_active", { onSuccess: () => refetch() });
    function toggleActive(category, current) {
        toggleActiveMutation.mutate({ category, isActive: !current });
    }

    const saveAdminMutation = useApiMutation("save_site_config", {
        onSuccess: (out) => {
            if (!out.ok) {
                setAdminError(out.error || "Save failed.");
                return;
            }
            setAdminError("");
            setAdminSaved(true);
            setTimeout(() => setAdminSaved(false), 2500);
            refetch();
        },
        onError: () => setAdminError("Save failed."),
    });

    function saveAdmin() {
        setAdminError("");
        saveAdminMutation.mutate({ category: "ADMIN", config: { email: adminEmail } });
    }

    const saveSmtpMutation = useApiMutation("save_site_config", {
        onSuccess: (out) => {
            if (!out.ok) {
                setSmtpError(out.error || "Save failed.");
                return;
            }
            setSmtpError("");
            setSmtpSaved(true);
            setTimeout(() => setSmtpSaved(false), 2500);
            setSmtp((s) => ({ ...s, password: "" }));
            refetch();
        },
        onError: () => setSmtpError("Save failed."),
    });

    function saveSmtp() {
        setSmtpError("");
        const config = {
            host: smtp.host,
            port: Number(smtp.port) || 0,
            secure: smtp.secure,
            username: smtp.username,
            fromName: smtp.fromName,
            fromEmail: smtp.fromEmail,
        };
        // Blank password = "leave unchanged" — omit it entirely, or Save
        // would wipe out the stored password.
        const secrets = smtp.password ? { password: smtp.password } : {};
        saveSmtpMutation.mutate({ category: "SMTP", config, secrets });
    }

    const testMutation = useApiMutation("test_mail_connection", {
        onSuccess: (out) => {
            // Refetch either way — the backend records Success/Failed on
            // every attempt, so the "Last test" badge should reflect this
            // one even when it failed.
            refetch();
            if (!out.ok) {
                setTestError(out.error || "Test failed.");
                setTestOk(false);
                return;
            }
            setTestError("");
            setTestOk(true);
        },
        onError: (err) => {
            setTestError(err?.message || "Test failed.");
            setTestOk(false);
        },
    });

    function sendTest() {
        setTestError("");
        setTestOk(false);
        testMutation.mutate({
            host: smtp.host,
            port: Number(smtp.port) || 0,
            secure: smtp.secure,
            username: smtp.username,
            password: smtp.password || undefined,
            fromName: smtp.fromName,
            fromEmail: smtp.fromEmail,
            sendTestTo: testTo,
        });
    }

    const saveAiMutation = useApiMutation("save_site_config", {
        onSuccess: (out) => {
            if (!out.ok) {
                setAiError(out.error || "Save failed.");
                return;
            }
            setAiError("");
            setAiTestOk("");
            setAiTestError("");
            setAiSaved(true);
            setTimeout(() => setAiSaved(false), 2500);
            setAi((a) => ({ ...a, apiKey: "" })); // the key never stays in the browser after it is saved
            refetch();
        },
        onError: () => setAiError("Save failed."),
    });

    function saveAi() {
        setAiError("");
        // Blank key = leave the saved one as it is — omit it, or Save would wipe it.
        saveAiMutation.mutate({ category: "ANTHROPIC", config: { model: ai.model }, secrets: ai.apiKey.trim() ? { apiKey: ai.apiKey.trim() } : {} });
    }

    async function removeAiKey() {
        const ok = await confirmModal("Remove the saved Anthropic key? AI invoice reading stops working (unless the server has its own key) until you add a new one.", "Remove key", true);
        if (!ok) return;
        setAiError("");
        saveAiMutation.mutate({ category: "ANTHROPIC", secrets: { apiKey: null } });
    }

    const testAiMutation = useApiMutation("test_anthropic_connection", {
        onSuccess: (out) => {
            refetch(); // the backend records the result either way, so the "Last test" badge should show this one
            if (!out.ok) {
                setAiTestError(out.error || "Test failed.");
                setAiTestOk("");
                return;
            }
            setAiTestError("");
            setAiTestOk("Anthropic accepted this key for " + (out.model || "the selected model") + ".");
        },
        onError: (err) => {
            setAiTestError(err?.message || "Test failed.");
            setAiTestOk("");
        },
    });

    function testAi() {
        setAiTestError("");
        setAiTestOk("");
        testAiMutation.mutate({ apiKey: ai.apiKey.trim() || undefined, model: ai.model });
    }

    const error = (res && res.ok === false && (res.error || "Failed to load.")) || (bootError && "Failed to load.");
    const aiRow = configByCategory.ANTHROPIC;
    const aiStatus = res?.ai || { source: "none", keyHint: null, model: "claude-sonnet-5" };
    const aiModelOptions = AI_MODELS.some((m) => m.value === ai.model) ? AI_MODELS : [...AI_MODELS, { value: ai.model, label: ai.model }];
    const adminRow = configByCategory.ADMIN;
    const smtpRow = configByCategory.SMTP;
    const smtpConfigured = Boolean(smtpRow?.config?.host) && Boolean(smtpRow?.secretsSet?.password);
    const lastTestAt = smtpRow?.lastTestedAt;
    const lastTestResult = smtpRow?.lastTestResult;
    const lastTestError = smtpRow?.lastTestError;

    return (
        <>
            <PageTitle title="Dashboard — Site Configuration" />
            <DashboardShell activeKey="site-config">
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <PageHeader
                        title="Site Configuration"
                        help="site.page"
                        description="Site-wide admin config — separate from the production/audit Settings tab."
                        actions={<RefreshButton onRefetch={refetch} />}
                    />

                    {loading && (
                        <div className="mx-auto my-12 h-8 w-8 animate-spin rounded-full border-[3px] border-line" style={{ borderTopColor: "#0e5c45" }} />
                    )}
                    {error && <div className="text-danger-ink">{error}</div>}

                    {!loading && res?.ok && (
                        <>
                            <SectionCard
                                title="Admin"
                                help="site.admin"
                                actions={
                                    <ConfigToggle
                                        active={adminRow ? adminRow.isActive : true}
                                        pending={toggleActiveMutation.isPending}
                                        onToggle={() => toggleActive("ADMIN", adminRow ? adminRow.isActive : true)}
                                    />
                                }
                            >
                                <div className="max-w-md">
                                    <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Admin Email</label>
                                    <div className="mb-[0.35rem] text-[0.78rem] text-muted">
                                        The owner&apos;s email address — where site-wide admin notifications go.
                                    </div>
                                    <input type="email" className={inputCls} value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                                    {adminRow?.updatedAt && (
                                        <div className="mt-[0.3rem] text-[0.72rem] text-muted">Last updated {new Date(adminRow.updatedAt).toLocaleString()}</div>
                                    )}
                                    {adminError && <div className="mt-2 text-[0.8rem] text-danger-ink">{adminError}</div>}
                                    <div className="mt-3 flex items-center gap-3">
                                        <button disabled={saveAdminMutation.isPending} className={saveBtnCls} onClick={saveAdmin}>
                                            {saveAdminMutation.isPending ? "Saving…" : "Save"}
                                        </button>
                                        {adminSaved && <span className="text-[0.8rem] font-semibold text-success-ink">Saved</span>}
                                    </div>
                                </div>
                            </SectionCard>

                            <SectionCard
                                title="AI — Claude (invoice reading)"
                                help="site.ai"
                                description="The Anthropic API key used to read delivery invoices and turn them into purchases. Stored encrypted on the server and never shown again after saving."
                                actions={
                                    <div className="flex items-center gap-2">
                                        {aiStatus.source === "none" ? (
                                            <span className="rounded-full bg-line px-2.5 py-1 text-[0.72rem] font-semibold text-muted">Not configured</span>
                                        ) : (
                                            <span className="rounded-full bg-success-bg px-2.5 py-1 text-[0.72rem] font-semibold text-success-ink">Configured</span>
                                        )}
                                        <ConfigToggle
                                            active={aiRow ? aiRow.isActive : true}
                                            pending={toggleActiveMutation.isPending}
                                            onToggle={() => toggleActive("ANTHROPIC", aiRow ? aiRow.isActive : true)}
                                        />
                                    </div>
                                }
                            >
                                <div className="mb-4 text-[0.85rem]">
                                    {aiStatus.source === "dashboard" && (
                                        <span>
                                            Using the key saved here (ends in <span className="font-mono font-semibold">{aiStatus.keyHint}</span>).
                                        </span>
                                    )}
                                    {aiStatus.source === "environment" && (
                                        <span>
                                            Using the key set on the server (ends in <span className="font-mono font-semibold">{aiStatus.keyHint}</span>). A key saved below takes over from it.
                                        </span>
                                    )}
                                    {aiStatus.source === "none" && (
                                        <span className="text-danger-ink">No key yet, so invoices can&apos;t be read by AI. Paste one below.</span>
                                    )}
                                    {aiRow && !aiRow.isActive && aiRow.secretsSet?.apiKey && (
                                        <div className="mt-1 text-[0.78rem] text-muted">The saved key is switched off (Inactive), so it is being ignored.</div>
                                    )}
                                </div>
                                <div className="grid grid-cols-2 gap-x-8 gap-y-[1.1rem] max-[720px]:grid-cols-1">
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Anthropic API Key</label>
                                        <input
                                            type="password"
                                            className={inputCls}
                                            autoComplete="new-password"
                                            spellCheck={false}
                                            placeholder={aiRow?.secretsSet?.apiKey ? "•••••••• (saved — leave blank to keep)" : "sk-ant-..."}
                                            value={ai.apiKey}
                                            onChange={(e) => setAi((a) => ({ ...a, apiKey: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Model</label>
                                        <select className={inputCls} value={ai.model} onChange={(e) => setAi((a) => ({ ...a, model: e.target.value }))}>
                                            {aiModelOptions.map((m) => (
                                                <option key={m.value} value={m.value}>
                                                    {m.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                {aiError && <div className="mt-2 text-[0.8rem] text-danger-ink">{aiError}</div>}
                                <div className="mt-4 flex flex-wrap items-center gap-3">
                                    <button disabled={saveAiMutation.isPending} className={saveBtnCls} onClick={saveAi}>
                                        {saveAiMutation.isPending ? "Saving…" : "Save"}
                                    </button>
                                    <button disabled={testAiMutation.isPending} className={saveBtnCls} onClick={testAi}>
                                        {testAiMutation.isPending ? "Testing…" : ai.apiKey.trim() ? "Test this key" : "Test saved key"}
                                    </button>
                                    {aiRow?.secretsSet?.apiKey && (
                                        <button
                                            disabled={saveAiMutation.isPending}
                                            className="rounded-lg border border-line bg-transparent px-4 py-[0.6rem] text-[0.9rem] font-semibold text-danger-ink disabled:opacity-50"
                                            onClick={removeAiKey}
                                        >
                                            Remove saved key
                                        </button>
                                    )}
                                    {aiSaved && <span className="text-[0.8rem] font-semibold text-success-ink">Saved</span>}
                                </div>
                                {aiTestError && <div className="mt-2 text-[0.8rem] text-danger-ink">{aiTestError}</div>}
                                {!aiTestError && !aiTestOk && aiRow?.lastTestResult === "failed" && aiRow.lastTestError && (
                                    <div className="mt-2 text-[0.8rem] text-danger-ink">Last test failed: {aiRow.lastTestError}</div>
                                )}
                                {aiTestOk && <div className="mt-2 text-[0.8rem] font-semibold text-success-ink">{aiTestOk}</div>}
                                {aiRow?.lastTestedAt && (
                                    <div className="mt-2 text-[0.72rem] text-muted">
                                        Last test: {new Date(aiRow.lastTestedAt).toLocaleString()} —{" "}
                                        <span className={aiRow.lastTestResult === "success" ? "font-semibold text-success-ink" : "font-semibold text-danger-ink"}>
                                            {aiRow.lastTestResult === "success" ? "Success" : "Failed"}
                                        </span>
                                    </div>
                                )}
                            </SectionCard>

                            <SectionCard
                                title="SMTP Connection"
                                help="site.smtp"
                                description="The email account outbound system mail (reports, alerts) is sent from — not hardcoded in code, set it here."
                                actions={
                                    <div className="flex items-center gap-2">
                                        {smtpConfigured ? (
                                            <span className="rounded-full bg-success-bg px-2.5 py-1 text-[0.72rem] font-semibold text-success-ink">Configured</span>
                                        ) : (
                                            <span className="rounded-full bg-line px-2.5 py-1 text-[0.72rem] font-semibold text-muted">Not configured</span>
                                        )}
                                        <ConfigToggle
                                            active={smtpRow ? smtpRow.isActive : true}
                                            pending={toggleActiveMutation.isPending}
                                            onToggle={() => toggleActive("SMTP", smtpRow ? smtpRow.isActive : true)}
                                        />
                                    </div>
                                }
                            >
                                <div className="grid grid-cols-2 gap-x-8 gap-y-[1.1rem] max-[720px]:grid-cols-1">
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">SMTP Host</label>
                                        <input
                                            className={inputCls}
                                            placeholder="smtp.gmail.com"
                                            value={smtp.host}
                                            onChange={(e) => setSmtp((s) => ({ ...s, host: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Port</label>
                                        <input
                                            className={inputCls}
                                            placeholder="587"
                                            value={smtp.port}
                                            onChange={(e) => setSmtp((s) => ({ ...s, port: e.target.value.replace(/[^0-9]/g, "") }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Username</label>
                                        <input className={inputCls} value={smtp.username} onChange={(e) => setSmtp((s) => ({ ...s, username: e.target.value }))} />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Password</label>
                                        <input
                                            type="password"
                                            className={inputCls}
                                            placeholder={smtpRow?.secretsSet?.password ? "•••••••• (saved — leave blank to keep)" : "Enter a password"}
                                            value={smtp.password}
                                            onChange={(e) => setSmtp((s) => ({ ...s, password: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">From Name</label>
                                        <input
                                            className={inputCls}
                                            placeholder="Sushi Kiosk System"
                                            value={smtp.fromName}
                                            onChange={(e) => setSmtp((s) => ({ ...s, fromName: e.target.value }))}
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">From Email</label>
                                        <input
                                            type="email"
                                            className={inputCls}
                                            value={smtp.fromEmail}
                                            onChange={(e) => setSmtp((s) => ({ ...s, fromEmail: e.target.value }))}
                                        />
                                    </div>
                                </div>
                                <label className="mt-4 flex items-center gap-2 text-[0.85rem]">
                                    <input type="checkbox" checked={smtp.secure} onChange={(e) => setSmtp((s) => ({ ...s, secure: e.target.checked }))} />
                                    Use TLS from connect (port 465) — leave unchecked for STARTTLS (port 587, most common)
                                </label>
                                {smtpError && <div className="mt-2 text-[0.8rem] text-danger-ink">{smtpError}</div>}
                                <div className="mt-4 flex items-center gap-3">
                                    <button disabled={saveSmtpMutation.isPending} className={saveBtnCls} onClick={saveSmtp}>
                                        {saveSmtpMutation.isPending ? "Saving…" : "Save settings"}
                                    </button>
                                    {smtpSaved && <span className="text-[0.8rem] font-semibold text-success-ink">Saved</span>}
                                </div>
                            </SectionCard>

                            <SectionCard
                                title="Test Connection"
                                description="Sends a real email using whatever is currently in the form above (saved or not), so you can verify before saving."
                                actions={
                                    lastTestAt && (
                                        <span className="text-[0.78rem] text-muted">
                                            Last test: {new Date(lastTestAt).toLocaleString()} —{" "}
                                            <span className={lastTestResult === "success" ? "font-semibold text-success-ink" : "font-semibold text-danger-ink"}>
                                                {lastTestResult === "success" ? "Success" : "Failed"}
                                            </span>
                                        </span>
                                    )
                                }
                            >
                                <div className="flex flex-wrap items-end gap-3">
                                    <div className="min-w-[240px] flex-1">
                                        <label className="mb-[0.15rem] block text-[0.95rem] font-semibold">Send Test To</label>
                                        <input type="email" className={inputCls} value={testTo} onChange={(e) => setTestTo(e.target.value)} />
                                    </div>
                                    <button disabled={testMutation.isPending} className={saveBtnCls} onClick={sendTest}>
                                        {testMutation.isPending ? "Sending…" : "Send test email"}
                                    </button>
                                </div>
                                {testError && <div className="mt-2 text-[0.8rem] text-danger-ink">{testError}</div>}
                                {!testError && lastTestResult === "failed" && lastTestError && (
                                    <div className="mt-2 text-[0.8rem] text-danger-ink">{lastTestError}</div>
                                )}
                                {testOk && <div className="mt-2 text-[0.8rem] font-semibold text-success-ink">Test email sent successfully.</div>}
                            </SectionCard>
                        </>
                    )}
                </div>
            </DashboardShell>
        </>
    );
}
