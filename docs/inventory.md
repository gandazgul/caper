# Inventory

The inventory system is a bottom-of-screen strip displaying items the player has collected. Items are dragged from the
strip onto scene props for `use-with` interactions.

## ContentRegistry

The engine resolves an item id — `"apple"`, `"key"`, `"fishing_rod"` — to a renderable sprite spec through the
`ContentRegistry`. The game populates this at boot:

```js
import { content } from "@caper/engine";

content.registerItems({
    apple: { atlas: "props-atlas", frame: "apple", scale: 0.8 },
    key: { atlas: "props-atlas", frame: "key", scale: 0.8 },
    rod: { atlas: "props-atlas", frame: "fishing_rod", scale: 0.6 },
});

// For computed specs (e.g. procedural items), register a resolver:
content.registerItemResolver((id) => {
    if (id.startsWith("gem_")) {
        return { atlas: "gems-atlas", frame: id, scale: 1 };
    }
    return null; // not resolved here
});
```

## InventoryLayer

Created automatically by the base scene. It subscribes to the Store `inventory` collection and re-renders on every
change.

```js
// Created in AdventureScene.create():
this.inventory = new InventoryLayer(this, {
    atlasKey: "inventory-atlas", // default atlas for items without explicit atlas
    layout: { // override defaults
        stripHeight: 90,
        slotPadding: 10,
        padding: 60,
    },
});
```

### Visibility

```js
this.inventory.setVisible(true); // show (default)
this.inventory.setVisible(false); // hide (for puzzles that need the bottom of the screen)
```

## Inventory operations

```js
import { store } from "@caper/engine";

// Standard:
store.addTo("inventory", "apple"); // add one
store.removeFrom("inventory", "apple"); // remove all
store.has("inventory", "apple"); // check
store.list("inventory"); // get all item ids

// Stackable:
store.addToInventory("apple", 3); // add with count
store.decrementInventory("apple"); // consume one; removes when last
store.getInventoryCount("apple"); // → 3
```

## Pickup animation

When a prop uses the `pickup` effect, the engine plays the standard pickup sequence: reach, remove the prop from the
scene, arc the item into the inventory strip, and commit the inventory item when the arc lands.

```js
onClick: [{ pickup: { id: "apple" } }];
```

## Drag interaction

1. Player clicks and holds an inventory item
2. The cursor changes to the item sprite
3. Player drags the item over scene props
4. If the prop has an `onDrop` handler matching the item, the cursor indicates a valid drop target
5. On drop, the prop's effects run (see [props.md](props.md))
6. If dropped on empty space, the item snaps back to the strip

## Stacked items

Items with `count > 1` get a small shadow sprite drawn behind them and a count badge. The next slot after a stacked item
has extra horizontal gap to avoid badge collisions.
