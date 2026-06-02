# Interaction Model

The engine implements a **one-click** interaction model inspired by Humongous Entertainment games. The player clicks an
object; the active character walks to it (if needed), performs an action, and effects fire. No verb selection.

## WalkController

The `WalkController` owns the active character's sprite, movement, and animation. Created automatically by the base
scene.

```js
// Created in AdventureScene.create():
this.walk = new WalkController(this, {
    characterId: "hero",
    spriteKey: "character_hero",
    startPosition: { x: 500, y: 500 },
    walkable: [...],               // polygon defining where the character can walk
    spriteScale: 0.55,
    animationSet: { ... },          // per-direction animations (see characters.md)
    animationScales: { ... },       // per-animation scale overrides
    animationOrigins: { ... },      // per-animation origin overrides
    perspective: null,              // perspective config or null
    initialFacing: "down",
});
```

### Walkable area

A polygon defined as an array of `{ x, y }` points. The character walks only inside this polygon; clicks outside are
snapped to the nearest edge.

```js
walkable: [
    { x: 100, y: 600 },
    { x: 900, y: 600 },
    { x: 900, y: 300 },
    { x: 100, y: 300 },
],
```

### Motion states

| State    | What happens                          | Animation played                      |
| -------- | ------------------------------------- | ------------------------------------- |
| `walk`   | Character moving to a target          | Direction's `walk` animation (looped) |
| `still`  | Stationary, no input                  | Direction's `still` texture           |
| `fidget` | Stationary, occasional idle animation | Direction's `idle` animation (once)   |
| `reach`  | Playing a pickup action               | Direction's `reach` animation (once)  |

### Methods

```js
this.walk.lock(); // prevent player movement
this.walk.unlock(); // restore movement
this.walk.forceMoveTo(x, y, cb); // programmatic walk (for cutscenes)
this.walk.playReach(cb); // play reach animation, call back when done
this.walk.getFacing(); // → "up" | "down" | "left" | "right"
```

## HotspotManager

Hotspots are clickable zones that trigger walk-and-interact or in-place interactions. Created by the base scene and
managed automatically by the PropEngine and CastDirector.

```js
// Hotspot config shape:
{
    id: "exit_door",
    type: "exit",                    // determines default cursor
    x: 920, y: 300, w: 60, h: 120,  // bounds
    approachPoint: { x: 900, y: 400, facing: "right" },
    cursor: "url('/objects/cursor_exit.png') 16 16, pointer",
    onClick: () => { ... },          // called after walk arrives
}
```

### Hotspot types and default cursors

| Type       | Cursor                  | Meaning                                |
| ---------- | ----------------------- | -------------------------------------- |
| `pickup`   | grab hand               | Pick up an item                        |
| `look`     | eye                     | Examine                                |
| `exit`     | arrow (direction-aware) | Transition to another scene            |
| `subscene` | point finger            | Open a zoom-in view                    |
| `use-with` | grab hand               | Active when dragging an inventory item |

Direction-aware exit cursors swap the arrow direction: `left` shows a left-pointing arrow, `right` shows a
right-pointing arrow, `up` reuses the right arrow (going further into the scene).

## Click flow

```
1. Player clicks
   ↓
2. Is the click on a hotspot?
   ├── Yes → is there an approach point?
   │         ├── Yes (walk) → character walks there → hotspot:arrived event → effects run
   │         └── No (in-place) → effects run immediately
   └── No → is the click inside the walkable area?
            ├── Yes → character walks there
            └── No → snap to nearest walkable edge, character walks there
```

## Drag-from-inventory

When the player drags an item from the inventory strip onto the scene, it triggers a **use-with** interaction:

1. Drag starts: cursor changes to the item's sprite
2. Hover over a prop with an `onDrop` handler: cursor changes to the drop target cursor
3. Drop: the `onDrop` condition checks the dragged item id; if accepted, effects run
4. If the drop lands on a non-drop prop (or empty space), the item snaps back to the inventory

## Exits

Exits are props with a `goToScene` effect. The base scene handles return-approach: when entering a scene, it checks
which prop's `transitionTo` matches the previous scene, and spawns the character at that prop's approach point.

## Cursors

Custom CSS cursors are defined per hotspot type. Override per-prop:

```js
cursor: "url('/objects/my_custom.png') 10 10, pointer",
```

The cursor hotspot coordinates (`x y` after `url(...)`) target the tip of the cursor element (fingertip for grab, arrow
tip for exits).
