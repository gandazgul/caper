# Caper

A point-and-click adventure engine built on Phaser 3.

Caper provides the reusable systems for a Humongous-style adventure game: walking, one-click interaction, declarative
props, inventory, NPC/cast behavior, weather, cutscenes, transitions, UI helpers, and engine-owned state primitives.

## Install

Install Caper from [npm](https://www.npmjs.com/package/@gandazgul/caper-engine). Phaser 3 is a peer dependency;
install it in the game so that the game and engine share one copy.

**npm:**

```bash
npm install @gandazgul/caper-engine phaser@^3.86.0
```

**Bun:**

```bash
bun add @gandazgul/caper-engine phaser@^3.86.0
```

## Runnable starter

Run `bun run starter` for [The Garden Gate](examples/starter/README.md), a complete two-room adventure with local
artwork, an inventory puzzle, an NPC, and resume. Build it for static hosting with `bun run starter:build`.

## Usage

Everything is imported from the package entry point:

```js
import { AdventureScene, createAdventureGame } from "@gandazgul/caper-engine";

const game = createAdventureGame({
    config: { scene: [MyScene], width: 960, height: 640 },
    // register: registerGameContent
});
```

See the [public API](mod.js) for the full list of exports.

## Module map

`src/` is organized into capability slices. The folders are internal — everything is re-exported from the package root
(`@gandazgul/caper-engine`) — but each slice is "everything for one capability," including the boot-time registry the game fills.

| Slice (`src/`) | What it owns                             | Modules                                                                                |
| -------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `core/`        | cross-cutting primitives                 | `conditions`, `random`, `perspective`                                                  |
| `scene/`       | the shell a game extends + boots         | `AdventureScene`, `EngineScene`, `createAdventureGame`, `SubsceneStack`, `transitions` |
| `movement/`    | locomotion & navigation                  | `WalkController`, `pathfinding`, `Fidget`, `IdleCharacter`, `behaviors/`               |
| `interaction/` | the one-click verb loop + props          | `HotspotManager`, `PropEngine`                                                         |
| `inventory/`   | carried items                            | `InventoryLayer`, `itemDef`, `ContentRegistry`                                         |
| `cast/`        | NPCs + the ensemble director             | `NPC`, `CastDirector`, `CastRegistry`                                                  |
| `characters/`  | playable characters, switching, outfits  | `CharacterRegistry`, `CharacterSwitcher`, `Wearables`, `portraits`                     |
| `cutscene/`    | scripted sequences + on-screen speech    | `Cutscene`, `CutsceneRunner`, `cutsceneActor`, `DialogueBubble`, `SuccessMessage`      |
| `environment/` | the ambient world                        | `WeatherLayer`, `NightLayer`, `CritterHelper`                                          |
| `state/`       | persistent reactive store                | `Store`                                                                                |
| `assets/`      | load conventions + engine asset registry | `assetLoading`, `EngineAssets`                                                         |
| `ui/`          | shared chrome + dev tools                | `UIHelper`, `FullscreenButton`, `DebugOverlay`, `SceneEditor`                          |

## Documentation

Start with [docs/index.md](docs/index.md).

Useful entry points:

- [Architecture](docs/architecture.md)
- [Hello World](docs/hello-world.md)
- [Props](docs/props.md)
- [Inventory](docs/inventory.md)
- [NPCs and Cast](docs/npc-and-cast.md)
- [State Store](docs/store.md)

## Local development against an unpublished checkout

To work on a game and the engine side by side, add a local dependency in the game's `package.json`:

```json
{
    "dependencies": {
        "@gandazgul/caper-engine": "file:../Caper"
    }
}
```

Run `bun install` in the game. Keep `resolve.dedupe: ["phaser"]` in its Vite config so the game and engine use the
same Phaser runtime.

## Development

Install [Bun](https://bun.sh) at the version in `.bun-version`, then run:

```bash
bun install --frozen-lockfile
bun run ci      # lint + fmt:check + check + dts:check + test
bun run test
bun run dts     # regenerate the bundled mod.d.ts from JSDoc
```

## Types

The engine is authored in JavaScript with JSDoc. `bun run dts` compiles the JSDoc with `tsc`, bundles the declarations
with `dts-bundle-generator`, then corrects Phaser namespace references in the generated `mod.d.ts`.
`package.json` exposes this file through `exports.types` and `types`. `bun run dts:check` regenerates the file and fails
if it differs from the committed version.

## Publishing

### First publish and trusted publisher setup

After this change is merged, log in to npm as `gandazgul`. From the merged `main` checkout at version `0.5.0`, run:

```bash
bun install --frozen-lockfile
bun run ci
npm login
npm publish
```

The package sets public access. After the first publish, open the package's Settings on npmjs.com and add a GitHub
Actions trusted publisher for owner `gandazgul`, repository `caper`, and workflow filename `publish.yml`.

### Later releases

Bump `version` in `package.json`, regenerate and commit any type changes, then commit the version bump. Tag that commit
`v<version>` and push the tag. `.github/workflows/publish.yml` runs the checks, rejects a tag that differs from the
package version, and publishes to npm with OIDC trusted publishing. No npm token secret is needed. npm adds provenance
for trusted publishing on GitHub-hosted runners.

## License

MIT
