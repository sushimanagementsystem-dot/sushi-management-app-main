/**
 * dashboard-common.js — shared sidebar shell for every /dashboard* page.
 * Loaded after common.js. Each dashboard page calls
 * initDashboard("<sectionKey>") once its markup is in place; it runs the
 * same requireRole("dashboard") gate every dashboard page needs, then
 * builds the sidebar (highlighting the active section) and reveals
 * #dashMain — which stays hidden until access is confirmed, same
 * reveal-after-auth pattern as home.html's menu.
 *
 * href is null for a section that hasn't been built yet — that's what
 * renders it as a disabled "soon" item instead of a link. Flip it to a
 * real path once that section's page exists.
 */
const DASHBOARD_SECTIONS = [
    { key: "overview", icon: "📊", label: "Overview", href: "/dashboard" },
    { key: "inbox", icon: "📥", label: "Action Inbox", href: "/dashboard/inbox" },
    { key: "kiosk-comparison", icon: "⚖️", label: "Kiosk Comparison", href: "/dashboard/kiosk-comparison" },
    { key: "stock-usage", icon: "📦", label: "Stock Usage View", href: "/dashboard/stock-usage" },
    { key: "tables", icon: "🗂️", label: "Data Tables", href: "/dashboard/tables" },
    { key: "settings", icon: "⚙️", label: "Settings", href: "/dashboard/settings" },
];

const DASH_COLLAPSE_KEY = "dash_sidebar_collapsed";

// Applied immediately, not gated behind the (async) role check — it's a
// stored UI preference with no permission implications, so doing it here
// avoids a flash of the expanded sidebar while requireRole() is in flight.
if (localStorage.getItem(DASH_COLLAPSE_KEY) === "1") {
    document.querySelector(".dash-shell").classList.add("dash-collapsed");
}

function initDashboard(activeKey) {
    return requireRole("dashboard").then((ok) => {
        if (!ok) return false;
        renderDashSidebar(activeKey);
        document.getElementById("dashMain").style.display = "";
        return true;
    });
}

function renderDashSidebar(activeKey) {
    const nav = document.getElementById("dashSidebar");

    const header = document.createElement("div");
    header.className = "dash-sidebar-header";
    header.innerHTML = '<div class="dash-sidebar-title">Owner Dashboard</div>';
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "dash-toggle";
    toggle.title = "Collapse/expand sidebar";
    toggle.textContent = "☰";
    toggle.addEventListener("click", toggleDashSidebar);
    header.appendChild(toggle);
    nav.appendChild(header);

    DASHBOARD_SECTIONS.forEach((s) => {
        const el = document.createElement(s.href ? "a" : "div");
        el.className =
            "dash-nav-item" +
            (s.key === activeKey ? " dash-nav-active" : "") +
            (s.href ? "" : " dash-nav-disabled");
        if (s.href) el.href = s.href;
        el.title = s.label + (s.href ? "" : " (coming soon)");
        el.innerHTML =
            '<span class="icon">' +
            s.icon +
            "</span><span>" +
            s.label +
            "</span>" +
            (s.href ? "" : '<span class="dash-nav-soon">soon</span>');
        if (s.href) {
            el.addEventListener("click", (e) => {
                if (!_unsavedGuard || !_unsavedGuard()) return;
                e.preventDefault();
                confirmModal("You have unsaved changes. Leave without saving?").then(
                    (leave) => {
                        if (leave) {
                            _unsavedGuard = null;
                            window.location.href = s.href;
                        }
                    },
                );
            });
        }
        nav.appendChild(el);
    });
}

function toggleDashSidebar() {
    const collapsed = document
        .querySelector(".dash-shell")
        .classList.toggle("dash-collapsed");
    localStorage.setItem(DASH_COLLAPSE_KEY, collapsed ? "1" : "0");
    // The sidebar's width transition changes .dash-main's actual width
    // without a window resize event firing, so anything sizing itself off
    // its container (e.g. a Tabulator grid) needs an explicit nudge.
    window.dispatchEvent(new CustomEvent("dash-sidebar-toggled"));
}

// --- Unsaved-changes guard, shared by every dashboard page ----------------
//
// setUnsavedGuard(fn) registers a predicate ("are there unsaved changes
// right now?") that both the sidebar's own link clicks and the browser's
// native reload/close prompt check before letting navigation through.
// Real page reload/tab-close can only ever show the browser's own native
// dialog (no site can replace that with custom UI — deliberate browser
// restriction) via beforeunload; in-app sidebar navigation is a normal
// click we control, so that gets the real styled confirmModal() instead.

let _unsavedGuard = null;

function setUnsavedGuard(fn) {
    _unsavedGuard = fn;
}

window.addEventListener("beforeunload", (e) => {
    if (!_unsavedGuard || !_unsavedGuard()) return;
    e.preventDefault();
    e.returnValue = "";
});

/** Styled yes/no confirmation, reusing the same .modal-* look as
 * "add row" forms. Resolves true if the user chose to proceed.
 * confirmLabel defaults to "Leave" (the original nav-guard use case) —
 * pass something like "Delete" for other confirmations. */
function confirmModal(message, confirmLabel) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        overlay.innerHTML =
            '<div class="modal-box"><p>' +
            message +
            '</p><div class="modal-actions">' +
            '<button class="dash-btn" id="confirmCancel" style="background:var(--line);color:var(--ink)">Cancel</button>' +
            '<button class="dash-btn" id="confirmLeave">' +
            (confirmLabel || "Leave") +
            "</button></div></div>";
        document.body.appendChild(overlay);
        overlay.querySelector("#confirmCancel").addEventListener("click", () => {
            overlay.remove();
            resolve(false);
        });
        overlay.querySelector("#confirmLeave").addEventListener("click", () => {
            overlay.remove();
            resolve(true);
        });
    });
}
