/**
 * Engine playable-character switcher (ADR 0005): a tappable portrait of the
 * next playable character, shown only when more than one **playable** character
 * is registered AND the active one is itself playable. The portrait is resolved
 * from the character's registration metadata — the engine knows no character
 * names, only registered configs.
 *
 * The portrait is resolved (and the default cropped) by the shared
 * {@link resolveCharacterPortrait} — see `portraits.js` for the fallback chain.
 * If a portrait texture is not yet ready (still baking / loading), the switcher
 * defers and retries on the next frame.
 */

import { characters } from "./CharacterRegistry.js";
import { store } from "../state/Store.js";
import { UI_DEPTH } from "../ui/UIHelper.js";
import { resolveCharacterPortrait } from "./portraits.js";
import { IdleCharacter } from "../movement/IdleCharacter.js";

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
     * @param {import("../scene/EngineScene.js").EngineScene} scene
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

        const textureKey = resolveCharacterPortrait(this.scene, next, config);
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
                this.switchActiveCharacter();
            },
        );
    }

    /** Switch the active playable character, falling back to game-agnostic logic if the scene doesn't provide it. */
    switchActiveCharacter() {
        if (this.opts.onSwitch) {
            this.opts.onSwitch();
            return;
        }

        const engineScene = /** @type {any} */ (this.scene);
        if (typeof engineScene.switchActiveCharacter === "function") {
            engineScene.switchActiveCharacter();
            return;
        }

        // Game-agnostic default implementation
        const walk = engineScene.walk;

        if (!walk) return;
        if (walk.locked) return; // don't switch mid-puzzle

        const activeName = store.getActiveCharacter() ?? characters.defaultPlayer ?? "";
        const playables = characters.playableIds();
        if (playables.length < 2) return;
        const nextName = playables[(playables.indexOf(activeName) + 1) % playables.length] ?? activeName;
        if (nextName === activeName) return;

        const activeX = walk.sprite.x;
        const activeY = walk.sprite.y;

        // Find the IdleCharacter instance for the character that is ABOUT TO BECOME ACTIVE
        const nextIdleChar = engineScene.idleCharacters?.find(
            /** @param {{ name?: string }} c */
            (c) => c.name === nextName,
        );

        let inactiveX, inactiveY;
        const isInactivePresent = nextIdleChar && nextIdleChar.isPresent();
        if (isInactivePresent) {
            const pos = nextIdleChar.getPosition();
            inactiveX = pos ? pos.x : -150;
            inactiveY = pos ? pos.y : activeY;
        } else {
            inactiveX = -150;
            inactiveY = activeY;
        }

        const newActiveX = isInactivePresent ? inactiveX : activeX;
        const newActiveY = isInactivePresent ? inactiveY : activeY;
        const newInactiveX = activeX;
        const newInactiveY = activeY;

        // Preserve idle character options (like greetings) to recreate it
        const idleOpts = engineScene.idleCharacters?.[0]?.opts ?? {};

        store.setActiveCharacter(nextName);

        walk.shutdown();
        if (walk.sprite) walk.sprite.destroy();
        engineScene.walk = null;

        for (const c of engineScene.idleCharacters ?? []) c.destroy();
        engineScene.idleCharacters = [];

        if (typeof engineScene.spawnActiveCharacter === "function") {
            engineScene.spawnActiveCharacter({ x: newActiveX, y: newActiveY });
        }

        if (typeof engineScene.spawnIdleCharacters === "function") {
            engineScene.spawnIdleCharacters(idleOpts);
        } else if (typeof engineScene.createIdleCharacter === "function") {
            // Fallback for games that haven't updated yet
            engineScene.idleCharacters = [engineScene.createIdleCharacter()];
        } else {
            engineScene.idleCharacters = engineScene.sceneConfig?.disableIdleCharacter
                ? []
                : playables.filter((id) => id !== nextName).map((id) =>
                    new IdleCharacter(engineScene, { ...idleOpts, characterId: id })
                );
        }

        // Make the newly inactive character stand where the active character just was
        const newlyInactiveChar = engineScene.idleCharacters?.find(
            /** @param {{ name?: string }} c */
            (c) => c.name === activeName,
        );
        if (newlyInactiveChar) {
            newlyInactiveChar.presentAt(newInactiveX, newInactiveY);
        }

        this.createPortrait();
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
