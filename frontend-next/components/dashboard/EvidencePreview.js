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
            {resolved.kind === "drive" ? (
                <iframe src={resolved.src} allow="autoplay" className="h-[20rem] w-full rounded-card border border-line" />
            ) : (
                // Not necessarily an image (help_issue can upload video) —
                // wrapped in a link so a non-image upload is still openable
                // instead of showing a broken-image icon with no recourse.
                <a href={resolved.src} target="_blank" rel="noreferrer" className="block">
                    <img src={resolved.src} alt={label || "Evidence"} className="max-h-[20rem] w-auto rounded-card border border-line" />
                </a>
            )}
        </div>
    );
}
