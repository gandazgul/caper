---
planId: "d77784f2-4709-46a5-b7a1-6e0343ba677b"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "HIGH"
affectedPaths:
  - "package.json"
  - "deno.json"
  - "deno.lock"
  - "bun.lock"
  - ".bun-version"
  - ".oxlintrc.json"
  - ".oxfmtrc.json"
  - "tsconfig.json"
  - "tsconfig.check.json"
  - "tsconfig.bundle.json"
  - "mod.js"
  - "mod.d.ts"
  - "scripts/fix-phaser-dts.ts"
  - "src/**/*.test.js"
  - ".github/workflows/ci.yml"
  - ".github/workflows/publish.yml"
  - "README.md"
  - "CONTEXT.md"
  - "docs/"
  - "examples/starter/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-10-17"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
targetBranch: "main"
deliveryBranch: "main"
status: "reviewed"
validatedCommit: "4b80f14b214368edc3601f49b554c3ac5c47ad86"
workRecord:
  status: "generated"
  recordId: "4549d337-5550-4c42-9e25-82f89688add5"
  path: "docs/work-records/2026-10-17-bun-development-and-npm-package-configuration.md"
  lastAttemptAt: "2026-10-17T22:57:04.848Z"
---

# Migrate Caper from Deno and JSR to Bun and npm

## Context

Caper is developed with Deno and published to JSR as `@caper/engine`. The user wants to develop with Bun and publish to
npm instead.

Deno and JSR are used in these places today:

