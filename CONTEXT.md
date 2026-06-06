# Caper — Context Overview

A **point-and-click adventure engine** built on [Phaser 3](https://phaser.io/) that provides reusable systems for
Humongous-style adventure games: walking, one-click interaction, declarative props, inventory, NPC/cast behavior,
weather, cutscenes, transitions, UI helpers, and engine-owned state primitives.

The engine ships no game content (no character names, scene names, or art keys). All game-specific knowledge is supplied
at boot via typed registries and configuration — a strict one-way dependency boundary (ADR 0005).

## Language

Extract and formalize domain terminology from the codebase.

### Key Concepts

| Term                             | Definition                                                                                                                                                                                                                                                                                                                                | Aliases / Notes                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Capability slice**             | A `src/` subdirectory that owns everything for one engine capability — types, runtime code, and the boot-time registry                                                                                                                                                                                                                    | Module, package                                                                                                     |
| **Registry**                     | A Phaser-idiomatic singleton the game populates at boot (`register()`) and the engine queries at runtime (`get()`/`resolve()`)                                                                                                                                                                                                            | e.g. `characters`, `content`, `castRegistry`, `engineAssets`, `wearables`                                           |
| **AdventureScene**               | The engine's base Phaser Scene class that composes all engine systems (hotspots, walk, inventory, weather, props, cast, debug, editor)                                                                                                                                                                                                    | Composed via `super.create(data)`                                                                                   |
| **Hotspot**                      | A clickable zone in a scene with a type (`pickup`, `look`, `exit`, `subscene`, `use-with`), bounds, approach point, and cursor                                                                                                                                                                                                            | Registered via `HotspotManager`                                                                                     |
| **Prop**                         | A declarative scene object with art + ordered states, each gated by a `when` condition; renders + binds interaction reactively                                                                                                                                                                                                            | Managed by `PropEngine`                                                                                             |
| **PropState**                    | One visual/behavioral state of a Prop — frame, position, effects, click/drop handlers                                                                                                                                                                                                                                                     | Selection: first state whose `when` passes                                                                          |
| **Store**                        | The engine's generic reactive state container: three typed buckets (`values`, `collections`, `items`), change events, localStorage persistence, replay sandboxing                                                                                                                                                                         | Engine singleton `store`                                                                                            |
| **Condition**                    | A pure serializable data DSL for querying game state — ops: `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`has`/`not`, combinators: `allOf`/`anyOf`/`not`                                                                                                                                                                                               | Used by props, cast reactions, wearables                                                                            |
| **Cutscene**                     | A cancellable async sequence of `walkTo`/`speak`/`play` primitives over a `Cutscene` cancel token                                                                                                                                                                                                                                         | Orchestrated by `CutsceneRunner`                                                                                    |
| **CutsceneActor**                | A per-NPC wrapper that exposes awaitable `walkTo`, `speak`, `play`, `facePlayer` methods bound to a cancel token                                                                                                                                                                                                                          | Built by `buildCutsceneContext()` / `actorFor()`                                                                    |
| **CastDirector**                 | Per-scene orchestrator that spawns NPCs from the cast registry, runs ambient behaviors, wires reactions, and runs cutscenes                                                                                                                                                                                                               | One per `AdventureScene`                                                                                            |
| **WalkController**               | Owns the active character sprite: walkable polygon, linear walking, fidget idle, direction animation                                                                                                                                                                                                                                      | `this.walk` on AdventureScene                                                                                       |
| **EngineScene**                  | The duck-typed interface contract engine modules rely on — the union of capabilities an AdventureScene provides                                                                                                                                                                                                                           | `EngineScene` typedef in `src/scene/EngineScene.js`                                                                 |
| **Event bus**                    | A `Phaser.Events.EventEmitter` (`this.bus`) for cross-system communication without coupling                                                                                                                                                                                                                                               | Events: `chapterchange`, `weatherchange`, `timechange`, `ambientchange`, `hotspot:arrived`, `subscene:open`/`close` |
| **RenderableItem**               | The minimal shape for a renderable inventory item: `{ id, frame?, scale?, rotation? }`                                                                                                                                                                                                                                                    | Typedef in `src/inventory/itemDef.js`                                                                               |
| **Transition**                   | Named fade presets (`room`, `quick`, `dim`, `dramatic`, `night`, `cinematic`, `arrival`) with configurable duration/color                                                                                                                                                                                                                 | Managed in `src/scene/transitions.js`                                                                               |
| **Replay sandbox**               | A snapshot/restore system on the Store that isolates mini-game state changes from the main save                                                                                                                                                                                                                                           | `store.snapshot()` / `store.restore()`                                                                              |
| **NPC**                          | A dynamic non-player character with sprite, fidget, walk-to, speak, behavior (wander/patrol/follow), and hotspot zone                                                                                                                                                                                                                     | Managed by `CastDirector`                                                                                           |
| **IdleCharacter**                | The playable character that ISN'T currently active — ambles via WanderBehavior and greets on click                                                                                                                                                                                                                                        | Engine-generic, reads from `characters` registry                                                                    |
| **WanderBehavior**               | Come-and-go state machine: wandering → leaving → absent → return                                                                                                                                                                                                                                                                          | Drives a `WanderHost` (NPC or WalkController)                                                                       |
| **Wearable**                     | A visual attachment to a character sprite — backpack, held item, etc. — with per-character offset tables and a condition DSL                                                                                                                                                                                                              | Managed by `WearableManager`                                                                                        |
| **Subscene**                     | A zoom-in overlay on a scene: background swap + back arrow + optional custom content, pushable onto a stack                                                                                                                                                                                                                               | `SubsceneStack`                                                                                                     |
| **WeatherLayer**                 | Overlays procedural rain/snow (Graphics lines) and/or falling leaves (sprites)                                                                                                                                                                                                                                                            | `this.weather` on AdventureScene                                                                                    |
| **NightLayer**                   | Evening/night lighting overlay: tint, lit windows, moon                                                                                                                                                                                                                                                                                   | Per-scene optional                                                                                                  |
| **CritterHelper**                | Static utility for spawning decorative ambient critters (butterfly, bird, ground)                                                                                                                                                                                                                                                         |                                                                                                                     |
| **Quest**                        | A composite tree of Steps the game registers at boot; the engine derives `done`/`whatsNext` by evaluating each node's `doneWhen` **Condition** over the Store. No stored status, no player-facing log                                                                                                                                     | Registered via `quests` registry; evaluator peer of `PropEngine`                                                    |
| **Step**                         | A node in a Quest — a Quest nested in a Quest. Leaf carries a `doneWhen`; composite carries ordered `steps` (hand-authored or generated from a runtime target list). `whatsNext` = DFS to first incomplete leaf                                                                                                                           | One node type, no `flag`/`collection` taxonomy                                                                      |
| **Quest path namespace**         | Virtual `quest.<id>.<accessor>` keys the Condition evaluator resolves at eval time (not stored). `<accessor>` ∈ `{ status, whatsNext, progress }` or a `<step_name>` that descends. `status` ∈ `not_started`→`seen`→`started`→`done` (derived cascade); `progress` = count of done leaves. Same namespace for `when` and imperative reads | Step names can't shadow `status`/`whatsNext`/`progress` (boot guard)                                                |
| **DialogueBubble**               | A cloud-bubble Container with optional icons + text, auto-destroying                                                                                                                                                                                                                                                                      | Supports `thought` and `speech` variants                                                                            |
| **ContentRegistry**              | Engine registry mapping inventory item IDs to atlas/frame/scale specs                                                                                                                                                                                                                                                                     | `content.registerItems()` / `content.getItem()`                                                                     |
| **CharacterRegistry**            | Engine registry mapping character IDs to render configs (sprite, animations, outfits)                                                                                                                                                                                                                                                     | `characters.register()` / `characters.resolve()` / `characters.render()`                                            |
| **CastRegistry**                 | Engine registry mapping NPC IDs to per-chapter ambient behaviors + reactions                                                                                                                                                                                                                                                              | `registerCast()` / `castRegistry`                                                                                   |
| **EngineAssetRegistry**          | Engine registry for art keys of built-in widgets (thought bubble, back button, leaves, critter, inventory atlas)                                                                                                                                                                                                                          | `engineAssets.configure()` / `engineAssets.get()`                                                                   |
| **Asset loading convention**     | Key-based URL derivation: `bg_<name>` → `/scenes/<name>.jpg`, `sprite_<name>` → `/objects/<name>.png` (+ JSON), `object_<name>` → `/objects/<name>.png`, `character_<name>` → `/characters/<name>.png`                                                                                                                                    | `deriveAsset()` in `src/assets/assetLoading.js`                                                                     |
| **Boot sequence**                | 1. Game calls `createAdventureGame({ register, config })` → 2. `register()` fires to populate all registries → 3. `new Phaser.Game(config)` boots scenes                                                                                                                                                                                  | See ADR 0005                                                                                                        |
| **Tracer-bullet vertical slice** | Development philosophy: build a working end-to-end feature across all layers before full implementation                                                                                                                                                                                                                                   | Reference in project context                                                                                        |

## Key Files

| File                                       | Purpose                                                                                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.js`                                   | Package entry point — re-exports all public API symbols from every capability slice                                                                |
| `mod.d.ts`                                 | Bundled type declarations (auto-generated from JSDoc via `deno task dts`)                                                                          |
| `deno.json`                                | Deno project config: tasks, imports (Phaser 3, std/assert, std/fs), fmt/lint rules, publish config                                                 |
| `src/scene/AdventureScene.js`              | **Engine base scene** — composes all engine systems, hooks for game override (`getActiveCharacterId`, `handleChapterTransition`, `isExitDisabled`) |
| `src/scene/createAdventureGame.js`         | **Bootstrap factory** — runs `register()` then creates `Phaser.Game`                                                                               |
| `src/state/Store.js`                       | **Reactive state store** — values/collections/items buckets, persistence, change events, batching, replay sandbox                                  |
| `src/core/conditions.js`                   | **Declarative conditions DSL** — pure data query language over the Store                                                                           |
| `src/interaction/PropEngine.js`            | **Declarative prop engine** — renders/updates props reactively from state changes                                                                  |
| `src/interaction/HotspotManager.js`        | **Hotspot input routing** — click zones, cursor switching, hover events                                                                            |
| `src/movement/WalkController.js`           | **Character locomotion** — walkable polygon, linear walking, animation state machine                                                               |
| `src/movement/pathfinding.js`              | **Nav helpers** — point-in-polygon, snap-to-polygon, visibility-graph + Dijkstra pathfinding                                                       |
| `src/cast/CastDirector.js`                 | **NPC orchestrator** — spawns cast, runs ambient behaviors, wires reactions, runs cutscenes                                                        |
| `src/cast/CastRegistry.js`                 | **Cast registry types** — CastEntry, Ambient, Reaction, SceneCastOverride type definitions + live registry                                         |
| `src/cast/NPC.js`                          | **NPC class** — sprite, walk-to, speak, fidget, hotspot zone, behavior attachment                                                                  |
| `src/cutscene/Cutscene.js`                 | **Cutscene cancel token** — cancellable async primitive with `wait()` bridging callbacks to promises                                               |
| `src/cutscene/CutsceneRunner.js`           | **Cutscene orchestrator** — one-at-a-time execution with suspend/resume and preemption                                                             |
| `src/cutscene/cutsceneActor.js`            | **Cutscene actor builder** — wraps NPCs as awaitable `walkTo`/`speak`/`play` actors                                                                |
| `src/characters/CharacterRegistry.js`      | **Character config registry** — sprite + animations + outfits + portrait settings                                                                  |
| `src/characters/Wearables.js`              | **Wearable attachments** — per-character offset tables, condition-gated visibility                                                                 |
| `src/inventory/InventoryLayer.js`          | **Inventory UI** — bottom-of-screen item strip with drag support                                                                                   |
| `src/inventory/ContentRegistry.js`         | **Item art registry** — inventory id → atlas/frame/scale                                                                                           |
| `src/scene/transitions.js`                 | **Scene transitions** — fade presets, `transitionTo`/`transitionIn`, replay exit                                                                   |
| `src/scene/SubsceneStack.js`               | **Sub-scene management** — push/pop zoom-in overlays                                                                                               |
| `src/environment/WeatherLayer.js`          | **Weather effects** — procedural rain/snow, falling leaves                                                                                         |
| `src/environment/NightLayer.js`            | **Night lighting** — tint, lit windows, moon                                                                                                       |
| `src/environment/CritterHelper.js`         | **Ambient critters** — butterfly, bird, ground creatures                                                                                           |
| `src/movement/IdleCharacter.js`            | **Idle playable character** — autonomous wanderer when another character is active                                                                 |
| `src/movement/behaviors/WanderBehavior.js` | **Come-and-go wander state machine**                                                                                                               |
| `src/movement/behaviors/walker.js`         | **Walker/WanderHost contract** + shared utility functions                                                                                          |
| `src/assets/assetLoading.js`               | **Convention-based asset loading** — key → URL derivation, guarded loaders, chapter-based key collection                                           |
| `src/assets/EngineAssets.js`               | **Engine widget art key registry** — thought bubble, back button, leaves, critter, inventory atlas                                                 |
| `src/ui/UIHelper.js`                       | **Shared UI utilities** — chunky buttons, icon drawing, depth constant                                                                             |
| `src/ui/DebugOverlay.js`                   | **Debug visualizer** — walkable polygon, hotspot bounds, approach arrows                                                                           |
| `src/ui/SceneEditor.js`                    | **In-game editor** — drag handles for walkable polygon, hotspots, props; copy-to-clipboard                                                         |
| `src/ui/FullscreenButton.js`               | **Fullscreen toggle UI button**                                                                                                                    |
| `src/ui/FullscreenButton.js`               | Fullscreen toggle                                                                                                                                  |
| `src/cutscene/DialogueBubble.js`           | **Speech/thought bubble** — cloud container with icons + text, icon type registry                                                                  |
| `src/cutscene/SuccessMessage.js`           | **Success banner** — styled confirmation text with scale animation                                                                                 |
| `docs/index.md`                            | **Documentation entry point** — module map, architecture, ADR index                                                                                |
| `docs/architecture.md`                     | **Architecture & registries** — boot sequence, engine/game boundary, event bus reference                                                           |
| `docs/adr/`                                | **Architecture Decision Records** — 6 ADRs covering interaction model, prop framework, weather, NPC cast, engine boundary, character outfits       |
| `README.md`                                | **Project overview** — install, usage, development, publishing, module map                                                                         |
| `LICENSE`                                  | MIT License                                                                                                                                        |
| `.github/workflows/publish.yml`            | **CI/CD** — publish to JSR on `v*` tag push                                                                                                        |

## Patterns & Conventions

### Coding Conventions

- **Language**: JavaScript with extensive JSDoc type annotations (`@typedef`, `@param`, `@returns`, `@property`)
- **Runtime/Module**: Deno (ES modules, `.js` extensions in all imports, `npm:` and `jsr:` import specifiers)
- **Formatting** (from `deno.json`): 4-space indent, 120 line width, semicolons required, double quotes
- **Linting** (from `deno.json`): excludes `no-window-prefix` and `no-slow-types` rules
- **Compiler options**: strict mode, but `strictNullChecks: false`, `strictPropertyInitialization: false`,
  `noImplicitOverride: false`

### Architecture Patterns

1. **Engine/Game Boundary (ADR 0005)**: The engine never imports game code. All game knowledge enters through boot-time
   registries populated in a `register()` callback passed to `createAdventureGame()`. This is a strict one-way
   dependency.

2. **Capability Slices**: Each `src/` subdirectory owns one complete capability — runtime code, types, and its boot-time
   registry. Dependencies between slices are explicit; cross-slice communication goes through the Store or the Event
   Bus.

3. **Registries**: Phaser-idiomatic pattern — populate at boot (`register()`, `configure()`, `registerItems()`), query
   by key at runtime (`get()`, `resolve()`, `has()`). Engine registers are singletons exported from their module.

4. **Declarative Configuration**: Scene behavior is driven by `AdventureSceneConfig` objects — background keys, walkable
   polygons, props, weather modes, cast overrides, assets. Game scenes extend `AdventureScene` and pass config to
   `super(config)`.

5. **Reactive State**: The `Store` drives reactivity. Engine widgets subscribe to changes via `store.onChange()`.
   `PropEngine.reconcile()` runs on every store change to update prop visibility/state/hotspots. The
   `evaluateCondition()` DSL queries the store declaratively.

6. **Event Bus**: `this.bus` (`Phaser.Events.EventEmitter`) for cross-system communication. Major events:
   `chapterchange`, `weatherchange`, `timechange`, `hotspot:arrived`, `subscene:open`/`close`.

7. **Game Hooks**: `AdventureScene` provides override points for game-specific behavior: `getActiveCharacterId()`,
   `handleChapterTransition()`, `isExitDisabled()`. Default implementations exist for each.

### Data Flow

```
User Click → HotspotManager → WalkController (walks to approach point)
  → bus emits "hotspot:arrived" → PropEngine.handleArrived()
  → PropEngine executes effects (store.set, store.addTo, transitionTo, etc.)
  → Store change → reconcile() → Props self-update
```

### State Management

- Three buckets: `values` (scalars/flags), `collections` (named Sets for inventory/world items), `items` (item visual
  state strings)
- Engine-owned defaults: `currentScene`, `timeOfDay`, `inventory` Set, `world` Set
- Game supplies schema via `store.configure({ saveKey, createFreshState, aliases, notifySubject })`
- LocalStorage persistence via `_saveState()` / `_loadState()` — serializes Sets as arrays
- Change batching via `store.batch()` — suspends notifications until the batch completes
- Replay sandbox via `store.snapshot()` / `store.restore()` — isolates mini-game state mutations
- `notifySubject`: the game can supply a facade object passed to subscribers instead of the raw Store

### Conditions DSL

- Pure serializable data — no functions — so the in-game editor can author and round-trip them
- Shape: `{ key: constraint }` = AND across keys; `[A, B]` = OR; `{ allOf: [...] }`, `{ anyOf: [...] }`, `{ not: ... }`
- Leaf constraints: `{ eq: v }`, `{ ne: v }`, `{ gt/gte/lt/lte: v }`, `{ has: id }`, `{ not: id }`, `{ count: n }`
- Bare scalars are sugar: for collections = `has`, for values = `eq`
- Special key `dropped` resolves against the dragged inventory item

### Testing

- **Framework**: Deno's built-in test runner (`Deno.test()`)
- **Assertions**: `@std/assert` (`assertEquals`)
- **Location**: Test files are co-located with source as `*.test.js` files in `src/`
- **Files**: 5 test files found: `conditions.test.js`, `Cutscene.test.js`, `CutsceneRunner.test.js`,
  `CritterHelper.test.js`, `assetLoading.test.js`
- **Coverage**: Tests exist for core logic (conditions, cutscene contract, critter helper, asset loading) but UI/system
  integration is untested
- **CI task**: `deno task test` runs `deno test --permit-no-files --allow-read src/`

### Build & CI Pipeline

- **`deno task ci`** runs sequentially: lint → fmt:check → check (typecheck) → dts:check (regenerate `mod.d.ts` and
  verify it's clean) → test
- **`deno task dts`**: Compiles JSDoc to `.d.ts` files via `tsc`, then bundles into single `mod.d.ts` via
  `dts-bundle-generator`
- **Publishing**: Pushed to JSR on `v*` tag via GitHub Actions. Pre-publish run: `deno install` → `deno task dts:check`
  → `deno publish`
- **`mod.d.ts`**: Lives at `// @ts-self-types="./mod.d.ts"` in `mod.js`. CI validates it's never stale.

### Error Handling

- **Cutscene cancellation**: `CutsceneCancelled` is thrown into pending awaits when a cutscene is preempted or the scene
  shuts down. `CutsceneRunner` swallows this specific error so cancellation is silent; other errors propagate.
- **NPC teardown**: Best-effort cleanup in `Cutscene.cancel()` — failing `stopWalking` on a half-destroyed sprite must
  not block teardown (caught and ignored).
- **Store persistence**: `localStorage` access wrapped in try/catch for private browsing / quota errors. Unknown save
  shapes silently boot fresh (no migration).
- **Safe defaults**: All registries have empty initial states. Unconfigured registries return `undefined`/`null`/empty.
  The engine doesn't crash if a game omits optional registrations.

### Module Dependencies

- **`scene/` depends on**: `interaction/`, `movement/`, `inventory/`, `environment/`, `cast/`, `characters/`, `assets/`,
  `state/`, `ui/`
- **`interaction/` depends on**: `core/` (conditions), `state/` (store), `scene/` (transitions), `cutscene/`
  (DialogueBubble)
- **`movement/` depends on**: `core/` (perspective, random), `state/` (store), `characters/`, `cutscene/`
  (DialogueBubble), `interaction/` (PropEngine for exit approaches)
- **`cast/` depends on**: `core/` (conditions), `state/` (store), `movement/` (behaviors, fidget, pathfinding),
  `cutscene/` (runner, actor), `characters/`
- **`cutscene/` depends on**: `characters/` (portraits), `assets/` (EngineAssets), `state/` (store)
- **`characters/` depends on**: `state/` (store)
- **`environment/` depends on**: `assets/` (EngineAssets), `state/` (store), `core/` (random)
- **`inventory/` depends on**: `state/` (store), `ui/` (UIHelper)
- **`assets/` depends on**: nothing internal
- **`state/` depends on**: nothing internal
- **`core/` depends on**: `state/` (store — conditions uses it)
- **`ui/` depends on**: `state/` (store), `scene/` (transitions), `assets/` (EngineAssets)

### Heavily Coupled Subsystems (Impact Hotspots)

1. **AdventureScene ↔ All systems**: The base scene creates and wires every subsystem. Changes to the scene lifecycle,
   event bus, or system composition ripple everywhere.
2. **PropEngine ↔ Store + evaluateCondition**: The entire reactive prop system depends on the Store's change events and
   the conditions DSL. Changes to either have wide blast radius.
3. **CastDirector ↔ NPC + behaviors + CutsceneRunner**: NPC orchestration ties together spawning, ambient behaviors,
   reactions, and cutscenes. Tightly intertwined.
4. **WalkController ↔ Wearables + perspective + pathfinding**: Character rendering depends on wearable offsets,
   perspective scale, and walkable polygon navigation.
5. **Store ↔ Everything**: Nearly every module imports the Store. It's the single most-coupled module in the codebase.
