import { isSaveData } from "./saveFormat.js";

/**
 * Engine — generic reactive state Store (ADR 0005).
 *
 * Game-agnostic primitive store: three typed buckets, change events,
 * localStorage persistence, and snapshot/restore (replay). It is the role
 * Phaser's `registry`/DataManager plays, with batteries. It knows nothing
 * about domains or game state — only keys and values.
 *
 * Buckets:
 *   - `values`      — scalars, flags, strings, numbers, arrays, plain-object maps.
 *   - `collections` — named Sets (engine-owned `inventory`/`world`, plus game-defined sets).
 *   - `items`       — per-item visual-state string map (display_case: "filled").
 *
 * The Store is schema-agnostic. A Game supplies its schema via `configure()`:
 * a `createFreshState()` factory (game defaults + additional collections), the
 * `saveKey`, optional key `aliases`, and the `notifySubject` handed to change
 * subscribers. Domain rules (chapter gates, item availability, …) live in the Game's
 * GameState wrapper, never here.
 *
 * The exported `store` is the engine-owned singleton: engine modules import it
 * directly; the Game configures it at boot. Reads before `configure()` return
 * the engine-owned defaults.
 *
 * @typedef {Object} RunState
 * @property {Record<string, any>} values
 * @property {Record<string, Set<string>>} collections
 * @property {Record<string, string>} items
 */

/**
 * Engine-owned state, seeded under every Game's fresh state so engine features
 * (scene resume, night, inventory, world item conditions) work for any Game.
 * The Game's own fresh values/collections win on conflict; a Game need not
 * declare these.
 */
const ENGINE_VALUE_DEFAULTS = Object.freeze({ currentScene: "", timeOfDay: "day" });

/** @returns {Record<string, Set<string>>} */
function engineCollectionDefaults() {
    return { inventory: new Set(), world: new Set() };
}

/**
 * @typedef {{ state: "ready" | "saved" | "unavailable" | "invalid" | "incompatible", operation: "load" | "save", message?: string }} SaveStatus
 */

export class Store {
    constructor() {
        this._saveKey = "";
        this._saveVersion = 0;
        /** @type {((data: import("./saveFormat.js").SaveData, from: number, to: number) => import("./saveFormat.js").SaveData | null) | undefined} */
        this._migrateSave = undefined;
        this._saveProtected = false;
        /** @type {Readonly<SaveStatus>} */
        this._saveStatus = Object.freeze({ state: "ready", operation: "load" });
        /** @type {Set<(status: Readonly<SaveStatus>) => void>} */
        this._saveStatusSubs = new Set();
        /** @type {() => RunState} */
        this._createFreshState = () => ({ values: {}, collections: {}, items: {} });
        /** @type {Record<string, string>} */
        this._aliases = {};
        this._defaultReplayReturnScene = "";
        /** @type {Set<string>} */
        this._replayPreserveValues = new Set();
        /** Object passed to change subscribers (the Game's state facade, if set). */
        this._notifySubject = /** @type {any} */ (null);

        /** @type {RunState} */
        this._state = this._createFresh();
        /** @type {string[]} */
        this._collectionNames = [];
        /** @type {((subject: any) => void)[]} */
        this._changeSubs = [];

        // Replay sandbox.
        this._replaying = false;
        /** @type {RunState | null} */
        this._replaySnapshot = null;
        this._replayReturnScene = "";

        // Change batching (suspend → fire once).
        this._suspend = 0;
        this._dirty = false;
    }

