# Cutscenes

The engine provides an async cutscene system built on cancellable promises. Cutscenes are plain async functions over
awaitable NPC/player primitives — strongly typed, full control flow, no nested `delayedCall` chains.

## The Cutscene primitive

`Cutscene` is the cancellation core — deliberately Phaser-free. It bridges callback-based operations (tweens, timers)
into cancellable promises.

```js
import { Cutscene } from "@adventure-engine/Cutscene.js";

const cs = new Cutscene();

// Wrap a callback operation:
await cs.wait(
    (done) => {
        // Start something, call done() when it completes
        someTween.once("complete", done);
    },
    () => {
        // onCancel: stop the underlying operation
        someTween.stop();
    },
);

cs.cancel();  // rejects all pending awaits with CutsceneCancelled
```

## CutsceneRunner

`CutsceneRunner` is the orchestration layer that handles suspend/resume of ambient NPC behaviors, player locking, and
the actor context. It guarantees:

- Ambient behavior is suspended before the sequence and **resumed exactly once after**, even if the sequence throws
- `CutsceneCancelled` is swallowed (silent unwind)
- A new cutscene preempts a running one cleanly

```js
const runner = new CutsceneRunner({
    suspend: (cast) => { /* pause NPC ambient */ },
    resume: (cast) => { /* restore NPC ambient */ },
    lockPlayer: () => scene.walk.lock(),
    unlockPlayer: () => scene.walk.unlock(),
    buildContext: (cs) => buildCutsceneContext(scene, cs, presentNPCs),
});
```

## The director.cutscene() API

The `CastDirector` exposes a `cutscene()` method that wraps `CutsceneRunner.run()`:

```js
director.cutscene(async (d) => {
    await d.hero.say("What's this?");
    await d.npc.facePlayer();
    await d.npc.say("A secret passage!");
    await d.hero.walkTo({ x: 400, y: 300 });
    await d.wait(500);          // pause, cancellable
}, { lockPlayer: true, cast: ["npc"] });
```

### Options

| Option | Default | Description |
|---|---|---|
| `lockPlayer` | false | Lock the player's walk controller during the cutscene |
| `cast` | undefined | Which NPCs' ambient to suspend (default: all present) |

## Actor context (the `d` object)

The context exposes every present cast member by id, the player walker, and scene helpers — all bound to the cutscene's
cancel token:

```js
director.cutscene(async (d) => {
    // Per-NPC methods:
    await d.shopkeeper.walkTo({ x: 400, y: 300 });   // returns promise
    await d.shopkeeper.say("Hello!", 3000);            // speech + hold
    await d.shopkeeper.facePlayer();                   // instant
    await d.shopkeeper.play("wave-anim");              // animation, resolves on complete
    d.shopkeeper.setFlipX(true);                       // instant

    // Player:
    await d.player.forceMoveTo(500, 400);              // walk controller

    // Scene helpers:
    await d.wait(1000);                                 // pause
    d.give("item_id", "shopkeeper");                   // fly item to inventory from above NPC
    d.give("item_id");                                  // fly from above player instead
});
```

## Cutscene from a cast reaction

The most common path — writing a cutscene inline in a cast reaction's `run`:

```js
reactions: [
    {
        on: "click",
        when: { hasQuestItem: true },
        run: async (d) => {
            await d.shopkeeper.say("You found it!");
            await d.give("reward");
        },
    },
],
```

## Writing cancellable async sequences

```js
director.cutscene(async (d) => {
    await d.npc.say("Follow me!");
    await d.npc.walkTo({ x: 200, y: 300 });

    // If the cutscene is cancelled here (scene shutdown or preemption),
    // the await rejects with CutsceneCancelled — the rest never runs.
    // The NPC's ambient behavior is still resumed once.

    await d.npc.say("We're here.");
}, { lockPlayer: true });
```

## Error handling

- `CutsceneCancelled` is swallowed by the runner (silent unwind)
- Any other error propagates after cleanup (ambient resumed, player unlocked)
