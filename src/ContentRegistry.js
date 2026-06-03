/**
 * Engine — content registry (ADR 0005).
 *
 * Phaser-idiomatic: the Game registers its item catalogs at boot; the engine
 * resolves an inventory id to a renderable sprite spec by key — the same shape
 * Phaser's TextureManager has (register a key, look it up later). The engine
 * hardcodes no atlas names or scales; those are Game knowledge supplied at
 * registration. Item ids are globally unique, so resolution is a flat
 * id → ItemSprite lookup with ordered resolver fallbacks for catalogs that
 * compute their specs (e.g. lake/fall lookups).
 *
 * @typedef {Object} ItemSprite
 * @property {string} atlas
 * @property {string} frame
 * @property {number} scale
 */
export class ContentRegistry {
    constructor() {
        /** @type {Map<string, ItemSprite>} */
        this._items = new Map();
        /** @type {((id: string) => ItemSprite | null | undefined)[]} */
        this._resolvers = [];
    }

    /**
     * Register normalized item sprite specs by id (merges with prior calls).
     * @param {Record<string, ItemSprite>} map
     */
    registerItems(map) {
        for (const [id, def] of Object.entries(map)) this._items.set(id, def);
        return this;
    }

    /**
     * Register a fallback resolver, tried in order when no direct entry exists.
     * Useful for catalogs that compute their specs rather than enumerate them.
     * @param {(id: string) => ItemSprite | null | undefined} fn
     */
    registerItemResolver(fn) {
        this._resolvers.push(fn);
        return this;
    }

    /**
     * Resolve an id to its sprite spec, or null if unknown.
     * @param {string} id @returns {ItemSprite | null}
     */
    getItem(id) {
        const direct = this._items.get(id);
        if (direct) return direct;
        for (const fn of this._resolvers) {
            const r = fn(id);
            if (r) return r;
        }
        return null;
    }
}

/** Engine-owned singleton. Engine modules read it; the Game populates it at boot. */
export const content = new ContentRegistry();
