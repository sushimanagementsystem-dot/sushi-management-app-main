/**
 * The one Help / Info pattern for the whole dashboard: a small "?" button that opens an explanation popover.
 *
 * Plain DOM on purpose (no React state): React pages use it through components/dashboard/HelpTip.js, and the Data Tables
 * grid — which is built with plain DOM rather than React — uses createHelpButton() directly, so a "?" looks and behaves
 * exactly the same everywhere. Only one popover is ever open at a time.
 *
 * Behaviour
 *  - Hover (mouse): opens after a short delay, closes when the pointer leaves the "?" and the popover.
 *  - Click / tap / Enter / Space: opens and pins it, so it can be read (or scrolled) at leisure and works on touch screens.
 *    A pinned popover closes on another click, on clicking anywhere else, or on Escape.
 *  - Positioned next to the "?" and kept inside the screen (flips above when there is no room below); on narrow
 *    screens it uses the full width minus a small margin, and scrolls inside itself if it is taller than the screen.
 *  - Content is only ever inserted as text, never as HTML.
 */
import { getHelp } from "./content";

const SHOW_DELAY_MS = 140;
const HIDE_DELAY_MS = 220;
const MARGIN = 12;
const GAP = 8;
const MAX_WIDTH = 368;

const BUTTON_CLASS =
    "relative inline-flex h-[1.1rem] w-[1.1rem] flex-none cursor-help items-center justify-center rounded-full border border-line bg-panel " +
    "align-middle text-[0.7rem] font-bold normal-case leading-none tracking-normal text-muted shadow-none transition-colors duration-150 " +
    "before:absolute before:-inset-[0.45rem] before:content-[''] hover:border-accent/50 hover:bg-accent-soft hover:text-accent " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-expanded:border-accent aria-expanded:bg-accent-soft aria-expanded:text-accent";

const POPOVER_CLASS =
    "fixed z-[100] overflow-y-auto rounded-card border border-line bg-card p-3.5 text-left text-[0.82rem] font-normal normal-case leading-relaxed " +
    "tracking-normal text-ink shadow-elevate-3";

const SECTIONS = [
    ["what", "What it is"],
    ["why", "Why it exists"],
    ["how", "How it works"],
    ["use", "How to use it"],
];

let seq = 0;
let current = null; // { anchor, popover, pinned }
let showTimer = null;
let hideTimer = null;
let listening = false;

function clearTimers() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = null;
    hideTimer = null;
}

function buildPopover(entry, id) {
    const el = document.createElement("div");
    el.id = id;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Help: " + entry.title);
    el.className = POPOVER_CLASS;
    el.style.width = "min(" + MAX_WIDTH + "px, calc(100vw - " + MARGIN * 2 + "px))";
    el.style.maxHeight = "calc(100vh - " + MARGIN * 2 + "px)";

    const title = document.createElement("div");
    title.className = "mb-1.5 flex items-start justify-between gap-2 text-[0.9rem] font-semibold text-ink";
    const titleText = document.createElement("span");
    titleText.textContent = entry.title;
    title.appendChild(titleText);
    if (entry.unused) {
        const badge = document.createElement("span");
        badge.className = "flex-none rounded-full bg-warn-bg px-2 py-0.5 text-[0.68rem] font-semibold text-warn-ink";
        badge.textContent = "Not used yet";
        title.appendChild(badge);
    }
    el.appendChild(title);

    for (const [key, label] of SECTIONS) {
        if (!entry[key]) continue;
        const block = document.createElement("div");
        block.className = "mt-2";
        const heading = document.createElement("div");
        heading.className = "text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted";
        heading.textContent = label;
        const body = document.createElement("p");
        body.className = "m-0 mt-0.5 text-ink";
        body.textContent = entry[key];
        block.append(heading, body);
        el.appendChild(block);
    }

    if (entry.affects && entry.affects.length) {
        const block = document.createElement("div");
        block.className = "mt-2";
        const heading = document.createElement("div");
        heading.className = "text-[0.68rem] font-bold uppercase tracking-[0.06em] text-muted";
        heading.textContent = "Connected to";
        const list = document.createElement("ul");
        list.className = "m-0 mt-0.5 list-disc pl-[1.1rem] text-ink";
        for (const line of entry.affects) {
            const li = document.createElement("li");
            li.textContent = line;
            list.appendChild(li);
        }
        block.append(heading, list);
        el.appendChild(block);
    }

    if (entry.note) {
        const note = document.createElement("div");
        note.className = "mt-2.5 rounded-lg border border-warn-border bg-warn-bg px-2.5 py-2 text-[0.78rem] text-warn-ink";
        note.textContent = entry.note;
        el.appendChild(note);
    }
    return el;
}

