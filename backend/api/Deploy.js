/**
 * Deploy.js — self-service redeploy via the Apps Script REST API.
 *
 * Called through the API (action "redeploy") after `clasp push`. Runs as the
 * OWNER (this deployment executes as them), so the new version/deployment is
 * created under the owner's identity — emails keep coming from the owner even
 * when the push was made by a developer account.
 *
 * Script Properties required: BACKEND_SCRIPT_ID, BACKEND_DEPLOYMENT_ID
 * (FRONTEND_SCRIPT_ID/FRONTEND_DEPLOYMENT_ID are unused now that the frontend
 * project merged into this one — harmless to leave set, or remove.)
 * Owner must once enable the Apps Script API: script.google.com/home/usersettings
 */

/** Run this directly in the editor to debug redeploys — errors show in place. */
function debugRedeploy() {
    const result = redeployAll("debug-run");
    console.log(JSON.stringify(result, null, 2));
}

function redeployAll(label) {
    const props = PropertiesService.getScriptProperties();
    const scriptId = props.getProperty("BACKEND_SCRIPT_ID");
    const deploymentId = props.getProperty("BACKEND_DEPLOYMENT_ID");
    if (!scriptId || !deploymentId)
        throw new Error("Missing BACKEND_SCRIPT_ID/BACKEND_DEPLOYMENT_ID script properties.");
    const version = createVersion_(scriptId, label);
    updateDeployment_(scriptId, deploymentId, version, label);
    return { ok: true, label: label, results: [{ project: "backend", version: version }] };
}

function scriptApi_(method, path, body) {
    const res = UrlFetchApp.fetch(`https://script.googleapis.com/v1/${path}`, {
        method: method,
        contentType: "application/json",
        headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
        payload: body ? JSON.stringify(body) : undefined,
        muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300)
        throw new Error(`Apps Script API ${method} ${path} -> ${code}: ${res.getContentText().slice(0, 300)}`);
    return JSON.parse(res.getContentText() || "{}");
}

function createVersion_(scriptId, label) {
    return scriptApi_("post", `projects/${scriptId}/versions`, {
        description: label,
    }).versionNumber;
}

function updateDeployment_(scriptId, deploymentId, versionNumber, label) {
    scriptApi_("put", `projects/${scriptId}/deployments/${deploymentId}`, {
        deploymentConfig: {
            scriptId: scriptId,
            versionNumber: versionNumber,
            manifestFileName: "appsscript",
            description: label,
        },
    });
}
