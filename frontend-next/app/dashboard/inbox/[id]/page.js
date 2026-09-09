// The Action Inbox reads whichever id is in the URL client-side (see
// idFromPath() in ../page.js), exactly like the original's plain
// window.location.pathname parsing — this route just needs to exist so a
// direct visit/refresh at /dashboard/inbox/<id> resolves to the same page
// instead of a 404.
export { default } from "../page";
