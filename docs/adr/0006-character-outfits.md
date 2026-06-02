# 0006 — Character outfits (engine)

Status: **proposed** Date: 2026-06-02

## Decision

An **outfit** is an alternate render config (full sprite set — stills + walk animations) for a registered character,
selected by an engine-controlled, per-character state key. It is an extension of the **CharacterRegistry** (ADR 0005),
not a new subsystem:

1. **Registry** — a character config gains an optional `outfits: Record<string, OutfitConfig>`, where each
   `OutfitConfig` is a partial render override (`spriteKey`, `animationSet`, `animationScales`, `animationOrigins`, and
   the asset keys it needs). The base config is the implicit `default` look.
2. **Selection** — a **per-character flat Store key `${id}Outfit`** (e.g. `heroOutfit: "pajamas"`). Engine helpers
   `setOutfit(id, name)` / `getOutfit(id)`. Default = key absent → base look. Flat keys are chosen over a nested
   `outfits` map specifically so the existing condition DSL (props + cast reactions) can gate on them directly —
   `when: { heroOutfit: { eq: "pajamas" } }` — and so they persist in the save automatically.
3. **Resolution** — a generic `resolveCharacterRender(id)` returns `{ ...base, ...outfits[active] }` (outfit fields,
   including the whole `animationSet`, replace base — a full sprite-set swap, not an overlay).
4. **Reactive rebuild** — the engine base scene subscribes to the Store; when a present character's `${id}Outfit`
   changes, it rebuilds that sprite via the same generic spawn/rebuild path used for the active-character switch. The
   resolver feeds the **active walker, the idle character, and registered-character NPCs** alike (one key drives every
   spawn of that character). Ad-hoc NPCs with explicit configs are unaffected.

This depends on the ADR-0005 character port (active/idle → `CharacterRegistry` + `activeCharacter`) landing first,
because outfits reuse that generic spawn/rebuild machinery.

## Context

The game already has de-facto outfits, hand-rolled per helper:

- **Character: home/outdoor variants** — _contextual_, picked from the scene `indoors` flag.
- **Character: regular/alternate state** — _stateful_ (set on a game event and persist).

Both collapse onto one mechanism. The only difference is **who sets the key**: stateful outfits are set on a game event
and persist; contextual outfits are set by the scene on entry from its own context (persistence is harmless because
every scene with that character re-sets it). The win is that one `${id}Outfit` key makes every spawn of a character —
cast NPC, companion, one-off — render the same look, replacing the scattered per-helper sprite-picking.

## Considered options

- **Per-character flat key `${id}Outfit` (chosen)** vs. a single nested `outfits` map. The map is tidier to enumerate
  but the condition DSL reads flat `values` keys, so a map would block props/NPC reactions from gating on outfit without
  a DSL path extension. Flat keys integrate with the existing reactive systems and the save for free.
- **Full sprite-set swap (chosen)** vs. overlay sprites. Outfits are genuinely different stills + walk sets, so they
  replace the render config. Costume overlays stay a separate game system (single-pose overlays, no walk
  sets) and are explicitly **not** outfits.
- **Outfits on the registry (chosen)** vs. a standalone outfit system. They are character render data; the registry is
  their home, and resolution layers on the spawn path the engine already owns.

## Consequences

- New engine surface: `CharacterRegistry` `outfits` field + `OutfitConfig` type, `setOutfit`/`getOutfit`,
  `resolveCharacterRender(id)`, and the rebuild-on-change subscription in the engine base scene.
- Outfit asset keys are declared on the character/outfit config so the engine preload includes them; the Game lists
  them.
- Migrating existing contextual outfits and adding new outfits become Game-side registrations + `setOutfit`
  calls; no engine change once the mechanism ships.
- Builds on [ADR 0005](./0005-engine-game-boundary.md) (CharacterRegistry, active-character spawn path).
