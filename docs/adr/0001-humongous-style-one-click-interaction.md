# 0001 — Humongous-style one-click + drag-from-inventory interaction model

Status: **accepted** Date: 2026-05-17

## Decision

The player interacts with the world through **a single click**. Every world Hotspot declares its own behavior —
`pickup`, `look`, `exit`, `subscene`, or `use-with` — and the Active Character performs the appropriate action on click
without any verb selection from the player. Inventory items are dragged onto world Hotspots to trigger `use-with`
interactions. Cursor shape changes on hover to telegraph the interaction.

## Context

The target audience is young or casual players who should be able to interact without reading a verb menu. The primary
inspiration is the style of late-90s Humongous Entertainment adventure games, alongside other point-and-click and modern
touch-first puzzle adventures.

The point-and-click adventure genre offers a spectrum of input models:

- **SCUMM 9-verb bar** (Maniac Mansion, Monkey Island 1–2): player picks a verb ("Use", "Open", "Look at", "Talk to" …)
  from a menu, then clicks the object.
- **Verb coin** (Monkey Island 3, Curse of Monkey Island): right-click reveals a 3-icon ring (eye/hand/mouth =
  look/use/talk); player picks one, then clicks the object.
- **One-click, Humongous-style**: no verb selection. The player clicks the object; the game does the right thing.
  Inventory items are dragged from the inventory strip onto the target.

The 9-verb model is too cognitively expensive for pre-readers. The verb coin still requires the player to choose, and
the icons aren't legible to kids who don't yet recognize "use" vs "look at." The one-click model assumes intelligent
Hotspot behavior on the engine side, but offloads zero choice onto the player.

## Consequences

- **Hotspot authoring is more opinionated.** Every Hotspot must declare exactly what happens on click — no generic
  verbs. This pushes design effort upstream into the per-Hotspot JSON config.
- **Dialog trees are optional, not foundational.** Talking is not a primary verb; a game can present character speech
  through thought bubbles, cutscenes, or a custom subscene/dialog panel rather than a global `talk` verb.
- **`use-with` is the only multi-step interaction.** Drag an Inventory item onto a Hotspot. This is the only place the
  player composes intent across two objects.
- **Cursor system must support per-Hotspot cursor shapes.** Hovering different Hotspots changes the cursor (open hand
  for pickup, eye for look, door for exit, magnifier-plus for subscene). This is the _only_ place verbs become visible
  to the player.
- **Hard to reverse.** Swapping to a verb-based model later would require re-authoring every Hotspot config, replacing
  the cursor system, and adding a verb-selection UI. This is the foundational interaction commitment of the engine.
- **Constrains future puzzle design.** Puzzles can't depend on "the player picks the right verb"; they depend on "the
  player picks the right object" or "the player combines the right two objects." This matches the Humongous-inspired
  interaction style: object recognition and inventory combination, not verb parsing.

## Considered alternatives

- **SCUMM 9-verb bar.** Rejected: too much reading and choice for the target age.
- **Verb coin (MI3).** Rejected: still requires verb selection; icons not pre-reader-legible.
- **Free WASD movement + proximity actions.** Rejected: turns the game into a platformer; loses the genre-defining
  "click a thing, watch the character do it" magic; bad fit for touch/click devices.
- **Two-click "select-then-target" for inventory.** Considered for inventory combinations as an alternative to
  drag-and-drop. Rejected: drag is more intuitive for young players on touch devices and keeps the interaction direct.
