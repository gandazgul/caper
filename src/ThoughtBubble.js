import Phaser from "phaser";
import { engineAssets } from "./EngineAssets.js";

/**
 * A cloud-bubble Container with optional icons + text, auto-destroying after
 * `autoDestroyMs`.
 *
 * Positioning model — the container's (x, y) IS the cloud body's visible
 * center in world coords. Everything added to the container is laid out
 * around local (0, 0), which is the same point. So:
 *
 *   - The bubble image is internally offset so its cloud body (not the
 *     puff-tail-skewed image center) lands on (0, 0).
 *   - An icon at local (0, 0) appears dead-center of the cloud.
 *   - Two icons split evenly to the left and right of (0, 0).
 *   - Text sits just below the icons (or at (0, 0) if no icons).
 *
 * Icons are passed as `{ type, id }` pairs. New `type` values can be
 * registered at runtime via `ThoughtBubble.registerIconType()`, so other
 * scenes plug in their own atlases without editing this file.
 */

const BUBBLE_SCALE = 1;
const BUBBLE_DEPTH = 799;

/**
 * Offset from the bubble image's GEOMETRIC center to its CLOUD BODY's
 * VISIBLE center, in image-local pixels (before BUBBLE_SCALE). The puff tail
 * trails out the bottom-left of `thought-bubble`, so the visible cloud body
 * is shifted up and slightly right of the geometric center. Tune these by
 * passing `debug: true` and eyeballing the magenta cross.
 */
const CLOUD_BODY_DX = 15;
const CLOUD_BODY_DY = -22;

/**
 * How high above (`character.y` − this many pixels) the bubble center sits
 * when callers pass a `character` instead of explicit x/y. Sized for the
 * active-character sprite plus a small gap.
 */
const DEFAULT_Y_OFFSET = 390;
const DEFAULT_X_OFFSET = 140;

const ICON_SPACING = 70;
const ICON_DEFAULT_SCALE = 0.4;

/**
 * Resolver: build the icon Image for a given id, or return null if unknown.
 * Each resolver owns its own atlas/texture wiring so types like `toy`
 * (atlas + frame) and a single-texture icon (no frame) coexist cleanly.
 * @typedef {(scene: import("phaser").Scene, id: string, scale: number) => Phaser.GameObjects.Image | null} IconResolver
 */

/**
 * Icon-type registry. Empty by default — the Engine ships no game-specific
 * icon types. The Game registers its own (`toy`, `clothing`, `character`, …)
 * via {@link ThoughtBubble.registerIconType} at boot; scenes register their
 * own scene-local types the same way.
 * @type {Record<string, IconResolver>}
 */
const ICON_TYPES = {};

/**
 * @typedef {object} ThoughtBubbleIcon
 * @property {string} type - key in the icon-type registry (e.g. "toy", "clothing")
 * @property {string} id - id within that registry
 * @property {number} [scale] - override the default icon scale
 */

/**
 * @typedef {object} ThoughtBubbleOpts
 * The bubble always anchors to a `character` — pass a sprite or any object
 * with `{x, y}`. It auto-places `DEFAULT_Y_OFFSET` above the character;
 * `offset` nudges that position. Callers never pass world coords directly.
 * @property {{x: number, y: number}} character - speaker to anchor to
 * @property {{x?: number, y?: number}} [offset] - per-call nudge in pixels
 * @property {string} [text] - optional caption rendered inside the cloud
 * @property {ThoughtBubbleIcon[]} [icons] - 0-N icons laid out in a row or stack
 * @property {boolean} [stacked] - if true, render icons stacked diagonally instead of side-by-side
 * @property {boolean} [large] - override anchor sizing for a tall speaker (else read from the sprite's `largeBubble` data)
 * @property {number} [autoDestroyMs] - if set, auto-destroys after this many ms
 * @property {boolean} [follow] - defaults to true: re-anchor to the character
 *   every frame so the bubble tracks a moving sprite. Pass `false` to pin the
 *   bubble at its initial position (useful for static anchors / one-shot
 *   coordinate literals where there's nothing to follow).
 * @property {boolean} [debug] - if true, draws a magenta cross at (0, 0)
 */

/**
 * Compute the bubble's world position from the character's transform.
 * Pulled out so both `constructor` and `_reanchor` (follow mode) share the
 * exact same placement math.
 *
 * @param {{ x: number, y: number, displayWidth?: number, displayHeight?: number, originX?: number, originY?: number }} char
 * @param {number} dx
 * @param {number} dy
 * @param {boolean} isLarge
 * @param {number} xOffsetSign +1 → bubble on the right of character; -1 → on the left
 * @returns {{ x: number, y: number }}
 */
