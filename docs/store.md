# State (Store)

The engine provides a generic reactive state store with three typed buckets, change events, localStorage persistence,
and a snapshot/restore sandbox for replays. It is the role Phaser's `DataManager` plays, with batteries.

The Store knows nothing about domains or game state — only keys and values. Domain rules live in the game's wrapper.

## Three buckets

### Values — scalars, flags, strings, numbers

```js
store.get("chapter"); // → "intro"
store.set("hasKey", true);
store.set("playerName", "Hero");
```

### Collections — named Sets

The engine always creates two collections:

- `inventory` — items the player is carrying
- `world` — items present in the scene/world when a game wants collection-backed item-state conditions

Games can add their own collections for domain concepts such as placed objects, quest flags, or completed sets.

```js
store.addTo("inventory", "apple");
store.removeFrom("inventory", "apple");
store.has("inventory", "apple"); // → boolean
store.list("inventory"); // → string[]
store.size("inventory"); // → number
```

### Items — per-item visual state

A string map for item-level state (a door's locked/unlocked state, a display's empty/filled state).

```js
store.setItemState("display_case", "filled");
store.getItemState("display_case"); // → "filled"
```

## Configuration

Configure the store once at boot with your game's schema:

```js
store.configure({
    saveKey: "my-game-save", // localStorage key
    createFreshState: () => ({
        values: {
            chapter: "intro",
            timeOfDay: "day",
            activeCharacter: "hero",
            // ...your game's default flags
        },
        collections: {
            placedObjects: new Set(),
            completedQuests: new Set(),
            // ...any other game-specific Sets
        },
        items: {
            // display_case: "empty", // optional per-item visual state
        },
    }),
    defaultReplayReturnScene: "MyRoom",
    notifySubject: stateFacade, // optional facade passed to change subscribers
});
```

Engine-owned state is seeded automatically: `currentScene`, `timeOfDay`, `inventoryCounts`, and the `inventory` and
`world` collections always exist.

## Persistence

The Store auto-saves to `localStorage` on every change (debounced by batching). Loading a save is automatic in
`configure()`. Resetting:

```js
store.reset(); // fresh state, notifies subscribers
```

## Change events

Subscribe to any state change:

```js
const unsubscribe = store.onChange((subject) => {
    // subject is your state facade (or the Store itself)
});

// Later:
unsubscribe();
```

### Batching

Run several mutations as one change event:

```js
store.batch(() => {
    store.set("hasKey", true);
    store.addTo("inventory", "key_item");
    store.setItemState("door", "unlocked");
});
// Subscribers fire once, save fires once
```

## Replay sandbox

Mini-games run in a sandbox: the current state is snapshotted, the mini-game runs, and on exit the snapshot is restored.

```js
store.beginReplay({ returnScene: "PuzzleHub" });
// ... player plays mini-game ...
store.endReplay(); // snapshots restored, save triggered
```

## Engine-reserved keys

| Key               | Type   | Default  | Purpose                                                          |
| ----------------- | ------ | -------- | ---------------------------------------------------------------- |
| `currentScene`    | string | `""`     | Last active scene (for resume)                                   |
| `timeOfDay`       | `"day" | "night"` | `"day"`                                                          |
| `activeCharacter` | string | —        | Currently active playable character                              |
| `inventoryCounts` | object | `{}`     | Stack counts for inventory items                                 |
| `${id}Outfit`     | string | —        | Per-character active outfit (see [characters.md](characters.md)) |

Helper methods:

```js
store.getTimeOfDay(); // → "day" | "night"
store.setTimeOfDay("night");
store.isNight(); // → boolean
store.getCurrentScene(); // → "MyRoom"
store.setCurrentScene("MyRoom");
store.getActiveCharacter(); // → "hero"
store.setActiveCharacter("hero");
store.getOutfit("hero"); // → "pajamas" | undefined
store.setOutfit("hero", "pajamas");
```