function place(anchor, popover) {
    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

    const below = vh - rect.bottom - GAP - MARGIN;
    const above = rect.top - GAP - MARGIN;
    let top;
    if (height <= below || below >= above) top = rect.bottom + GAP;
    else top = rect.top - GAP - Math.min(height, above);
    top = Math.max(MARGIN, Math.min(top, vh - Math.min(height, vh - MARGIN * 2) - MARGIN));

    popover.style.left = left + "px";
    popover.style.top = top + "px";
}

function reposition() {
    if (!current) return;
    if (!current.anchor.isConnected) return close();
    place(current.anchor, current.popover);
}

function onDocPointerDown(e) {
    if (!current) return;
    if (current.popover.contains(e.target) || current.anchor.contains(e.target)) return;
    close();
}

function onDocKeyDown(e) {
    if (e.key === "Escape" && current) {
        const anchor = current.anchor;
        const wasPinned = current.pinned;
        close();
        if (wasPinned) anchor.focus();
    }
}

function listen(on) {
    if (on === listening) return;
    listening = on;
    const fn = on ? "addEventListener" : "removeEventListener";
    document[fn]("pointerdown", onDocPointerDown, true);
    document[fn]("keydown", onDocKeyDown, true);
    window[fn]("resize", reposition);
    window[fn]("scroll", reposition, true);
}

function close() {
    clearTimers();
    if (!current) return;
    current.anchor.setAttribute("aria-expanded", "false");
    current.anchor.removeAttribute("aria-controls");
    current.popover.remove();
    current = null;
    listen(false);
}

function open(anchor, entry, pinned) {
    clearTimers();
    if (current && current.anchor === anchor) {
        if (pinned) current.pinned = true;
        return;
    }
    close();
    const id = "help-popover-" + ++seq;
    const popover = buildPopover(entry, id);
    popover.style.visibility = "hidden";
    document.body.appendChild(popover);
    current = { anchor, popover, pinned };
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", id);
    place(anchor, popover);
    popover.style.visibility = "";
    popover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    popover.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "mouse") scheduleHide(anchor);
    });
    listen(true);
}

function scheduleHide(anchor) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
        if (current && current.anchor === anchor && !current.pinned) close();
    }, HIDE_DELAY_MS);
}

/**
 * Builds the "?" button for a help entry (an id from lib/help/content.js, or an entry object). Returns null when the
 * id is unknown so a missing entry never leaves a dead "?" on screen.
 */
export function createHelpButton(idOrEntry) {
    const entry = typeof idOrEntry === "string" ? getHelp(idOrEntry) : idOrEntry;
    if (!entry) {
        if (typeof console !== "undefined") console.warn("[help] no help entry for", idOrEntry);
        return null;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.textContent = "?";
    button.setAttribute("aria-label", "Help: " + entry.title);
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.dataset.help = typeof idOrEntry === "string" ? idOrEntry : entry.title;

    button.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(hideTimer);
        clearTimeout(showTimer);
        showTimer = setTimeout(() => open(button, entry, false), SHOW_DELAY_MS);
    });
    button.addEventListener("pointerleave", (e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(showTimer);
        scheduleHide(button);
    });
    button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation(); // sits inside sortable headers / clickable cards — must not trigger them
        if (current && current.anchor === button && current.pinned) close();
        else {
            const wasOpen = current && current.anchor === button;
            if (wasOpen) current.pinned = true;
            else open(button, entry, true);
        }
    });
    // Sortable table headers and cards react to mousedown/pointerdown too.
    button.addEventListener("mousedown", (e) => e.stopPropagation());
    return button;
}

/** Closes any open help popover (e.g. before a page navigates). */
export function closeHelp() {
    close();
}
