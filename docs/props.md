# Declarative Props (ADR 0002)

The PropEngine is the heart of the interaction model. A prop is art + an ordered list of **states**. Each state carries
its own appearance, click behavior, and gates. Most prop use cases need zero imperative scene code.

## A prop entity

```js
{
    id: "apple_box",
    atlas: "sprite_fall",         // default atlas for all states
    x: 300, y: 400, depth: 5,    // default position
    approach: { x: 280, y: 450, facing: "right" },
    states: [
        {
            when: { hasApple: { ne: true } },  // gate: show only if not picked up
            frame: "apple_box",
            activeWhen: { boxSlid: { eq: true } },  // gate: clickable only after sliding
            cursor: "pickup",
            onClick: [
                { pickup: { id: "apple" } },
                { set: { hasApple: true } },
            ],
        },
    ],
}
```

## States and selection

The engine evaluates states top-to-bottom. The **first** state whose `when` condition passes is rendered. If no state
matches, the prop is hidden.

```js
states: [
    {
        when: { world: { state: { eq: "empty" } } },
        frame: "case_empty",
        onDrop: { accepts: { dropped: { eq: "gem" } }, effects: [{ setItemState: { display_case: "filled" } }] },
    },
    { when: { world: { state: { eq: "filled" } } }, frame: "case_filled" },
];
```

`world` and `inventory` are engine-owned collections available to every game. Seed initial item states in
`store.configure({ createFreshState })` when a prop needs an explicit starting state.

## Conditions DSL

Conditions are pure, serializable data — no functions. Every leaf is `key: { op: value }`.

### Operators

| Op           | Meaning                 |
| ------------ | ----------------------- |
| `eq`         | Equal                   |
| `ne`         | Not equal               |
| `gt` / `gte` | Greater than / or equal |
| `lt` / `lte` | Less than / or equal    |
| `has`        | Collection membership   |

### Combinators

```js
// AND — multiple keys in an object
{ hasKey: { eq: true }, doorOpen: { eq: false } }

// OR — an array value
{ weatherMode: { anyOf: ["light-rain", "heavy-rain"] } }

// allOf / anyOf / not
{ allOf: [{ hasKey: true }, { hasMap: true }] }
{ anyOf: [{ isMorning: true }, { isEvening: true }] }
{ not: { doorLocked: true } }
```

### Subject resolution

- A bare property (`world: { state: { eq: "filled" } }`) targets the **prop's own id**.
- A dotted path (`world: { "display_case.state": { eq: "filled" } }`) targets another item.
- `dropped` resolves against the dragged inventory item: `dropped: { eq: "apple" }`.

## Effects (verbs)

Each effect is an object with exactly one verb key. Effects run in order after the player reaches the approach point.

### State mutations

| Verb           | Example                                        | Effect                     |
| -------------- | ---------------------------------------------- | -------------------------- |
| `set`          | `{ set: { doorOpen: true } }`                  | Sets a Store value         |
| `addTo`        | `{ addTo: { inventory: "apple" } }`            | Adds to a collection       |
| `removeFrom`   | `{ removeFrom: { world: "apple" } }`           | Removes from a collection  |
| `setItemState` | `{ setItemState: { display_case: "filled" } }` | Sets per-item visual state |

### Visual effects

| Verb          | Example                                | Effect                                                                            |
| ------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| `pickup`      | `{ pickup: { id: "apple" } }`          | Picks up the prop: reach animation, remove from scene, fly to inventory, add item |
| `playReach`   | `{ playReach: true }`                  | Plays the character's reach animation                                             |
| `tween`       | `{ tween: { x: 600, duration: 500 } }` | Tweens the prop sprite                                                            |
| `destroy`     | `{ destroy: true }`                    | Destroys the prop sprite                                                          |
| `showThought` | `{ showThought: { text: "Nice!" } }`   | Shows a thought bubble on the character                                           |

### Scene transitions

| Verb                    | Example                                                                                  | Effect                                       |
| ----------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| `goToScene`             | `{ goToScene: "Forest" }`                                                                | Transitions to another scene                 |
| `goToScene` (with data) | `{ goToScene: { target: "Forest", transition: "cinematic", data: { fromDoor: true } } }` | Scene transition with custom preset and data |
| `pushSubscene`          | `{ pushSubscene: { ... } }`                                                              | Opens a zoom-in subscene                     |

### Bridge to imperative code

| Verb   | Example                   | Effect                                                |
| ------ | ------------------------- | ----------------------------------------------------- |
| `emit` | `{ emit: "startPuzzle" }` | Emits an event on the scene bus; game code subscribes |

## Drop targets (inventory → prop)

A prop can accept inventory items dropped onto it:

```js
{
    id: "table",
    states: [{
        frame: "table_empty",
        onDrop: {
            accepts: { dropped: { eq: "apple" } },  // condition on the dragged item
            effects: [
                { removeFrom: { inventory: "apple" } },
                { setItemState: { display_case: "filled" } },
            ],
        },
    }],
}
```

## Approach modes

- **`"walk"`** (default) — character walks to the approach point, then effects run.
- **`"in-place"`** — interaction fires immediately at the character's current position (for UI-like props: switches,
  books, control panels).

```js
approach: "in-place";
```

## Reactive rendering

Props re-evaluate on every Store change. The engine re-selects the active state, re-applies the frame/transform, and
re-checks clickability — all automatically. No manual destroy/recreate.

## Accessibility

The PropEngine has a special mode for screen-reader accessibility. When `accessibilityMode` is enabled, each prop
registers interactive elements with ARIA roles, live regions for state changes, and managed tab order. Set via:

```js
// In game configuration
{
    set: {
        accessibilityMode: true;
    }
}
```

In this mode, props expose `aria-label`, `role="button"`, `tabindex="0"`, and screen-reader announcements on state
changes. Focus management follows the standard one-click interaction model.
