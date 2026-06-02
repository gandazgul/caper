// deno-lint-ignore no-unused-vars
import { HotspotManager } from "./HotspotManager.js"; // eslint-disable-line no-unused-vars

const ENABLE_SPRITE_LABELS = false;
const ENABLE_SPRITE_BOUNDS = false;
const ENABLE_HOTSPOT_BOUNDS = true;

const DEBUG_DEPTH = 9000;

/**
 * Toggled with Shift+D. Draws the walkable polygon, Hotspot bounds, and each
 * Hotspot's approach point with a small "facing" arrow. The primary scene-
 * authoring tool: edit JSON, save, reload, see the result.
 *
 * Initial visibility comes from `opts.initialVisible` (the Game wires this to
 * its own debug flag). The Shift+D toggle works at runtime regardless.
 *
 * While a Sub-scene is open the overlay is **suppressed** — graphics cleared
 * and the Shift+D toggle is no-op — so the sub-scene's own debug (e.g.
 * `ToyBoxPuzzle`) owns the shortcut without conflicts. `SubsceneStack` calls
 * `suppress()` on push and `unsuppress()` on pop; on unsuppress, the prior
 * visibility is restored.
 *
 * @typedef {{ x: number, y: number }} Point
 */
export class DebugOverlay {
    /**
     * @param {import("phaser").Scene} scene
     * @param {object} opts
     * @param {Point[]} opts.walkable
     * @param {HotspotManager} opts.hotspotManager
     * @param {boolean} [opts.initialVisible] - start visible (Game's debug flag).
     */
    constructor(scene, opts) {
        this.scene = scene;
        this.walkable = opts.walkable ?? [];
        /** @type {HotspotManager} */
        this.hotspotManager = opts.hotspotManager;
        this.visible = opts.initialVisible ?? false;
        this.suppressed = false;
        this.graphics = scene.add.graphics().setDepth(DEBUG_DEPTH);
        /** @type {Phaser.GameObjects.Text[]} */
        this.labels = [];
        /** @type {((g: Phaser.GameObjects.Graphics) => void) | null} */
        this.extraDraw = null;
        if (this.visible) {
            setTimeout(() => this.draw(), 100);
        }

        const keyboard = scene.input.keyboard;
        if (keyboard) {
            keyboard.on("keydown-D", (/** @type {KeyboardEvent} */ e) => {
                if (!e.shiftKey) return;
                if (this.suppressed) return; // sub-scene owns Shift+D right now
                this.toggle();
            });
        }

        // Redraw every frame so sprite boxes track moving objects (the
        // walking character, dragged items, etc.). Held as a bound ref
        // so we can detach on scene shutdown — otherwise the OLD overlay's
        // draw() keeps firing on a NEW scene's display list, throwing on
        // destroyed sprites and blocking other scene.events listeners.
        this._onUpdate = () => {
            if (this.visible && !this.suppressed) this.draw();
        };
        scene.events.on("update", this._onUpdate);
        scene.events.once("shutdown", () => {
            scene.events.off("update", this._onUpdate);
        });
    }

    toggle() {
        this.visible = !this.visible;
        if (this.visible) this.draw();
        else this.clear();
    }

    clear() {
        this.graphics.clear();
        for (const l of this.labels) l.destroy();
        this.labels = [];
    }

    /** Called when a sub-scene opens — hide rendering until unsuppressed. */
    suppress() {
        this.suppressed = true;
        this.clear();
    }

    /** Called when a sub-scene closes — restore rendering if it was visible. */
    unsuppress() {
        this.suppressed = false;
        if (this.visible) this.draw();
    }

