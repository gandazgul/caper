import { createBackButton } from "./UIHelper.js";

/**
 * @typedef {object} SubsceneConfig
 * @property {string} backgroundKey - texture key for the zoomed-in background
 * @property {number} [backgroundScale] - optional scale for the background
 * @property {{x?: number, y?: number}} [offset] - shift the bg image away from
 *   the top-left of the canvas (e.g. center a narrow sub-scene bg). Puzzles
 *   that draw their own sprites should read the same offset and apply it to
 *   their internal coords.
 * @property {(scene: import("phaser").Scene) => void} [onOpen] - called after bg + back arrow are placed
 * @property {(scene: import("phaser").Scene) => void} [onClose] - called before bg + back arrow are destroyed
 */

/** Background depth — sub-scene content slots in above the world, below the inventory. */
const SUBSCENE_BG_DEPTH = 800;

/**
 * Manages zoom-in Sub-scenes inside a parent Scene. A Sub-scene is a
 * background swap + a Back arrow + optional caller-supplied content,
 * pushed onto a stack so multiple nested sub-scenes work.
 *
 * The background is made interactive (with no behavior) so clicks inside the
 * sub-scene are consumed and don't fall through to the parent scene's hotspots
 * or walk controller.
 */
export class SubsceneStack {
    /** @param {import("phaser").Scene} scene */
    constructor(scene) {
        this.scene = scene;
        /** @type {{ bg: any, back: any, config: SubsceneConfig }[]} */
        this.stack = [];
    }

    /** @param {SubsceneConfig} config */
    push(config) {
        const bgX = config.offset?.x ?? 0;
        const bgY = config.offset?.y ?? 0;
        const bg = this.scene.add.image(bgX, bgY, config.backgroundKey)
            .setOrigin(0, 0)
            .setScale(config.backgroundScale ?? 1)
            .setDepth(SUBSCENE_BG_DEPTH)
            .setData("debugSkip", true)
            .setInteractive();
        // Swallow clicks on the bg so they don't trigger underlying hotspots /
        // walk. event.stopPropagation() prevents the scene-level pointerdown
        // listener (WalkController) from firing too.
        bg.on(
            "pointerdown",
            (
                /** @type {Phaser.Input.Pointer} */ _p,
                /** @type {number} */ _x,
                /** @type {number} */ _y,
                /** @type {{stopPropagation: () => void}} */ event,
            ) => {
                event?.stopPropagation?.();
            },
        );

        // stopPropagation: pop() destroys this back button synchronously, so by
        // the time the scene-level pointerdown fires there's nothing for
        // WalkController's hitTestPointer to detect — without this, the
        // back-button click would also be interpreted as a walk command.
        const back = createBackButton(this.scene, () => this.pop(), {
            stopPropagation: true,
            // This arrow pops the zoom, not the scene — never hijack it to the
            // any scene during a replay.
            replayReturn: false,
        }).setData("debugSkip", true);

        this.stack.push({ bg, back, config });
        if (config.onOpen) config.onOpen(this.scene);
        (/** @type {any} */ (this.scene).bus).emit("subscene:open");
    }

    pop() {
        const top = this.stack.pop();
        if (!top) return;
        if (top.config.onClose) top.config.onClose(this.scene);
        top.bg.destroy();
        top.back.destroy();
        (/** @type {any} */ (this.scene).bus).emit("subscene:close");
    }

    /** @returns {boolean} */
    isOpen() {
        return this.stack.length > 0;
    }
}
