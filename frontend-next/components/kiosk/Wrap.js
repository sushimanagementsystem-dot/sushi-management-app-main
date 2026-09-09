/** Shared page-content container — ported from the `.wrap` class. */
export default function Wrap({ children, className = "" }) {
    return <div className={"mx-auto max-w-[30rem] px-4 pb-12 pt-4 " + className}>{children}</div>;
}