```text
deno.json                     # tasks, import map (phaser, @std/assert, @std/fs), fmt/lint rules, compilerOptions, JSR publish excludes
deno.lock                     # Deno lockfile (phaser 3.90.0, typescript 6.0.3, dts-bundle-generator 9.5.1)
mod.js                        # `// @ts-self-types="./mod.d.ts"` (Deno/JSR-only directive)
scripts/fix-phaser-dts.ts     # Deno.readTextFile / Deno.writeTextFile
src/**/*.test.js              # 13 files, 51 Deno.test cases, @std/assert (assert, assertEquals, assertStrictEquals, assertThrows, assertRejects)
.github/workflows/ci.yml      # setup-deno, deno task ci
.github/workflows/publish.yml # JSR OIDC publish on v* tags
README.md, CONTEXT.md, docs/hello-world.md, examples/starter/README.md  # Deno and JSR instructions
```

No PRD or ADR covers the toolchain. `docs/domain-language.md` does not use Deno or JSR terms, so the glossary does not
change.

### Decisions from planning

- **npm package name: `@gandazgul/caper-engine`.** This is the user's choice. `@gandazgul` is the user's npm
  namespace. A `caper` scope exists on npm: `registry.npmjs.org/-/org/caper/package` returns 200 with no packages,
  and an unknown scope returns 404. This check does not show who owns the `caper` scope, and the name choice does not
  depend on it. Every `@caper/engine` import in docs and the starter changes to the new name.
- **Phaser is a `peerDependency` (`^3.86.0`).** The game installs Phaser, so the engine and the game share one Phaser
  copy. The repository pins `phaser@3.90.0` as a devDependency. That is the version Deno resolves today.
- **Stay in the Bun ecosystem. Use standalone tools only where Bun has no equivalent.** Most Bun projects do this. Bun
  supplies the runtime, the package manager, the script runner and the test runner (`bun test`). Bun has no linter,
  formatter or type checker, so:
  - **Oxlint** replaces `deno lint`.
  - **Oxfmt** replaces `deno fmt`. It also formats Markdown, which keeps the docs formatted as they are today.
  - **`tsc`** replaces `deno check`. `tsc` already generates the declarations.
  - Vite+ is not used, because it brings Vitest and Node management, which overlap with Bun.
- **Publishing uses npm Trusted Publishing.** The `v*` tag workflow uses OpenID Connect (OIDC) and needs no npm
  token. It also makes provenance. npm needs one manual first publish before you can set up the trusted publisher.

## Objective

After this change:

- `bun install` and `bun run ci` are the complete development loop.
- Pushing a `v*` tag publishes `@gandazgul/caper-engine` to npm, with types.
- No Deno or JSR configuration, API or instructions remain.
- The 51 existing tests keep the same assertions.

## Approach

`package.json` replaces `deno.json` as the single project manifest. The `ci` script runs the same checks in the same
order as today. Only the tool behind each check changes:

| `deno.json` task | `package.json` script | New tool                                                                                   |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| `lint`           | `lint`                | `oxlint`                                                                                   |
| `fmt:check`      | `fmt:check`           | `oxfmt --check` (same paths as today)                                                      |
| `check`          | `check`               | `tsc -p tsconfig.check.json` (no emit, includes tests, Bun types)                          |
| `dts:check`      | `dts:check`           | `tsc` → `dts-bundle-generator` → `bun scripts/fix-phaser-dts.ts` → `git diff --exit-code` |
| `test`           | `test`                | `bun test src/`                                                                            |
| `starter*`       | `starter*`            | `vite` from devDependencies                                                                |

The published package shape:

```json
{
    "name": "@gandazgul/caper-engine",
    "type": "module",
    "exports": { ".": { "types": "./mod.d.ts", "default": "./mod.js" } },
    "types": "./mod.d.ts",
    "files": ["mod.js", "mod.d.ts", "src/**/*.js", "!src/**/*.test.js"],
    "peerDependencies": { "phaser": "^3.86.0" },
    "repository": { "type": "git", "url": "git+https://github.com/gandazgul/caper.git" },
    "publishConfig": { "access": "public" }
}
```

> [!NOTE]
> **The `repository` field is required**
>
> Trusted Publishing rejects a publish when `repository.url` does not match the GitHub repository that runs the
> workflow (`gandazgul/caper`). A scoped package also needs `access: public`, otherwise npm publishes it as private.

The test conversion is mechanical. It must keep each assertion at least as strict as it is today:

```text
Deno.test(name, fn)               -> test(name, fn)            (import { expect, test } from "bun:test")
assertEquals(a, b)                -> expect(a).toStrictEqual(b) (checks undefined keys and classes, like @std/assert)
assertStrictEquals(a, b)          -> expect(a).toBe(b)
assert(x)                         -> expect(x).toBeTruthy()
assertThrows(fn, Error, "msg")    -> expect(fn).toThrow("msg")
await assertRejects(fn, Klass)    -> await expect(fn()).rejects.toThrow(Klass)   (or the promise itself when fn returns an existing promise)
```

> [!WARNING]
> **Oxfmt reformats the codebase once**
>
> Oxfmt follows Prettier style, and `deno fmt` does not, so the first `bun run fmt` changes many files. This is a
> formatting-only diff. The test suite and `dts:check` prove that behavior is the same. Do the reformat as its own
> step, so a reviewer can tell it apart from the logic changes.

Publishing runs on npm, because Trusted Publishing needs the npm CLI 11.5.1 or later. Bun does all other work in the
workflow.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

```diff
+package.json              # manifest: name, exports, files, peer/dev deps, scripts
+bun.lock                  # Bun text lockfile
+.bun-version              # Bun version for CI (1.4.3)
+.oxlintrc.json            # lint config (ignores mod.d.ts, types/, dist/)
+.oxfmtrc.json             # 4-space, 120 cols, semicolons, double quotes
+tsconfig.check.json       # no-emit type check of mod.js + src incl. tests
-deno.json                 # replaced by package.json and the configs above
-deno.lock                 # replaced by bun.lock
```

- `mod.js` — remove the Deno-only `// @ts-self-types` line. `package.json` `exports.types` now gives the types.
- `mod.d.ts` — regenerated. It changes only if the pinned `tsc` output differs.
- `scripts/fix-phaser-dts.ts` — uses `Bun.file`/`Bun.write`. The comment refers to `tsc`, not to JSR fast-check.
- `src/**/*.test.js` — the 13 files use `bun:test`. The test names and cases stay the same.
- `tsconfig.json` — stays the declaration-emit config. The comment in `tsconfig.bundle.json` refers to `bun run dts`.
- `.github/workflows/ci.yml` and `publish.yml` — use Bun. The publish workflow uses npm Trusted Publishing.
- `README.md` — Install, Runnable starter, Local development, Development, Types and Publishing sections.
- `CONTEXT.md` — toolchain, test framework, CI and publishing facts.
- `docs/*.md` — the package name in imports (assets, cutscenes, hello-world, index, inventory, npc-and-cast,
  transitions, ui-helpers). `hello-world.md` prerequisites and run commands.
