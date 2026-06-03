# NPCs and the Declarative Cast System

The engine provides two complementary systems for non-player characters:

1. **`NPC`** — the primitive: a sprite + hotspot + locomotion + speech. Use it for ad-hoc, one-scene characters.
2. **`CastDirector` + `castRegistry`** — declarative NPC management: seasonal ambient behavior, reaction wiring, and
   cutscene orchestration. Use it for recurring characters that appear across multiple scenes.

## NPC primitive

Create an NPC directly for scene-local characters:

```js
import { NPC } from "@caper/engine";

const npc = new NPC(this, {
    id: "shopkeeper",
    name: "Shopkeeper",
    x: 400,
    y: 300,
    texture: "character_shopkeeper",
    frame: 0, // optional: atlas frame index
    scale: 0.5,
    approachOffset: { x: 80, y: 0, facing: "left" },
    boundsOffset: { x: -40, y: -200, w: 80, h: 180 },
    walkSpeed: 80, // px/sec for walkTo()
    walkAnim: "shopkeeper-walk",
    stillFrame: "shopkeeper-still",
    chatter: ["Hello!", "Welcome!"],
    onClick: (npc) => {
        npc.speak("Nice to meet you!");
    },
    fidget: { // optional: occasional idle animation
        stillKey: "shopkeeper-still",
        idleAnimKey: "shopkeeper-idle",
        intervalMs: 8000,
    },
});
```

### NPC methods

```js
npc.walkTo({ x: 500, y: 300 }, onComplete); // walk and call back
npc.speak("Hello!", holdMs); // thought bubble with text
npc.facePlayer(); // rotate toward active character
npc.stopWalking(); // interrupt movement
npc.setOrigin(x, y); // adjust sprite origin
```

## Declarative cast

For recurring characters, populate the `castRegistry` at boot. The `CastDirector` (one per scene) reads the registry,
spawns each character's seasonal ambient behavior, and wires reactions.

### Cast entry structure

```js
import { registerCast } from "@caper/engine";

registerCast({
    shopkeeper: {
        defaults: { // shared across seasons
            scale: 0.5,
            approachOffset: { x: 80, y: 0, facing: "left" },
            boundsOffset: { x: -40, y: -200, w: 80, h: 180 },
        },
        spring: {
            ambient: {
                behavior: "wander", // see behaviors below
                scope: "inside", // only in indoor scenes
                when: { timeOfDay: { eq: "day" } },
                options: { dwellRange: [4000, 8000] },
            },
            reactions: [
                { on: "click", say: ["Hello spring!"] },
                {
                    on: "click",
                    when: { hasQuestItem: { eq: true } },
                    run: async (d) => {
                        await d.shopkeeper.say("Thanks for bringing that!");
                        await d.give("reward");
                    },
                },
            ],
        },
        summer: {
            ambient: { behavior: "patrol", activity: "sweep", scope: "outside" },
            reactions: [{ on: "click", say: ["Hot out here!"] }],
        },
    },
});
```

### Seasonal ambient rules

The `ambient` field is either a single rule or an **ordered list** of weather/scope-conditioned rules. The director
picks the first whose conditions match, re-picking only on `seasonchange` / `weatherchange` / `timechange` bus events.

```js
ambient: [
    // Rainy → stay inside and wander
    { when: { weatherMode: { anyOf: ["light-rain", "heavy-rain"] } },
      scope: "inside", behavior: "wander" },
    // Dry → patrol outside with a rake animation
    { scope: "outside", behavior: "patrol", activity: "rake" },
],
```

### Ambient behavior scope

- **`"inside"`** — only in indoor scenes (scenes with `indoors: true` in config)
- **`"outside"`** — only in outdoor scenes
- **`"anywhere"`** — all scenes

## Behaviors

The engine ships four locomotion behaviors:

### WanderBehavior

Random walk within walkable bounds, with occasional dwells.

```js
{ behavior: "wander", options: { dwellRange: [3000, 8000] } }
```

### PatrolBehavior

Fixed waypoint circuit with per-waypoint activity animations and rain/night door retreat.

```js
{ behavior: "patrol", activity: "rake" }
```

Activity geometry is defined per-scene in the scene config:

```js
// In your scene config:
cast: {
    shopkeeper: {
        activities: {
            rake: {
                waypoints: [
                    { x: 200, y: 500, activity: "rake", faceRight: true },
                    { x: 600, y: 500, activity: "rake", faceRight: false },
                    { x: 400, y: 400 },
                ],
                activities: {
                    rake: { anim: "rake-anim", faceRight: true },
                },
                doorPoint: { x: 50, y: 300 },
                order: "loop",     // or "random"
            },
        },
    },
}
```

### FollowBehavior

Trail the active character at a lag distance. Used for companions.

```js
{ behavior: "follow", options: { lag: 180, repathMs: 700 } }
```

### CompanionBehavior

Tight lockstep "conga line" trailing with configurable spacing and formation.

```js
{ behavior: "companion", options: { spacing: 100, order: 1, trainMode: true } }
```

## Reactions

Reactions are triggered events. The engine detects these natively:

| Trigger   | When it fires                                  |
| --------- | ---------------------------------------------- |
| `"see"`   | Active character enters a range around the NPC |
| `"click"` | Player clicks the NPC                          |
| `"hover"` | Mouse hovers over the NPC                      |
| `"leave"` | Active character leaves the range              |

Additionally, any string the game emits on the bus can be a trigger (e.g. `"drop:backpack"`, `"quest_complete"`).

Reaction options:

```js
{
    on: "click",
    when: { hasItem: { eq: true } },    // conditions DSL
    every: false,                        // fire once (default) or every time
    say: ["Hello!"],                     // random line from array
    run: async (d) => { ... },           // custom cutscene
    lockPlayer: true,                    // lock player walk during the cutscene
    cast: ["shopkeeper"],                // suspend these NPCs' ambient during cutscene
}
```

## Scene cast overrides

Scenes can opt characters out, or supply activity geometry:

```js
// In your scene config:
cast: {
    shopkeeper: {
        suppress: true,                  // don't spawn shopkeeper here
    },
    gardener: {
        activities: {
            rake: { waypoints: [...], doorPoint: {...} },
        },
    },
}
```