    /**
     * Install a Game's schema and load any save. Call once at boot.
     * @param {{
     *   saveKey: string,
     *   saveVersion?: number,
     *   migrateSave?: (data: import("./saveFormat.js").SaveData, from: number, to: number) => import("./saveFormat.js").SaveData | null,
     *   createFreshState: () => RunState,
     *   aliases?: Record<string, string>,
     *   defaultReplayReturnScene?: string,
     *   replayPreserveValues?: string[],
     *   notifySubject?: any,
     * }} cfg
     */
    configure(cfg) {
        if (!Number.isSafeInteger(cfg.saveVersion ?? 0) || (cfg.saveVersion ?? 0) < 0) {
            throw new Error("Store: saveVersion must be a non-negative integer.");
        }
        this._saveKey = cfg.saveKey;
        this._saveVersion = cfg.saveVersion ?? 0;
        this._migrateSave = cfg.migrateSave;
        this._saveProtected = false;
        this._createFreshState = cfg.createFreshState;
        this._aliases = cfg.aliases ?? {};
        this._defaultReplayReturnScene = cfg.defaultReplayReturnScene ?? "";
        this._replayReturnScene = this._defaultReplayReturnScene;
        this._replayPreserveValues = new Set(cfg.replayPreserveValues ?? []);
        this._notifySubject = cfg.notifySubject ?? null;
        this._state = this._loadState();
        return this;
    }

    /**
     * The game-facing state facade handed to game-authored callbacks (change
     * subscribers, cast guards). The engine forwards it without knowing its
     * domain methods. Falls back to the Store itself when unconfigured.
     * @returns {any}
     */
    get subject() {
        return this._notifySubject ?? this;
    }

    // ─── Live buckets (for the Game's GameState wrapper) ────────────────────
    /** @returns {Record<string, any>} */
    get values() {
        return this._state.values;
    }
    /** @returns {Record<string, Set<string>>} */
    get collections() {
        return this._state.collections;
    }
    /** @returns {Record<string, string>} */
    get items() {
        return this._state.items;
    }

    // ─── Persistence (internal) ─────────────────────────────────────────────
    /** A game fresh state with the engine-owned values/collections seeded under it. @returns {RunState} */
    _createFresh() {
        const fresh = this._createFreshState();
        fresh.values = { ...ENGINE_VALUE_DEFAULTS, inventoryCounts: {}, ...(fresh.values ?? {}) };
        fresh.collections = { ...engineCollectionDefaults(), ...(fresh.collections ?? {}) };
        fresh.items = fresh.items ?? {};
        return fresh;
    }

    /** @returns {RunState} */
    _loadState() {
        const fresh = this._createFresh();
        this._collectionNames = Object.keys(fresh.collections);
        let raw;
        try {
            if (typeof localStorage === "undefined") throw new Error("Storage is unavailable.");
            raw = localStorage.getItem(this._saveKey);
        } catch {
            // We cannot tell whether progress exists: don't overwrite it later
            // with this fresh state if storage suddenly becomes accessible.
            this._saveProtected = true;
            this._setSaveStatus(
                "unavailable",
                "load",
                "Progress could not be read. Reload to retry, or reset to start fresh.",
            );
            return fresh;
        }
        if (raw === null) {
            this._setSaveStatus("ready", "load");
            return fresh;
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
            if (!isSaveData(parsed)) throw new Error("Invalid save envelope.");
        } catch {
            this._saveProtected = true;
            this._setSaveStatus("invalid", "load", "Saved progress is unreadable and has been preserved.");
            return fresh;
        }
        const from = parsed.version ?? 0;
        if (from !== this._saveVersion) {
            try {
                if (from > this._saveVersion || !this._migrateSave) throw new Error("Unsupported version.");
                parsed = this._migrateSave(parsed, from, this._saveVersion);
                if (!isSaveData(parsed)) throw new Error("Migration returned invalid data.");
            } catch {
                this._saveProtected = true;
                this._setSaveStatus(
                    "incompatible",
                    "load",
                    `Save version ${from} cannot be loaded by version ${this._saveVersion}. The original is preserved.`,
                );
                return fresh;
            }
        }
        this._setSaveStatus("ready", "load");
        return this._hydrate(parsed, fresh);
    }

    /** @returns {Readonly<SaveStatus>} */
    get saveStatus() {
        return this._saveStatus;
    }

