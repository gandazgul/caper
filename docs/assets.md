# Asset Loading

The engine uses a key-naming convention for asset loading — no hand-maintained manifest. The texture/JSON key encodes
where the file lives, so the engine can derive the URL from the key.

## Key conventions

| Key pattern | Type | URL derived |
|---|---|---|
| `bg_<name>` | Image | `/scenes/<name>.jpg` |
| `sprite_<name>` | Atlas | `/objects/<name>.png` + `/objects/<name>.json` |
| `object_<name>` | Image | `/objects/<name>.png` |
| `character_<name>` | Image | `/characters/<name>.png` |

Anything that doesn't match a prefix (globally-loaded assets like `inventory-atlas`, `ui-atlas`, spritesheets that need
explicit frame sizes) is loaded explicitly by BootScene or the owning scene.

## Scene asset declaration

Each scene config declares the asset keys it needs:

```js
class MyScene extends AdventureScene {
    constructor() {
        super({
            key: "MyScene",
            backgroundsBySeason: {
                spring: "bg_myroom_spring",   // → /scenes/myroom_spring.jpg
                summer: "bg_myroom_summer",    // → /scenes/myroom_summer.jpg
            },
            assets: [                          // additional keys
                "sprite_props",                 // → /objects/props.png + .json
                "sprite_fall",                  // → /objects/fall.png + .json
            ],
        });
    }
}
```

## Loading functions

```js
import { loadAssetKeys, loadImageOnce, loadSpritesheetOnce } from "@adventure-engine/assetLoading.js";

// Load by convention keys (guards against duplicates):
loadAssetKeys(scene, ["bg_myroom", "sprite_props"]);

// Load one image, guarded:
loadImageOnce(scene, "custom_key", "/path/to/image.png");

// Load a spritesheet with explicit frame config:
loadSpritesheetOnce(scene, "character_hero", "/characters/hero.png", {
    frameWidth: 64,
    frameHeight: 96,
});
```

All loaders guard on `textures.exists()` / `cache.json.exists()` — the same key requested from BootScene, a season
intro, and the scene itself only downloads once.

## Seasonal loading

The engine pre-computes which assets each season needs:

```js
import { collectSeasonAssetKeys, seasonLoadSet } from "@adventure-engine/assetLoading.js";

// All keys for a given season:
const keys = collectSeasonAssetKeys(sceneManager, "summer");

// Spring baseline + season-specific extras:
const loadSet = seasonLoadSet(sceneManager, "summer");
// Spring is always loaded (the baseline). Summer extras are added on top.
// A reload that resumes into summer never re-downloads spring-loadable assets.
```

## EngineAssets registry

The engine owns several built-in visuals (thought bubbles, back button, falling leaves, critters, inventory bar) but
owns no art. The game supplies the actual texture/atlas keys at boot:

```js
import { engineAssets } from "@adventure-engine/EngineAssets.js";

engineAssets.configure({
    thoughtBubble: { atlas: "ui-atlas",      frame: "thought-bubble" },
    backButton:    { atlas: "ui-atlas",      frame: "back-arrow" },
    leaves:        { atlas: "sprite_fall",   frames: ["leaf1","leaf2","leaf3","leaf4"] },
    critter:       { atlas: "critters-atlas", frame: "red_butterfly" },
    inventoryAtlas: "inventory-atlas",
    replayDefaultReturn: "MyRoom",
});
```

### Slots

| Slot | Shape | Used by |
|---|---|---|
| `thoughtBubble` | `{ atlas, frame }` | `ThoughtBubble.js` — cloud sprite |
| `backButton` | `{ atlas, frame }` | `UIHelper.js` — back arrow |
| `leaves` | `{ atlas, frames[] }` | `WeatherLayer.js` — falling leaf sprites |
| `critter` | `{ atlas, frame }` | `CritterHelper.js` — default critter sprite |
| `inventoryAtlas` | `string` | `AdventureScene.js` — default inventory bar atlas |
| `replayDefaultReturn` | `string` | `transitions.js` — scene key for replay return |

## Boot sequence

1. **`registerGameContent()`** — populates all registries including `engineAssets`
2. **`BootScene`** — loads globally-shared atlases (`ui-atlas`, character spritesheets)
3. **Season intro scene** — preloads assets for the current season using `seasonLoadSet()`
4. **Per scene** — loads its remaining assets in `preload()` via `loadAssetKeys()`