function computeAnchor(char, dx, dy, isLarge, xOffsetSign) {
    let centerX = char.x;
    // Fallback default: align with active-character scale 0.55 top (y - 352)
    let headY = char.y - DEFAULT_Y_OFFSET + 38;
    const xOffset = (isLarge ? 190 : DEFAULT_X_OFFSET) * xOffsetSign;
    const yOffset = isLarge ? 90 : 110;
    if (char.displayHeight !== undefined) {
        const originY = char.originY !== undefined ? char.originY : 0.5;
        const originX = char.originX !== undefined ? char.originX : 0.5;
        headY = char.y - (originY * char.displayHeight);
        centerX = char.x + (0.5 - originX) * char.displayWidth;
    }
    return { x: centerX + xOffset + (dx * xOffsetSign), y: headY - yOffset + dy };
}

export class ThoughtBubble extends Phaser.GameObjects.Container {
    /**
     * @param {import("phaser").Scene} scene
     * @param {ThoughtBubbleOpts} opts
     */
    constructor(scene, opts) {
        const dx = opts.offset?.x ?? 0;
        const dy = opts.offset?.y ?? 0;

        const char = /** @type {any} */ (opts.character);

        const textureKey = char.texture?.key ?? "";
        // "Large" speakers (taller characters) anchor their bubble higher and
        // wider. Generic: the game flags such characters via `largeBubble` in
        // the registry, set as sprite data at spawn (see NPC); callers may also
        // override per-bubble with `opts.large`. The engine knows no names.
        const isLarge = opts.large ?? !!char.getData?.("bubbleLarge");

        // Determine if the character is facing left or right.
        // We only consider it facing left/right if the texture key contains "side"
        // (meaning they are in profile/side view).
        // If it's a side view:
        //   - flipX === true means they face left, so bubble appears on the right (behind them).
        //   - flipX === false means they face right, so bubble appears on the left (behind them).
        // If it's NOT a side view or doesn't have flipX, we default to facingLeft = true
        // (bubble appears on the right, unflipped), preserving original default behavior.
        let facingLeft = true;
        if (char.flipX !== undefined && textureKey.includes("side")) {
            facingLeft = char.flipX;
        }

        let xOffsetSign = facingLeft ? 1 : -1;

        // Check if the default xOffsetSign makes it offscreen
        let anchor = computeAnchor(char, dx, dy, isLarge, xOffsetSign);

        const cam = scene.cameras.main;
        if (cam) {
            const screenLeft = cam.scrollX;
            const screenRight = cam.scrollX + cam.width;
            const halfWidth = 160;

            if (anchor.x - halfWidth < screenLeft) {
                xOffsetSign = 1;
                anchor = computeAnchor(char, dx, dy, isLarge, xOffsetSign);
            } else if (anchor.x + halfWidth > screenRight) {
                xOffsetSign = -1;
                anchor = computeAnchor(char, dx, dy, isLarge, xOffsetSign);
            }
        }

        super(scene, anchor.x, anchor.y);
        this.setDepth(BUBBLE_DEPTH);

        // Stash everything the follow-loop needs so destroy()/update can clean up.
        // Follow defaults to ON so bubbles track their speaker as they move; pass
        // `follow: false` for static / one-shot coord anchors.
        this._followChar = opts.follow === false ? null : char;
        this._followIsLarge = isLarge;
        this._followXSign = xOffsetSign;
        this._followDx = dx;
        this._followDy = dy;
        this._stacked = !!opts.stacked;

        // Bubble image: center origin, then offset so the cloud body lands
        // on container-local (0, 0). The puff tail extends to the bottom-left.
        // If we flipped the bubble (xOffsetSign = -1), the tail points to the bottom-right.
        const bubbleArt = engineAssets.get("thoughtBubble");
        this.bubble = scene.add.image(0, 0, bubbleArt?.atlas, bubbleArt?.frame)
            .setOrigin(0.5, 0.5)
            .setScale(BUBBLE_SCALE);
        this.add(this.bubble);

        this.icons = (opts.icons ?? [])
            .map((spec) => resolveIcon(scene, spec))
            .filter(/** @returns {x is Phaser.GameObjects.Image} */ (x) => x !== null);

        if (this._stacked) {
            this.icons.forEach((img) => {
                img.setScale(img.scale * 0.72);
            });
        }
        this.icons.forEach((img) => this.add(img));

        this.hasText = !!(opts.text && opts.text.length > 0);
        if (this.hasText) {
            this.label = scene.add.text(0, 0, opts.text ?? "", {
                fontSize: "20px",
                color: "#000000",
                align: "center",
                wordWrap: { width: 220 },
            }).setOrigin(0.5);
            this.add(this.label);
        }

        this._applyLayout(xOffsetSign);

        if (opts.debug) {
            const g = scene.add.graphics();
            g.lineStyle(2, 0xff00ff, 1);
            g.strokeCircle(0, 0, 6);
            g.lineBetween(-14, 0, 14, 0);
            g.lineBetween(0, -14, 0, 14);
            this.add(g);
        }

        scene.add.existing(this);

        // Follow mode: re-anchor every frame so the bubble tracks a wandering
        // NPC. Cached fields above keep the recompute branch-light.
        if (this._followChar) {
            this._followUpdate = () => this._reanchor();
            scene.events.on("update", this._followUpdate);
        }

        if (opts.autoDestroyMs) {
            scene.time.delayedCall(opts.autoDestroyMs, () => {
                if (this.active) this.destroy();
            });
        }
    }