- `examples/starter/vite.config.js`, `main.js`, `README.md` — the new package name and the Bun commands.

Out of scope: engine source behavior, the public API surface, and `docs/adr/` (no ADR covers the toolchain).

## Reuse Opportunities

- `tsconfig.json` and `tsconfig.bundle.json` — the existing declaration pipeline. `tsconfig.check.json` extends
  `tsconfig.json` and does not duplicate its compiler options.
- The `deno.json` `fmt` block (4 spaces, 120 columns, semicolons, double quotes) and its path list are the source for
  `.oxfmtrc.json` and the `fmt` scripts.
- The `deno.json` `exclude` and `publish.exclude` lists are the source for the oxlint ignore patterns and the
  package.json `files` field.
- `examples/starter/vite.config.js` — keep its alias and its `dedupe: ["phaser"]` setting. Only the alias key changes.

## Implementation Steps

1. `package.json` exists with these fields:
   - `name` `@gandazgul/caper-engine` and `version` `0.5.0`.
   - `license` `MIT` and `type` `module`.
   - The `exports`, `types`, `files`, `repository` and `publishConfig` fields shown in Approach.
   - `peerDependencies.phaser` `^3.86.0`.
   - `devDependencies` pinned to exact versions: `phaser` `3.90.0`, `typescript` `6.0.3`, `dts-bundle-generator`
     `9.5.1`, `vite` `8.0.8`, `@types/bun`, `oxlint`, `oxfmt`.
   - `scripts` `lint`, `fmt`, `fmt:check`, `check`, `types`, `dts`, `dts:check`, `test`, `ci`, `starter`,
     `starter:build` and `starter:preview`. Each script does what its Approach table row describes.
   - `ci` runs `lint`, `fmt:check`, `check`, `dts:check` and `test` in that order and stops at the first failure.
2. `bun.lock` is committed. `bun install --frozen-lockfile` succeeds on a clean checkout. `deno.json` and `deno.lock`
   are deleted.
3. `.bun-version` contains `1.4.3`.
4. `.oxfmtrc.json` sets `printWidth` 120, `tabWidth` 4, `useTabs` false, `semi` true and `singleQuote` false.
   `fmt` and `fmt:check` cover the paths that `deno fmt` covers today: `mod.js`, `src/`, `docs/`,
   `examples/starter/`, `README.md` and `package.json`. Do not format `mod.d.ts`. The formatting-only change is in a
   separate commit, and `bun run fmt:check` passes.
5. `.oxlintrc.json` ignores `mod.d.ts`, `types/`, `dist/`, `**/.vite/` and `examples/starter/dist/`. `bun run lint`
   passes with no errors. Fix each finding in the source. When you disable a rule instead, give the reason in the
   config. A blanket ignore of `src/` does not satisfy this step.
6. `tsconfig.check.json` extends `tsconfig.json` and sets `noEmit` true and `types` `["bun"]`. It includes
   `mod.js`, `src/**/*.js` and `src/**/*.test.js`. `bun run check` passes. The test files get the same `checkJs`
   strictness as source files: no `@ts-nocheck`, and no exclusion of the test files.
