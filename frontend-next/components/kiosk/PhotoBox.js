"use client";

import { useRef } from "react";
import { Camera } from "lucide-react";
import { readFileForUpload } from "@/lib/api";

/**
 * Tap-to-photograph/choose box used by Damaged Product, Delivery Invoices,
 * Help/Issues. Ported from the `.photo-box` pattern each of those pages
 * repeated. onChange receives { base64, mimeType, name } (or an array of
 * those when `multiple`). accept/capture default to a rear-camera photo;
 * pass accept="image/*,video/*" (and drop capture) for Help/Issues' video
 * case.
 */
export default function PhotoBox({
    value,
    onChange,
    accept = "image/*",
    capture = "environment",
    label = "Photo",
    placeholder = "Tap to take or choose a photo",
}) {
    const inputRef = useRef(null);

    const handleChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        readFileForUpload(file).then((data) => onChange(data));
    };

    return (
        <>
            {label && <label className="mb-1 ml-[0.1rem] block text-[0.8rem] text-muted">{label}</label>}
            <div
                onClick={() => inputRef.current?.click()}
                className="mb-[0.7rem] cursor-pointer rounded-card border-2 border-dashed border-line bg-panel/40 p-4 text-center transition-colors duration-150 hover:border-accent/50 hover:bg-accent-soft/40"
            >
                {value ? (
                    (value.mimeType || "").startsWith("video/") ? (
                        <video
                            controls
                            src={"data:" + value.mimeType + ";base64," + value.base64}
                            className="mx-auto block max-h-[14rem] max-w-full rounded-lg"
                        />
                    ) : (
                        <img
                            src={"data:" + value.mimeType + ";base64," + value.base64}
                            alt=""
                            className="mx-auto block max-h-[14rem] max-w-full rounded-lg"
                        />
                    )
                ) : (
                    <div className="flex flex-col items-center gap-1.5 py-6 text-[0.9rem] text-muted">
                        <Camera size={22} strokeWidth={1.8} />
                        {placeholder}
                    </div>
                )}
            </div>
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                capture={capture}
                className="hidden"
                onChange={handleChange}
            />
        </>
    );
}
