"use client";

/**
 * Sets the document title from within a Client Component tree. React 19
 * natively hoists a <title> rendered anywhere in the component tree up
 * into <head> — this is the correct way to do this now. A plain
 * `document.title = "..."` mutation inside a useEffect does NOT work
 * reliably here: the root layout's static metadata title is itself
 * rendered as a React-managed <title> element, and any later re-render
 * higher in the tree (e.g. from an async fetch's setState call shortly
 * after mount — exactly what every page here does) makes React
 * reconcile the DOM back to match its own tree, silently overwriting the
 * imperative mutation. Rendering our own <title> here instead makes it
 * part of that same reconciliation, so it wins consistently.
 */
export default function PageTitle({ title }) {
    if (!title) return null;
    return <title>{title}</title>;
}
