/**
 * Engine fullscreen toggle button.
 *
 * A reusable control that wraps Phaser ScaleManager's fullscreen API.
 * Defaults to a diagonal-arrows icon drawn via UIHelper; callers can
 * override with text, a named icon, or a custom draw function.
 *
 * The button hides itself while fullscreen is active and reappears on exit.
 * Lifecycle mirrors other engine UI controls: `setVisible` / `destroy`.
 */

import { createChunkyButton } from "./UIHelper.js";

/**
 * @typedef {object} FullscreenButtonOptions
 * @property {number} [x] - centre X (default right-edge offset).
 * @property {number} [y] - centre Y (default right-edge offset).
 * @property {number} [width] - button width (default 50).
 * @property {number} [height] - button height (default 50).
 * @property {number} [depth] - display depth (default UI_DEPTH).
 * @property {string} [text] - text label (overrides icon).
 * @property {string} [icon] - named icon for drawIcon (default "fullscreen").
 * @property {(gfx: Phaser.GameObjects.Graphics, cx: number, cy: number) => void} [iconDrawFn] - custom draw callback.
 */

export class FullscreenButton {
    /**
     * @param {import("phaser").Scene} scene
     * @param {FullscreenButtonOptions} [opts]
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        /** @type {import("phaser").GameObjects.Container | null} */
        this.btn = null;

        /** @type {() => void} */
        this._onEnter = () => {
            this.btn?.setVisible(false);
        };
        /** @type {() => void} */
        this._onLeave = () => {
            // Only show if the GameUI hasn't externally hidden us.
            if (this._visible) this.btn?.setVisible(true);
        };

        this._visible = true;

        this._create(opts);

        // Listen for fullscreen transitions.
        scene.scale.on("enterfullscreen", this._onEnter);
        scene.scale.on("leavefullscreen", this._onLeave);

        // Sync with current fullscreen state.
        if (scene.scale.isFullscreen) {
            this.btn?.setVisible(false);
        }

        // Auto-cleanup on scene shutdown.
        const shutdownHandler = () => {
            this.destroy();
        };
        scene.events.once("shutdown", shutdownHandler);
        this._shutdownHandler = shutdownHandler;
    }

    /**
     * @param {FullscreenButtonOptions} opts
     */
    _create(opts) {
        const width = opts.width ?? 50;
        const height = opts.height ?? 50;
        const x = opts.x ?? 0;
        const y = opts.y ?? 0;

        this.btn = createChunkyButton(this.scene, x, y, width, height, {
            text: opts.text ?? null,
            icon: opts.text ? undefined : (opts.icon ?? "fullscreen"),
            iconDrawFn: opts.iconDrawFn ?? null,
            onClick: () => {
                if (this.scene.scale.isFullscreen) {
                    this.scene.scale.stopFullscreen();
                } else {
                    this.scene.scale.startFullscreen();
                }
            },
        });

        if (opts.depth !== undefined) {
            this.btn.setDepth(opts.depth);
        }
        this.btn.setScrollFactor(0);
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        this._visible = visible;
        // Never show while in fullscreen regardless.
        if (visible && this.scene.scale.isFullscreen) return;
        this.btn?.setVisible(visible);
    }

    destroy() {
        this.scene.scale.off("enterfullscreen", this._onEnter);
        this.scene.scale.off("leavefullscreen", this._onLeave);
        if (this._shutdownHandler) {
            this.scene.events.off("shutdown", this._shutdownHandler);
        }
        if (this.btn) {
            this.btn.destroy();
            this.btn = null;
        }
    }
}
