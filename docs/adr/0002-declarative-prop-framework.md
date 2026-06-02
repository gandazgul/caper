# 0002 — Declarative prop framework (state-driven props, conditions, effects)

Status: **proposed** Date: 2026-05-26

## Decision

A prop's **appearance, click behavior, and clickability** all become serializable data — reactive to game state,
round-trippable by the in-game editor — so most prop use cases need zero imperative scene code. Today's two hand-synced
arrays (`propItems` for art, `hotspots` for interaction) collapse into one `props[]` entity. Irreducibly-bespoke
behavior (mini-games, NPC choreography, timed cutscenes) is reached through a single `emit` event bridge rather than
modeled declaratively.

This is the data-model layer underneath the one-click interaction commitment of
[ADR 0001](./0001-humongous-style-one-click-interaction.md): same player-facing model (single click,
drag-from-inventory, cursor affordances), but the per-hotspot behavior 0001 calls for is now expressed as a closed,
serializable vocabulary instead of imperative subclass code.

## Context

Imperative point-and-click scenes tend to develop three coupled problems:

1. **Two parallel arrays, hand-synced.** A prop (`add.image`, non-interactive) and its hotspot (the click zone) are
   separate objects linked only by convention (`data.itemId` matching, or bounds drawn around a sprite's position).
   Scene code then has to cross-reference them to suppress stale pickup zones.
2. **Behavior and visibility are imperative.** "When it renders" is a `shouldRender: () => boolean` **function**; "what
   clicking does" is a `handleArrived`/`onPickup` switch plus bespoke methods (`advanceState`, `slideTween`);
   tweens); "when the hotspot is active" is imperative `register()`/`unregister()` calls. Some scenes are thousands of
   lines as a result.
3. **The editor can't author logic.** It moves/resizes handles and copies JS literals, but `formatProps` **silently
   drops functions**, so `shouldRender` can't round-trip. Logic must live in code, defeating editor authorship.

The goal is a framework — applicable to a future game — where the 90% case is declarative data and the editor owns it.

## The unified entity

A prop = art + an ordered list of **states**. Each state carries its own appearance, interaction, and gates. Pure
decoration omits interactions; a pure trigger-zone (an exit over a background-painted door) omits art. State-driven
variants generalize the existing `backgroundsBySeason` pattern.

```
// Visible-but-inactive: apple box renders behind the box stack,
// but its pickup stays dead until the stack slides aside.
{ id: "apple_box", atlas: "sprite_fall", x, y, depth, approach,
  states: [
    { when: { inventory: { not: "apple_box" } },
      frame: "apple_box",
      activeWhen: { boxStackSlid: { eq: true } },   // independent of visibility
      cursor: "pickup",
      onClick: [ { pickup: { id: "apple_box" } } ] }
  ] }

// Multi-state, clicked in place (no walk): display case state machine.
{ id: "display_case", atlas: "props-atlas", x, y, approach: "in-place",
  states: [
    { when: { world: { state: { eq: "empty" } } }, frame: "case_empty",
      onDrop: { accepts: { dropped: { eq: "gem" } },
                effects: [ { setItemState: { display_case: "filled" } } ] } },
    { when: { world: { state: { eq: "filled" } } }, frame: "case_filled" },
  ] }
```

### State primitive store

Three opinionated, game-agnostic buckets. Being opinionated about what can be stored is what keeps conditions a small
serializable language.

- **`values`** — `get(key)` / `set(key, val)` scalars (boolean/number/string). Well-known keys `chapter` (season) and
  `timeOfDay`; every `*Open`/`*Done`/`*Seen` flag; counters; namespaced counts (`itemCount.some_item`). Replaces the
  `markFlag`/`isFlag` method-pair explosion with `set`/`get`.
- **`collections`** — named Sets, queried with `has`. `inventory` and `world` are engine-owned collections; a game
  defines any additional collections it needs.
- **item registry** — per-item objects carrying `state` (and other props). `inventory` / `world` are _views_ over this
  registry keyed by an item's `location`, so `world: { state }` resolves whether the item is in the bag or in the scene.

Game-specific `markX`/`isX`/`hasX` helper methods, if a game wants them, become thin shims over this store. Save/load
serialization, the `onChange` bus, and the replay sandbox (snapshot/restore) stay generic.

### Condition DSL

Every leaf is `key: { op: value }`. Operators: `eq, ne, gt, gte, lt, lte, has`, combinators `allOf, anyOf, not`.
Conventions:

- An object with multiple keys = **AND**; an array value = **OR**.
- A **bare** property (`world: { state: {...} }`) refers to _the prop's own id_ as subject; a **dotted** path
  (`world: { "display_case.state": {...} }`) addresses another item.
- Bare number = `eq`; thresholds use explicit `{ gte: 3 }`.

Derived completions are **not** quantified at condition time — they are
**computed-and-stored** as flags via effects, keeping the DSL
pure and serializable. Gameplay-only gates (season transitions, exit win-conditions) stay as plain code reading the
primitives.