7. All 13 `src/**/*.test.js` files import from `bun:test` and use the mapping in Approach. No file imports
   `@std/assert` or references `Deno`. The test names do not change. `bun test src/` reports 51 passing tests and 0
   failures.
8. `scripts/fix-phaser-dts.ts` runs under Bun with `Bun.file(path).text()` and `Bun.write`. It still strips
   `import("phaser").Phaser.` to `import("phaser").`. `bun run dts:check` passes against the committed `mod.d.ts`.
9. `mod.js` has no `// @ts-self-types` line. It still exports the same names as before.
10. `.github/workflows/ci.yml` uses `oven-sh/setup-bun@v2` with `bun-version-file: .bun-version`. It runs
    `bun install --frozen-lockfile` and then `bun run ci`. It does not mention Deno.
11. `.github/workflows/publish.yml` is named "Publish to npm" and runs on `v*` tags. It has `id-token: write` and
    `contents: read` permissions. The workflow does these steps in order:
    1. Install Bun from `.bun-version` and run `bun install --frozen-lockfile`.
    2. Run `bun run ci`.
    3. Fail when the tag name is not `v` followed by the `package.json` version.
    4. Set up Node 24 with `registry-url: https://registry.npmjs.org`.
    5. Make sure the npm CLI is 11.5.1 or later.
    6. Run `npm publish`. The workflow does not use an `NPM_TOKEN` and does not mention JSR.
12. `README.md` matches the new toolchain:
    - **Install:** `npm install @gandazgul/caper-engine phaser` and `bun add @gandazgul/caper-engine phaser`, and it
      says that Phaser is a peer dependency.
    - **Usage:** imports from `@gandazgul/caper-engine`.
    - **Starter commands:** `bun run starter` and `bun run starter:build`.
    - **Local development:** a game links an unpublished checkout with `"@gandazgul/caper-engine": "file:../Caper"`
      or `bun link`, and keeps the Phaser dedupe setting.
    - **Development:** the `bun run` scripts.
    - **Types:** the `tsc` → `dts-bundle-generator` pipeline and `exports.types`, with no JSR fast-check text.
    - **Publishing:** bump the version in `package.json`, commit, tag `v<version>`, push the tag. It also describes
      the one-time manual first publish and the trusted publisher setup.
13. `CONTEXT.md` describes Bun, `package.json`, `bun:test`, oxlint, oxfmt, `tsc`, the `bun run ci` order, and npm
    publishing. It does not describe Deno or JSR as the current toolchain.
14. Every `@caper/engine` reference in `docs/*.md` and `examples/starter/` (`main.js`, `vite.config.js` alias key,
    `README.md`) is `@gandazgul/caper-engine`. `docs/hello-world.md` lists "Node.js 18+ or Bun" and shows
    `npm run dev` / `bun run dev` and `bun run starter`. `examples/starter/README.md` uses `bun run starter*` and says
    that a standalone copy installs the engine from npm.
15. `grep -rniE "deno|jsr" --exclude-dir={node_modules,.git,.history,types,.wld} .` finds nothing outside
    `docs/plans/`. Plan files keep their history.
16. The core project memories that name Deno or JSR state the Bun/npm facts: [4640] conventions and `deno task ci`,
    [6] the release version bump in `package.json`, [1] the tech stack, and [2] "published on JSR". Update them with
    the `memory` tool. Store each replacement before you delete the old memory.

## Verification Plan

**Automated (run on a clean install):**

- `rm -rf node_modules && bun install --frozen-lockfile` — succeeds. This proves that the lockfile and the manifest
  agree.
- `bun test src/` — 51 pass, 0 fail. A count below 51 means that a converted file has lost a test.
- **Mutation check:** change `evaluateCondition` in `src/core/conditions.js` to always return `true`, then run
  `bun test src/`. The suite must fail. Revert the change. This proves that the converted assertions still detect
  errors.
