/**
 * Upload.js — shared file-upload plumbing. Staff pick a file, the browser
 * base64-encodes it into the payload; the backend decodes and saves it to
 * Drive under UPLOADS_FOLDER_ID (Script Property, one folder — organized by
 * filename prefix, not subfolders, to avoid folder-lookup races/quota).
 */

/**
 * file = { base64, mimeType, name }. Returns { id, url, name } for the saved
 * Drive file. Throws on failure — callers decide how to handle it (a
 * required photo should fail the submission, not go missing).
 */
function saveUpload_(file, kioskId, formType) {
    const folderId = PropertiesService.getScriptProperties().getProperty("UPLOADS_FOLDER_ID");
    if (!folderId) throw new Error("UPLOADS_FOLDER_ID is not configured.");

    const bytes = Utilities.base64Decode(file.base64);
    const blob = Utilities.newBlob(bytes, file.mimeType || "application/octet-stream", file.name || "upload");
    const stamped = `${formType}_${kioskId}_${nowStamp().replace(/[: ]/g, "-")}_${blob.getName()}`;
    blob.setName(stamped);

    const folder = DriveApp.getFolderById(folderId);
    const driveFile = folder.createFile(blob);
    return { id: driveFile.getId(), url: driveFile.getUrl(), name: stamped };
}
