# Caper

A point-and-click adventure engine built on Phaser 3.

Caper provides the reusable systems for a Humongous-style adventure game: walking, one-click interaction, declarative
props, inventory, NPC/cast behavior, weather, cutscenes, transitions, UI helpers, and engine-owned state primitives.

The engine owns no game content. A game supplies characters, items, cast, art keys, scene configs, and domain rules
through registries and configuration at boot.

## Install

Caper is published to [JSR](https://jsr.io/@caper/engine) and depends on Phaser 3 as a runtime dependency.

**Deno:**

```bash
deno add jsr:@caper/engine
```

**Node / npm (Vite, webpack, etc.):**

```bash
npx jsr add @caper/engine
npm install phaser
```

## Usage

Everything is imported from the package entry point:

```js
import { AdventureScene, createAdventureGame } from "@caper/engine";

const game = createAdventureGame({
    scenes: [MyScene],
    // ...game config
});
```

See the [public API](mod.js) for the full list of exports.

## Module map

`src/` is organized into capability slices. The folders are internal — everything is re-exported from the package root
(`@caper/engine`) — but each slice is "everything for one capability," including the boot-time registry the game fills.

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

To work on a game and the engine side by side without publishing, map the package in your game's `deno.json`:

```json
{
    "imports": {
        "@caper/engine": "../Caper/mod.js"
    }
}
```

## Development

```bash
deno task ci      # lint + fmt:check + check + test
deno task test
```

## Publishing

```bash
deno publish --allow-slow-types
```

Requires the `@caper` scope on JSR. The engine is authored in JavaScript with JSDoc types, so JSR ships it with "slow
types" (no generated `.d.ts`); `--allow-slow-types` acknowledges that.

## License

MIT
