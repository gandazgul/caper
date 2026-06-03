# Architecture & Registries (ADR 0005)

The engine is designed around a strict one-way dependency: **the engine never imports game code**. All game-specific
knowledge reaches the engine through typed registries populated at boot.

## The boundary rule

No engine file may import from game code. This is a one-way dependency contract enforced during extraction to prevent
regressions. Engine-internal relative specifiers are fine (e.g. a behavior importing `../NPC.js`). Escaping to game code
(e.g. `../content/items.js`) is a violation.

## Registries at a glance

Every registry follows the Phaser-idiomatic pattern: **populate at boot, query by key at runtime**.

| Registry       | Engine file            | What it stores                                           | Populated by game at boot via…            |
| -------------- | ---------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `characters`   | `CharacterRegistry.js` | Character render configs (sprite key, animations, scale) | `characters.register("hero", {...})`      |
| `content`      | `ContentRegistry.js`   | Inventory item sprite specs (atlas + frame + scale)      | `content.registerItems({ apple: {...} })` |
| `castRegistry` | `CastRegistry.js`      | NPC cast: per-season ambient + reactions                 | `registerCast({ npcId: {...} })`          |
| `engineAssets` | `EngineAssets.js`      | Art keys for built-in engine widgets                     | `engineAssets.configure({...})`           |
| `wearables`    | `Wearables.js`         | Wearable item definitions (backpack, held items)         | `wearables.registerAll({...})`            |
| `store`        | `Store.js`             | Injects state schema, save key, default values           | `store.configure({...})`                  |

## Boot sequence

```
1. Game calls createAdventureGame({ register, config })

2. register() fires once:
   ├── engineAssets.configure(...)       # art keys for thought bubbles, etc.
   ├── store.configure(...)              # save key, fresh state factory
   ├── characters.register("hero", ...)  # player + NPC render configs
   ├── content.registerItems({...})      # inventory item art
   ├── registerCast({...})               # NPC seasonal ambient + reactions
   ├── wearables.registerAll({...})      # wearable offsets and art
   └── (any other game-specific setup)

3. new Phaser.Game(config) boots:
   ├── Scenes are registered in config.scene[]
   ├── BootScene preloads global assets
   └── Each AdventureScene subclass creates itself
```

## Engine systems composition

Every game scene extends `AdventureScene`. The base scene composes the engine's systems automatically:

```js
class MyGameScene extends AdventureScene {
    constructor() {
        super(myConfig);
    }

    create(data) {
        super.create(data); // ← builds every system:
        //   this.hotspots, this.walk, this.inventory,
        //   this.weather, this.subscenes, this.debug,
        //   this.editor, this.cast, this.propEngine
    }
}
```

### Systems created by the base scene

| Property          | Class                        | Purpose                                     |
| ----------------- | ---------------------------- | ------------------------------------------- |
| `this.walk`       | `WalkController`             | Active character movement + animation       |
| `this.hotspots`   | `HotspotManager`             | Click zones for props and exits             |
| `this.inventory`  | `InventoryLayer`             | Bottom-of-screen item strip                 |
| `this.weather`    | `WeatherLayer`               | Rain, snow, falling leaves                  |
| `this.subscenes`  | `SubsceneStack`              | Zoom-in sub-scenes                          |
| `this.debug`      | `DebugOverlay`               | Walkable polygon + hotspot visualizer       |
| `this.editor`     | `SceneEditor`                | In-game spatial editor (keyboard shortcuts) |
| `this.cast`       | `CastDirector`               | NPC ambient behavior + reaction wiring      |
| `this.propEngine` | `PropEngine`                 | Declarative prop rendering + interaction    |
| `this.bus`        | `Phaser.Events.EventEmitter` | Cross-system event bus                      |

## Game hooks

The base scene provides override points for game-specific behavior:

```js
class MyGameScene extends AdventureScene {
    /** Which registered character is active? */
    getActiveCharacterId() {
        return store.getActiveCharacter() ?? characters.defaultPlayer ?? "";
    }

    /** React to a season change */
    handleSeasonTransition(oldSeason, newSeason) {
        this.changeBackground(`bg_room_${newSeason}`);
    }

    /** Prevent exiting a scene */
    isExitDisabled(hotspot) {
        return store.get("puzzleInProgress") === true;
    }
}
```

## The Event Bus

`this.bus` is a `Phaser.Events.EventEmitter` that engine systems and game code use to communicate without coupling:

| Event                              | Emitted by     | Payload          | Consumed by                                |
| ---------------------------------- | -------------- | ---------------- | ------------------------------------------ |
| `seasonchange`                     | AdventureScene | season string    | CastDirector (rebuilds NPCs), WeatherLayer |
| `weatherchange`                    | AdventureScene | weather string   | CastDirector, CritterHelper                |
| `timechange`                       | AdventureScene | "day" or "night" | CastDirector, NightLayer                   |
| `ambientchange`                    | AdventureScene | ambient string   | —                                          |
| `hotspot:arrived`                  | WalkController | hotspot config   | PropEngine (triggers effects)              |
| `subscene:open` / `subscene:close` | SubsceneStack  | —                | —                                          |
