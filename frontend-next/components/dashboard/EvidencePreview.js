"use client";

import { useEffect, useState } from "react";
import { BACKEND_URL } from "@/lib/api";

/**
 * Resolves an evidence/photo reference to something renderable. Two
 * possible formats depending on when the row was written: legacy data from
 * the old Apps Script backend stored a Google Drive share-link
 * ("…/d/<fileId>/…"); this backend's own UploadService writes
 * "/uploads/<id>" instead, served by UploadController. Shared by the
 * Action Inbox review UI and the Final Audit Result page — both show the
 * same evidence photos, so both need the same resolution logic.
 */
export function evidencePreviewSrc(url) {
    const raw = String(url || "");
    if (!raw) return null;
    const driveMatch = raw.match(/\/d\/([^/]+)\//);
    if (driveMatch) return { kind: "drive", src: "https://drive.google.com/file/d/" + driveMatch[1] + "/preview" };
    if (raw.startsWith("/uploads/")) return { kind: "image", src: BACKEND_URL + raw };
    return null;
}

export default function EvidencePreview({ url, label, className = "" }) {
    const resolved = evidencePreviewSrc(url);
    if (!resolved) return null;
    return (
        <div className={"my-2 " + className}>
            {label && <div className="mb-[0.2rem] text-[0.8rem] text-muted">{label}</div>}
            {resolved.kind === "drive" ? <DriveFrame src={resolved.src} /> : <UploadedFile src={resolved.src} label={label} />}
        </div>
    );
}

function DriveFrame({ src }) {
    return <iframe src={src} allow="autoplay" className="h-[20rem] w-full rounded-card border border-line" />;
}

/**
 * An uploaded file is usually a photo, but the same /uploads route also
 * serves PDFs (delivery invoices) and video (Help/Issue) — an <img> alone
 * shows a broken-image icon and a wall of alt text for those. So: try the
 * image; if it won't render, ask the server what the file really is and
 * show it properly (PDF frame / video player), or say plainly that it is no
 * longer there.
 */
function UploadedFile({ src, label }) {
    const [imgFailed, setImgFailed] = useState(false);
    const [probe, setProbe] = useState(null); // { ok, type } once the HEAD request answers

    useEffect(() => {
        if (!imgFailed) return;
        let cancelled = false;
        fetch(src, { method: "HEAD" })
            .then((res) => !cancelled && setProbe({ ok: res.ok, type: res.headers.get("content-type") || "" }))
            .catch(() => !cancelled && setProbe({ ok: false, type: "" }));
        return () => {
            cancelled = true;
        };
    }, [imgFailed, src]);

    if (!imgFailed) {
        // Not necessarily an image — wrapped in a link so a non-image upload is still openable.
        return (
            <a href={src} target="_blank" rel="noreferrer" className="block">
                <img src={src} alt={label || "Uploaded file"} onError={() => setImgFailed(true)} className="max-h-[20rem] w-auto rounded-card border border-line" />
            </a>
        );
    }
    if (!probe) return <Notice>Loading preview…</Notice>;
    if (!probe.ok) return <Notice>This file is no longer available on the server, so it can't be previewed.</Notice>;
    if (probe.type.startsWith("video/")) return <video src={src} controls className="max-h-[20rem] w-full rounded-card border border-line" />;
    if (probe.type === "application/pdf") {
        return (
            <>
                <iframe src={src} className="h-[24rem] w-full rounded-card border border-line" />
                <OpenLink src={src} />
            </>
        );
    }
    return (
        <Notice>
            This file type can't be previewed here. <OpenLink src={src} inline />
        </Notice>
    );
}

function Notice({ children }) {
    return <div className="rounded-card border border-line bg-panel px-3 py-2.5 text-[0.85rem] text-muted">{children}</div>;
}

function OpenLink({ src, inline }) {
    return (
        <a href={src} target="_blank" rel="noreferrer" className={"text-[0.82rem] font-semibold text-accent hover:underline" + (inline ? "" : " mt-1 inline-block")}>
            Open file in a new tab
        </a>
    );
}
