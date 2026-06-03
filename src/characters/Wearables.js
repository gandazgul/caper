import Phaser from "phaser";
import { store } from "../state/Store.js";
import { evaluateCondition } from "../core/conditions.js";

// ─── Type definitions (JSDoc) ─────────────────────────────────────────────

/**
 * Per-character offset for a single direction.
 * @typedef {object} WearableOffset
 * @property {number} x - horizontal offset from host sprite center
 * @property {number} y - vertical offset from host sprite feet
 * @property {number} [depthBias] - relative depth offset from host
 * @property {boolean} [flipWithFacing] - auto-flip based on host facingLeft
 * @property {boolean} [scaled] - whether x/y are multiplied by host scale (default true)
 */

/**
 * Character-specific offsets table.
 * @typedef {Record<string, Partial<Record<"front"|"back"|"side", WearableOffset>> | WearableOffset>} WearableOffsets
 */

/**
 * Anchor definition — a point projected from the sprite's origin+angle.
 * Used for line-attach points like rod tips.
 * @typedef {object} WearableAnchor
 * @property {number} [adjustX] - additional px offset in local sprite space
 * @property {number} [adjustY]
 */

/**
 * Resolver that returns a frame name based on host state.
 * @typedef {(hostState: WearableHostState) => string} FrameResolver
 */

/**
 * Wearable definition in the registry.
 * @typedef {object} WearableDef
 * @property {string} atlas - Phaser texture key
 * @property {string|FrameResolver} frame - static frame name or resolver function
 * @property {{ x: number, y: number }} [origin] - sprite origin (default 0.5, 0.5)
 * @property {number} [scale] - base scale (default 1)
 * @property {number} [angle] - rotation in degrees
 * @property {"persistent"|"manual"} mode
 * @property {*} [equippedWhen] - condition DSL for persistent wearables
 * @property {WearableOffsets} offsets - per-character per-direction offsets
 * @property {Record<string, WearableAnchor>} [anchors] - named anchor points
 * @property {{ absolute?: number, bias?: number }} [depth] - depth mode
 */

/**
 * Host state snapshot passed to sync.
 * @typedef {object} WearableHostState
 * @property {string} characterId - the host character's registry id.
 * @property {"front"|"back"|"side"} direction
 * @property {boolean} facingLeft
 * @property {number} baseScale
 * @property {number} yScale - perspective Y scale (1 if no perspective)
 * @property {number} depth - host sprite depth
 * @property {Phaser.GameObjects.Sprite} sprite - host sprite reference
 */

// ─── Registry ─────────────────────────────────────────────────────────────

export class WearableRegistry {
    constructor() {
        /** @type {Record<string, WearableDef>} */
        this._defs = {};
    }

    /**
     * @param {string} id
     * @param {WearableDef} def
     * @returns {this}
     */
    register(id, def) {
        this._defs[id] = def;
        return this;
    }

    /**
     * @param {Record<string, WearableDef>} defs
     * @returns {this}
     */
    registerAll(defs) {
        Object.assign(this._defs, defs);
        return this;
    }

    /**
     * @param {string} id
     * @returns {WearableDef | undefined}
     */
    get(id) {
        return this._defs[id];
    }

    /**
     * @returns {Record<string, WearableDef>}
     */
    getAll() {
        return this._defs;
    }
}

/** Engine-owned singleton. Game content registers items here at boot. */
export const wearables = new WearableRegistry();

/**
 * Resolve the effective offset for a given host state.
 * Returns a combined offset + depthBias + flipWithFacing.
 * @param {WearableDef} def
 * @param {WearableHostState} hostState
 * @returns {{ x: number, y: number, depthBias: number, flipWithFacing: boolean, scaled: boolean }}
 */
