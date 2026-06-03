# AdventureEngine — Context Overview

A **game-agnostic point-and-click adventure engine** built on [Phaser 3](https://phaser.io/) (v3.86+). Ships the
"batteries" for the genre — walking, one-click interaction, inventory, weather, NPCs with ambient behaviors, cutscenes,
declarative props, transitions, UI helpers — but owns **no game content** (no character names, scene names, or art
keys). All game-specific knowledge is supplied at boot via typed registries and configuration.

**Language:** JavaScript (Deno runtime, JSDoc types, no TypeScript compilation)\
**Testing:** Deno test framework, `@std/assert`\
**Formatting:** deno fmt with indentWidth=4, lineWidth=120, semicolons on\
**Licensing:** MIT

---

## Language & Key Concepts

### Core Domain Terminology

| Term                  | Definition                                                                                                                                                                                                                                             | Aliases to avoid             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Prop**              | A declarative interactive object in a scene. State-machine-driven: multiple states with `when` conditions (DSL), art (frame/atlas/anim), interactions (onClick/onDrop).                                                                                | "object", "entity"           |
| **State Store**       | The engine's reactive state singleton (`Store.js`). Three typed buckets: `values` (scalars/flags), `collections` (Sets), `items` (per-item string map). Auto-persists to localStorage.                                                                 | "data manager", "registry"   |
| **Cast**              | The declarative NPC roster. Per-character, per-season rules defining ambient behavior (wander/patrol/follow/static) and reactions (see/click/hover/leave + arbitrary bus events).                                                                      | "NPC list"                   |
| **Active Character**  | The currently player-controlled playable character. Tracked in the Store under `activeCharacter`. Spawned as a `WalkController` by `AdventureScene`.                                                                                                   | "player character"           |
| **WalkController**    | Owns the active character's sprite, movement (tween-based walking along a walkable polygon), animation states (walk/still/fidget/reach), perspective Y-scaling, and wearable sync.                                                                     | "player controller"          |
| **Walkable**          | A polygon (array of `{x, y}` points) defining where the character can walk. Clicks outside are snapped to the nearest edge. Pathfinding uses visibility graph + Dijkstra.                                                                              | "nav mesh"                   |
| **Hotspot**           | A clickable zone (`HotspotManager`) with bounds, approach point, type (pickup/look/exit/subscene/use-with), and cursor. Click → walk → `hotspot:arrived` event → effects.                                                                              | "click zone", "trigger"      |
| **Condition DSL**     | Pure serializable data for gating prop states and NPC reactions. AND across object keys, OR across arrays, combinators (allOf/anyOf/not). Leaf ops: eq/ne/gt/gte/lt/lte/has/not. Special sentinels: `$self` (prop's id), `$dragged` (dropped item id). | "conditions"                 |
| **Effect**            | A declarative verb object in a prop's onClick/onDrop array. Types: set, addTo, removeFrom, tween, destroy, pickup, goToScene, pushSubscene, showThought, emit, playReach, setItemState.                                                                | "action"                     |
| **Cutscene**          | An async function over cancellable promises. `Cutscene.js` provides the cancel token primitive; `CutsceneRunner` handles NPC suspend/resume/player-lock lifecycle. Cast reactions expose `director.cutscene(fn)`.                                      | "sequence", "cinematic"      |
| **Replay Sandbox**    | Mini-game isolation via `store.beginReplay()`/`store.endReplay()`. Snapshots current state, runs mini-game, restores on exit. `transitionTo` redirects to `exitReplay` during replays.                                                                 | "mini-game mode"             |
| **Ambient Behavior**  | An NPC's autonomous routine: `WanderBehavior` (come-and-go random walks), `PatrolBehavior` (waypoint loop with activities), `FollowBehavior` (trail player at lag), `CompanionBehavior` (tight lockstep), `static`/`none`.                             | "AI", "routine"              |
| **Boot Registration** | The one-time setup phase where the game populates engine registries (characters, content, cast, engineAssets, wearables, store) before `new Phaser.Game(...)`.                                                                                         | "init", "setup"              |
| **Approach Point**    | `{x, y, facing}` — where the character walks to before interacting with a hotspot or drop target. `"in-place"` skips the walk and interacts immediately.                                                                                               | "interact point"             |
| **Wearable**          | A persistent or manual sprite attached to a character (backpack, held item). Registered in the `WearableRegistry` with per-character, per-direction offsets. Auto-synced by `WalkController.wearables` and `NPC.wearables`.                            | "accessory"                  |
| **Perspective**       | Y-based scaling and depth-sorting for outdoor 3/4-view scenes. Characters lower on screen render bigger and in front. Config: `{ nearY, farY, nearScale?, farScale? }`.                                                                                | "parallax", "foreshortening" |

---

## Key Files

### Entry Points

| File                         | Purpose                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `mod.js`                     | Public API — re-exports all engine symbols. The `"exports"` target in deno.json.                                |
| `src/createAdventureGame.js` | Engine bootstrap factory. Runs game's `register()` callback, then `new Phaser.Game()`. The front door for boot. |

### Core Engine Systems

| File                    | Purpose                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/AdventureScene.js` | Base scene class. Composes all engine systems in `create()`: WalkController, HotspotManager, InventoryLayer, WeatherLayer, SubsceneStack, DebugOverlay, SceneEditor, PropEngine, CastDirector. Game subclasses override hooks. |
| `src/WalkController.js` | Active character movement + animation. Tween-based walking, direction state machine, fidget timer, reach animation, wearable syncing, perspective scaling.                                                                     |
| `src/Store.js`          | Reactive state singleton with 3 buckets, change events, localStorage persistence, replay sandbox.                                                                                                                              |
| `src/PropEngine.js`     | Declarative prop state machine. Reconciles on every Store change. Handles sprite rendering, hotspot registration, drag/drop, effect sequencing.                                                                                |
| `src/HotspotManager.js` | Clickable zone registration/unregistration. Emits hotspot:hover/unhover/click/arrived via bus. Direction-aware exit cursors.                                                                                                   |

### Registries (Engine-owned singletons, populated by Game at boot)

| File                       | Stores                                                                                                | Boot method                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `src/CharacterRegistry.js` | Character render configs (sprite key, animation set, scale, outfits)                                  | `characters.register("id", config)` |
| `src/ContentRegistry.js`   | Inventory item sprite specs (atlas + frame + scale)                                                   | `content.registerItems({...})`      |
| `src/CastRegistry.js`      | NPC cast: per-season ambient + reactions                                                              | `registerCast({...})`               |
| `src/EngineAssets.js`      | Art keys for built-in engine widgets (thought bubbles, back button, leaves, critter, inventory atlas) | `engineAssets.configure({...})`     |
| `src/Wearables.js`         | Wearable item definitions + per-character offsets                                                     | `wearables.registerAll({...})`      |

### NPC & Cast

| File                    | Purpose                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/NPC.js`            | Dynamic NPC sprite management. WalkTo/stopWalking, hotspots, fidget, speak, wearable sync. Presence tracking to avoid duplicates. |
| `src/CastDirector.js`   | Per-scene cast orchestrator: spawns NPCs for active season/weather, wires ambient behaviors and reactions, manages cutscenes.     |
| `src/Cutscene.js`       | Cancellable promise primitive (Phaser-free, unit-testable).                                                                       |
| `src/CutsceneRunner.js` | One-at-a-time cutscene lifecycle: suspend NPCs → run → resume. Handles preemption and error cleanup.                              |
| `src/cutsceneActor.js`  | Builds the `d` context object for cutscene functions (per-NPC methods, player walker, scene helpers).                             |
| `src/DialogueBubble.js` | Cloud-bubble Container with optional icons + text. Used by NPC responses and character thoughts.                                  |

### Behaviors

| File                                 | Purpose                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/behaviors/WanderBehavior.js`    | Come-and-go wandering state machine. Present/absent cycles, random walks, exit-based entrance, return check timer.                                      |
| `src/behaviors/PatrolBehavior.js`    | Fixed-waypoint patrol loops with per-waypoint activity animations (raking, gardening). Door retreat for weather.                                        |
| `src/behaviors/FollowBehavior.js`    | Loose follow: re-paths toward player at a lag distance on a timer.                                                                                      |
| `src/behaviors/CompanionBehavior.js` | Tight lockstep "conga line" trailing. Per-frame offset behind target, matching facing.                                                                  |
| `src/behaviors/walker.js`            | Walker/WanderHost contracts. `npcWanderHost()` and `walkControllerWanderHost()` adapters. `getRandomWalkablePoint()` and `randomExitSpawn()` utilities. |

### Infrastructure

| File                  | Purpose                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/transitions.js`  | Scene transition presets (room/dim/dramatic/night/cinematic/quick/arrival). `transitionTo()` and `transitionIn()` with fade in/out. Replay sandbox redirection. |
| `src/assetLoading.js` | Convention-based asset loading: key → URL (bg_ → /scenes/, sprite_ → /objects/, etc.). `loadImageOnce`/`loadSpritesheetOnce` guard on texture cache.            |
| `src/pathfinding.js`  | `pointInPolygon`, `snapToPolygon`, `findPath` (visibility graph + Dijkstra). Returns waypoints around obstacles.                                                |
| `src/perspective.js`  | Y-based perspective scale computation for outdoor scenes.                                                                                                       |
| `src/random.js`       | Deterministic PRNG (SplitMix32). `setGlobalSeed(seed)` for reproducible runs. `randomInt(min, max)` replaces Phaser.Math.Between.                               |
| `src/conditions.js`   | Condition DSL evaluator. Pure, serializable, no functions. Used by PropEngine and CastDirector.                                                                 |

### Scenery & Environment

| File                       | Purpose                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/WeatherLayer.js`      | Procedural rain (light/heavy), snow, and falling leaves (sprite-based with spin/sway/tilt).                                     |
| `src/NightLayer.js`        | Night-time darkening overlay.                                                                                                   |
| `src/InventoryLayer.js`    | Bottom-of-screen inventory strip. Auto-hides when empty. Stackable items with shadow + count badge. Drag-to-use from inventory. |
| `src/SubsceneStack.js`     | Zoom-in sub-scenes (close-up views of props).                                                                                   |
| `src/IdleCharacter.js`     | Autonomous idle character (inactive sibling) — wanders when you're the other sibling.                                           |
| `src/CharacterSwitcher.js` | UI for switching between multiple playable characters.                                                                          |
| `src/WeatherLayer.js`      | Procedural rain, snow, and falling leaves.                                                                                      |

### Utilities

| File                      | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `src/UIHelper.js`         | Back button, chunky button, icon drawing functions. UI_DEPTH constant. |
| `src/DebugOverlay.js`     | Walkable polygon + hotspot visualizer.                                 |
| `src/SceneEditor.js`      | In-game spatial editor (keyboard shortcuts).                           |
| `src/FullscreenButton.js` | Fullscreen toggle button.                                              |
| `src/Fidget.js`           | Attachable idle fidget animation for any sprite.                       |
| `src/SuccessMessage.js`   | "Success!" overlay for puzzle completion.                              |
| `src/portraits.js`        | Character portrait resolution and circular crop.                       |

### Documentation

| File                   | Purpose                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `docs/index.md`        | Technical documentation index with architecture diagram and concepts map.               |
| `docs/architecture.md` | Engine/game boundary, registry overview, boot sequence, system composition, game hooks. |
| `docs/store.md`        | Full Store API documentation.                                                           |
| `docs/characters.md`   | Character registry, animation sets, outfits, active character.                          |
| `docs/npc-and-cast.md` | NPC class, cast declarative system, behaviors, reactions.                               |
| `docs/props.md`        | Declarative prop framework, state machine, conditions DSL, effects.                     |
| `docs/interaction.md`  | One-click interaction model, walk controller, hotspots, cursors, drag-from-inventory.   |
| `docs/cutscenes.md`    | Cutscene system, CutsceneRunner, actor context, cancellable sequences.                  |
| `docs/inventory.md`    | Inventory strip, item lookup, drag-to-use.                                              |
| `docs/weather.md`      | Weather layers, precipitation modes, ambient effects.                                   |
| `docs/transitions.md`  | Scene transitions, presets, replay sandbox.                                             |
| `docs/assets.md`       | Key-convention asset loading, EngineAssets, boot sequence.                              |
| `docs/ui-helpers.md`   | Buttons, debug overlay, scene editor.                                                   |
| `docs/hello-world.md`  | Step-by-step guide to building a new game on the engine.                                |

### ADRs (docs/adr/)

| ADR  | Title                                 | What it decided                                                                     |
| ---- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| 0001 | Humongous-style one-click interaction | No verb selection — one click walks and/or interacts.                               |
| 0002 | Declarative prop framework            | Props as state machines with conditions DSL and effects.                            |
| 0003 | Dynamic weather & ambient system      | Procedural rain/snow + sprite-based leaves. No interaction.                         |
| 0004 | Declarative NPC cast                  | Per-season ambient behaviors + reactions, cast registry.                            |
| 0005 | Engine / game boundary                | **Central ADR.** Engine never imports game code. Registries at boot. Generic Store. |
| 0006 | Character outfits                     | Outfits as full sprite-set swaps via Store `${id}Outfit` keys.                      |

### Configuration

| File         | Purpose                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| `deno.json`  | Package config: exports, tasks (check/test/lint/fmt/ci), imports (Phaser, @std/assert, @std/fs), compiler options. |
| `.gitignore` | node_modules/, dist/, .DS_Store                                                                                    |

---

## Patterns & Conventions

### Engine/Game Boundary (ADR 0005)

- **Engine never imports game code.** This is a lint-enforced one-way dependency.
- Game supplies knowledge at boot via registries: `characters.register()`, `content.registerItems()`, `registerCast()`,
  `engineAssets.configure()`, `store.configure()`, `wearables.registerAll()`.
- Every registry follows the Phaser-idiomatic pattern: **populate at boot, query by key at runtime**.

### Coding Conventions

- **Language:** JavaScript with JSDoc types. No TypeScript compilation — Deno's built-in type checker validates JSDoc
  annotations (`checkJs: true`, `strict: true`).
- **Modules:** ES modules (`.js` extension). All imports use full relative paths with `.js` suffix.
- **Singletons:** Registry-like classes are instantiated at module scope and exported as singletons (`store`,
  `characters`, `content`, `castRegistry`, `engineAssets`).
- **Exports:** Re-exported through `mod.js` — the public API surface.
- **Constants:** `Object.freeze()` for config objects, cursors maps, etc.
- **Depth layers:** `UI_DEPTH` constant (from UIHelper.js) for consistent z-ordering.
- **Error classes:** Custom error types like `CutsceneCancelled` (extends Error).
- **Async:** Cutscenes use async/await over cancellable promises. No nested `delayedCall` chains.

### Data Flow

1. **Boot:** Game calls `createAdventureGame({ register, config })` → `register()` populates registries →
   `new Phaser.Game(config)` starts scenes.
2. **Scene create:** `super.create(data)` in `AdventureScene` builds all systems: WalkController, HotspotManager,
   InventoryLayer, WeatherLayer, SubsceneStack, DebugOverlay, SceneEditor, PropEngine, CastDirector.
3. **Interaction:** Click → HotspotManager emitter → WalkController walks → `hotspot:arrived` → PropEngine.runEffects
   (or CastDirector reaction).
4. **State changes:** Store mutations trigger `onChange` subscriptions. PropEngine re-reconciles (re-selects states)
   reactively. CastDirector re-evaluates ambient on season/weather/time changes.
5. **Cross-system communication:** Via `this.bus` (Phaser.Events.EventEmitter). Events: seasonchange, weatherchange,
   timechange, ambientchange, hotspot:arrived, hotspot:click, subscene:open, subscene:close.

### Event Bus Events

| Event                 | When                             | Payload          | Consumers                   |
| --------------------- | -------------------------------- | ---------------- | --------------------------- |
| `seasonchange`        | Store chapter value changes      | season string    | CastDirector, WeatherLayer  |
| `weatherchange`       | Store weatherMode changes        | weather string   | CastDirector                |
| `timechange`          | Store timeOfDay changes          | "day" or "night" | CastDirector, NightLayer    |
| `ambientchange`       | Ambient mode changes             | ambient string   | —                           |
| `hotspot:arrived`     | WalkController reaches a hotspot | hotspot config   | PropEngine, game code       |
| `hotspot:click`       | Player clicks a hotspot          | hotspot config   | WalkController              |
| `subscene:open/close` | Subscene opens/closes            | —                | —                           |
| `characterchange`     | Active character switches        | new id           | CastDirector, NPC reactions |

### Testing Patterns

- **Location:** `*.test.js` files alongside source files in `src/`.
- **Framework:** Deno test (`Deno.test()` blocks) + `@std/assert`.
- **Phaser mocking:** Manual mock objects (no global Phaser mock). Tests like `conditions.test.js` are pure logic.
  `Cutscene.test.js` tests cancellation contract without Phaser. `CritterHelper.test.js` uses hand-written mock images.
- **Tests run:** `deno task test` (`deno test --permit-no-files --allow-read src/`)
- **CI:** `deno task ci` runs lint + fmt:check + check + test

### Error Handling

- **Cutscene errors:** `CutsceneCancelled` is swallowed by `CutsceneRunner`. Other errors propagate after cleanup.
- **Store persistence:** Silent try/catch for localStorage quota errors and private browsing mode.
- **Prop effects:** tween/playReach errors don't break the effect chain — effects are async but errors propagate.
- **Defensive checks:** `if (!sprite || !sprite.active)` checks before touching game objects, especially in update loops
  and shutdown sequences.

### Conditional Behavior Contract

Behaviors (WanderBehavior, PatrolBehavior, FollowBehavior) share a common interface:

- `holdForGreeting()` — stop and hold still so player can reach a stationary target
- `interrupt(action)` — run an action (speak), resume behavior after timeout
- `pause()` / `resume()` — suspend/resume for cutscenes
- `destroy()` — cleanup timers

### WalkController / NPC Walker Contract

Both `WalkController` and `NPC` satisfy the `Walker` interface:

```js
{
    sprite: Phaser.GameObjects.Sprite,
    walkTo(target, onArrive?, opts?),  // tween-based
    stopWalking(),                      // cancel tween, settle to still
}
```

Behaviors consume this contract through the `WanderHost` adapter (in `walker.js`), which adds spawn/despawn lifecycle.

### Save & Persistence

- Auto-saves to `localStorage` on every Store change (debounced via batching).
- Load is automatic in `store.configure()`.
- Replay sandbox snapshots the full state; `endReplay()` restores it.
- `store.hasSave()` checks for existing save.
- `store.reset()` clears to fresh state.

### Naming Conventions

- **Private fields:** underscore prefix (`_state`, `_changeSubs`).
- **Event handlers:** underscore prefix + handler suffix (`_onPointerDown`, `_onArrived`).
- **Config shape:** Scene config keys use camelCase (`backgroundsBySeason`, `activeCharacter`).
- **Registry methods:** `register()` / `configure()` / `get()` / `resolve()`.
- **Direction constants:** `"front"`/`"back"`/`"side"` for directions, `"up"`/`"down"`/`"left"`/`"right"` for facing.

### Key Architectural Constraints

- Engine must remain game-agnostic — no game imports allowed.
- Registries must be populated before any scene creates.
- Props are reactive (re-evaluated on every Store change) — effects should only mutate state, never directly change art.
- Cutscenes must unwind silently on scene shutdown (pending awaits reject, NPC behavior resumes).
- The Store's three-bucket design is schema-agnostic — domain rules belong in the Game's wrapper, not in Store.js.
