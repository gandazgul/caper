import { assertEquals } from "@std/assert";
import { walk } from "@std/fs/walk";

/**
 * ENGINE BOUNDARY GATE (ADR 0005, step 1).
 *
 * The Engine must be game-agnostic: no engine source file may import from
 * outside the engine directory. The rule: a "../" specifier is fine as long as
 * it resolves to another path INSIDE the engine source directory (engine-internal, e.g.
 * `behaviors/walker.js` → `../PropEngine.js`); it's a violation only when it
 * escapes the engine dir (e.g. `../content/items.js`, `../config.js`). Sibling
 * ("./Foo.js") and bare ("phaser", "@std/...") specifiers are always fine. The
 * check covers real imports (static, re-export, and dynamic) as well as JSDoc
 * type-imports, because all of them couple the engine to game code and all must
 * be gone before the engine can live as its own package.
 *
 * This is a RATCHET. `KNOWN_VIOLATIONS` is the current debt, keyed by engine
 * file → the set of "../" specifiers it still uses. The test fails if:
 *   - a NEW violation appears (a new file, or a new "../" specifier) — don't
 *     grow the engine→game coupling; invert the dependency (Config / registry)
 *     instead, OR
 *   - an allowlisted specifier is GONE — you fixed one, so delete its entry
 *     here (this keeps the list honest and shrinking).
 *
 * When `KNOWN_VIOLATIONS` is empty, delete it and this header, leaving a hard
 * zero-"../" gate — then the engine is extraction-ready.
 *
 * @type {Record<string, string[]>}
 */
const KNOWN_VIOLATIONS = {};

const ENGINE_DIR = import.meta.dirname;

/** Matches `from "x"`, `import "x"`, dynamic/JSDoc `import("x")`. */
const SPECIFIER_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

/** @returns {Promise<Map<string, Set<string>>>} engine file → set of "../" specifiers */
async function collectParentImports() {
    /** @type {Map<string, Set<string>>} */
    const found = new Map();
    for await (
        const entry of walk(ENGINE_DIR, {
            exts: [".js"],
            skip: [/\.test\.js$/],
            includeDirs: false,
        })
    ) {
        const source = await Deno.readTextFile(entry.path);
        const rel = entry.path.slice(ENGINE_DIR.length + 1);
        const fileUrl = new URL("file://" + entry.path);
        for (const match of source.matchAll(SPECIFIER_RE)) {
            const spec = match[1];
            if (!spec.startsWith("../")) continue;
            // Resolve the specifier against the file; flag it only if it lands
            // outside the engine dir (engine-internal "../" stays in-bounds).
            const resolved = new URL(spec, fileUrl).pathname;
            if (resolved.startsWith(ENGINE_DIR + "/")) continue;
            if (!found.has(rel)) found.set(rel, new Set());
            found.get(rel).add(spec);
        }
    }
    return found;
}

Deno.test({
    name: "engine has no NEW out-of-bounds imports (ADR 0005 boundary gate)",
    permissions: { read: [import.meta.dirname] },
    async fn() {
        const found = await collectParentImports();
        /** @type {string[]} */
        const newViolations = [];
        for (const [file, specs] of found) {
            const allowed = new Set(KNOWN_VIOLATIONS[file] ?? []);
            for (const spec of specs) {
                if (!allowed.has(spec)) newViolations.push(`${file} → ${spec}`);
            }
        }
        assertEquals(
            newViolations,
            [],
            "New engine→game coupling introduced. The engine must not import game code — " +
                "invert the dependency (Config / registry) instead of adding these:\n  " +
                newViolations.join("\n  "),
        );
    },
});

Deno.test({
    name: "engine boundary allowlist is not stale (delete fixed entries)",
    permissions: { read: [import.meta.dirname] },
    async fn() {
        const found = await collectParentImports();
        /** @type {string[]} */
        const stale = [];
        for (const [file, specs] of Object.entries(KNOWN_VIOLATIONS)) {
            const actual = found.get(file) ?? new Set();
            for (const spec of specs) {
                if (!actual.has(spec)) stale.push(`${file} → ${spec}`);
            }
        }
        assertEquals(
            stale,
            [],
            "These allowlisted violations are gone — nice. Delete them from KNOWN_VIOLATIONS " +
                "so the ratchet stays tight:\n  " + stale.join("\n  "),
        );
    },
});
