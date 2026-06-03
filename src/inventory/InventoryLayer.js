import { store } from "../state/Store.js";
import { content } from "./ContentRegistry.js";
import { UI_DEPTH } from "../ui/UIHelper.js";

/** Default inventory strip layout — a Game overrides any field via the `layout` option. */
const DEFAULT_INVENTORY_LAYOUT = { stripHeight: 90, slotPadding: 10, padding: 60 };

/**
 * Resolve an inventory id to its atlas + frame via the engine ContentRegistry.
 * The Game registers which atlas/frame/scale each id maps to at boot (see the
 * game's content registration); the engine knows none of that. Returns null
 * for unknown ids so refresh() can skip them.
 *
 * @param {string} id
 * @returns {{ atlas: string, frame: string, scale: number } | null}
 */
function lookupInventoryItem(id) {
    return content.getItem(id);
}

/** Depth layers — keep inventory above sub-scenes so it's always reachable. */
const INVENTORY_BG_DEPTH = UI_DEPTH;
const INVENTORY_SPRITE_DEPTH = UI_DEPTH + 1;

/** Offset of the "second" sprite drawn behind a stacked (count > 1) slot. */
const STACK_OFFSET = { x: 9, y: -9 };

/**
 * Extra horizontal gap after a stacked slot. The offset shadow + count badge
 * overhang the main sprite's right edge, so the next item needs more room than
 * the usual slotPadding to avoid colliding with the badge.
 */
const STACK_SLOT_EXTRA = 24;

/**
 * Bottom-of-screen Inventory strip. Re-renders on every change.
 *
 * Visibility is the AND of two flags:
 *   - `allowed` — set by callers via `setVisible()`. Puzzles flip this off
 *     when they need the bottom of the canvas (e.g. ClosetPuzzle); scenes
 *     with `inventoryHidden: true` start with it off.
 *   - `slotSprites.length > 0` — empty inventory auto-hides the strip so the
 *     bg art isn't covered before the player has picked up anything. The
 *     plank reappears the moment a pickup commits (after `flyItemTo`'s arc
 *     lands and `addItem` / `refresh()` runs).
 *
 * Inventory item sprites are placed in scene-space (not a container) so that
 * puzzles can make them draggable directly without coordinate-system juggling.
 * Each sprite carries `toyId`, `baseX`, `baseY` data so callers can tween a
 * dropped item back to its slot.
 */
export class InventoryLayer {
    /**
     * @param {import("phaser").Scene} scene
     * @param {object} opts
     * @param {string} opts.atlasKey
     * @param {{ stripHeight?: number, slotPadding?: number, padding?: number }} [opts.layout] - strip layout overrides.
     */
    constructor(scene, opts) {
        this.scene = scene;
        this.atlasKey = opts.atlasKey;
        this.layout = { ...DEFAULT_INVENTORY_LAYOUT, ...(opts.layout ?? {}) };
        const h = scene.scale.height;
        this.stripY = h - this.layout.stripHeight - 15;
        this.bg = scene.add
            .image(0, this.stripY, "bg-inventory")
            .setOrigin(0, 0)
            .setData("debugSkip", true)
            .setDepth(INVENTORY_BG_DEPTH)
            .setInteractive();
        /** @type {import("phaser").GameObjects.Image[]} */
        this.slotSprites = [];
        // Purely decorative stack shadows + count badges, rebuilt every
        // refresh(). Kept out of slotSprites so drag/release logic ignores them.
        /** @type {(import("phaser").GameObjects.Image | import("phaser").GameObjects.Text)[]} */
        this.decorSprites = [];
        this.allowed = true;
        (/** @type {any} */ (this.scene)).inventory = this;

        // Auto-hide when a subscene opens
        this._onSubsceneToggle = () => this.applyVisibility();
        const bus = /** @type {any} */ (this.scene).bus;
        if (bus) {
            bus.on("subscene:open", this._onSubsceneToggle);
            bus.on("subscene:close", this._onSubsceneToggle);
            this.scene.events.once("shutdown", () => {
                if (bus) {
                    bus.off("subscene:open", this._onSubsceneToggle);
                    bus.off("subscene:close", this._onSubsceneToggle);
                }
            });
        }

        this.refresh();
    }

    /** @param {string} toyId */
    addItem(toyId) {
        store.addToInventory(toyId);
        this.refresh();
    }

