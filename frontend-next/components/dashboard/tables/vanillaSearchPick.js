/**
 * Searchable picker for long lists (native <select> has no search on any
 * platform) — a plain-DOM port of components/SearchPick.js for use inside
 * DataGrid.js, which owns its own imperative DOM tree (Tabulator cells,
 * floating popups, modals) rather than a React tree, so the React
 * SearchPick component isn't reachable there. Same API as the original
 * frontend's assets/search-pick.js (wrapEl, opts) -> { input, refresh,
 * setLabel }. Pure Tailwind utility classes, no custom CSS.
 *
 * opts.getItems(query) -> [{id, label}, ...] — caller applies its own
 *   filtering (category, already-picked, etc); query is lowercased.
 * opts.onSelect(item) -> called when the user taps a suggestion.
 * opts.placeholder
 */
export function makeSearchPick(wrapEl, opts) {
    wrapEl.className = (wrapEl.className ? wrapEl.className + " " : "") + "relative";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = opts.placeholder || "Search…";
    input.autocomplete = "off";
    input.className = "w-full";
    const sug = document.createElement("div");
    sug.className =
        "absolute left-0 right-0 top-[calc(100%+2px)] z-30 hidden max-h-[40vh] overflow-y-auto rounded border border-line bg-white shadow-[0_6px_16px_rgba(16,24,40,0.12)]";
    wrapEl.append(input, sug);

    const render = () => {
        const q = input.value.trim().toLowerCase();
        const items = opts.getItems(q);
        sug.innerHTML = "";
        items.slice(0, 40).forEach((it) => {
            const o = document.createElement("div");
            o.className = "cursor-pointer border-b border-line px-[0.8rem] py-[0.7rem] last:border-b-0 active:bg-panel";
            o.textContent = it.label;
            o.onclick = () => {
                input.value = it.label;
                sug.classList.add("hidden");
                opts.onSelect(it);
            };
            sug.appendChild(o);
        });
        sug.classList.toggle("hidden", items.length === 0);
    };
    input.addEventListener("focus", render);
    input.addEventListener("input", render);
    input.addEventListener("blur", () => setTimeout(() => sug.classList.add("hidden"), 150));

    return {
        input: input,
        refresh: render,
        setLabel: (text) => (input.value = text || ""),
    };
}
