// Vercel serverless relay: called fire-and-forget by the browser right
// after a successful form submit (see lib/api.js kickProcessing()). Makes
// the backend call server-side, so it completes even if the browser tab
// closes immediately after the submit.
//
// Required env vars (Vercel Project Settings -> Environment Variables
// locally, or .env.local for dev):
//   BACKEND_URL     - same NestJS backend URL as lib/api.js's BACKEND_URL
//   PROCESS_SECRET  - must match the backend's PROCESS_SECRET env var

export async function POST() {
    const backendUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
    const secret = process.env.PROCESS_SECRET;
    if (!backendUrl || !secret) {
        return Response.json({ ok: false, error: "Relay not configured." }, { status: 500 });
    }

    try {
        const res = await fetch(`${backendUrl}/process_now`, {
            method: "POST",
            headers: { "x-process-secret": secret },
        });
        return Response.json(await res.json());
    } catch (err) {
        return Response.json({ ok: false, error: String((err && err.message) || err) });
    }
}
