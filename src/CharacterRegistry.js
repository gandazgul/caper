/**
 * Engine — character registry (ADR 0005).
 *
 * The Game registers each character's render config (sprite + animations) at
 * boot and flags which are **playable** (the human can control them). The
 * engine base scene spawns the active character from this registry and, when
 * more than one playable character is registered, offers a switcher between
 * them. The engine knows no character names — only what's registered.
 *
 * @typedef {Object} CharacterConfig
 * @property {string} [spriteKey]
 * @property {number} [spriteScale]
 * @property {import("./WalkController.js").AnimationSet} [animationSet]
 * @property {Record<string, number>} [animationScales]
 * @property {Record<string, { x?: number, y?: number }>} [animationOrigins]
 * @property {boolean} [playable]
 * @property {boolean} [largeBubble]
 * @property {Record<string, CharacterConfig>} [outfits]
 * @property {{ scale?: number, texture?: string, offsetX?: number, offsetY?: number }} [portraitSettings]
 * @property {(scene: Phaser.Scene) => string | null | undefined} [getPortrait]
 *
 * An **outfit** is a partial `CharacterConfig` (typically `spriteKey` +
 * `animationSet` + scales/origins — a full sprite-set swap) that overrides the
 * base look. See {@link CharacterRegistry#render} and ADR 0006.
 */
export class CharacterRegistry {
    constructor() {
        /** @type {Map<string, CharacterConfig>} */
        this._chars = new Map();
        /** @type {string | null} First-registered playable — the default active character. */
        this._defaultPlayer = null;
    }

    /**
     * Register a character. The first one flagged `playable` becomes the
     * default active character.
     * @param {string} id @param {CharacterConfig} config
     */
    register(id, config) {
        this._chars.set(id, config);
        if (config.playable && this._defaultPlayer === null) this._defaultPlayer = id;
        return this;
    }

    /** @param {string} [id] @returns {CharacterConfig | undefined} */
    get(id) {
        return id ? this._chars.get(id) : undefined;
    }

    /**
     * Resolve a registered character's config, falling back to the default
     * player when the id is unknown. Guaranteed non-null for any populated
     * registry (the engine spawn paths rely on this).
     * @param {string} id @returns {CharacterConfig}
     */
    resolve(id) {
        const c = this._chars.get(id);
        if (c) return c;
        const def = this._defaultPlayer ? this._chars.get(this._defaultPlayer) : undefined;
        if (def) return def;
        throw new Error(`CharacterRegistry: no character "${id}" and no default player registered`);
    }

    /**
     * Resolve a character's effective render config with a named outfit's
     * overrides applied over the base (a full sprite-set swap). Falsy/unknown
     * outfit → the base look. The selected outfit lives in Store state under
     * `${id}Outfit` (ADR 0006). @param {string} id @param {string} [outfit]
     * @returns {CharacterConfig}
     */
    render(id, outfit) {
        const base = this.resolve(id);
        const override = outfit ? base.outfits?.[outfit] : undefined;
        return override ? { ...base, ...override } : base;
    }

    /** @param {string} id @returns {boolean} */
    has(id) {
        return this._chars.has(id);
    }

    /** @returns {string[]} playable character ids, in registration order. */
    playableIds() {
        return [...this._chars].filter(([, c]) => c.playable).map(([id]) => id);
    }

    /** @returns {boolean} whether a switcher is warranted (more than one playable). */
    get hasMultiplePlayers() {
        return this.playableIds().length > 1;
    }

    /** @returns {string | null} the first-registered playable (default active character). */
    get defaultPlayer() {
        return this._defaultPlayer;
    }
}

/** Engine-owned singleton. Engine base scene reads it; the Game populates it at boot. */
export const characters = new CharacterRegistry();
