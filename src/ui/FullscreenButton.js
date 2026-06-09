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
 * @property {{ texture: string, frame?: string | number, maxWidth?: number, maxHeight?: number, scale?: number }} [iconImage] - sprite icon.
 * @property {boolean} [imageOnly] - if true, renders only the iconImage as an interactive sprite instead of a chunky button.
 */

export class FullscreenButton {
    /**
     * @param {import("phaser").Scene} scene
     * @param {FullscreenButtonOptions} [opts]
     */
    constructor(scene, opts = {}) {
        this.scene = scene;
        /** @type {(import("phaser").GameObjects.Container | import("phaser").GameObjects.Image) | null} */
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

        if (opts.imageOnly && opts.iconImage) {
            const frame = opts.iconImage.frame === undefined ? undefined : opts.iconImage.frame;
            this.btn = this.scene.add.image(x + width / 2, y + height / 2, opts.iconImage.texture, frame);

            // Replicate typical button behavior
            this.btn.setInteractive({ useHandCursor: true });

            // Need a container-like wrapper for setDepth/setScrollFactor compatibility with original
            // Actually, Phaser Images have setDepth and setScrollFactor so it matches transparently.
            const baseScale = opts.iconImage.scale ?? 1;
            if (opts.iconImage.scale !== undefined) {
                this.btn.setScale(baseScale);
            }

            this.btn.on("pointerover", () => this.btn?.setScale(baseScale * 1.05));
            this.btn.on("pointerout", () => this.btn?.setScale(baseScale));
            this.btn.on("pointerdown", () => this.btn?.setScale(baseScale * 0.95));
            this.btn.on("pointerup", () => {
                this.btn?.setScale(baseScale);
                if (this.scene.scale.isFullscreen) {
                    this.scene.scale.stopFullscreen();
                } else {
                    this.scene.scale.startFullscreen();
                }
            });
        } else {
            this.btn = createChunkyButton(this.scene, x, y, width, height, {
                text: opts.text ?? null,
                icon: opts.text || opts.iconImage ? undefined : (opts.icon ?? "fullscreen"),
                iconDrawFn: opts.iconDrawFn ?? null,
                iconImage: opts.iconImage ?? null,
                onClick: () => {
                    if (this.scene.scale.isFullscreen) {
                        this.scene.scale.stopFullscreen();
                    } else {
                        this.scene.scale.startFullscreen();
                    }
                },
            });
        }

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
