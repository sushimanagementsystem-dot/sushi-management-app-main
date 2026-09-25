import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Keeps the dashboard's Help / Info text honest. The help lives in the frontend (frontend-next/lib/help/content.js),
 * but what it says about the system has to match this backend, so these checks read both:
 *  - every "?" used on a page points at an entry that exists (no dead icons);
 *  - every entry is complete and short enough to read;
 *  - a setting the help calls "not used" really is never read anywhere in this backend, and a setting it describes as
 *    doing something really is read (so help can't quietly go stale when a setting is wired up or removed).
 */
const FRONTEND = resolve(__dirname, "../../../frontend-next");
const BACKEND_SRC = resolve(__dirname, "..");

type Entry = { title: string; what?: string; why?: string; how?: string; use?: string; affects?: string[]; note?: string; unused?: boolean; dormant?: boolean };

async function loadHelp(): Promise<Record<string, Entry>> {
    const mod = await import(pathToFileURL(join(FRONTEND, "lib/help/content.js")).href);
    return mod.HELP as Record<string, Entry>;
}

function walk(dir: string, accept: (file: string) => boolean, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".next") continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, accept, out);
        else if (accept(full)) out.push(full);
    }
    return out;
}

/** Every setting key the backend reads (anything mentioned in non-spec source). */
function backendMentions(key: string, files: string[]): number {
    return files.filter((f) => readFileSync(f, "utf8").includes(key)).length;
}

describe("dashboard help content", () => {
    it("every entry is complete and concise", async () => {
        const HELP = await loadHelp();
        const ids = Object.keys(HELP);
        expect(ids.length).toBeGreaterThan(40);
        for (const id of ids) {
            const e = HELP[id]!;
            expect(e.title, id).toBeTruthy();
            expect(e.what, `${id} needs a "what"`).toBeTruthy();
            const words = [e.what, e.why, e.how, e.use, e.note, ...(e.affects ?? [])].filter(Boolean).join(" ").split(/\s+/).length;
            expect(words, `${id} is too long to read comfortably (${words} words)`).toBeLessThanOrEqual(150);
            for (const text of [e.what, e.why, e.how, e.use, e.note, ...(e.affects ?? [])]) {
                if (text) expect(text, id).not.toMatch(/<[a-z][^>]*>|TODO|lorem/i); // plain text only, nothing unfinished
            }
        }
    });

    it("every help id referenced by a page exists", async () => {
        const HELP = await loadHelp();
        const files = walk(join(FRONTEND, "app"), (f) => f.endsWith(".js")).concat(walk(join(FRONTEND, "components"), (f) => f.endsWith(".js")));
        const referenced = new Set<string>();
        for (const f of files) {
            const src = readFileSync(f, "utf8");
            for (const m of src.matchAll(/\bhelp[:=]\s*[{]?\s*"([A-Za-z0-9_.]+)"/g)) referenced.add(m[1]!);
            for (const m of src.matchAll(/<HelpTip id="([A-Za-z0-9_.]+)"/g)) referenced.add(m[1]!);
        }
        expect(referenced.size).toBeGreaterThan(30);
        const missing = [...referenced].filter((id) => !HELP[id]);
        expect(missing).toEqual([]);
    });

    it("every setting on the Settings page has an explanation", async () => {
        const HELP = await loadHelp();
        const page = readFileSync(join(FRONTEND, "app/dashboard/settings/page.js"), "utf8");
        const keys = [...page.matchAll(/"([A-Z][A-Z0-9_]{5,})"/g)].map((m) => m[1]!).filter((k) => /_/.test(k) && !/^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)$/.test(k) && !/_(picker|list)$/i.test(k));
        const settingKeys = [...new Set(keys)].filter((k) => k === k.toUpperCase());
        expect(settingKeys.length).toBeGreaterThan(40);
        const missing = settingKeys.filter((k) => !HELP["setting." + k]);
        expect(missing).toEqual([]);
    });

    it("what the help says about a setting matches whether the backend really reads it", async () => {
        const HELP = await loadHelp();
        const files = walk(BACKEND_SRC, (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"));
        const settingIds = Object.keys(HELP).filter((id) => id.startsWith("setting."));
        expect(settingIds.length).toBeGreaterThan(40);
        for (const id of settingIds) {
            const key = id.slice("setting.".length);
            const e = HELP[id]!;
            const mentions = backendMentions(key, files);
            if (e.unused) expect(mentions, `${key} is described as never read, but the backend reads it`).toBe(0);
            else expect(mentions, `${key} is described as doing something, but the backend never reads it`).toBeGreaterThan(0);
        }
    });
});
