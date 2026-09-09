import { Inter } from "next/font/google";
import "./globals.css";
import QueryProvider from "@/components/QueryProvider";
import DevAgentation from "@/components/DevAgentation";

// Self-hosted via next/font (no runtime network request, zero layout
// shift) — one typeface for the entire app, headings included (see
// tailwind.config.js's fontFamily comment for why no serif pairing).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// No title here on purpose: every route renders its own <title> via
// components/PageTitle.js (a Client Component). React 19 hoists whichever
// <title> elements exist anywhere in the tree into <head>, but the browser
// uses the FIRST one in document order for document.title/the tab title —
// so a static title here would permanently win over every page's own,
// since it's part of the server-rendered shell and always ends up first.
export const metadata = {
    icons: {
        icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🍣</text></svg>",
    },
};

export const viewport = {
    width: "device-width",
    initialScale: 1,
};

export default function RootLayout({ children }) {
    return (
        <html lang="en" className={inter.variable}>
            <body>
                <QueryProvider>{children}</QueryProvider>
                <DevAgentation />
            </body>
        </html>
    );
}
