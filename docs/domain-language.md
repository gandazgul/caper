# Caper Domain Language

Caper provides reusable systems for browser point-and-click adventures. Each game supplies its characters, rooms,
items, artwork, and story rules.

## Language

### Places and movement

**Scene**: A game location with a background, walkable area, props, and optional cast. A scene can represent a room.

**Subscene**: A close-up view inside a parent scene, with its own background, Back control, and optional content.
Subscenes can nest. Closing one returns to the view below it. _Avoid_: Separate room, scene transition.

**Transition**: A change from one scene to another, with a visual fade.

**Walkable area**: The region where characters can walk. It can contain one polygon or several separate polygons.

**Approach point**: The position and facing direction a character uses before an interaction. An in-place interaction
runs without a walk to an approach point.

**Chapter**: A game-defined story phase that can select backgrounds, cast behavior, weather, and ambient effects.

### Interaction and items

**Hotspot**: A clickable region for an interaction. A hotspot can have bounds, a cursor, and an approach point.
_Avoid_: Prop, when referring only to the clickable region.

**Prop**: A scene object with an identity and ordered states. A prop can provide artwork, a click interaction, or an
inventory drop target. It need not have visible artwork. _Avoid_: Hotspot, when referring to the whole object.

**Prop state**: One possible appearance and behavior of a prop. The first state whose condition passes is selected.
If no state matches, the prop is hidden. A separate active condition can prevent interaction with a visible prop.

**Condition**: A declarative test of game state. Conditions control prop states, cast rules, wearables, and quest
completion. They can combine tests with AND, OR, and NOT.

**Effect**: One action in a prop interaction, such as changing a value, picking up an item, or changing scenes.
Effects run in their declared order.

**Inventory**: The items carried by the player. Items can have stack counts and can be dragged to a drop target.

**Inventory item**: An identified carried object with a registered visual representation. An inventory item is not
the same thing as the prop from which it was picked up.

**Drop target**: A prop interaction that tests whether a dragged inventory item is accepted, then applies effects.

**Item state**: A named visual state for an identified item, such as locked or filled. It is distinct from a prop
state, which describes a prop's appearance and behavior together.

**World collection**: The set of item identities a game tracks as present in its world. It is not the full list of
props in a scene.

### Characters and cast

**Active character**: The playable character currently controlled by the player.

**Idle character**: A playable character that is not currently active and can move independently.
_Avoid_: NPC, when the distinction between playable and non-player characters matters.

**NPC**: A non-player character that can have movement, speech, and a clickable region.

**Cast**: Game-defined NPCs with chapter-specific ambient behavior and reactions.

**Ambient behavior**: An NPC's activity outside a scripted sequence, such as wandering, patrolling, or following.
It is distinct from an ambient environment effect.

**Reaction**: A cast response to an interaction or event, optionally gated by a condition. It can show speech or run
a scripted sequence.

**Outfit**: A character's selected visual variant.

**Wearable**: A visual attachment to a character, such as a backpack or held item. Its visibility can depend on a
condition. _Avoid_: Outfit, when referring to an attachment.

### Sequences and speech

**Cutscene**: A cancellable scripted sequence of character actions and speech. A new cutscene replaces a running
cutscene. Selected cast members pause their ambient behavior during the sequence.

**Cutscene actor**: A character taking part in a cutscene, with actions such as walking, speaking, and facing the
player.

**Dialogue bubble**: A character's on-screen speech or thought, with optional text and icons.

**Speech advance**: The rule for ending a speech line: player input, automatic timing, or either. A voiced line can
use audio completion for automatic advance.

### Quests and hints

**Quest**: A tree of completion requirements. Its status and progress are derived from current game state, not
recorded as separate completion flags. _Avoid_: Quest log, when referring to the requirements themselves.

**Step**: A quest node nested within another quest node. A step can contain further steps or be a leaf with a
completion condition. Collection requirements can generate steps from a target item list.

**Quest status**: One of not_started, seen, started, or done. Completion takes priority; otherwise start and seen
conditions determine the status. Without an explicit start condition, a completed leaf marks the quest as started.

**Next step**: The first incomplete leaf in a quest's declared depth-first order. A completed quest has no next step.

**Quest progress**: The number of completed leaf steps and the total number of leaf steps.

**Quest hint**: An icon above an actor for the next incomplete quest step. It yields to speech and open subscenes.

### Progress and environment

**Save**: Browser-local recorded progress used to resume a game. Invalid, unreadable, or incompatible saved progress
is preserved until the player explicitly resets it.

**Save status**: The current result of loading or saving progress: ready, saved, unavailable, invalid, or incompatible.

**Replay sandbox**: Temporary play that starts from a snapshot and restores progress on exit. Replay changes do not
write to the save; a game can select values to preserve when the replay ends.

**Weather**: Precipitation allowed for a scene and chapter, such as rain or snow.

**Ambient effect**: An environmental visual effect, such as falling leaves, separate from precipitation and NPC
ambient behavior.

**Time of day**: The day or night setting used by lighting and cast rules.
