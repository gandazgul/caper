# AdventureEngine — Technical Documentation

An extensible, game-agnostic **point-and-click adventure engine** built on [Phaser 3](https://phaser.io/). The engine
ships the "batteries" for the genre — walking, one-click interaction, inventory, weather, NPCs with ambient behaviors,
cutscenes, declarative props, and more — but owns **no game content** (no character names, no scene names, no art keys).
All game-specific knowledge is supplied at boot via typed registries and configuration.

## Table of Contents

- [Architecture overview](#architecture-overview)
- [How the seam works](#how-the-seam-works)
- [Concepts map](#concepts-map)
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
│  ENGINE LAYER AdventureEngine (ADR 0005)                    │
│                                                             │
│  No game imports. Shaped by registries at boot.             │
│                                                             │
│  Base scene systems (AdventureScene):                       │
│    WalkController  HotspotManager  InventoryLayer           │
│    WeatherLayer    NightLayer      SubsceneStack            │
│    PropEngine      CastDirector    DebugOverlay             │
│                                                             │
│  Primitive modules:                                         │
│    NPC          ThoughtBubble    Fidget       Wearables     │
│    Cutscene     CutsceneRunner   cutsceneActor              │
│                                                             │
│  Declarative data:                                          │
│    Store        ContentRegistry  CharacterRegistry          │
│    CastRegistry EngineAssets     conditions.js              │
│                                                             │
│  Behaviors (NPC locomotion):                                │
│    WanderBehavior   PatrolBehavior                          │
│    FollowBehavior   CompanionBehavior  walker.js            │
│                                                             │
│  Infrastructure:                                            │
│    transitions.js  assetLoading.js   perspective.js         │
│    pathfinding.js  random.js        UIHelper.js             │
│                                                             │
└────────────────────────────────────────────────────────────┘
```

## How the seam works

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

## Concepts map

| Topic                                        | Description                                          | File                                                   |
| -------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| [Architecture & registries](architecture.md) | Engine/game boundary, all registries, boot sequence  | —                                                      |
| [Hello World](hello-world.md)                | Step-by-step guide to build a new game on the engine | —                                                      |
| [State (Store)](store.md)                    | Reactive state, persistence, replay sandbox          | `Store.js`                                             |
| [Characters](characters.md)                  | Registry, outfits, active character, switching       | `CharacterRegistry.js`                                 |
| [NPCs & Cast](npc-and-cast.md)               | NPC class, cast declarative system, behaviors        | `NPC.js`, `CastDirector.js`, `CastRegistry.js`         |
| [Props](props.md)                            | Declarative props, conditions DSL, effects           | `PropEngine.js`, `conditions.js`                       |
| [Interaction](interaction.md)                | One-click, WalkController, hotspots, cursors         | `WalkController.js`, `HotspotManager.js`               |
| [Weather & Night](weather.md)                | Rain/snow, falling leaves, night overlay             | `WeatherLayer.js`, `NightLayer.js`                     |
| [Cutscenes](cutscenes.md)                    | Async cutscene runner, actor context                 | `Cutscene.js`, `CutsceneRunner.js`, `cutsceneActor.js` |
| [Inventory](inventory.md)                    | Strip, item lookup, drag-to-use                      | `InventoryLayer.js`, `ContentRegistry.js`              |
| [Transitions](transitions.md)                | Scene transitions, presets, replay sandbox           | `transitions.js`                                       |
| [Assets](assets.md)                          | Key-convention loading, EngineAssets, boot           | `assetLoading.js`, `EngineAssets.js`                   |
| [UI Helpers](ui-helpers.md)                  | Buttons, debug overlay, scene editor                 | `UIHelper.js`, `DebugOverlay.js`, `SceneEditor.js`     |

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