### Effects (verbs) + lifecycle

`onClick` / `onDrop.effects` are an **ordered list** of verbs (SCUMM lineage): `pickup`, `set`, `addTo` / `removeFrom`,
`goToScene`, `pushSubscene`, `showThought`, `tween`, `destroy`, `playReach`, and `emit` (the bridge).

The engine runs a fixed lifecycle:

> **walk to approach → arrive → reach anim → run effects → chained anims**

State mutations live only in the effect list, which runs _after_ arrival — making "never commit optimistically on drop"
structural rather than a rule each handler must remember. `pickup` is the baked-in item collection lifecycle: reach,
remove the prop, arc to inventory, and add the item when the arc lands. `approach: "walk"` is the default (no
telekinesis); `"in-place"` opts out (in-place clicks on props like switches or control panels).

### Interaction / active model

A state's hotspot is live when **(a)** it is the currently-rendered state, **(b)** it defines `onClick`/`onDrop`, and
**(c)** an optional `activeWhen` condition passes (default: always). Visibility (`when`) and clickability (`activeWhen`)
are **independent** — the apple box (visible behind the stack, inert until slid) is the proof case. Bounds auto-derive
from the sprite's `getBounds()` (explicit `bounds` override allowed when the clickable area ≠ the art); the approach
point is authored; `cursor` is a semantic affordance hint per ADR 0001.

### Drop-targets

A prop interaction, not a special case: `onDrop: { accepts: <condition>,
effects: [...] }` with the same lifecycle.
Drop targets use this same path — point-and-click "use X with Y" interactions without a special-case subsystem.

### Reactive rendering

The engine subscribes to `store.onChange` and, on any change, **re-evaluates every prop**: re-selects its state,
re-applies frame/transform/visibility, re-checks `activeWhen` to arm/disarm its zone. Effects mutate the store; props
self-update. No manual destroy/recreate anywhere. Re-evaluation is gated against
in-flight tweens/walks so a sprite isn't re-rendered mid-animation.

### The `emit` bridge

`emit: "eventName"` fires a scene event; the scene registers `on(event)` and scripts the bespoke bit (an NPC relocates to
the table, launch a mini-game). This affords any behavior while keeping the prop fully declarative. In principle the
whole game could be `emit` + handlers; the declarative verbs exist precisely so it doesn't have to be.

## Scope boundary

**In:** every _prop_ interaction — decoration, pickup, look, exit, subscene-open, toggle, reveal/slide, multi-state —
plus drop-targets.

**Out (stays imperative, triggered via `emit`/`goToScene`):** mini-game scenes, autonomous NPC controllers,
timed multi-actor cutscenes, weather and day/night tint.

## Editor — two phases

- **Phase 1 (ship this):** existing spatial handles (position, bounds, approach, per-state frame) **plus** lossless
  round-trip of `when`/`onClick`/`activeWhen`/ `onDrop` — possible now only because nothing in a prop is a function. The
  dev hand-writes logic once; the editor tunes everything spatial and preserves the rest. Today's
  `formatProps`-drops-functions limitation evaporates.
- **Phase 2 (later):** visual condition/effect builder — dropdowns over the small, closed vocabularies. Off the critical
  path.

Content stays as **pure-data objects in scene modules** (matches the copy-to- clipboard-and-paste workflow), but the
no-functions rule makes externalizing to JSON a mechanical lift for the framework vision.

## Migration plan

1. Build engine pieces: store, condition evaluator, prop renderer + state selection, interaction binder, effect runner
   + lifecycle, drop binder, reactive loop, editor round-trip.
2. Author new scenes directly as `props[]` data.
3. Validate with a representative scene that covers season-gated pickups, slide-reveal (tween + `emit`),
   visible-but-inactive props, a subscene, and an exit.
4. Validate with a second stress-test scene that covers multi-state props, drops, NPC choreography, and the `emit`
   bridge end to end.

## Consequences

- **Prop authoring becomes data, not code.** A new interactive prop is a `props[]` entry, not a sprite + a hotspot + a
  `handleArrived` case + a state-helper method pair. The editor can author and round-trip it.
- **Game state surface stays small.** Domain-specific helper methods can collapse to `get`/`set`/`has`/`addTo`/
  `removeFrom` over three buckets.
- **Reactive rendering removes a whole class of bugs** (stale sprites, manual re-render, forgotten hotspot unregister) —
  props are a pure function of state.
- **Hard to reverse, like 0001.** Once scenes are authored as `props[]` data, returning to imperative props means
  re-authoring every scene. This is a foundational data-model commitment.
- **Risk — item-registry vs collection views** is the subtlest reshape; get it right early or `world`/`inventory`
  queries become muddy.
- **Risk — reactive re-eval correctness** during in-flight tweens/walks; the lifecycle must gate re-evaluation against
  active animations.
- **Risk — `emit` discipline.** Easy to over-use and recreate today's imperative sprawl; treat it as the exception, not
  the reflex.
