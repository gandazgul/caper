# Scene Transitions

The engine provides a unified transition system — every scene change runs through one of two functions. No more
copy-pasted `fadeOut → camerafadeoutcomplete → scene.start`.

## Transition presets

Named presets are defined in `TRANSITIONS`:

| Preset        | Duration | Color | Use case                       |
| ------------- | -------- | ----- | ------------------------------ |
| `"quick"`     | 400ms    | white | Mini-game back buttons         |
| `"room"`      | 600ms    | white | Default room-to-room (DEFAULT) |
| `"arrival"`   | 800ms    | white | Longer destination reveal      |
| `"dim"`       | 500ms    | black | Quickest dark cut              |
| `"dramatic"`  | 600ms    | black | Weightier dark exit            |
| `"night"`     | 700ms    | black | Deeper dark                    |
| `"cinematic"` | 800ms    | black | Chapter-change intros          |

## transitionTo

The main function for scene changes. Resolution order: per-call override > per-scene default > `"room"`.

```js
import { transitionTo } from "@caper/engine";

// By preset name:
transitionTo(this, "ForestScene");                       // uses scene default or "room"
transitionTo(this, "ForestScene", "cinematic");           // by preset name
transitionTo(this, "ForestScene", { preset: "cinematic" });  // same, object form

// Full override:
transitionTo(this, "ForestScene", {
    duration: 1000,
    color: 0x000000,
    fadeIn: true,
    data: { fromDoor: true },                            // passed to the target scene's create(data)
    onBeforeStart: () => console.log("transitioning"),
});

// Per-scene default:
// Set in the scene config:
sceneConfig: {
    transition: "dim",
}
```

### Replay guard

If a replay sandbox is active, `transitionTo` redirects to `exitReplay` — the player is mid-mini-game and "exit" means
"restore the snapshot and return to the configured replay owner scene," not "go to the literal target."

## exitReplay

For leaving a mini-game launched from a replay sandbox:

```js
import { exitReplay } from "@caper/engine";

exitReplay(this);
```

This restores the pre-replay state snapshot and fades to the return scene (configured via `engineAssets`:
`replayDefaultReturn`).

## transitionIn

Call in a scene's `create()` to fade in on arrival:

```js
import { transitionIn } from "@caper/engine";

class MyScene extends AdventureScene {
    create(data) {
        super.create(data);
        transitionIn(this); // matches the outgoing transition style
        // or: transitionIn(this, "cinematic");
    }
}
```

## The full lifecycle

```
1. transitionTo(scene, targetKey, opts)
   ↓
2. Is a replay sandbox active?
   ├── Yes → exitReplay(scene): restore snapshot, go to return scene
   └── No → record lastTransitionFrom
       ↓
3. Resolve transition preset:
   a. per-call override (opts.preset / opts.duration + opts.color)
   b. per-scene default (scene.sceneConfig.transition)
   c. global default ("room")
   ↓
4. Camera.fadeOut(duration, r, g, b)
   ↓
5. On camerafadeoutcomplete:
   a. Run onBeforeStart hook
   b. scene.start(targetKey, data)
   ↓
6. Target scene's create(data) runs
   ↓
7. transitionIn(this) matches the incoming effect
```

## Return approach

When entering a scene, the base scene checks which prop's `transitionTo` matches the previous scene. It spawns the
character at that prop's approach point, creating natural "walking through the door" behavior.

```js
// In your prop config:
{
    id: "exit_door",
    states: [{
        onClick: [{ goToScene: "ForestScene" }],
        approach: { x: 900, y: 400, facing: "right" },
    }],
}
// When returning from ForestScene, the character spawns at (900, 400) facing left.
```
