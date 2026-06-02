# 0004 — Declarative NPC cast (season-keyed ambient, reactions, cutscene runner)

Status: **proposed** Date: 2026-05-30

## Decision

A recurring character's **global ambient behavior** becomes declarative data in a single **cast registry**, keyed by
season — readable in one place per character. Everything beyond ambient (scripted choreography, puzzles, one-off
appearances) stays **imperative code**, reached through engine-provided primitives. Season gating, locomotion,
greeting, and quest hooks decompose into cast data + a small set of engine services.

This is the NPC sibling of [ADR 0002](./0002-declarative-prop-framework.md). It deliberately **diverges** from 0002 on
one axis: props optimize for editor-authorability (everything serializable); the cast optimizes for **strong types + JS
expressiveness** (custom behaviors and cutscenes are code). Props are _push_ (re-render continuously as state changes);
NPC interactions are _pull_ (evaluated only when the player interacts). That difference is why the cast does **not** get
a global reactive evaluation loop.

## Context

Point-and-click NPC scenes tend to share primitive behavior — `walkTo`/`speak`/`wander()`/`patrol()` — but duplicate
the integration logic around those primitives:

1. **Season/weather/time gating** is hand-written per character. Each scene controller hard-codes which season and
   weather conditions show the character and which retreat them indoors.
2. **One character's logic is spread across places.** Understanding a recurring character requires reading multiple
   controller files, the global NPC spawner, and per-scene `new NPC(...)` calls.
3. **Greeting + quest reactions are bespoke per controller.** Each controller hand-rolls its own conditional ladder.
4. **No cutscene primitive.** Choreography is nested `delayedCall` chains; each scene re-solves sequencing,
   await, and cleanup.

The goal: **one declarative place per character for global ambient**, with imperative escape hatches that are
_engine-provided primitives_ rather than copy-pasted glue. It is acceptable — by design — that a character's _per-scene_
reaction is read in that scene, not the registry.

## The engine / game line

The single principle: **the engine detects only what it can know without game knowledge, and provides plumbing; it never
hardcodes a game concept.** "Steal" is not an engine trigger — it is the game declaring `steal: true` on a prop and
emitting an event when that prop is taken; the engine merely routes the event string to reactions.

| Engine provides                                                                                                            | Game (creator) provides                                                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `NPC` (sprite + hotspot + locomotion + speak)                                                                              | Cast registry data (per character, per season)                                                 |
| Behaviors: `wander` / `patrol` / `static` / `follow` + custom-factory escape                                               | The `run` fns / `say` lines (the choreography itself)                                          |
| `CastDirector`: resolves season-keyed ambient on spawn, re-resolves on coarse bus events, suspend/resume                   | Scene-side `activityLoop(localWaypoints)`, `suppress`, appear-and-say                          |
| Reaction system: spatial triggers it detects natively + open bus-event subscription, **scoped to the current season only** | Semantics of game events (what `steal`/`pickup` _mean_; prop `steal:true`; emitting the event) |
| Cutscene runner: async suspend → sequence → resume, blast-radius via opts                                                  | `director.cutscene(fn)` cutscenes / puzzles + their state flags                                |
| Conditions DSL (reused for `when`)                                                                                         | The conditions' content                                                                        |

## The cast registry

One entry per recurring character. The **season key partitions the whole entry** — ambient, greet, and
reactions all nest under the season — so three chapters later the engine never reconsiders a past chapter's conditions:
that chapter's reaction list is not even in the lookup.

```js
// cast.js
shopkeeper: {
  sprites:  { indoor: "shopkeeper-home-side-walk", outdoor: "shopkeeper-hat-side-walk" },
  defaults: { scale: 0.42, boundsOffset: {...}, approachOffset: {...} },

  fall: {
    ambient: [
      { when: { weatherMode: { anyOf: ["light-rain", "heavy-rain"] } },
        scope: "inside",  behavior: "wander" },
      { scope: "outside", behavior: "patrol", activity: "sweep" },
    ],
    reactions: [
      { on: "see", every: false, say: ["Getting chilly out!"] },
      { on: "click",
        when: { questItemSeen: { eq: true }, rewardGiven: { ne: true } },
        run: giveReward },
    ],
  },
  summer: {
    ambient:   { scope: "anywhere", behavior: "wander", shelterOnRain: true },
    reactions: [ { on: "both", every: true, say: ["Beautiful day!"] } ],
  },
  spring: { ambient: { scope: "inside", behavior: "wander" }, reactions: [ ... ] },
}
```

### Reactions

A reaction is `{ on: <trigger>, when?: <conditions>, every?: bool, run | say }`. The season holds an **ordered list**;
for a given fired trigger the **first matching `when` wins** (`PropEngine` first-match semantics, reused). Greeting is
not special — it is the reaction whose trigger is `see` / `click`.

- **Triggers the engine detects natively (spatial/local):** `see` (active character within range), `click`, `hover`, `leave`.
  Wired onto the sprite on spawn.
- **Triggers from the bus (open vocabulary):** any string the game emits — `enter`, a prop's `emit`, a drag-drop
  (`drop:key_item`), a quest event. The game owns their meaning.
