# Hello World — Building a Game on the Caper

This guide walks through creating a minimal point-and-click game from scratch. By the end you'll have a player character
who can walk around a room, pick up an item, and exit to another scene.

## Prerequisites

- Node.js 18+ or Deno
- A Phaser 3 project setup (Vite recommended)
- A Phaser 3 project that imports the engine package

## 1. Create the boot file

Every game needs a single entry point that populates the engine's registries and creates the Phaser game. This is the
**manifest** pattern.

```js
// src/main.js
import Phaser from "phaser";
import { createAdventureGame } from "@caper/engine";
import { registerGameContent } from "./registerContent.js";
import { MyRoomScene } from "./MyRoomScene.js";

createAdventureGame({
    register: registerGameContent,
    config: {
        type: Phaser.AUTO,
        width: 1024,
        height: 768,
        scale: { mode: Phaser.Scale.FIT },
        scene: [MyRoomScene],
        physics: { default: "arcade", arcade: { gravity: { y: 0 } } },
    },
});
```

## 2. Populate registries

Create a registration file that the engine calls once at boot. This is where you supply all game-specific knowledge.

```js
// src/registerContent.js
import { store } from "@caper/engine";
import { characters } from "@caper/engine";
import { content } from "@caper/engine";
import { engineAssets } from "@caper/engine";
import { wearables } from "@caper/engine";

export function registerGameContent() {
    // ─── Engine widget art ─────────────────────────────────────────────
    // The engine owns built-in visuals (thought bubbles, back button,
    // leaves, critters, inventory). You supply the actual atlas/frame keys.
    engineAssets.configure({
        thoughtBubble: { atlas: "ui-atlas", frame: "thought-bubble" },
        backButton: { atlas: "ui-atlas", frame: "back-arrow" },
        leaves: { atlas: "sprite_fall", frames: ["leaf1", "leaf2", "leaf3", "leaf4"] },
        critter: { atlas: "critters-atlas", frame: "butterfly" },
        inventoryAtlas: "inventory-atlas",
        replayDefaultReturn: "MyRoom",
    });

    // ─── State store ───────────────────────────────────────────────────
    // Tell the engine how to create a fresh save state, and where to persist it.
    store.configure({
        saveKey: "my-game-save",
        createFreshState: () => ({
            values: {
                playerName: "Hero",
                hasKey: false,
                chapter: "spring",
                activeCharacter: "hero",
            },
            collections: {
                visitedRooms: new Set(),
            },
            items: {},
        }),
        aliases: { season: "chapter" },
        defaultReplayReturnScene: "MyRoom",
    });

    // ─── Characters ────────────────────────────────────────────────────
    // Register the player character and any NPCs.
    // The first playable character becomes the default active character.
    characters.register("hero", {
        spriteKey: "character_hero",
        spriteScale: 0.55,
        animationSet: {
            front: { still: "hero-front", walk: "hero-walk-front" },
            back: { still: "hero-back", walk: "hero-walk-back" },
            side: { still: "hero-side", walk: "hero-walk-side" },
        },
        playable: true,
    });

    // ─── Items (for inventory) ─────────────────────────────────────────
    content.registerItems({
        key_item: { atlas: "props-atlas", frame: "key", scale: 0.8 },
    });

    // ─── Wearables (optional) ──────────────────────────────────────────
    wearables.registerAll({
        // See Wearables.js for the full wearable definition shape.
    });
}
```

## 3. Create your first scene

Extend the engine's base `AdventureScene`. Your scene config describes the room — its background, walkable area, props,
and cast.

```js
// src/MyRoomScene.js
import { AdventureScene } from "@caper/engine";
import { transitionIn } from "@caper/engine";

export class MyRoomScene extends AdventureScene {
    constructor() {
        super({
            key: "MyRoom",
            backgroundsBySeason: {
                spring: "bg_myroom", // loads /scenes/myroom.jpg
            },
            walkable: [
                { x: 100, y: 600 },
                { x: 900, y: 600 },
                { x: 900, y: 300 },
                { x: 100, y: 300 },
            ],
            activeCharacter: {
                startPosition: { x: 500, y: 500 },
            },
            props: [
                {
                    id: "key",
                    atlas: "props-atlas",
                    x: 300,
                    y: 400,
                    states: [
                        {
                            // Show only when not yet picked up
                            when: { hasKey: { ne: true } },
                            frame: "key",
                            cursor: "pickup",
                            onClick: [
                                { pickup: { id: "key_item" } },
                                { set: { hasKey: true } },
                            ],
                        },
                    ],
                },
                {
                    id: "exit_door",
                    x: 950,
                    y: 350,
                    bounds: { x: 920, y: 300, w: 60, h: 120 },
                    states: [
                        {
                            cursor: "exit",
                            approach: { x: 900, y: 400, facing: "right" },
                            onClick: [
                                { goToScene: "MySecondRoom" },
                            ],
                        },
                    ],
                },
            ],
        });
    }

    create(data) {
        super.create(data);
        transitionIn(this);
    }
}
```

## 4. Run it

With Vite configured, start the dev server:

```bash
npm run dev
# or
deno task dev
```

You'll see your character standing in the room. Click the walkable floor to move. Click the key to pick it up. Click the
exit to transition to another scene.

## What's next?

- Add more scenes and link them with exits
- Register NPCs with seasonal ambient behaviors → [npc-and-cast.md](npc-and-cast.md)
- Declare interactive props with state machines → [props.md](props.md)
- Add weather, day/night cycles → [weather.md](weather.md)
- Write cutscenes with awaitable locomotion → [cutscenes.md](cutscenes.md)
- Understand the Store and game state → [store.md](store.md)
