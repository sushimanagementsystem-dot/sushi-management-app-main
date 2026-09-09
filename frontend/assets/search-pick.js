/**
 * Searchable picker for long lists (native <select> has no search on any
 * platform). Renders an <input> + filtered suggestion list inside wrapEl.
 *
 * opts.getItems(query) -> [{id, label}, ...] — caller applies its own
 *   filtering (category, already-picked, etc); query is lowercased.
 * opts.onSelect(item) -> called when the user taps a suggestion.
 * opts.placeholder
 *
 * Returns { input, refresh(), setLabel(text) }.
 */
function makeSearchPick(wrapEl, opts) {
    wrapEl.classList.add("searchpick");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = opts.placeholder || "Search…";
    input.autocomplete = "off";
    const sug = document.createElement("div");
    sug.className = "suggest";
    wrapEl.append(input, sug);

    const render = () => {
        const q = input.value.trim().toLowerCase();
        const items = opts.getItems(q);
        sug.innerHTML = "";
        items.slice(0, 40).forEach((it) => {
            const o = document.createElement("div");
            o.textContent = it.label;
            o.onclick = () => {
                input.value = it.label;
                sug.style.display = "none";
                opts.onSelect(it);
            };
            sug.appendChild(o);
        });
        sug.style.display = items.length ? "block" : "none";
    };
    input.addEventListener("focus", render);
    input.addEventListener("input", render);
    input.addEventListener("blur", () =>
        setTimeout(() => (sug.style.display = "none"), 150),
    );

    return {
        input: input,
        refresh: render,
        setLabel: (text) => (input.value = text || ""),
    };
}