    /** Subscribe and immediately receive the current status. @param {(status: Readonly<SaveStatus>) => void} listener */
    onSaveStatusChange(listener) {
        this._saveStatusSubs.add(listener);
        listener(this._saveStatus);
        return () => {
            this._saveStatusSubs.delete(listener);
        };
    }

    /** @param {SaveStatus["state"]} state @param {SaveStatus["operation"]} operation @param {string} [message] */
    _setSaveStatus(state, operation, message) {
        if (
            state === this._saveStatus.state &&
            operation === this._saveStatus.operation &&
            message === this._saveStatus.message
        )
            return;
        this._saveStatus = Object.freeze({ state, operation, ...(message ? { message } : {}) });
        for (const listener of this._saveStatusSubs) listener(this._saveStatus);
    }

    /** Retry a failed write. Protected unreadable/incompatible saves require explicit reset first. @returns {boolean} */
    save() {
        return this._saveState();
    }

    /**
     * Merge a parsed save over a fresh state: values shallow-merged, named
     * collections rebuilt as Sets, items copied.
     * @param {any} parsed @param {RunState} fresh @returns {RunState}
     */
    _hydrate(parsed, fresh) {
        /** @type {Record<string, Set<string>>} */
        const collections = {};
        for (const name of this._collectionNames) {
            const arr = parsed.collections?.[name];
            collections[name] = Array.isArray(arr) ? new Set(arr) : new Set(fresh.collections[name]);
        }
        return {
            values: { ...fresh.values, ...parsed.values },
            collections,
            items: { ...fresh.items, ...(parsed.items ?? {}) },
        };
    }

    /** Serialize and persist. Replay and protected saves never write. @returns {boolean} */
    _saveState() {
        if (this._replaying || this._saveProtected) return false;
        try {
            if (typeof localStorage === "undefined") throw new Error("Storage is unavailable.");
            /** @type {Record<string, string[]>} */
            const collections = {};
            for (const [k, v] of Object.entries(this._state.collections)) collections[k] = [...v];
            localStorage.setItem(
                this._saveKey,
                JSON.stringify({
                    version: this._saveVersion,
                    values: this._state.values,
                    collections,
                    items: this._state.items,
                }),
            );
        } catch {
            this._setSaveStatus(
                "unavailable",
                "save",
                "Progress is only in memory. Retry saving before closing this page.",
            );
            return false;
        }
        this._setSaveStatus("saved", "save");
        return true;
    }

    /** @param {RunState} s @returns {RunState} deep-ish clone (Sets rebuilt). */
    _cloneState(s) {
        /** @type {Record<string, Set<string>>} */
        const collections = {};
        for (const [k, v] of Object.entries(s.collections)) collections[k] = new Set(v);
        return { values: structuredClone(s.values), collections, items: structuredClone(s.items) };
    }

    // ─── Change events + batching ───────────────────────────────────────────
    /** @param {(subject: any) => void} func @returns {() => void} unsubscribe */
    onChange(func) {
        this._changeSubs.push(func);
        return () => this.offChange(func);
    }

    /** @param {(subject: any) => void} func */
    offChange(func) {
        const idx = this._changeSubs.indexOf(func);
        if (idx !== -1) this._changeSubs.splice(idx, 1);
    }

    handleChange() {
        if (this._suspend > 0) {
            this._dirty = true;
            return;
        }
        this._saveState();
        const subject = this._notifySubject ?? this;
        for (const func of this._changeSubs) func(subject);
    }

    /**
     * Run several mutations as one change: subscribers + save fire once at the
     * end (if anything changed). Nestable.
     * @param {() => void} fn
     */
    batch(fn) {
        this._suspend++;
        try {
            fn();
        } finally {
            this._suspend--;
            if (this._suspend === 0 && this._dirty) {
                this._dirty = false;
                this.handleChange();
            }
        }
    }

