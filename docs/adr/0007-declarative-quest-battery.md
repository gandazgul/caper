# 0007 — Declarative Quest battery

Status: **accepted** Date: 2026-06-04

## Decision

The Engine provides a **Quest battery** — a generic, game-agnostic system for declaring task structures and querying
their progress — as a peer to the Prop framework (ADR 0002) and the declarative NPC cast (ADR 0004). It has four parts:

1. **A single recursive node type.** A Quest is a composite tree. Each node is one shape:
   - **leaf** — `{ id, doneWhen: Condition }`
   - **composite** — `{ id, steps: Node[] }`
   - **collection** — `{ id, collect: { items, in, selfCombineInto? } }` — generates one leaf per item (each `doneWhen`
     = `has(in, item)`); `items` may be a function so the set can be rolled at runtime.

   A node is **done** when, if it has steps, all steps are done; otherwise its `doneWhen` passes. A Step _is_ a Quest —
   there is no separate "sub-quest" type and no `flag`/`collection` taxonomy at the type level. Any node may carry an
   **optional `icon`** (a hint for the Thought-Bubble nudge or a future quest log), shown when present and hidden when
   absent — so the unit→icon mapping lives on the node, not in a separate Game table.

2. **A `quests` registry** the Game populates at boot (`quests.register(def)`), exactly like `content`, `castRegistry`,
   and `wearables`. Definitions are plain declarative data; the Engine never hardcodes a quest.

3. **A derived evaluator.** `status` and `whatsNext` are **computed on read** from the Store via the **Condition** DSL —
   never stored. `status` resolves by a priority cascade:

   ```
   done         if all leaves done
   started      else if startWhen passes   (default: any leaf done)
   seen         else if seenWhen passes     (optional; typically an intro-seen fact)
   not_started  otherwise
   ```

   `whatsNext` is a depth-first walk to the first incomplete leaf (the concrete unit still outstanding: a toy id, an
   ingredient id), or `null` once done. `progress` is the count of done leaves in the subtree (a scalar; `total` is
   known from the definition, so percent is derivable).

4. **A virtual path namespace** in the Condition evaluator. State is read as `quest.<id>.<accessor>`, where `<accessor>`
   is one of three reserved keys (`status`, `whatsNext`, `progress`) or a `<step_name>` that descends into that child
   and reopens the same accessors. The **same namespace serves both `when` blocks and imperative reads** — there is no
   second API for querying quests. The evaluator recognizes the `quest.` prefix and routes to the Quest resolver instead
   of the flat Store. A `when` therefore reads quest state with plain, serializable `eq`:

   ```js
   when: { "quest.backpack.status": { eq: "started" } }
   when: { "quest.backpack.fill.pencil_case.whatsNext": { eq: "ruler" } }
   ```

   Step ids may not shadow the reserved accessors `status` / `whatsNext` / `progress`; registration throws if they do.

The Game owns only the **catalog** of definitions (including each node's optional `icon`). The Engine owns the node
type, registry, evaluator, and namespace.

## Context

State across an adventure game is a sprawl of booleans, and the same composite predicate gets hand-re-derived wherever
it is needed. In the reference game, the two kitchen-doorway hotspots each inlined a character-for-character copy of the
`isBreakfastInProgress` predicate in raw DSL keys; the "what is the next thing to do" question was answered by ~6
bespoke cascades (`getMissingToys`, `getPancakeIngredientsMissing`, `getOutOfBoundsBlockers`,
`getNextBackpackQuestStepIcon`, `getBreakfastReminderIcons`, `getEndGameBlocker`); and a pile of intro-seen flags
(`summerIntroSeen`, `mamaBackpackIntroSeen`, …) tracked lifecycle by hand. Changing one rule meant editing every copy in
lockstep; missing one shipped a regression.

A survey of how the genre handles this confirmed the failure mode rather than offering an escape:

- **Adventure Game Studio** uses one global `int` per quest (`0`/`1`/`-1`), advanced by hand — the same boolean sprawl
  with a sanctioned name.
- **Bethesda (Skyrim/Fallout)** uses stored stage integers (`SetStage`) plus objective flags, advanced by quest scripts.
  Powerful, but the canonical source of "permanently broken quest" bugs — a script path that forgets to advance a stage.
  This is precisely our regression class at AAA scale, and the argument against any _stored_ status.
- **Unity** best practice is ScriptableObject-based quests: author as data at edit time, evaluate at runtime. The one
  durable approach, and structurally identical to this battery.
- **Phaser** offers only the registry/DataManager — a key-value store (our `Store`); no quest concept.

The Engine already had every ingredient: a pure, serializable **Condition** DSL (ADR 0002) shared by props, cast, and
wearables; the declarative-registry idiom; and a reactive `Store`. A Quest's "is it done" check is structurally
identical to a Prop's `when`. So this battery formalizes a pattern the Engine was already shaped for, rather than
introducing a foreign mechanism.

## Consequences

- **Status cannot desync.** Because `status`/`whatsNext` are derived from existing facts on every read, there is no
  stored quest field to fall out of agreement with the world — structurally avoiding the Bethesda/AGS failure mode.
- **One `whatsNext`, not six cascades.** Every "what's the next step" question becomes a single DFS over a declared
  tree. Drilling (which quest → which step → which item) falls out of the recursion.
- **`when` blocks reference quests, not raw keys.** Props, exits, cast reactions, and gates read `quest.<id>.<accessor>`
  instead of re-spelling composite conditions. One definition, many readers.
- **The Condition evaluator gains a virtual-namespace seam.** It must route prefixed keys to a resolver. This is general
  (future namespaces can reuse it) but it is now load-bearing for props/cast/wearables, which makes the seam **hard to
  reverse** — backing it out means re-inlining conditions across every consumer.
- **Facts must be monotonic.** Lifecycle stages derived from transient signals (e.g. "an item is on-screen now") will
  flicker/regress. Transients must be latched into a stored monotonic fact that the Quest reads. The derived-status
  guarantee holds only over a monotonic fact substrate.
- **Reserved accessors constrain step names.** `status` and `whatsNext` are reserved; a boot guard enforces it.
- **Another engine surface to maintain,** and the Engine is now committed to the Quest concept fairly permanently.

## Considered alternatives

- **Stored status machine (AGS int / Bethesda stage).** Rejected: reintroduces the desync/regression class that
  motivated the work; adds an (N+1)th field that must agree with N others.
- **Materialized derived Store keys** (recompute status into reserved keys so plain `eq` works). Rejected: a cache that
  exists only to be read by conditions, and still "stored" in spirit; the virtual namespace gets the same `eq`
  ergonomics with nothing materialized.
- **A dedicated `quest` Condition op.** Rejected: hard-couples the Engine's most shared primitive (the Condition DSL) to
  one concept; the virtual path namespace needs no new op.
- **Game-only quests (no Engine battery).** Rejected: the evaluator is pure tree-traversal + Condition eval with zero
  game knowledge — the textbook definition of an Engine battery under ADR 0005 — and every title in this genre needs it.
  Keeping it game-side would trap reusable code and duplicate the Engine's existing evaluation path.
- **Flat step list with a closed `flag`/`collection` taxonomy.** Rejected: real data nests three levels
  (`backpack → fill → pencil_case → parts`) and target sets are sometimes runtime-rolled; a uniform recursive node with
  generated children covers all of it with one `whatsNext` traversal.
- **Distributed, entity-owned state** (each object tracks itself; no central quest). Rejected for the "what's next / is
  this flow done" question specifically: it needs an ordered view _across_ entities, which a uniform Quest tree provides
  and scattered self-state does not.
