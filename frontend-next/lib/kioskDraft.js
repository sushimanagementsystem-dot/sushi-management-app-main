"use client";

// Shared browser-storage draft persistence for long kiosk forms (Monthly Audit, Weekly Stocktake) — these
// used to live only in React state, so a page reload, accidental back-navigation, or tab close mid-fill
// wiped everything the staff member had entered. Saved on every change and restored on load instead.
//
// IndexedDB, not localStorage: Monthly Audit's evidence photos (even compressed) can add up past
// localStorage's typical 5-10MB per-origin quota, especially on mobile — once that quota is hit, every
// further write throws and is silently dropped (the user keeps seeing their answers on screen; only the
// save fails). IndexedDB's quota is a large fraction of free disk space, so the same mechanism is reused
// for lighter forms like Weekly Stocktake even though they don't strictly need the extra headroom.
const DRAFT_DB_NAME = "sushi_kiosk_drafts";
const DRAFT_STORE_NAME = "drafts";

function openDraftDb() {
    return new Promise((resolve, reject) => {
        const req = window.indexedDB.open(DRAFT_DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(DRAFT_STORE_NAME)) req.result.createObjectStore(DRAFT_STORE_NAME);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    try {
        const db = await openDraftDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(DRAFT_STORE_NAME, "readonly");
            const req = tx.objectStore(DRAFT_STORE_NAME).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
        });
    } catch {
        return null; // private browsing, storage disabled, or corrupt data — fall back to a blank form, never crash
    }
}

async function idbSet(key, value) {
    try {
        const db = await openDraftDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
            tx.objectStore(DRAFT_STORE_NAME).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // Storage unavailable — the in-memory state the user can still see and submit right now is
        // unaffected; only "survives a page reload" is lost.
    }
}

async function idbDelete(key) {
    try {
        const db = await openDraftDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(DRAFT_STORE_NAME, "readwrite");
            tx.objectStore(DRAFT_STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        // Nothing to clean up if storage was never usable in the first place.
    }
}

/**
 * formKey: a short tag ("monthly_audit", "weekly_stocktake") so each form's draft lives under its own
 * IndexedDB key, scoped further by kiosk slug. A draft from a different businessDate than the one passed
 * to load() is a prior, already-submitted day — treated as stale and ignored rather than resurrected.
 */
export function makeFormDraft(formKey) {
    const draftKey = (slug) => `${formKey}_draft_${slug}`;
    return {
        async load(slug, businessDate) {
            const parsed = await idbGet(draftKey(slug));
            if (!parsed || parsed.businessDate !== businessDate) return null;
            return parsed;
        },
        async save(slug, businessDate, data) {
            await idbSet(draftKey(slug), { businessDate, ...data });
        },
        async clear(slug) {
            await idbDelete(draftKey(slug));
        },
    };
}