- **Evaluation is pull, not push.** A reaction's `when` is checked **only when its trigger fires** — never in a global
  loop, never on every `store.onChange`. The `CastDirector` subscribes **only the current season's** reactions to
  their triggers; on `seasonchange` it tears those down and wires the next season's. Cost = reactions in the current
  chapter for characters currently on screen.
- **Frequency.** `every: false` = first encounter only, backed by an engine-derived Store flag (the sprite is
  rebuilt every room, so an instance bool won't survive). `every: true` = each encounter.

### Ambient

`ambient` is either one rule or an **ordered list of weather/scope-conditioned rules**; the director picks the first
whose `when` (weather/time DSL) + `scope` + `activity`-availability hold, re-picking only on a coarse `seasonchange` /
`weatherchange` / `timechange` bus event (the events the scene already listens for) — never a continuous scan.
`behavior` is one of `wander` / `patrol` / `static` / `follow`, **or** a custom factory `(npc, ctx) => Behavior`.

**Weather switch + scene geometry.** An outdoor character does an activity loop while dry and wanders inside
while it rains — expressed as two rules. The dry rule is `behavior: "patrol", activity: "<name>"`; its **waypoints +
doorPoint live in the scene** (`cast.<id>.activities.<name>` in the scene config), so the rule only applies where that
geometry exists (yards) and is absent everywhere else without naming scenes. When weather flips dry→rain, the active
rule changes: the director **retreats** the outdoor NPC to the nearest indoor-leading exit (the patrol `doorPoint`)
rather than vanishing it; an indoor scene's rain rule then shows them wandering inside — continuity if the player
follows. Behavior policy (the weather switch) is global in the registry; only the geometry is per-scene.

## Scenes own everything else (imperatively, via cast helpers)

The cast holds the _global_ default. A scene installs local behavior by calling director helpers in `create()`:

- `director.get("shopkeeper")?.activityLoop({ waypoints, activities })` — installs a local routine **and auto-suspends the
  global ambient** for this scene. This replaces the pattern of per-scene controller files with local geometry.
- `director.suppress("shopkeeper")` — opt a character out of this scene.
- `director.play(fn, opts)` — run a cutscene (below).

**One-scene NPCs are NOT in the registry.** They are plain `new NPC(...)` created in their
scene's `create()`, wiring the _same_ reaction API inline (`npc.reactions([...])`, `activityLoop()`). The reaction
system belongs to the NPC/director primitive; the cast registry is one declaration site, scene-local NPCs are another.

## The cutscene runner

One async primitive generalizes `PatrolBehavior.interrupt`: **suspend → run sequence → resume**. A cutscene is a plain
async function over awaitable NPC/player primitives — strongly typed, full control flow, no nested `delayedCall`.

```js
director.cutscene(fn, { lockPlayer?: boolean, cast?: string[] });

async function giveReward(d) {     // d exposes each present cast member + player + helpers
  await d.shopkeeper.facePlayer();
  await d.shopkeeper.say("Here's your reward!");
  await d.give("reward_item");
  store.set("rewardGiven", true);
}
```

- **Blast radius via opts.** `cast` lists which ambient behaviors to suspend (default: all present); `lockPlayer` locks
  the player walk. A greeting is `{ cast: ["shopkeeper"] }` (player free); a multi-actor scene is
  `{ lockPlayer: true, cast: ["shopkeeper", "guard"] }`. `npc.interrupt()` stays as sugar for the one-NPC, no-lock case.
- **Awaitable primitives.** `walkTo` / `say` / `play` return promises wrapping the existing tween/timer callbacks. Scene
  shutdown (or preemption) **rejects** outstanding awaits so the async function unwinds cleanly and never fires
  callbacks on a destroyed sprite — the riskiest implementation surface, called out explicitly.
- **A puzzle is a cutscene that sets a flag.** No separate "puzzle" primitive.

## Worked decomposition (proof the model holds)

| Controller does…                         | …becomes                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Seasonal presence gate                   | `<id>.<season>.ambient` (cast lookup)                                            |
| Scene-specific activity loop             | scene `director.get(id).activityLoop(waypoints)`                                  |
| Rain/night retreat                       | `shelterOnRain` + `doorPoint`                                                    |
| Click → greeting                         | reaction `{ on: "see"/"click", say: [...] }`                                     |
| Click → quest item                       | reaction `{ on: "click", when, run }`                                            |
| Companion follow-behind                  | `{ behavior: "follow" }`, scene/quest-invoked                                    |
| Give item on drop                        | reaction `{ on: "drop:<item>", run }` (inventory emits the event)               |
| Global NPC wander matrix                 | `<id>.<season>.ambient` entries                                                   |
| Non-playable character idle wander       | `WanderBehavior` over its `WalkController`                                       |

## Consequences

- One declarative place per character for global ambient; per-scene reactions read in the scene (accepted).
- No global reactive NPC loop — interaction-time pull + season-scoped subscriptions keep cost bounded as the game grows.
- New surface to build: `CastDirector`, the reaction subscription/scoping layer, awaitable locomotion + the cutscene
  runner's cancellation contract, and the `follow` behavior. The conditions DSL and first-match evaluation are reused
  from `PropEngine`, not reinvented.
- Divergence from 0002 (code over serializable) is intentional and scoped to the cast: choreography is easier and more
  expressive as typed code than as data, and NPCs are explicitly **not** an editor target for now.
