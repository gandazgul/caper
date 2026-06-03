# Caper — Technical Documentation

An extensible, game-agnostic **point-and-click adventure engine** built on [Phaser 3](https://phaser.io/). The engine
ships the "batteries" for the genre — walking, one-click interaction, inventory, weather, NPCs with ambient behaviors,
cutscenes, declarative props, and more — but owns **no game content** (no character names, no scene names, no art keys).
All game-specific knowledge is supplied at boot via typed registries and configuration.

## Table of Contents

- [Architecture overview](#architecture-overview)
- [Engine/game boundary](#enginegame-boundary)
- [Module map](#module-map)
- [ADRs](#adrs)

## Architecture overview

```
┌────────────────────────────────────────────────────────────┐
│  GAME LAYER (owner: game developer)                        │
│                                                             │
│  scenes/   helpers/   objects/   registerContent.js         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ populate registries at boot:                         │   │
│  │   characters.register("hero", {...})                 │   │
│  │   content.registerItems({...})                        │   │
│  │   registerCast({...})                                 │   │
│  │   engineAssets.configure({...})                       │   │
│  │   wearables.registerAll({...})                        │   │
│  │   store.configure({...})                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Game scenes extend AdventureScene:                         │
│    class MyScene extends AdventureScene { ... }             │
│                                                             │
└──────────────────────────┬─────────────────────────────────┘
                           │ one-way dependency
                           ▼
┌────────────────────────────────────────────────────────────┐
│  ENGINE LAYER  Caper (ADR 0005)                            │
│                                                            │
│  No game imports. Each capability slice owns its           │
│  boot-time registry. See the Module map below.             │
│                                                            │
│  Capability slices (src/):                                 │
│    core/         scene/        movement/                   │
│    interaction/  inventory/    cast/                       │
│    characters/   cutscene/     environment/                │
│    state/        assets/       ui/                         │
└────────────────────────────────────────────────────────────┘
```

## Engine/game boundary

The engine declares **interfaces** — the shapes of data it needs. The game fills them at boot. The engine never
hardcodes a game-specific value.

| Engine needs…                        | Game supplies at boot via…                                               |
| ------------------------------------ | ------------------------------------------------------------------------ |
| Active character sprite + animations | `characters.register("hero", { spriteKey, animationSet })`               |
| Item art for inventory               | `content.registerItems({ apple: { atlas, frame, scale } })`              |
| NPC cast + seasonal behavior         | `registerCast({ hero: { spring: { ambient, reactions } } })`             |
| Art keys for built-in widgets        | `engineAssets.configure({ thoughtBubble, backButton, leaves, critter })` |
| Wearable offsets per character       | `wearables.registerAll({ ... })`                                         |
| State schema + save key              | `store.configure({ saveKey, createFreshState })`                         |

See [architecture.md](architecture.md) for details.

## Module map

`src/` is organized into **capability slices** — each folder is "everything for one capability," including the boot-time
registry the game fills. The folders are internal; everything is re-exported from the package root (`@caper/engine`).

| Slice (`src/`) | Modules                                                                                | Docs                                                                                          |
| -------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `core/`        | `conditions`, `random`, `perspective`                                                  | [Props (conditions DSL)](props.md)                                                            |
| `scene/`       | `AdventureScene`, `EngineScene`, `createAdventureGame`, `SubsceneStack`, `transitions` | [Architecture](architecture.md), [Hello World](hello-world.md), [Transitions](transitions.md) |
| `movement/`    | `WalkController`, `pathfinding`, `Fidget`, `IdleCharacter`, `behaviors/`               | [Interaction](interaction.md)                                                                 |
| `interaction/` | `HotspotManager`, `PropEngine`                                                         | [Props](props.md), [Interaction](interaction.md)                                              |
| `inventory/`   | `InventoryLayer`, `itemDef`, `ContentRegistry`                                         | [Inventory](inventory.md)                                                                     |
| `cast/`        | `NPC`, `CastDirector`, `CastRegistry`                                                  | [NPCs & Cast](npc-and-cast.md)                                                                |
| `characters/`  | `CharacterRegistry`, `CharacterSwitcher`, `Wearables`, `portraits`                     | [Characters](characters.md)                                                                   |
| `cutscene/`    | `Cutscene`, `CutsceneRunner`, `cutsceneActor`, `DialogueBubble`, `SuccessMessage`      | [Cutscenes](cutscenes.md)                                                                     |
| `environment/` | `WeatherLayer`, `NightLayer`, `CritterHelper`                                          | [Weather & Night](weather.md)                                                                 |
| `state/`       | `Store`                                                                                | [State (Store)](store.md)                                                                     |
| `assets/`      | `assetLoading`, `EngineAssets`                                                         | [Assets](assets.md)                                                                           |
| `ui/`          | `UIHelper`, `FullscreenButton`, `DebugOverlay`, `SceneEditor`                          | [UI Helpers](ui-helpers.md)                                                                   |

## ADRs

The engine evolves under Architectural Decision Records in [docs/adr/](adr/). Key ADRs:

| ADR  | Title                                                                                      |
| ---- | ------------------------------------------------------------------------------------------ |
| 0001 | [Humongous-style one-click interaction](adr/0001-humongous-style-one-click-interaction.md) |
| 0002 | [Declarative prop framework](adr/0002-declarative-prop-framework.md)                       |
| 0003 | [Dynamic weather & ambient system](adr/0003-dynamic-weather-ambient-system.md)             |
| 0004 | [Declarative NPC cast](adr/0004-declarative-npc-cast.md)                                   |
| 0005 | [Engine / game boundary](adr/0005-engine-game-boundary.md)                                 |
| 0006 | [Character outfits](adr/0006-character-outfits.md)                                         |