- `bun run check` — passes. Add `/** @type {number} */ const n = "x";` to one test file. Confirm that `check` reports
  the error, then revert. This proves that the test files are type-checked.
- `bun run dts:check` — passes with no `mod.d.ts` diff.
- `bun run starter:build` — builds `examples/starter/dist/` with the renamed alias.

**Package boundary (proves npm consumers get the JS files and the types):**

- `npm pack --dry-run --json`: the tarball contains `package.json`, `README.md`, `LICENSE`, `mod.js`, `mod.d.ts` and
  every non-test `src/**/*.js`. It contains no `*.test.js`, `scripts/`, `examples/`, `docs/`, `CONTEXT.md` or
  `tsconfig*`.
- Consumer test in a temporary directory:
  1. Run `npm pack` and install the tarball with `bun add <tarball> phaser@3.90.0 typescript@6.0.3`.
  2. Write a `consumer.ts` that imports `createAdventureGame` and `AdventureScene` from `@gandazgul/caper-engine`.
  3. Run `tsc --noEmit --moduleResolution bundler --module esnext --target esnext --skipLibCheck false` on it. It must
     pass. This proves that `exports.types` resolves to `mod.d.ts` and that the Phaser types resolve.
  4. Write a `consumer.js` with the same import and run `bun build consumer.js --target browser`. It must bundle
     without resolution errors.

**Manual (user, after merge; these steps cannot run in the repository):**

1. Log in to npm as `gandazgul` and run `npm publish` from the merged `main` at version 0.5.0. This is the one-time
   first publish.
2. On npmjs.com, go to `@gandazgul/caper-engine` → Settings → Trusted Publisher. Add GitHub Actions with repository
   `gandazgul/caper` and workflow `publish.yml`.
3. For the next release, bump the version, tag `v<version>` and push. Confirm that the workflow publishes and that
   npm shows provenance.

**Behavior to protect, and behavior to stop:**

- **Protect:** all 51 test cases and every assertion they make. Convert each test, never delete it. When a test
  fails after conversion, the cause is a mapping that differs from `@std/assert`. Fix the mapping. Do not weaken the
  expectation.
- **Stop:** Deno tasks, JSR publishing, `deno.lock`, the `@ts-self-types` directive and the `@caper/engine` name.

## Edge Cases & Considerations

- **`toStrictEqual` is stricter than `toEqual`.** `@std/assert`'s `assertEquals` also rejects extra `undefined` keys
  and different constructors, so `toStrictEqual` is the faithful mapping. Use `toEqual` only in a place where a
  difference from `@std/assert` is proven, and give the reason in a comment.
- **Type check of the test files can show new errors.** `deno check` and `tsc` with Bun types can disagree, for
  example on mock scene objects. Fix the types in the test file (JSDoc casts). Do not exclude the test files.
- **Oxlint can find code that `deno lint` accepted.** Fix real defects. Disable only the rules that conflict with
  intentional patterns (for example, the `no-window-prefix` exception that exists today), and give each reason in
  `.oxlintrc.json`.
- **`mod.d.ts` drift.** The `typescript` and `dts-bundle-generator` versions are pinned to the versions Deno resolves
  today, so the output stays the same. If it changes, commit the regenerated file and record the reason in the
  commit message.
- **A stale `node_modules/phaser` (4.1.0) exists in the working tree.** The clean `bun install` in verification
  replaces it with the pinned 3.90.0.
- **Existing JSR users.** Old `@caper/engine` versions stay on JSR. Marking that package as deprecated on jsr.io is an
  optional manual step for the user and is outside the repository change.
- **Assumption: the first npm version stays `0.5.0`.** The release process bumps the version for the next release.
  Change the version before the first publish if you want a new version to mark the registry move.
- **Assumption: Bun 1.4.3 for CI.** This is the local version. `.bun-version` pins it in one place.