    // ─── Values ─────────────────────────────────────────────────────────────
    /** @param {string} key */
    _alias(key) {
        return this._aliases[key] ?? key;
    }

    /** @param {string} key @returns {any} */
    get(key) {
        return this._state.values[this._alias(key)];
    }

    /** @param {string} key @param {any} value */
    set(key, value) {
        const target = this._alias(key);
        const current = this._state.values[target];
        // Primitive dedupe only — object/array writes always re-fire.
        if (current === value && (typeof value !== "object" || value === null)) return;
        this._state.values[target] = value;
        this.handleChange();
    }

    // ─── Collections (named Sets) ───────────────────────────────────────────
    /** @param {string} name @returns {boolean} */
    isCollection(name) {
        return name in this._state.collections;
    }

    /** @param {string} name @param {string} id @returns {boolean} */
    has(name, id) {
        const c = this._state.collections[name];
        return !!c && c.has(id);
    }

    /** @param {string} name @returns {number} */
    size(name) {
        return this._state.collections[name]?.size ?? 0;
    }

    /** Legacy spelling. @param {string} name */
    collectionSize(name) {
        return this.size(name);
    }

    /** @param {string} name @returns {string[]} */
    list(name) {
        const c = this._state.collections[name];
        return c ? [...c] : [];
    }

    /** @param {string} name @param {string} id */
    addTo(name, id) {
        const c = this._state.collections[name];
        if (!c || c.has(id)) return;
        c.add(id);
        this.handleChange();
    }

    /** @param {string} name @param {string} id */
    removeFrom(name, id) {
        const c = this._state.collections[name];
        if (!c || !c.has(id)) return;
        c.delete(id);
        this.handleChange();
    }

    /** @param {string} name */
    clear(name) {
        const c = this._state.collections[name];
        if (!c || c.size === 0) return;
        c.clear();
        this.handleChange();
    }

    // ─── Per-item visual state ──────────────────────────────────────────────
    /** @param {string} id @returns {string | undefined} */
    getItemState(id) {
        return this._state.items[id];
    }

    /** @param {string} id @param {string} value */
    setItemState(id, value) {
        if (this._state.items[id] === value) return;
        this._state.items[id] = value;
        this.handleChange();
    }

    // ─── Inventory (stackable: counts in values.inventoryCounts) ────────────
    /** @param {string} id @param {number} [n] */
    addToInventory(id, n = 1) {
        const inv = this._state.collections.inventory;
        if (!inv) return;
        const counts = this._state.values.inventoryCounts;
        const wasPresent = inv.has(id);
        const existing = counts[id];
        inv.add(id);
        if (existing !== undefined) counts[id] = existing + n;
        else if (wasPresent) counts[id] = 1 + n;
        else if (n > 1) counts[id] = n;
        this.handleChange();
    }

    /** @param {string} id */
    removeFromInventory(id) {
        const inv = this._state.collections.inventory;
        if (!inv) return;
        const counts = this._state.values.inventoryCounts;
        const had = inv.has(id);
        const hadCount = id in counts;
        if (!had && !hadCount) return;
        inv.delete(id);
        delete counts[id];
        this.handleChange();
    }

    /** Consume one of a stack; last copy drops membership. @param {string} id */
    decrementInventory(id) {
        const inv = this._state.collections.inventory;
        if (!inv) return;
        const counts = this._state.values.inventoryCounts;
        const count = counts[id];
        if (count === undefined || count <= 1) {
            inv.delete(id);
            delete counts[id];
        } else {
            counts[id] = count - 1;
        }
        this.handleChange();
    }

    /** @param {string} id @returns {number} */
    getInventoryCount(id) {
        const inv = this._state.collections.inventory;
        const counts = this._state.values.inventoryCounts ?? {};
        return counts[id] ?? (inv && inv.has(id) ? 1 : 0);
    }

