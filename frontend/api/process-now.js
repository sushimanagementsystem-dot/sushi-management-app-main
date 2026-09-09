// Vercel serverless relay: called fire-and-forget by the browser right
// after a successful form submit (see assets/common.js kickProcessing()).
// Makes the GAS call server-side, so it completes even if the browser tab
// closes immediately after the submit. No package.json in this project
// declares "type":"module", so module.exports (CommonJS) is used to avoid
// ESM/CJS ambiguity under Vercel's zero-config Node runtime.
//
// Required Vercel Project env vars (Settings -> Environment Variables):
//   GAS_BACKEND_URL    - same GAS /exec URL as frontend BACKEND_URL
//   GAS_PROCESS_SECRET - must match the GAS Script Property PROCESS_SECRET

module.exports = async function handler(req, res) {
    if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed." });
        return;
    }

    const backendUrl = process.env.GAS_BACKEND_URL;
    const secret = process.env.GAS_PROCESS_SECRET;
    if (!backendUrl || !secret) {
        res.status(500).json({ ok: false, error: "Relay not configured." });
        return;
    }

    try {
        const gasRes = await fetch(backendUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({ action: "process_now", secret: secret }),
        });
        res.status(200).json(await gasRes.json());
    } catch (err) {
        res.status(200).json({
            ok: false,
            error: String((err && err.message) || err),
        });
    }
};