function resolveOffset(def, hostState) {
    const { characterId, direction } = hostState;
    const charOffsets = def.offsets[characterId];
    if (!charOffsets) {
        // No entry for this character — wearable is absent.
        return { x: 0, y: 0, depthBias: 0, flipWithFacing: false, scaled: true };
    }

    // Allow flat offset object (no direction key) for static NPCs
    /** @type {WearableOffset} */
    let offset;
    if (
        /** @type {WearableOffset} */ (charOffsets).x !== undefined && /** @type {WearableOffset} */
            (charOffsets).y !== undefined
    ) {
        offset = /** @type {WearableOffset} */ (charOffsets);
    } else {
        const dirMap = /** @type {Partial<Record<"front"|"back"|"side", WearableOffset>>} */ (charOffsets);
        // Fallback: if direction is not found, try "side" as default
        offset = dirMap[direction] ?? dirMap["side"] ?? { x: 0, y: 0 };
    }

    return {
        x: offset.x ?? 0,
        y: offset.y ?? 0,
        depthBias: offset.depthBias ?? 0,
        flipWithFacing: offset.flipWithFacing ?? false,
        scaled: offset.scaled ?? true,
    };
}

// ─── Wearable (one equipped sprite + its definition) ──────────────────────

export class Wearable {
    /**
     * @param {Phaser.Scene} scene
     * @param {string} id
     * @param {WearableDef} def
     * @param {WearableHostState} hostState
     */
    constructor(scene, id, def, hostState) {
        this.id = id;
        this.def = def;
        this.scene = scene;

        const resolvedFrame = typeof def.frame === "function" ? def.frame(hostState) : def.frame;
        this.sprite = scene.add.sprite(0, 0, def.atlas, resolvedFrame)
            .setOrigin(def.origin?.x ?? 0.5, def.origin?.y ?? 0.5)
            .setVisible(false);

        // Participate in NightLayer's generic actor pass.
        this.sprite.setData("nightActor", true);

        this.sync(hostState);
    }

    /**
     * Update position, frame, flip, depth, scale, angle based on host state.
     * @param {WearableHostState} hostState
     */
    sync(hostState) {
        const def = this.def;
        const { sprite } = this;
        if (!sprite || !sprite.active) return;

        const offset = resolveOffset(def, hostState);

        // Frame
        if (typeof def.frame === "function") {
            sprite.setTexture(def.atlas, def.frame(hostState));
        }

        // Scale: base scale * host baseScale * host yScale (perspective)
        const sc = (def.scale ?? 1) * hostState.baseScale * hostState.yScale;
        sprite.setScale(sc);

        // Position: offset * scale factor (unless scaled: false)
        const scaleFactor = (offset.scaled ?? true) ? hostState.baseScale * hostState.yScale : 1;
        // When flipWithFacing is true, the offset X sign flips with facing
        // so the wearable stays on the correct side (e.g. a back-worn item
        // stays behind the host as they turn around).
        const posX = hostState.sprite.x +
            (offset.flipWithFacing && hostState.facingLeft ? -offset.x : offset.x) * scaleFactor;
        sprite.setPosition(
            posX,
            hostState.sprite.y + offset.y * scaleFactor,
        );

        // Flip
        if (offset.flipWithFacing) {
            sprite.setFlipX(!hostState.facingLeft);
        } else {
            sprite.setFlipX(false);
        }

        // Depth
        if (def.depth?.absolute !== undefined) {
            sprite.setDepth(def.depth.absolute);
        } else {
            const bias = offset.depthBias ?? def.depth?.bias ?? 0;
            sprite.setDepth(hostState.depth + bias);
            // Also store as data so NightLayer can reorder correctly when it
            // re-depths night actors.
            sprite.setData("nightDepthBias", bias);
        }

        // Angle
        if (def.angle !== undefined) {
            sprite.setAngle(def.angle);
        }

        // Visibility is managed externally (by the manager)
    }

    /**
     * Get a named anchor point in world coordinates.
     * Projects from the sprite's display-space tip (origin (0,1)) rotated by
     * angle, then adds anchor-specific adjust offsets.
     * @param {string} name
     * @returns {{ x: number, y: number } | null}
     */
    getAnchor(name) {
        if (!this.sprite || !this.sprite.active) return null;
        const def = this.def;
        const anchor = def.anchors?.[name];
        if (!anchor) return null;

        // Project tip from the sprite's rotated display space.
        // With origin (0, 1), the tip of the rod along the sprite's local
        // X axis is at (displayWidth, -displayHeight) accounting for y-flip.
        const localX = this.sprite.displayWidth;
        const localY = -this.sprite.displayHeight;
        const rad = Phaser.Math.DegToRad(this.sprite.angle);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        return {
            x: this.sprite.x + localX * cos - localY * sin + (anchor.adjustX ?? 0),
            y: this.sprite.y + localX * sin + localY * cos + (anchor.adjustY ?? 0),
        };
    }