    draw() {
        const g = this.graphics;
        this.clear();
        if (this.suppressed) return;

        // When a sub-scene is open, scope the overlay to its contents — the
        // parent room's walkable polygon and hotspot bounds are noise from
        // the puzzle's perspective. Anything at depth ≥ SUBSCENE_BG_DEPTH (800)
        // counts as "inside the sub-scene"; the bg/back chrome opts out with
        // a `debugSkip` data flag.
        const inSubscene = /** @type {{ subscenes?: { isOpen: () => boolean } }} */ (
            /** @type {any} */ (this.scene)
        ).subscenes?.isOpen?.() === true;

        if (!inSubscene) {
            if (this.walkable.length > 1) {
                g.lineStyle(2, 0x00ff00, 0.9);
                g.beginPath();
                g.moveTo(this.walkable[0].x, this.walkable[0].y);
                for (let i = 1; i < this.walkable.length; i++) {
                    g.lineTo(this.walkable[i].x, this.walkable[i].y);
                }
                g.closePath();
                g.strokePath();
            }

            for (const h of this.hotspotManager.list()) {
                if (ENABLE_HOTSPOT_BOUNDS) {
                    g.lineStyle(2, 0x00ffff, 0.9);
                    g.strokeRect(h.bounds.x, h.bounds.y, h.bounds.w, h.bounds.h);
                }

                if (h.approachPoint) {
                    g.fillStyle(0xffff00, 1);
                    g.fillCircle(h.approachPoint.x, h.approachPoint.y, 6);
                    const tip = arrowTip(h.approachPoint);
                    g.lineStyle(3, 0xffff00, 1);
                    g.lineBetween(h.approachPoint.x, h.approachPoint.y, tip.x, tip.y);
                }
            }
        }

        // Walk the display list and box every Image / Sprite with its
        // texture-key + display dimensions. Containers are traversed; the
        // bg, the debug graphics itself, and our own labels are skipped.
        if (ENABLE_SPRITE_BOUNDS) {
            g.lineStyle(1, 0xff5fff, 0.8);
            this.drawSpriteBoxes(this.scene.children.list, inSubscene);
        }

        // Scene-specific contribution (drop targets, etc.). Runs last so the
        // scene's shapes draw on top of the generic sprite boxes.
        if (this.extraDraw && !inSubscene) {
            this.extraDraw(g);
        }
    }

    /**
     * Register a scene-specific debug-draw callback. Runs after the standard
     * walkable / hotspot / sprite-box pass; invoked every frame while the
     * overlay is visible (and never while a sub-scene is open).
     *
     * @param {((g: Phaser.GameObjects.Graphics) => void) | null} fn
     */
    setExtraDraw(fn) {
        this.extraDraw = fn;
        if (this.visible && !this.suppressed) this.draw();
    }

    /**
     * @param {Phaser.GameObjects.GameObject[]} list
     * @param {boolean} inSubscene
     */
    drawSpriteBoxes(list, inSubscene) {
        for (const obj of list) {
            if (obj === this.graphics) continue;
            const anyObj = /** @type {any} */ (obj);
            if (anyObj?.constructor?.name === "Container" && Array.isArray(anyObj.list)) {
                this.drawSpriteBoxes(anyObj.list, inSubscene);
                continue;
            }
            if (!isBoxable(obj)) continue;

            const sprite = /** @type {Phaser.GameObjects.Image} */ (obj);
            // Opt-out: chrome elements like the sub-scene bg and back arrow
            // set this flag — they're scaffolding, not art worth boxing.
            if (sprite.getData?.("debugSkip")) continue;
            // Scene scoping: when a sub-scene is open, ignore anything from
            // the parent layer (depth < 800).
            if (inSubscene && sprite.depth < 800) continue;

            // getBounds gives a world-space rect that already accounts for
            // origin, scale, rotation, and container transforms.
            const b = sprite.getBounds();
            this.graphics.strokeRect(b.x, b.y, b.width, b.height);

            if (ENABLE_SPRITE_LABELS) {
                const key = sprite.texture?.key ?? "?";
                const frame = sprite.frame?.name && sprite.frame.name !== "__BASE" ? `:${sprite.frame.name}` : "";
                const label = this.scene.add.text(
                    b.x,
                    b.y - 2,
                    `${key}${frame} ${Math.round(b.width)}×${Math.round(b.height)}`,
                    {
                        fontSize: "11px",
                        color: "#ffffff",
                        backgroundColor: "#000000aa",
                        padding: { x: 3, y: 1 },
                    },
                )
                    .setOrigin(0, 1)
                    .setDepth(DEBUG_DEPTH + 1);
                this.labels.push(label);
            }
        }
    }
}

/** @param {Phaser.GameObjects.GameObject} obj */
function isBoxable(obj) {
    // Image and Sprite both expose getBounds + texture. We skip TileSprite,
    // Graphics, Text, Zone, etc. — they aren't "art" we'd want a box around.
    const name = obj.constructor?.name;
    return name === "Image" || name === "Sprite";
}

/** @param {{ x: number, y: number, facing: string }} ap */
export function arrowTip(ap) {
    const len = 28;
    switch (ap.facing) {
        case "up":
            return { x: ap.x, y: ap.y - len };
        case "down":
            return { x: ap.x, y: ap.y + len };
        case "left":
            return { x: ap.x - len, y: ap.y };
        case "right":
            return { x: ap.x + len, y: ap.y };
        default:
            return { x: ap.x, y: ap.y };
    }
}
