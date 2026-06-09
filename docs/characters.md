# Characters

The engine manages characters through a central registry. Characters can be **playable** (the player controls them) or
**non-playable** (NPCs managed by the CastDirector). The engine knows no character names — only what's registered.

## Character config

```js
characters.register("hero", {
    spriteKey: "character_hero",
    spriteScale: 0.55,
    animationSet: {
        front: { still: "hero-front", walk: "hero-walk-front", idle: "hero-idle-front" },
        back:  { still: "hero-back",  walk: "hero-walk-back" },
        side:  { still: "hero-side",  walk: "hero-walk-side", reach: "hero-reach-side" },
    },
    animationScales: { "hero-walk-front": 0.5 },   // per-animation scale overrides
    animationOrigins: { "hero-side": { x: 0.5, y: 1 } },
    playable: true,              // ← this character is player-controllable
    wanderer: true,              // ← if inactive, this character wanders the scene
    largeBubble: false,          // ← thought bubble anchors normally
    outfits: {
        pajamas: {               // alternate render config (see below)
            spriteKey: "character_hero_pajamas",
            animationSet: { ... },
        },
    },
    portraitSettings: {
        scale: 1,
        texture: "ui-atlas",
        offsetX: 0,
        offsetY: 0,
    },
    getPortrait: (scene) => {    // optional: generate a portrait texture at runtime
        return "character_hero"; // return a texture key
    },
});
```

### Animation set structure

The `animationSet` maps directions to animation entries. Each entry has these slots:

| Slot    | Type          | Purpose                                             |
| ------- | ------------- | --------------------------------------------------- |
| `still` | texture key   | Shown when stationary (a single frame)              |
| `walk`  | animation key | Looped while moving                                 |
| `idle`  | animation key | Played once as an occasional fidget (repeat: 0)     |
| `reach` | animation key | Played once during a pickup/interaction (repeat: 0) |

Fallback chain: missing `walk` → falls to `still` → `idle`; missing `idle` → `still`.

## Active character

The first playable character registered becomes the default. The active character is tracked in the Store under the key
`activeCharacter`.

```js
store.getActiveCharacter(); // → "hero"
store.setActiveCharacter("hero");
characters.defaultPlayer; // → "hero"
characters.playableIds(); // → ["hero", "sidekick"]
characters.hasMultiplePlayers; // → true (shows character switcher)
```

The base scene spawns the active character's `WalkController` in `create()`. Switching characters rebuilds the walker
and all NPCs react to the new active character.

## Character switching

When more than one playable character is registered, the engine automatically offers a character switcher UI. Switching:

1. Stores the new active character id
2. Rebuilds the active walker with the new character's render config
3. Repositions the newly active character to where the previous active character stood
4. Updates the inactive wandering characters (see below)
5. Emits a `characterchange` event that NPC reactions can listen for

## Wanderers (Inactive Characters)

When multiple playable characters are registered, the currently unselected (inactive) characters can autonomously wander
around the scene. The engine manages these characters through `engineScene.idleCharacters`.

To enable wandering, you must opt-in:

- **Registry Opt-in:** Set `wanderer: true` when registering the character. They will automatically wander whenever they
  are inactive.
- **Explicit Override:** Pass a `wanderers` array to the spawn method in your scene's `create()`:
  `this.spawnIdleCharacters({ wanderers: ["sister"] })`.
- **Suppressing:** Set `disableIdleCharacter: true` in your `AdventureSceneConfig` to completely disable wanderers for
  that scene.

You can also provide a `greeting` callback to `spawnIdleCharacters` to give them click-to-speak dialogue lines.

## Outfits (ADR 0006)

An outfit is an alternate render config — a full sprite-set swap. Outfits are selected per-character through a Store
key:

```
heroOutfit: "pajamas"   → uses hero.pajamas config
heroOutfit: undefined    → uses base hero config
```

```js
store.setOutfit("hero", "pajamas");
store.getOutfit("hero"); // → "pajamas"
```

Changing an outfit triggers a reactive rebuild — the active sprite, idle character, and all registered NPCs of that
character are updated immediately. Outfit state persists in saves automatically.

## Large characters (bubble sizing)

Characters taller than the default can flag `largeBubble: true` in their config. This adjusts thought bubble anchor
offsets — wider horizontal offset (190px vs default) and higher vertical offset (90px vs 110px).

```js
characters.register("tall_npc", {
    spriteKey: "character_tall",
    largeBubble: true,
    // ...
});
```

## Resolution and rendering

```js
// Get a character's render config (with outfit overrides applied):
characters.resolve("hero"); // base config
characters.render("hero", "pajamas"); // base + pajama overrides merged

// Check existence:
characters.has("hero"); // → boolean
```