    // ─── Replay sandbox ─────────────────────────────────────────────────────
    /** @param {{ returnScene?: string }} [opts] */
    beginReplay(opts = {}) {
        if (this._replaying) return;
        this._replaySnapshot = this._cloneState(this._state);
        this._replayReturnScene = opts.returnScene || this._defaultReplayReturnScene;
        this._replaying = true;
    }

    /** @returns {boolean} */
    isReplaying() {
        return this._replaying;
    }

    /** @returns {string} */
    getReplayReturnScene() {
        return this._replayReturnScene;
    }

    /** End the sandbox: restore the snapshot and persist once. */
    endReplay() {
        if (!this._replaying) return;
        this._replaying = false;
        if (this._replaySnapshot) {
            for (const key of this._replayPreserveValues) {
                if (Object.hasOwn(this._state.values, key)) {
                    this._replaySnapshot.values[key] = this._state.values[key];
                }
            }
            this._state = this._replaySnapshot;
        }
        this._replaySnapshot = null;
        this.handleChange();
    }

    // ─── Save / scene resume / lifecycle ────────────────────────────────────
    /** @returns {boolean} */
    hasSave() {
        try {
            if (typeof localStorage === "undefined") return false;
            return localStorage.getItem(this._saveKey) !== null;
        } catch {
            return false;
        }
    }

    /** @param {string} sceneKey */
    setCurrentScene(sceneKey) {
        if (!sceneKey || this._state.values.currentScene === sceneKey) return;
        this._state.values.currentScene = sceneKey;
        this._saveState();
    }

    /** @returns {string} */
    getCurrentScene() {
        return this._state.values.currentScene;
    }

    // ─── Time of day (engine-reserved) ──────────────────────────────────────
    /** @returns {"day" | "night"} */
    getTimeOfDay() {
        return this._state.values.timeOfDay;
    }

    /** @param {"day" | "night"} value */
    setTimeOfDay(value) {
        this.set("timeOfDay", value);
    }

    /** @returns {boolean} */
    isNight() {
        return this._state.values.timeOfDay === "night";
    }

    // ─── Outfits (per-character, ADR 0006) ──────────────────────────────────
    /** @param {string} id @returns {string | undefined} active outfit id, or undefined → base look. */
    getOutfit(id) {
        return this._state.values[`${id}Outfit`];
    }

    /** @param {string} id @param {string} name */
    setOutfit(id, name) {
        this.set(`${id}Outfit`, name);
    }

    // ─── Active character (engine-canonical key: `activeCharacter`) ──────────
    /** @returns {string | undefined} the active character's id. */
    getActiveCharacter() {
        return this._state.values.activeCharacter;
    }

    /** @param {string} id */
    setActiveCharacter(id) {
        this.set("activeCharacter", id);
    }

    /** @param {string} id @returns {boolean} */
    isActiveCharacter(id) {
        return this._state.values.activeCharacter === id;
    }

    /** Reset to a fresh state and notify. */
    reset() {
        this._saveProtected = false;
        this._replaying = false;
        this._replaySnapshot = null;
        this._state = this._createFresh();
        this.handleChange();
    }

    /** Replace the whole state without notifying (caller fires). Engine-owned
     * keys/collections are re-seeded if the replacement omits them. @param {RunState} s */
    replaceState(s) {
        s.values = { ...ENGINE_VALUE_DEFAULTS, inventoryCounts: {}, ...(s.values ?? {}) };
        s.collections = { ...engineCollectionDefaults(), ...(s.collections ?? {}) };
        s.items = s.items ?? {};
        this._state = s;
    }

    /**
     * DEBUG. Force-load a parsed save shape over a fresh state, then notify.
     * @param {any} parsed
     */
    loadSaveData(parsed) {
        if (!isSaveData(parsed)) return;
        this._saveProtected = false;
        this._state = this._hydrate(parsed, this._createFresh());
        this.handleChange();
    }
}

/** Engine-owned singleton. Engine modules import this; the Game configures it. */
export const store = new Store();
