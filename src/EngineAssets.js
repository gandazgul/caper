/**
 * Engine asset registry (ADR 0005). The engine ships several built-in visuals
 * — thought bubbles, the back button, falling-leaf weather, ambient critters,
 * the inventory bar — but it owns no art. The Game supplies the texture/atlas
 * keys for those visuals here at boot (see `registerGameContent`), and the
 * engine widgets look them up at runtime. The engine hard-codes no game keys.
 *
 * Same pattern as {@link content} / {@link characters} / cast: a generic
 * engine singleton the game populates once at boot. Read at *use* time (scene
 * create / widget construction), never at module load — the registry is empty
 * until the game configures it.
 *
 * @typedef {object} EngineAssetSlots
 * @property {{ atlas: string, frame: string }} [thoughtBubble] - cloud sprite for ThoughtBubble.
 * @property {{ atlas: string, frame: string }} [backButton] - the UIHelper back button.
 * @property {{ atlas: string, frames: string[] }} [leaves] - falling-leaf frames for WeatherLayer.
 * @property {{ atlas: string, frame: string }} [critter] - default atlas/frame for a critter spec that omits them.
 * @property {string} [inventoryAtlas] - default atlas for the inventory bar (a scene may override via `inventoryAtlas`).
 * @property {string} [replayDefaultReturn] - scene key to return to from a replay when no return scene is stored (default none).
 */

export class EngineAssetRegistry {
    constructor() {
        /** @type {EngineAssetSlots} */
        this._slots = {};
    }

    /**
     * Merge in the game's asset keys. Call once at boot.
     * @param {EngineAssetSlots} slots
     * @returns {this}
     */
    configure(slots) {
        Object.assign(this._slots, slots);
        return this;
    }

    /**
     * @template {keyof EngineAssetSlots} K
     * @param {K} key
     * @returns {EngineAssetSlots[K] | undefined}
     */
    get(key) {
        return this._slots[key];
    }
}

/** Engine-owned singleton. The Game supplies its keys at boot. */
export const engineAssets = new EngineAssetRegistry();
