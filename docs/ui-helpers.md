# UI Helpers

## Back button

The `createBackButton` helper creates a consistent back-arrow button in the top-left corner. It follows the replay guard
— during a replay, clicking it calls `exitReplay` instead of the custom handler.

```js
import { createBackButton } from "@adventure-engine/UIHelper.js";

const backBtn = createBackButton(scene, () => {
    scene.scene.start("PreviousScene");
}, {
    scrollFactor0: false, // pinned to camera
    visible: true,
    stopPropagation: true, // prevent walk/hotspot click-through
    replayReturn: true, // default: during replay, return to the replay owner scene
});
```

## Chunky buttons

The `createChunkyButton` helper creates a wooden-panel styled button with optional drawn icons.

```js
import { createChunkyButton, drawCameraIcon } from "@adventure-engine/UIHelper.js";

const btn = createChunkyButton(scene, 400, 300, 80, 80, {
    onClick: () => console.log("clicked"),
    iconDrawFn: (gfx, cx, cy) => drawCameraIcon(gfx, cx, cy),
});
```

### Built-in icon functions

```js
import { drawCameraIcon, drawFullscreenIcon, drawReloadIcon, drawTrashIcon } from "@adventure-engine/UIHelper.js";

// Usage inside a chunky button's drawIcon callback:
drawTrashIcon(gfx, cx, cy); // trash bin
drawCameraIcon(gfx, cx, cy); // camera
drawFullscreenIcon(gfx, cx, cy); // fullscreen toggle
drawReloadIcon(gfx, cx, cy); // reload/restart
```

### Using without an icon (text label):

```js
const btn = createChunkyButton(scene, 400, 300, 120, 50, {
    text: "Start",
    onClick: () => scene.scene.start("GameScene"),
});
```

## DebugOverlay

Toggled with the backtick key (`` ` ``). Displays:

- Walkable polygon as green wireframe
- Hotspot bounds as colored rectangles
- Prop approach points and facing
- Lit window positions (magenta handles)
- Per-actor bounding boxes

```js
// Created automatically by base scene if debug is enabled.
// Toggle with: this.debug.setVisible(!this.debug.visible);
```

## SceneEditor

In-game spatial editor for tuning prop positions, walkable polygons, and lit windows. Activated with keyboard shortcuts:

| Key          | Action                                                   |
| ------------ | -------------------------------------------------------- |
| `W`          | Copy walkable polygon to clipboard                       |
| `N`          | Copy NightLayer window entries to clipboard              |
| `P`          | Copy props to clipboard                                  |
| Arrow keys   | Nudge selected handle                                    |
| Drag handles | Move walkable vertices, prop positions, window positions |

```js
// Created automatically by base scene.
// The editor operates on this.sceneConfig which is the scene's own config object.
// Copy the formatted config from the clipboard back into your scene file.
```

## UI_DEPTH

All UI elements render at `UI_DEPTH` (9000) to sit above the night overlay (6000) and weather (5000). Buttons,
inventory, and debug overlay all use this depth baseline.
