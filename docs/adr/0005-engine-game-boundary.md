# 0005 — Engine / Game boundary (AdventureEngine extraction)

Status: **proposed** Date: 2026-06-01

## Decision

`src/` becomes a reusable, game-agnostic **AdventureEngine** (target home: separate package) with a one-way
dependency rule: **the Engine never imports Game content (item catalogs, cast, behaviors) or Game rules (season gates,
game rules); the Game depends on the Engine.** The Engine is the **type authority** (`RenderableItem`,
`InventoryItem`, `Critter`, `Prop`, …) and ships the standard "batteries" for the point-and-click genre. Where the
Engine needs Game-specific knowledge it gets it by **inversion**: a single Game-provided **Config** (values and asset
paths, never rules) plus **registries** the Game populates at boot.

API design **leans on Phaser's mental model** so the engine is legible to Phaser developers: registries you populate at
boot and query by key (mirroring `TextureManager`/`anims`/`registry`/`Cache`), Scene Plugins for cross-cutting systems,
and base-scene subclassing — not injected resolver callbacks or app-framework DI.

The concrete seams:

1. **State** — Engine owns a generic reactive **`Store`** (typed `values`/`collections`/`items` buckets, change events,
   localStorage persistence, snapshot/restore for replay) — the same role Phaser's `registry`/DataManager plays. The
   Game owns a **`GameState`** wrapper holding all domain methods (season transitions, scene-gating logic,
   gameplay counters). The Store never knows about a season; the Game may organize `GameState` internally as a
   flat facade or as reducers/slices without affecting the boundary.
2. **Content resolution** — Engine owns a **`ContentRegistry`**; the Game registers its catalogs at boot
   (`content.registerItems({ apple: ... })`, …) and the Engine resolves `content.getItem(id)` to a
   `RenderableItem`. Replaces hard-coded catalog chains in inventory/dialog helpers. **Inventory** and the
   **Dialog** system (the rename of `ThoughtBubble` — icon mode now, text + dialog trees later) are Engine built-ins.
3. **Batteries** — the generic NPC behaviors (`Wander`/`Patrol`/`Follow`/`Companion`/`walker`) and `cutsceneActor` move
   live **inside** the Engine. A **cast registry** lets a Game register its cast.
4. **Config inversion** — Engine reads a single Game-provided `Config` for dimensions, palette, inventory layout, tuning
   numbers, dev flags, and asset paths. `objects/` and `scenes/` are convention locations; concrete paths come from
   Config.
5. **Base scene** — `AdventureScene` splits into a **thin Engine base scene + Engine Scene Plugins**; Game scenes
   subclass it. The **Character** system is Engine-generic with the **roster** supplied via Config;
   game-specific quest logic is extracted to the Game.
6. **Bootstrap** — Engine exports a thin **`createAdventureGame(manifest)`** factory that internally does the
   Phaser-native thing (`new Phaser.Game` with `plugins: { scene: ENGINE_PLUGINS }`) and seeds the registries. It is a
   convenience front door, **not** a replacement: the plugins, registries, and base scenes stay directly usable so a
   Phaser dev can bypass the factory.

## Context

An extractable engine cannot reach outward into game code: item catalogs, cast declarations, scene modules, and
configuration belong to the Game. Backwards coupling makes the engine un-extractable — you cannot move a file to a
package while it imports a game's content modules.

The goal is for new games to reuse the same engine. The boundary above is the prerequisite; moving the folder is the
last, near-mechanical step.

## Considered options

- **State: generic Store + Game facade (chosen)** vs. Redux-Toolkit-style registered slices in the Engine vs. full
  Redux. The Engine needs generic `get`/`set`/collection operations, not domain methods, so a generic Store fully
  satisfies the Engine. Slices/reducers would add Engine API surface to solve a Game-internal organization problem.
- **Content resolution: Engine registry (chosen)** vs. Game-injected resolver callbacks. Registries match Phaser (and
  Unity/Godot/Unreal) idiom and the codebase's existing "registry" language; injected callbacks are the app-framework
  idiom and were rejected to keep the engine legible to Phaser devs.
- **Behaviors: Engine ships standard set (chosen)** vs. Engine ships only the contract. Every comparable engine ships
  locomotion/AI batteries; making each Game re-supply the basics was rejected.
- **Base scene: thin base + Scene Plugins (chosen)** vs. fat inheritance-only base vs. no base scene. Plugins are
  Phaser's native answer to cross-cutting systems and avoid a 698-line god-class.

## Consequences

- A lint gate prevents regressions during extraction; the engine is extraction-ready when the gate is clean.
- The **Character** system is Engine-generic; character names are Game-provided instances.
- Phaser becomes a **peer dependency** of the engine package (one shared instance across engine + game).
- Supersedes nothing, but builds on [ADR 0002](./0002-declarative-prop-framework.md) (props) and
  [ADR 0004](./0004-declarative-npc-cast.md) (cast); both already drew an engine/game line this ADR generalizes.
