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

## Persistence and recovery

The Store saves on each change; `batch()` coalesces synchronous mutations into one write. A single browser-local save is
the default. The game resumes its saved `currentScene` during boot (see the runnable starter).

```js
store.configure({
    saveKey: "my-game-save",
    saveVersion: 1,
    createFreshState,
    migrateSave: (saved, from, to) => {
        // Return the JSON save envelope with migrated game values/collections/items.
        // The engine writes version `to` on the next successful save.
        if (from === 0 && to === 1) {
            return { ...saved, values: { ...saved.values, newFlag: false } };
        }
        return null; // incompatible: preserve the original save
    },
});
```

Versions are non-negative integers. The default is 0; old unversioned saves also count as 0, so existing games continue
loading them. Migrations are synchronous, run only for older versions, and receive plain JSON data (collections are
arrays, not Sets). The game owns migration of its domain values. The engine checks the save envelope and reserved values
before hydrating over fresh defaults.

**Protection:** malformed saves, newer versions, unsupported migrations, and failed reads are preserved. In-memory
gameplay can continue, but autosave and `save()` cannot overwrite that stored progress. Fix the migration and reload, or
let the player explicitly choose `store.reset()` to discard it and start fresh. Migration errors/invalid results are
treated as incompatible. Starting a scene must never implicitly call reset to silence these states.

**Write failures:** quota/private-mode/storage errors retain progress in memory and are observable. The next mutation
retries a failed write; `store.save()` also retries immediately and returns whether a write succeeded. After a read
failure, reload to retry reading (a write retry intentionally cannot overwrite an unread save). No save writes occur
during replay sandboxing.

```js
const dispose = store.onSaveStatusChange((status) => {
    // Immediately receives current status; subsequently fires when status changes.
    // status.state: ready | saved | unavailable | invalid | incompatible
    // status.operation: load | save; status.message explains recovery when needed.
    saveWarning.textContent = status.message ?? "";
});
store.saveStatus; // read-only current status
store.save(); // explicit retry after a write failure
store.reset(); // explicit fresh start; releases protection and ends replay
// dispose() when the subscribing UI is destroyed
```

The starter demonstrates a status message and Retry saving button. Reset is an explicit player action, not a
prerequisite for normal gameplay.

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