    /** @param {number} xOffsetSign */
    _applyLayout(xOffsetSign) {
        // Shift/flip the bubble image so the tail points correctly
        this.bubble.setPosition(-CLOUD_BODY_DX * BUBBLE_SCALE * xOffsetSign, -CLOUD_BODY_DY * BUBBLE_SCALE);
        this.bubble.setFlipX(xOffsetSign === -1);

        // The cloud body's visible center sits ~10px off container origin in
        // the direction of the puff tail. Both icons and text use this same
        // anchor so an icon+text pair stays visually aligned as a single column.
        const bodyCenterX = -10 * xOffsetSign;
        const iconY = this.hasText ? -30 : 0;

        if (this.icons.length > 0) {
            if (this._stacked) {
                const stackDx = 6;
                const stackDy = -6;
                const N = this.icons.length;
                const centerOffsetIndex = (N - 1) / 2;
                // Diagonal grows away from the puff tail in either orientation.
                const stackXOffset = -5 * xOffsetSign;
                this.icons.forEach((img, i) => {
                    img.setPosition(
                        bodyCenterX + (i - centerOffsetIndex) * stackDx * xOffsetSign + stackXOffset,
                        iconY + (i - centerOffsetIndex) * stackDy,
                    );
                });
            } else {
                const totalW = (this.icons.length - 1) * ICON_SPACING;
                this.icons.forEach((img, i) => {
                    img.setPosition(bodyCenterX - totalW / 2 + i * ICON_SPACING, iconY);
                });
            }
        }

        if (this.hasText) {
            const textY = this.icons.length > 0 ? 36 : 0;
            this.label.setPosition(bodyCenterX, textY);
        }
    }

    /** Re-place the bubble at the follow character's current anchor. */
    _reanchor() {
        if (!this.active || !this._followChar) return;

        let xOffsetSign = this._followXSign;
        let anchor = computeAnchor(
            this._followChar,
            this._followDx,
            this._followDy,
            this._followIsLarge,
            xOffsetSign,
        );

        const cam = this.scene.cameras.main;
        if (cam) {
            const screenLeft = cam.scrollX;
            const screenRight = cam.scrollX + cam.width;
            const halfWidth = 160;

            let changed = false;
            if (anchor.x - halfWidth < screenLeft && xOffsetSign === -1) {
                xOffsetSign = 1;
                changed = true;
            } else if (anchor.x + halfWidth > screenRight && xOffsetSign === 1) {
                xOffsetSign = -1;
                changed = true;
            }

            if (changed) {
                this._followXSign = xOffsetSign;
                anchor = computeAnchor(
                    this._followChar,
                    this._followDx,
                    this._followDy,
                    this._followIsLarge,
                    xOffsetSign,
                );
                this._applyLayout(xOffsetSign);
            }
        }

        this.x = anchor.x;
        this.y = anchor.y;
    }

    /**
     * Phaser destroy hook — also unsubscribes the follow tick if any.
     * @param {boolean} [fromScene]
     */
    destroy(fromScene) {
        if (this._followUpdate && this.scene) {
            this.scene.events.off("update", this._followUpdate);
            this._followUpdate = null;
        }
        this._followChar = null;
        super.destroy(fromScene);
    }

    /**
     * Convenience: build + add to scene + return.
     * @param {import("phaser").Scene} scene
     * @param {ThoughtBubbleOpts} opts
     * @returns {ThoughtBubble}
     */
    static show(scene, opts) {
        return new ThoughtBubble(scene, opts);
    }

    /**
     * Register a new icon `type` so callers can pass `{ type, id }` without
     * knowing the atlas key. Returns a disposer for symmetry.
     * @param {string} type
     * @param {IconResolver} resolver
     */
    static registerIconType(type, resolver) {
        ICON_TYPES[type] = resolver;
        return () => {
            delete ICON_TYPES[type];
        };
    }
}

/**
 * Build an Image for a single icon spec, or null if the type/id is unknown.
 * @param {import("phaser").Scene} scene
 * @param {ThoughtBubbleIcon} spec
 * @returns {Phaser.GameObjects.Image | null}
 */
function resolveIcon(scene, spec) {
    const resolver = ICON_TYPES[spec.type];
    if (!resolver) return null;
    return resolver(scene, spec.id, spec.scale ?? ICON_DEFAULT_SCALE);
}
