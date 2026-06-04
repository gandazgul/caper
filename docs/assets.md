# Asset Loading

The engine uses a key-naming convention for asset loading — no hand-maintained manifest. The texture/JSON key encodes
where the file lives, so the engine can derive the URL from the key.

## Key conventions

| Key pattern        | Type  | URL derived                                                        |
| ------------------ | ----- | ------------------------------------------------------------------ |
| `bg_<name>`        | Image | `/scenes/<name>.jpg` by default; accepts explicit jpg/png/webp/svg |
| `sprite_<name>`    | Atlas | `/objects/<name>.png` + `/objects/<name>.json`; accepts png/webp   |
| `object_<name>`    | Image | `/objects/<name>.png` by default; accepts explicit png/webp/svg    |
| `character_<name>` | Image | `/characters/<name>.png` by default; accepts explicit png/webp/svg |

Anything that doesn't match a prefix (globally-loaded assets like `inventory-atlas`, `ui-atlas`, spritesheets that need
explicit frame sizes) is loaded explicitly by BootScene or the owning scene.

## Scene asset declaration

Each scene config declares the asset keys it needs:

```js
class MyScene extends AdventureScene {
    constructor() {
        super({
            key: "MyScene",
            backgroundsByChapter: {
                intro: "bg_myroom_intro", // → /scenes/myroom_intro.jpg
                chapter1: "bg_myroom_chapter1.webp", // → /scenes/myroom_chapter1.webp
            },
            assets: [ // additional keys
                "sprite_props", // → /objects/props.png + .json
                "object_sign.svg", // → /objects/sign.svg
                "sprite_fall", // → /objects/fall.png + .json
            ],
        });
    }
}
```

## Loading functions

```js
import { loadAssetKeys, loadImageOnce, loadSpritesheetOnce } from "@caper/engine";

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

All loaders guard on `textures.exists()` / `cache.json.exists()` — the same key requested from BootScene, a chapter
intro, and the scene itself only downloads once.

## Chapter-based loading

The engine pre-computes which assets each chapter needs:

```js
import { chapterLoadSet, collectChapterAssetKeys } from "@caper/engine";

// All keys for a given chapter:
const keys = collectChapterAssetKeys(sceneManager, "chapter1");

// Intro baseline + chapter-specific extras:
const loadSet = chapterLoadSet(sceneManager, "chapter1");
// The intro chapter is always loaded (the baseline). Chapter1 extras are added on top.
// A reload that resumes into chapter1 never re-downloads intro-loadable assets.
```

## EngineAssets registry

The engine owns several built-in visuals (thought bubbles, back button, falling leaves, critters, inventory bar) but
owns no art. The game supplies the actual texture/atlas keys at boot:

```js
import { engineAssets } from "@caper/engine";

engineAssets.configure({
    thoughtBubble: { atlas: "ui-atlas", frame: "thought-bubble" },
    backButton: { atlas: "ui-atlas", frame: "back-arrow" },
    leaves: { atlas: "sprite_fall", frames: ["leaf1", "leaf2", "leaf3", "leaf4"] },
    critter: { atlas: "critters-atlas", frame: "red_butterfly" },
    inventoryAtlas: "inventory-atlas",
    replayDefaultReturn: "MyRoom",
});
```

### Slots

| Slot                  | Shape                 | Used by                                           |
| --------------------- | --------------------- | ------------------------------------------------- |
| `thoughtBubble`       | `{ atlas, frame }`    | `ThoughtBubble.js` — cloud sprite                 |
| `backButton`          | `{ atlas, frame }`    | `UIHelper.js` — back arrow                        |
| `leaves`              | `{ atlas, frames[] }` | `WeatherLayer.js` — falling leaf sprites          |
| `critter`             | `{ atlas, frame }`    | `CritterHelper.js` — default critter sprite       |
| `inventoryAtlas`      | `string`              | `AdventureScene.js` — default inventory bar atlas |
| `replayDefaultReturn` | `string`              | `transitions.js` — scene key for replay return    |

## Boot sequence

1. **`registerGameContent()`** — populates all registries including `engineAssets`
2. **`BootScene`** — loads globally-shared atlases (`ui-atlas`, character spritesheets)
3. **Chapter intro scene** — preloads assets for the current chapter using `chapterLoadSet()`
4. **Per scene** — loads its remaining assets in `preload()` via `loadAssetKeys()`
