/**
 * Engine playable-character switcher (ADR 0005): a tappable portrait of the
 * next playable character, shown only when more than one **playable** character
 * is registered AND the active one is itself playable. The portrait is resolved
 * from the character's registration metadata — the engine knows no character
 * names, only registered configs.
 *
 * Portrait resolution order (per character config):
 *   1. `getPortrait(scene)` — full override returning a texture key.
 *   2. `portraitSettings` — crop recipe applied to a source texture.
 *   3. Engine default — circular crop from the character's front still texture,
 *      centred at (50%, 25%) of the texture with radius = 20% of width.
 *
 * If a portrait texture is not yet ready (still baking / loading), the switcher
 * defers and retries on the next frame.
 */

import { characters } from "./CharacterRegistry.js";
import { store } from "./Store.js";
import { UI_DEPTH } from "./UIHelper.js";

// ─── Engine-default circular portrait ───────────────────────────────────────

/**
 * Bake a circular crop from a texture frame into a new cached canvas texture.
 * Idempotent — subsequent calls with the same `outKey` are no-ops.
 *
 * @param {import("phaser").Scene} scene
 * @param {string} sourceKey
 * @param {string | number} frameNameOrIndex
 * @param {string} outKey
 * @param {{ cx: number, cy: number, radius: number }} circle - crop circle in
 *   pixel coords of the source frame.
 */
function _bakeCircularCrop(scene, sourceKey, frameNameOrIndex, outKey, circle) {
    if (scene.textures.exists(outKey)) return;
    if (!scene.textures.exists(sourceKey)) return;
    const texture = scene.textures.get(sourceKey);
    const frame = texture.get(frameNameOrIndex);
    if (!frame) return;
    const sourceImg = texture.getSourceImage(frame.sourceIndex);
    const diameter = Math.round(circle.radius * 2);
    const canvas = document.createElement("canvas");
    canvas.width = diameter;
    canvas.height = diameter;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
        /** @type {CanvasImageSource} */ (sourceImg),
        frame.cutX + (circle.cx - circle.radius),
        frame.cutY + (circle.cy - circle.radius),
        diameter,
        diameter,
        0,
        0,
        diameter,
        diameter,
    );
    ctx.restore();
    scene.textures.addCanvas(outKey, canvas);
}

/**
 * Resolve (or create) a circular portrait texture key for a character.
 * Follows the fallback chain: getPortrait → portraitSettings → engine default.
 *
 * @param {import("phaser").Scene} scene
 * @param {string} characterId
 * @param {import("./CharacterRegistry.js").CharacterConfig} config
 * @returns {string | null} texture key, or null if not yet available.
 */
function _resolvePortrait(scene, characterId, config) {
    // 1. Full override callback.
    if (typeof config.getPortrait === "function") {
        const key = config.getPortrait(scene);
        if (key && scene.textures.exists(key)) return key;
        // Callback returned a key but texture isn't ready → retry.
        if (key) return null;
        // Falsy → fall through.
    }

    const settings = config.portraitSettings;
    const sourceKey = settings?.texture ?? config.spriteKey;
    if (!sourceKey || !scene.textures.exists(sourceKey)) return null;

    const texture = scene.textures.get(sourceKey);
    const frameObj = texture.get(); // default frame (frame 0)
    if (!frameObj) return null;

    const fw = frameObj.width;
    const fh = frameObj.height;

    // 2. portraitSettings crop recipe.
    if (settings) {
        const cx = fw * (settings.offsetX ?? 0.5);
        const cy = fh * (settings.offsetY ?? 0.25);
        // Default radius = 20% of frame width, scaled by portraitSettings.scale.
        const radius = fw * 0.2 * (settings.scale ?? 1);
        const outKey = `engine-portrait-${characterId}`;
        _bakeCircularCrop(scene, sourceKey, 0, outKey, { cx, cy, radius });
        return outKey;
    }

    // 3. Engine default — centre at (50%, 25%), radius = 20% of width.
    const cx = fw * 0.5;
    const cy = fh * 0.25;
    const radius = fw * 0.2;
    const outKey = `engine-portrait-${characterId}`;
    _bakeCircularCrop(scene, sourceKey, 0, outKey, { cx, cy, radius });
    return outKey;
}

// ─── Exported class ─────────────────────────────────────────────────────────

/**
 * @typedef {object} CharacterSwitcherOptions
 * @property {() => void} [onSwitch] - tap handler; defaults to the scene's
 *   `switchActiveCharacter()`.
 * @property {{ x: number, y: number }} [position] - top-left portrait anchor.
 * @property {number} [scale] - display scale of the portrait sprite.
 */

export class CharacterSwitcher {
    /**
     * @param {import("./EngineScene.js").EngineScene} scene
     * @param {CharacterSwitcherOptions} opts
     */
    constructor(scene, opts) {
        this.scene = scene;
        this.opts = opts;
        /** @type {import("phaser").GameObjects.Image | null} */
        this.sprite = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this._retryTimer = null;
        this.createPortrait();
    }

    /** The playable to switch TO (next after the active one). */
    _nextPlayable() {
        const playables = characters.playableIds();
        if (playables.length < 2) return null;
        const active = store.getActiveCharacter() ?? characters.defaultPlayer ?? "";
        // No switching from a non-playable lead (e.g. a non-playable follower).
        if (!playables.includes(active)) return null;
        return playables[(playables.indexOf(active) + 1) % playables.length] ?? null;
    }

    createPortrait() {
        // Kill any pending retry so we don't double-create.
        if (this._retryTimer !== null) {
            this._retryTimer.remove(false);
            this._retryTimer = null;
        }

        if (this.sprite) {
            this.sprite.destroy();
            this.sprite = null;
        }

        const next = this._nextPlayable();
        if (!next) return;

        const config = characters.get(next);
        if (!config) return;

        const textureKey = _resolvePortrait(this.scene, next, config);
        if (!textureKey) {
            // Texture not ready (still baking / loading) — retry shortly.
            this._retryTimer = this.scene.time.delayedCall(50, () => {
                this._retryTimer = null;
                this.createPortrait();
            });
            return;
        }

        const pos = this.opts.position ?? { x: 50, y: 60 };
        const scale = this.opts.scale ?? 0.36;
        const sprite = this.scene.add.image(pos.x, pos.y, textureKey)
            .setOrigin(0.5)
            .setScale(scale)
            .setScrollFactor(0)
            .setDepth(UI_DEPTH)
            .setInteractive({ useHandCursor: true });
        this.sprite = sprite;

        sprite.on("pointerover", () => sprite.setScale(scale * 1.3));
        sprite.on("pointerout", () => sprite.setScale(scale));
        sprite.on(
            "pointerdown",
            /** @param {any} _p @param {any} _x @param {any} _y @param {PointerEvent} event */
            (_p, _x, _y, event) => {
                event?.stopPropagation?.();
                if (this.opts.onSwitch) this.opts.onSwitch();
                else {
                    const s = /** @type {any} */ (this.scene);
                    if (typeof s.switchActiveCharacter === "function") s.switchActiveCharacter();
                }
            },
        );
    }

    /** @param {boolean} visible */
    setVisible(visible) {
        this.sprite?.setVisible(visible);
    }

    destroy() {
        if (this._retryTimer !== null) {
            this._retryTimer.remove(false);
            this._retryTimer = null;
        }
        this.sprite?.destroy();
        this.sprite = null;
    }
}
