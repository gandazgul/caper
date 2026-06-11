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
 * @property {boolean} [viewportFallback] - use fixed-position viewport fullscreen when native fullscreen is unsupported (default true).
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
        this._viewportFallback = opts.viewportFallback !== false;
        this._pendingNativeFullscreen = false;
        /** @type {any | null} */
        this._viewportFullscreenState = null;

        /** @type {() => void} */
        this._onEnter = () => {
            this._pendingNativeFullscreen = false;
            this.btn?.setVisible(false);
        };
        /** @type {() => void} */
        this._onLeave = () => {
            this._pendingNativeFullscreen = false;
            // Only show if the GameUI hasn't externally hidden us.
            if (this._visible) this.btn?.setVisible(true);
        };
        /** @type {() => void} */
        this._onFullscreenFailure = () => {
            if (!this._pendingNativeFullscreen) return;
            this._pendingNativeFullscreen = false;
            this._enterViewportFullscreen();
        };

        this._visible = true;

        this._create(opts);

        // Listen for fullscreen transitions.
        scene.scale.on("enterfullscreen", this._onEnter);
        scene.scale.on("leavefullscreen", this._onLeave);
        scene.scale.on("fullscreenfailed", this._onFullscreenFailure);
        scene.scale.on("fullscreenunsupported", this._onFullscreenFailure);

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
                this._toggleFullscreen();
            });
        } else {
            this.btn = createChunkyButton(this.scene, x, y, width, height, {
                text: opts.text ?? null,
                icon: opts.text || opts.iconImage ? undefined : (opts.icon ?? "fullscreen"),
                iconDrawFn: opts.iconDrawFn ?? null,
                iconImage: opts.iconImage ?? null,
                onClick: () => this._toggleFullscreen(),
            });
        }

        if (opts.depth !== undefined) {
            this.btn.setDepth(opts.depth);
        }
        this.btn.setScrollFactor(0);
    }

    _toggleFullscreen() {
        if (this.scene.scale.isFullscreen) {
            this.scene.scale.stopFullscreen();
            return;
        }

        if (this._viewportFullscreenState) {
            this._leaveViewportFullscreen();
            return;
        }

        if (!this.scene.scale.fullscreen?.available) {
            this._enterViewportFullscreen();
            return;
        }

        this._pendingNativeFullscreen = true;

        try {
            this.scene.scale.startFullscreen();
        } catch (_err) {
            this._pendingNativeFullscreen = false;
            this._enterViewportFullscreen();
        }
    }

    _enterViewportFullscreen() {
        if (!this._viewportFallback || this._viewportFullscreenState) return;

        const target = resolveViewportFullscreenTarget(this.scene.scale);
        if (!target) return;

        const ownerDocument = target.ownerDocument ?? getGlobalDocument();
        const body = isStyleableElement(ownerDocument?.body) ? ownerDocument.body : null;
        const documentElement = isStyleableElement(ownerDocument?.documentElement)
            ? ownerDocument.documentElement
            : null;

        this._viewportFullscreenState = {
            target,
            targetStyles: captureStyles(target, VIEWPORT_FULLSCREEN_TARGET_STYLES),
            body,
            bodyStyles: body ? captureStyles(body, VIEWPORT_FULLSCREEN_ROOT_STYLES) : null,
            documentElement,
            documentElementStyles: documentElement
                ? captureStyles(documentElement, VIEWPORT_FULLSCREEN_ROOT_STYLES)
                : null,
        };

        applyStyles(target, {
            position: "fixed",
            inset: "0",
            width: "100vw",
            height: "100dvh",
            minHeight: "100vh",
            zIndex: "2147483647",
            margin: "0",
            padding: "0",
            backgroundColor: "#000",
            overflow: "hidden",
            touchAction: "none",
        });
        if (body) {
            applyStyles(body, {
                overflow: "hidden",
                overscrollBehavior: "none",
                height: "100%",
                margin: "0",
                padding: "0",
            });
        }
        if (documentElement) {
            applyStyles(documentElement, {
                overflow: "hidden",
                overscrollBehavior: "none",
                height: "100%",
                margin: "0",
                padding: "0",
            });
        }

        if (this._visible) this.btn?.setVisible(true);
        this.scene.scale.refresh?.();
    }

    _leaveViewportFullscreen() {
        const state = this._viewportFullscreenState;
        if (!state) return;

        restoreStyles(state.target, state.targetStyles);
        if (state.body && state.bodyStyles) restoreStyles(state.body, state.bodyStyles);
        if (state.documentElement && state.documentElementStyles) {
            restoreStyles(state.documentElement, state.documentElementStyles);
        }
        this._viewportFullscreenState = null;
        this.scene.scale.refresh?.();
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
        this.scene.scale.off("fullscreenfailed", this._onFullscreenFailure);
        this.scene.scale.off("fullscreenunsupported", this._onFullscreenFailure);
        if (this._shutdownHandler) {
            this.scene.events.off("shutdown", this._shutdownHandler);
        }
        this._leaveViewportFullscreen();
        if (this.btn) {
            this.btn.destroy();
            this.btn = null;
        }
    }
}

const VIEWPORT_FULLSCREEN_TARGET_STYLES = [
    "position",
    "inset",
    "width",
    "height",
    "minHeight",
    "zIndex",
    "margin",
    "padding",
    "backgroundColor",
    "overflow",
    "touchAction",
];

const VIEWPORT_FULLSCREEN_ROOT_STYLES = [
    "overflow",
    "overscrollBehavior",
    "height",
    "margin",
    "padding",
];

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStyleableElement(value) {
    return !!value && typeof value === "object" && "style" in value;
}

/**
 * @param {import("phaser").Scale.ScaleManager} scale
 * @returns {any | null}
 */
function resolveViewportFullscreenTarget(scale) {
    const scaleAny = /** @type {any} */ (scale);
    const candidates = [
        scaleAny.fullscreenTarget,
        scaleAny.parent,
        scaleAny.canvas?.parentElement,
        scaleAny.canvas,
    ];

    for (const candidate of candidates) {
        if (isStyleableElement(candidate)) return candidate;
    }

    return null;
}

/** @returns {any | null} */
function getGlobalDocument() {
    return typeof document === "undefined" ? null : document;
}

/**
 * @param {any} element
 * @param {string[]} properties
 * @returns {Record<string, string | undefined>}
 */
function captureStyles(element, properties) {
    /** @type {Record<string, string | undefined>} */
    const snapshot = {};
    for (const property of properties) {
        snapshot[property] = element.style[property];
    }
    return snapshot;
}

/**
 * @param {any} element
 * @param {Record<string, string>} styles
 */
function applyStyles(element, styles) {
    for (const [property, value] of Object.entries(styles)) {
        element.style[property] = value;
    }
}

/**
 * @param {any} element
 * @param {Record<string, string | undefined>} snapshot
 */
function restoreStyles(element, snapshot) {
    for (const [property, value] of Object.entries(snapshot)) {
        element.style[property] = value ?? "";
    }
}