    /** Tear down the sprite. */
    destroy() {
        if (this.sprite) {
            this.sprite.destroy();
            this.sprite = null;
        }
    }
}

// ─── WearableManager ──────────────────────────────────────────────────────

/**
 * Owns a set of equipped Wearables for one host.
 * Reconcilation: on construction, persistent wearables whose `offsets` include
 * the host's characterId and whose `equippedWhen` passes are auto-equipped.
 * The same process re-runs on store changes.
 */
export class WearableManager {
    /**
     * @param {Phaser.Scene} scene
     * @param {() => WearableHostState} getStateFn - function returning the
     *   current host state snapshot. Called each sync/equip/reconcile pass.
     */
    constructor(scene, getStateFn) {
        this.scene = scene;
        this._getState = getStateFn;
        /** @type {Map<string, Wearable>} */
        this._wearables = new Map();
        /** @type {(() => void) | null} */
        this._unsub = null;

        // Reconcile persistent wearables immediately.
        this._reconcilePersistent();

        // Listen for state changes so persistent wearables re-evaluate.
        this._unsub = store.onChange(() => this._reconcilePersistent());
    }

    /**
     * Sync all equipped wearables to the current host state.
     * Call from host's update/applyAnimation.
     */
    sync() {
        const hs = this._getState();
        for (const w of this._wearables.values()) {
            w.sync(hs);
        }
    }

    /**
     * Equip a wearable by id.
     * @param {string} id
     * @param {{ visible?: boolean }} [opts]
     * @returns {Wearable | null} the equipped wearable, or null if the id is
     *   unknown or the character has no offset for it.
     */
    equip(id, opts = {}) {
        if (this._wearables.has(id)) return this._wearables.get(id);

        const def = wearables.get(id);
        if (!def) return null;

        const hs = this._getState();

        // Check character has an offset entry
        const hasChar = def.offsets?.[hs.characterId];
        if (!hasChar) return null;

        const w = new Wearable(this.scene, id, def, hs);
        w.sprite.setVisible(opts.visible ?? true);
        this._wearables.set(id, w);
        return w;
    }

    /**
     * Unequip a wearable, destroying its sprite.
     * @param {string} id
     */
    unequip(id) {
        const w = this._wearables.get(id);
        if (w) {
            w.destroy();
            this._wearables.delete(id);
        }
    }

    /**
     * Get a named anchor from an equipped wearable.
     * @param {string} id
     * @param {string} anchorName
     * @returns {{ x: number, y: number } | null}
     */
    getAnchor(id, anchorName) {
        const w = this._wearables.get(id);
        if (!w) return null;
        return w.getAnchor(anchorName);
    }

    /** @param {string} id @returns {Wearable | undefined} */
    get(id) {
        return this._wearables.get(id);
    }

    /** Destroy all wearables + detach change listener. */
    destroy() {
        if (this._unsub) {
            this._unsub();
            this._unsub = null;
        }
        for (const w of this._wearables.values()) {
            w.destroy();
        }
        this._wearables.clear();
    }

    /**
     * Evaluate all persistent wearables: equip those whose `equippedWhen`
     * passes and whose offset includes the host character; unequip any
     * persistent wearable whose condition no longer holds.
     */
    _reconcilePersistent() {
        for (const [id, def] of Object.entries(wearables.getAll())) {
            if (def.mode !== "persistent") continue;

            const hs = this._getState();
            // Character must have an offset entry
            const hasChar = !!def.offsets?.[hs.characterId];
            if (!hasChar) {
                if (this._wearables.has(id)) this.unequip(id);
                continue;
            }

            const shouldShow = evaluateCondition(def.equippedWhen);
            const isEquipped = this._wearables.has(id);

            if (shouldShow && !isEquipped) {
                this.equip(id, { visible: true });
            } else if (!shouldShow && isEquipped) {
                this.unequip(id);
            }
        }
    }
}