    /**
     * Animate a pickup: spawn a ghost sprite at (fromX, fromY) and arc it down
     * into where its new inventory slot will land. When the arc finishes,
     * `onArrive` runs — defaults to `addItem(itemId)`, which mutates state and
     * refreshes the strip so the freshly-rendered slot sprite sits exactly
     * where the ghost touched down.
     *
     * If the inventory strip is currently hidden (e.g. during a sub-scene),
     * the animation is skipped and `onArrive` runs immediately so callers
     * never get stuck waiting on a tween that wouldn't be visible.
     *
     * @param {string} itemId
     * @param {number} fromX
     * @param {number} fromY
     * @param {() => void} [onArrive]
     */
    flyItemTo(itemId, fromX, fromY, onArrive) {
        const finalize = () => {
            if (onArrive) onArrive();
            else this.addItem(itemId);
        };
        const meta = lookupInventoryItem(itemId);
        if (!meta || !this.allowed) {
            finalize();
            return;
        }
        // A duplicate (stackable fish) lands on its existing slot; a brand-new
        // item flies to the slot it's about to create at the end of the strip.
        const existing = this.findSprite(itemId);
        const target = existing ? { x: existing.x, y: existing.y } : this.predictNextSlotPosition(meta);
        const flying = this.scene.add.image(fromX, fromY, meta.atlas, meta.frame)
            .setScale(meta.scale)
            .setDepth(INVENTORY_SPRITE_DEPTH + 100);

        // Peak height of the arc — taller jumps when the source is close to
        // the target so even short pickups feel bouncy.
        const peakLift = Math.max(70, Math.abs(fromY - target.y) * 0.4 + 40);
        const startX = fromX;
        const startY = fromY;
        const endX = target.x;
        const endY = target.y;

        this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 650,
            ease: "Sine.easeInOut",
            onUpdate: (tween) => {
                const t = tween.getValue();
                flying.x = startX + (endX - startX) * t;
                const linearY = startY + (endY - startY) * t;
                // 4·peak·t·(1-t) is a unit parabola peaking at t=0.5 with value 1.
                flying.y = linearY - 4 * peakLift * t * (1 - t);
                flying.rotation = (t - 0.5) * 0.8;
            },
            onComplete: () => {
                flying.destroy();
                finalize();
            },
        });
    }

    /**
     * Where the next inventory slot will land after this item is added.
     * Mirrors the math in slotPositionFor without mutating state.
     *
     * @param {{ atlas: string, frame: string, scale: number }} meta
     */
    predictNextSlotPosition(meta) {
        let usedWidth = 0;
        for (const s of this.slotSprites) {
            const extra = s.getData("isStack") ? STACK_SLOT_EXTRA : 0;
            usedWidth += s.displayWidth + this.layout.slotPadding + extra;
        }
        const sourceFrame = this.scene.textures.get(meta.atlas)?.get?.(meta.frame);
        const incomingWidth = (sourceFrame?.width ?? 64) * meta.scale;
        const x = this.layout.padding + this.layout.slotPadding + usedWidth + incomingWidth / 2;
        const y = this.stripY + this.layout.stripHeight / 2;
        return { x, y };
    }

    /**
     * Allow or block the inventory strip from showing. When `false`, the strip
     * stays hidden regardless of how many items are in inventory. When `true`,
     * the strip auto-hides only if empty.
     * @param {boolean} visible
     */
    setVisible(visible) {
        this.allowed = visible;
        this.applyVisibility();
    }

    /** Recompute and apply effective visibility = allowed AND non-empty AND no subscene open. */
    applyVisibility() {
        const inSubscene = /** @type {any} */ (this.scene).subscenes?.isOpen?.() === true;
        const shown = this.allowed && this.slotSprites.length > 0 && !inSubscene;
        this.bg.setVisible(shown);
        for (const s of this.slotSprites) s.setVisible(shown);
        for (const d of this.decorSprites) d.setVisible(shown);
    }

    /** @param {string} toyId @returns {boolean} */
    hasItem(toyId) {
        return store.has("inventory", toyId);
    }

    /**
     * Detach a sprite from inventory tracking without destroying it. The caller
     * takes ownership of the sprite (e.g. ToyBoxPuzzle when a toy is placed in
     * the box). Subsequent `refresh()` won't touch this sprite.
     *
     * @param {string} toyId
     * @returns {import("phaser").GameObjects.Image | null}
     */
    releaseSprite(toyId) {
        const idx = this.slotSprites.findIndex((s) => s.getData("toyId") === toyId);
        if (idx < 0) return null;
        const sprite = this.slotSprites[idx];
        this.slotSprites.splice(idx, 1);
        return sprite;
    }

    /** @param {string} toyId @returns {import("phaser").GameObjects.Image | null} */
    findSprite(toyId) {
        return this.slotSprites.find((s) => s.getData("toyId") === toyId) ?? null;
    }

    /** @param {number} index @returns {{x: number, y: number}} */
    slotPositionFor(index) {
        // const slotPadding = index === 0 ? 0 : this.layout.slotPadding;
        const currentWidth = this.slotSprites.slice(0, index).reduce((prev, curr) => {
            const extra = curr.getData("isStack") ? STACK_SLOT_EXTRA : 0;
            return prev += curr.displayWidth + this.layout.slotPadding + extra;
        }, 0);
        const x = this.layout.padding + this.layout.slotPadding + currentWidth +
            this.slotSprites[index].displayWidth / 2;
        const y = this.stripY + this.layout.stripHeight / 2;
        return { x, y };
    }

    /**
     * Decorate a stacked slot: draw a single offset "shadow" copy behind the
     * main sprite (so the slot reads as a pile of 2) and a small count badge in
     * the top-right corner. The decoration tracks the main sprite's position
     * and is registered in decorSprites for cleanup/visibility, never in
     * slotSprites (so it's invisible to drag/release logic).
     *
     * @param {import("phaser").GameObjects.Image} sprite - the main slot sprite
     * @param {{ atlas: string, frame: string, scale: number }} meta
     * @param {number} count
     */
    renderStack(sprite, meta, count) {
        const shadow = this.scene.add.image(
            sprite.x + STACK_OFFSET.x,
            sprite.y + STACK_OFFSET.y,
            meta.atlas,
            meta.frame,
        )
            .setScale(meta.scale)
            .setDepth(INVENTORY_SPRITE_DEPTH - 0.5);
        this.decorSprites.push(shadow);

        const badge = this.scene.add.text(
            sprite.x + sprite.displayWidth / 2 + STACK_OFFSET.x,
            sprite.y - sprite.displayHeight / 2 + STACK_OFFSET.y,
            `${count}`,
            {
                fontSize: "18px",
                fontFamily: "Arial",
                fontStyle: "bold",
                color: "#ffffff",
                backgroundColor: "#d24c2a",
                padding: { x: 4, y: 1 },
            },
        ).setOrigin(0.5).setDepth(INVENTORY_SPRITE_DEPTH + 1);
        this.decorSprites.push(badge);
    }

    /**
     * Render the combined items (pencil, eraser, sharpener) peeking out from
     * behind the pencil case to show combining progress.
     * @param {import("phaser").GameObjects.Image} sprite
     */
    renderPencilCaseStack(sprite) {
        const addedItems = store.list("pencilCaseItems");
        if (addedItems.length === 0) return;

        // Define distinct offsets and rotations for each of the four possible items
        const config = {
            pencil: { dx: -14, dy: 0, angle: -35 },
            eraser: { dx: 25, dy: 0, angle: 130 },
            sharpener: { dx: -6, dy: 0, angle: -10 },
            ruler: { dx: 3, dy: 0, angle: 10 },
        };
        /** @type {Record<string, { dx: number, dy: number, angle: number }>} */
        const configTyped = config;

        for (const itemId of addedItems) {
            const cfg = configTyped[itemId];
            if (!cfg) continue;
            const meta = lookupInventoryItem(itemId);
            if (!meta) continue;

            const itemSprite = this.scene.add.image(
                sprite.x + cfg.dx,
                sprite.y + cfg.dy,
                meta.atlas,
                meta.frame,
            )
                .setScale(meta.scale) // slightly smaller so they fit nicely
                .setAngle(cfg.angle)
                .setDepth(INVENTORY_SPRITE_DEPTH + 0.5);
            this.decorSprites.push(itemSprite);
        }
    }

    refresh() {
        for (const s of this.slotSprites) s.destroy();
        for (const d of this.decorSprites) d.destroy();
        this.slotSprites = [];
        this.decorSprites = [];
        const items = store.list("inventory");
        for (const toyId of items) {
            const meta = lookupInventoryItem(toyId);
            // Skip unknown ids — e.g. a saved inventory entry that no longer
            // maps to any registry (renamed items, removed items). The slot
            // index uses slotSprites.length so the skip can't desync.
            if (!meta) continue;

            // Stackable items (lake fish) carrying 2+ render as a little pile.
            // Flag it before laying out later slots so they reserve the extra
            // gap the offset shadow + count badge need. Also flag pencil case if it has items.
            const count = store.getInventoryCount(toyId);
            const isStack = count > 1 || (toyId === "pencil_case" && store.list("pencilCaseItems").length > 0);

            const sprite = this.scene.add.image(0, 0, meta.atlas, meta.frame)
                .setScale(meta.scale)
                .setDepth(INVENTORY_SPRITE_DEPTH);
            this.slotSprites.push(sprite);
            sprite.setData("isStack", isStack);
            const slotIdx = this.slotSprites.length - 1;
            const { x, y } = this.slotPositionFor(slotIdx);
            sprite.setPosition(x, y);
            sprite.setData("toyId", toyId);
            sprite.setData("baseX", x);
            sprite.setData("baseY", y);

            // A pile = a second sprite offset behind + a count badge in the corner.
            // Pencil case = custom decoration with actual items peeking out.
            if (toyId === "pencil_case") {
                this.renderPencilCaseStack(sprite);
            } else if (isStack) {
                this.renderStack(sprite, meta, count);
            }
        }
        // Re-apply effective visibility — refresh rebuilds sprites from
        // scratch and the slot count just changed, both of which feed the
        // visibility calculation.
        this.applyVisibility();

        if (this.scene && typeof (/** @type {any} */ (this.scene)).enableInventoryDrag === "function") {
            (/** @type {any} */ (this.scene)).enableInventoryDrag();
        }
    }
}
