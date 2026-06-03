import { store } from "../state/Store.js";
import { transitionTo } from "../scene/transitions.js";
import { evaluateCondition } from "../core/conditions.js";
import { DialogueBubble } from "../cutscene/DialogueBubble.js";

/**
 * Declarative prop engine (see docs/adr/0002-declarative-prop-framework.md).
 *
 * A scene declares `sceneConfig.props: Prop[]`. Each prop is art + an ordered
 * list of `states`; the engine selects the first state whose `when` passes,
 * renders it, and - when that state has an `onClick`/`onDrop` and its optional
 * `activeWhen` holds - binds a hotspot. Everything re-evaluates reactively on
 * `store.onChange`, so effects only ever mutate state and props self-update.
 *
 * Click flow reuses the existing plumbing: a walk-approach interaction registers
 * a HotspotManager zone (click → WalkController walks → `hotspot:arrived` →
 * effects); an `approach: "in-place"` interaction binds the sprite directly with
 * no walk.
 *
 * @typedef {Record<string, any>} PropEffect - exactly one verb key per object.
 *
 * @typedef {object} PropState
 * @property {string} [notes] - editor comments for this state.
 * @property {import("../core/conditions.js").Condition} [when] - gate for this state.
 * @property {string} [frame] - atlas frame; omit for a pure interaction zone.
 * @property {string} [atlas] - overrides the prop's atlas for this state.
 * @property {string} [anim] - animation key to play.
 * @property {number} [x] @property {number} [y] @property {number} [depth]
 * @property {number} [scale] @property {number} [rotation] @property {boolean} [flipX]
 * @property {{ x?: number, y?: number }} [origin]
 * @property {PropEffect[]} [onClick]
 * @property {{ accepts: import("../core/conditions.js").Condition, effects: PropEffect[] }} [onDrop]
 * @property {import("../core/conditions.js").Condition} [activeWhen] - gate clickability separately from visibility.
 * @property {"pickup"|"look"|"exit"|"subscene"|"use-with"} [cursor]
 * @property {{ x: number, y: number, w: number, h: number }} [bounds] - explicit hotspot bounds.
 * @property {{ x: number, y: number, facing: string } | "in-place"} [approach]
 *
 * @typedef {object} Prop
 * @property {string} id
 * @property {string} [notes] - editor comments for this prop.
 * @property {string} [atlas]
 * @property {string} [anim] - default animation key to play.
 * @property {number} [x] @property {number} [y] @property {number} [depth]
 * @property {number} [scale] @property {number} [rotation] @property {boolean} [flipX]
 * @property {{ x?: number, y?: number }} [origin]
 * @property {{ x: number, y: number, w: number, h: number }} [bounds]
 * @property {{ x: number, y: number, facing: string } | "in-place"} [approach]
 * @property {"pickup"|"look"|"exit"|"subscene"|"use-with"} [cursor]
 * @property {string | string[]} [transitionsTo] - explicit scene(s) this prop transitions to, used for return-approach resolution when the transition is hidden behind an `emit`.
 * @property {PropState[]} states
 */

/** CSS cursors for the in-place click path (the walk path goes through HotspotManager). */
/** @type {Record<string, string>} */
const INPLACE_CURSORS = {
    pickup: "url('/objects/cursor_grab.png') 21 21, grab",
    "use-with": "url('/objects/cursor_grab.png') 21 21, grab",
    look: "url('/objects/cursor_look.png') 20 20, pointer",
    subscene: "url('/objects/cursor_point.png') 0 0, pointer",
};

export class PropEngine {
    /** @param {import("phaser").Scene} scene */
    constructor(scene) {
        // Cast to any: PropEngine leans on the AdventureScene-composed helpers
        // (hotspots, walk, inventory, subscenes) that aren't on Phaser.Scene.
        /** @type {any} */
        this.scene = scene;
        /** @type {Prop[]} */
        this.props = (/** @type {any} */ (scene).sceneConfig?.props) ?? [];
        /** Sprites are shared with the scene so the editor / subclasses can reach them. */
        /** @type {Map<string, import("phaser").GameObjects.Sprite>} */
        this.sprites = (/** @type {any} */ (scene)).propSprites;
        /** propId → the PropState whose hotspot zone is currently registered. */
        /** @type {Map<string, PropState>} */
        this.zoneState = new Map();
        /** propId → the currently-selected state (for arrival dispatch). */
        /** @type {Map<string, PropState | null>} */
        this.currentState = new Map();
        /** propIds with an in-flight effect tween - reconcile won't reposition them. */
        this.animating = new Set();
        /** propIds destroyed by an effect - reconcile won't recreate them until they
         * genuinely leave the rendered set (prevents a mid-fly re-spawn). */
        this.suppressed = new Set();
        this._reconciling = false;
        /** @type {(() => void) | null} */
        this._unsub = null;
        /**
         * propId → {bounds, approach, accepts, effects, prop, st} for every prop
         * whose currently-selected state has `onDrop`. Iterated on dragend to
         * find the topmost drop target under the pointer.
         * @type {Map<string, { prop: Prop, st: PropState, bounds: {x:number,y:number,w:number,h:number}, approach: any, accepts: any, effects: PropEffect[] }>}
         */
        this.dropTargets = new Map();
        /**
         * propIds whose sprite currently has the in-place pointerdown handler
         * attached. Tracked so a state transition from an in-place state to a
         * walk state can disable interactive + remove the listener — otherwise
         * the sprite would keep firing the new state's `onClick` immediately
         * (no walk) alongside the freshly-registered HotspotManager zone.
         * @type {Set<string>}
         */
        this.inPlaceSprites = new Set();
    }

    build() {
        /** @type {(h: any) => void} */
        this._onArrived = (/** @type {any} */ h) => this.handleArrived(h);
        this.scene.bus.on("hotspot:arrived", this._onArrived);
        this._unsub = store.onChange(() => this.reconcile());
        this.scene.events.once("shutdown", () => this.shutdown());

        // Drop plumbing — scene-level drag listeners. Phaser dispatches drag/
        // dragend events to every listener, so a scene with both a legacy
        // drag handler (a game's legacy drop targets) and a
        // declarative drop target can coexist; each handler claims its own
        // scope and snaps back only what it owns.
        /** @type {(p: any, obj: any, x: number, y: number) => void} */
        this._onDrag = (
            /** @type {any} */ _p,
            /** @type {any} */ obj,
            /** @type {number} */ x,
            /** @type {number} */ y,
        ) => this._handleDrag(obj, x, y);
        /** @type {(p: any, obj: any) => void} */
        this._onDragEnd = (/** @type {any} */ _p, /** @type {any} */ obj) => this._handleDragEnd(obj);
        this.scene.input.on("drag", this._onDrag);
        this.scene.input.on("dragend", this._onDragEnd);

        this.reconcile();
    }

    shutdown() {
        if (this._onArrived) this.scene.bus.off("hotspot:arrived", this._onArrived);
        if (this._onDrag) this.scene.input.off("drag", this._onDrag);
        if (this._onDragEnd) this.scene.input.off("dragend", this._onDragEnd);
        if (this._unsub) this._unsub();
        this._unsub = null;
    }

    /** @param {Prop} prop @returns {PropState | null} first state whose `when` passes. */
    selectState(prop) {
        for (const st of prop.states ?? []) {
            if (evaluateCondition(st.when ?? null, { selfId: prop.id })) return st;
        }
        return null;
    }

    /**
     * Add a prop at runtime. Use this for content whose identity isn't known
     * until scene-enter time (per-run randomly-rolled items, NPCs that spawn
     * conditionally, etc.). Triggers an immediate reconcile so the new prop
     * renders + arms its zone right away. No-op if a prop with this id is
     * already registered.
     *
     * @param {Prop} propConfig
     */
    addProp(propConfig) {
        if (this.props.some((p) => p.id === propConfig.id)) return;
        this.props.push(propConfig);
        this.reconcile();
    }

    /**
     * Remove a prop entirely — tears down its sprite, click zone, drop target,
     * and any tracked state (animating / suppressed / in-place). For the
     * common case where you just want the prop to stop rendering, change its
     * `when` instead so the engine handles it declaratively; this method is
     * for genuinely destroying a runtime-added prop.
     *
     * @param {string} propId
     */
    removeProp(propId) {
        const idx = this.props.findIndex((p) => p.id === propId);
        if (idx < 0) return;
        this.props.splice(idx, 1);
        this.removeSprite(propId);
        this.removeZone(propId);
        this.currentState.delete(propId);
        this.dropTargets.delete(propId);
        this.animating.delete(propId);
        this.suppressed.delete(propId);
    }

    /** Re-evaluate every prop: re-select state, re-render art, arm/disarm the zone. */
    reconcile() {
        if (this._reconciling) return; // guard against effect→onChange re-entry
        this._reconciling = true;
        try {
            // Drop targets are recomputed from scratch each pass. Click hotspots
            // are tracked across reconciles (zoneState skip-if-same-state) so
            // we don't churn the HotspotManager.
            this.dropTargets.clear();

            for (const prop of this.props) {
                const st = this.selectState(prop);
                this.currentState.set(prop.id, st);

                if (this.suppressed.has(prop.id)) {
                    // Stay hidden until the prop truly leaves the rendered set,
                    // then heal so it can render again on a future visit.
                    if (!st) {
                        this.suppressed.delete(prop.id);
                        this.removeSprite(prop.id);
                        this.removeZone(prop.id);
                    }
                    continue;
                }

                if (!st) {
                    this.removeSprite(prop.id);
                    this.removeZone(prop.id);
                    continue;
                }

                if (st.frame || st.anim || prop.anim) this.applySprite(prop, st);
                else this.removeSprite(prop.id);

                const activeWhenPasses = evaluateCondition(st.activeWhen ?? null, { selfId: prop.id });
                // Click hotspot — only when onClick is present. A drop-only
                // state must NOT register a click hotspot (which would show
                // a walk cursor with no behavior on arrival).
                if (st.onClick && activeWhenPasses) this.ensureZone(prop, st);
                else this.removeZone(prop.id);
                // Drop target — armed independently of the click hotspot, so
                // a prop can have both (look + use-with) or just one.
                if (st.onDrop && activeWhenPasses) this._addDropTarget(prop, st);
            }
        } finally {
            this._reconciling = false;
        }
        // After state has settled, mirror draggability onto the current
        // inventory sprites. The inventory layer also calls back into us via
        // `refreshInventoryDraggability` after its own refresh (post-effect
        // commit), so this just covers the initial / state-change path.
        this.refreshInventoryDraggability();
    }

    /** @param {Prop} prop @param {PropState} st */
    _addDropTarget(prop, st) {
        const approach = st.approach ?? prop.approach;
        const bounds = st.bounds ?? prop.bounds ?? this.deriveBounds(prop.id);
        if (!bounds) return; // pure-data state with no bounds and no sprite — nothing to hit-test
        this.dropTargets.set(prop.id, {
            prop,
            st,
            bounds,
            approach,
            accepts: st.onDrop?.accepts ?? null,
            effects: st.onDrop?.effects ?? [],
        });
    }

    /** @param {Prop} prop @param {PropState} st */
    applySprite(prop, st) {
        const atlas = st.atlas ?? prop.atlas;
        const x = st.x ?? prop.x ?? 0;
        const y = st.y ?? prop.y ?? 0;
        let sprite = this.sprites.get(prop.id);
        if (!sprite) {
            sprite = this.scene.add.sprite(x, y, /** @type {string} */ (atlas), st.frame);
            this.sprites.set(prop.id, sprite);
        } else {
            // Only set texture/frame if it has actually changed, to avoid resetting running animations.
            if (sprite.texture.key !== atlas || (!sprite.anims.isPlaying && sprite.frame.name !== st.frame)) {
                sprite.setTexture(/** @type {string} */ (atlas), st.frame);
            }
            // Don't fight an in-flight effect tween (e.g. the box-stack slide);
            // the destination state's x/y match where the tween lands.
            if (!this.animating.has(prop.id)) sprite.setPosition(x, y);
        }
        sprite
            .setOrigin(st.origin?.x ?? prop.origin?.x ?? 0.5, st.origin?.y ?? prop.origin?.y ?? 0.5)
            .setDepth(st.depth ?? prop.depth ?? 0)
            .setFlipX(st.flipX ?? prop.flipX ?? false)
            .setScale(st.scale ?? prop.scale ?? 1)
            .setAngle(st.rotation ?? prop.rotation ?? 0)
            .setVisible(true);

        const animKey = st.anim ?? prop.anim;
        if (animKey) {
            sprite.play(animKey, true);
        } else {
            sprite.stop();
        }
    }

    /** @param {string} id */
    removeSprite(id) {
        const s = this.sprites.get(id);
        if (s) {
            s.destroy();
            this.sprites.delete(id);
        }
        this.inPlaceSprites.delete(id);
    }

    /** @param {Prop} prop @param {PropState} st */
    ensureZone(prop, st) {
        const approach = st.approach ?? prop.approach;
        const sprite = this.sprites.get(prop.id);

        if (approach === "in-place") {
            this.removeZone(prop.id);
            if (!sprite) return;
            const cursor = INPLACE_CURSORS[st.cursor ?? prop.cursor ?? "look"];
            if (this.inPlaceSprites.has(prop.id)) {
                // Already wired — just keep the cursor in sync; the pointerdown
                // handler always reads the current state, so it's correct as-is.
                if (sprite.input) sprite.input.cursor = cursor;
            } else {
                sprite.setInteractive({ cursor });
                sprite.on("pointerdown", () => {
                    const cur = this.currentState.get(prop.id);
                    if (cur?.onClick) this.runEffects(cur.onClick, this.ctxFor(prop));
                });
                this.inPlaceSprites.add(prop.id);
            }
            return;
        }

        // Transitioning from an in-place state to a walk state: tear down the
        // sprite's pointerdown so it doesn't keep firing alongside the walk
        // zone (which now owns the click → walk → arrive → effects flow).
        if (this.inPlaceSprites.has(prop.id) && sprite) {
            sprite.removeAllListeners("pointerdown");
            sprite.disableInteractive();
            this.inPlaceSprites.delete(prop.id);
        }

        // Already registered for this exact state - skip the churn.
        if (this.zoneState.get(prop.id) === st) return;

        const bounds = st.bounds ?? prop.bounds ?? this.deriveBounds(prop.id);
        if (!bounds || !approach) return;

        const zoneId = `prop:${prop.id}`;
        this.scene.hotspots.unregister(zoneId);
        this.scene.hotspots.register({
            id: zoneId,
            type: /** @type {any} */ (st.cursor ?? prop.cursor ?? "look"),
            bounds,
            approachPoint: /** @type {any} */ (approach),
            data: { propId: prop.id },
        });
        this.zoneState.set(prop.id, st);
    }

    /** @param {string} id */
    removeZone(id) {
        if (this.zoneState.has(id)) {
            this.scene.hotspots.unregister(`prop:${id}`);
            this.zoneState.delete(id);
        }
    }

    /** @param {string} id @returns {{x:number,y:number,w:number,h:number} | null} */
    deriveBounds(id) {
        const s = this.sprites.get(id);
        if (!s) return null;
        const b = s.getBounds();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
    }

    /** @param {Prop} prop @param {string} [draggedId] */
    ctxFor(prop, draggedId) {
        return {
            prop,
            scene: this.scene,
            engine: /** @type {PropEngine} */ (this),
            sprite: this.sprites.get(prop.id) ?? null,
            /** @type {{x:number,y:number} | null} */
            lastPos: null,
            draggedId,
        };
    }

    /** @param {any} hotspot - fired via `hotspot:arrived`; only prop zones carry `data.propId`. */
    handleArrived(hotspot) {
        const propId = hotspot?.data?.propId;
        if (!propId) return;
        const prop = this.props.find((p) => p.id === propId);
        if (!prop) return;
        const st = this.currentState.get(propId) ?? this.selectState(prop);
        if (st?.onClick) this.runEffects(st.onClick, this.ctxFor(prop));
    }

    // ─── Drag / drop ────────────────────────────────────────────────────

    /**
     * Mirror the engine's "any prop currently has an active onDrop" gate onto
     * inventory sprites: when true, every slot sprite is draggable. The
     * `accepts` filter runs at dragend, so the player can attempt any item;
     * unaccepted drops just snap back. Called from `reconcile` and from
     * `AdventureScene.enableInventoryDrag` (which fires after each inventory
     * refresh, when slot sprites have been rebuilt from scratch).
     */
    refreshInventoryDraggability() {
        const inventory = this.scene.inventory;
        if (!inventory?.slotSprites) return;
        const enable = this.dropTargets.size > 0;
        for (const sprite of inventory.slotSprites) {
            if (!sprite.active) continue;
            if (enable) {
                // setInteractive is a no-op if already interactive; force the
                // drag flag (Phaser tracks it on input.draggable, not on the
                // base interactive state).
                sprite.setInteractive({
                    draggable: true,
                    cursor: "url('/objects/cursor_grab.png') 21 21, grab",
                });
            }
        }
    }

    /** @param {any} obj @param {number} x @param {number} y */
    _handleDrag(obj, x, y) {
        const inventory = this.scene.inventory;
        if (!inventory?.slotSprites?.includes?.(obj)) return;
        obj.x = x;
        obj.y = y;
        obj.setDepth(9010);
    }

    /** @param {any} obj */
    _handleDragEnd(obj) {
        const inventory = this.scene.inventory;
        if (!inventory?.slotSprites?.includes?.(obj)) return;
        const draggedId = /** @type {string} */ (obj.getData("toyId"));
        if (!draggedId) {
            this._snapBackInventory(obj);
            return;
        }

        // Iterate in prop-array order; first match wins. Hit-test uses the
        // pointer landing point (obj.x/y at dragend == release coords because
        // _handleDrag tracked it there).
        for (const dt of this.dropTargets.values()) {
            if (!pointInBounds(obj.x, obj.y, dt.bounds)) continue;
            const ctx = this.ctxFor(dt.prop, draggedId);
            if (!evaluateCondition(dt.accepts, { selfId: dt.prop.id, draggedId })) continue;
            // Snap the dragged sprite back to its slot while the character walks
            // — the actual inventory removal happens in the effect list
            // (`removeFrom: { inventory: "$dragged" }` is the convention).
            this._snapBackInventory(obj);
            this._commitDrop(dt, ctx);
            return;
        }

        // No accepting target → return to inventory.
        this._snapBackInventory(obj);
    }

    /**
     * Walk the active character to the drop target's approach, then run the
     * onDrop effects (commit-on-arrival). `approach: "in-place"` skips the
     * walk and commits immediately.
     *
     * @param {{ prop: Prop, st: PropState, approach: any, effects: PropEffect[] }} dt
     * @param {any} ctx
     */
    _commitDrop(dt, ctx) {
        const run = () => this.runEffects(dt.effects, ctx);
        if (dt.approach === "in-place" || !dt.approach) {
            run();
            return;
        }
        if (this.scene.walk?.walkTo) {
            this.scene.walk.walkTo(
                { x: dt.approach.x, y: dt.approach.y, facing: dt.approach.facing },
                run,
            );
        } else {
            run();
        }
    }

    /** Tween the inventory sprite back to its rest position. @param {any} obj */
    _snapBackInventory(obj) {
        const bx = obj.getData("baseX");
        const by = obj.getData("baseY");
        if (bx === undefined || by === undefined) return;
        this.scene.tweens.add({
            targets: obj,
            x: bx,
            y: by,
            duration: 220,
            ease: "Quad.easeOut",
            onComplete: () => obj.setDepth(9001),
        });
    }

    /**
     * Run an ordered effect list. Sequential - async verbs (reach, tween, fly)
     * complete before the next runs, so state mutations land only after the
     * walk/animation, keeping commit-on-arrival structural.
     * @param {PropEffect[]} list
     * @param {any} ctx
     */
    async runEffects(list, ctx) {
        for (const eff of list) {
            await this.runEffect(eff, ctx);
        }
    }

    /** @param {PropEffect} eff @param {any} ctx @returns {void | Promise<void>} */
    runEffect(eff, ctx) {
        const prop = ctx.prop;

        if (eff.playReach) {
            return new Promise((res) => {
                if (this.scene.walk?.playReach) this.scene.walk.playReach(res);
                else res();
            });
        }

        if (eff.set) {
            for (const [k, v] of Object.entries(eff.set)) store.set(k, resolve(v, ctx));
            return;
        }

        if (eff.setItemState) {
            for (const [id, s] of Object.entries(eff.setItemState)) {
                store.setItemState(resolve(id, ctx), /** @type {string} */ (s));
            }
            return;
        }

        if (eff.addTo !== undefined) {
            const pairs = normalizeColl(eff.addTo, ctx);
            for (const [coll, id] of pairs) {
                if (coll === "inventory") this.scene.inventory?.addItem(id);
                else store.addTo(coll, id);
            }
            return;
        }

        if (eff.removeFrom !== undefined) {
            const pairs = normalizeColl(eff.removeFrom, ctx);
            for (const [coll, id] of pairs) {
                if (coll === "inventory") {
                    store.removeFromInventory(id);
                    this.scene.inventory?.refresh();
                } else {
                    store.removeFrom(coll, id);
                }
            }
            return;
        }

        if (eff.tween) {
            const sprite = this.sprites.get(prop.id);
            if (!sprite) return;
            const t = eff.tween;
            const targetX = t.offset ? sprite.x + (t.offset.x ?? 0) : (t.x ?? sprite.x);
            const targetY = t.offset ? sprite.y + (t.offset.y ?? 0) : (t.y ?? sprite.y);
            /** @type {any} */
            const cfg = {
                targets: sprite,
                x: targetX,
                y: targetY,
                duration: t.duration ?? 300,
                ease: t.ease ?? "Power2",
            };
            if (t.angle !== undefined) cfg.angle = t.angle;
            if (t.scale !== undefined) cfg.scale = t.scale;
            this.animating.add(prop.id);
            return new Promise((res) => {
                cfg.onComplete = () => {
                    this.animating.delete(prop.id);
                    res();
                };
                this.scene.tweens.add(cfg);
            });
        }

        if (eff.destroy) {
            const sprite = this.sprites.get(prop.id);
            if (sprite) ctx.lastPos = { x: sprite.x, y: sprite.y };
            this.suppressed.add(prop.id);
            this.removeSprite(prop.id);
            this.removeZone(prop.id);
            return;
        }

        if (eff.pickup !== undefined) {
            const id = eff.pickup === true ? prop.id : resolve(eff.pickup.id ?? eff.pickup, ctx);
            return new Promise((res) => {
                const finishReach = () => {
                    const sprite = this.sprites.get(prop.id);
                    const from = sprite ?? this.scene.walk?.sprite ?? { x: 0, y: 0 };
                    if (sprite) ctx.lastPos = { x: sprite.x, y: sprite.y };
                    this.suppressed.add(prop.id);
                    this.removeSprite(prop.id);
                    this.removeZone(prop.id);
                    if (!this.scene.inventory) {
                        store.addToInventory(id);
                        res();
                        return;
                    }
                    this.scene.inventory.flyItemTo(id, from.x, from.y, () => {
                        this.scene.inventory.addItem(id);
                        res();
                    });
                };
                if (this.scene.walk?.playReach) {
                    this.scene.walk.playReach(finishReach);
                } else {
                    finishReach();
                }
            });
        }

        if (eff.goToScene) {
            if (typeof eff.goToScene === "string") {
                transitionTo(this.scene, eff.goToScene);
                return;
            }
            // Object form: `{ target, transition?, data? }`. `transition` is the
            // preset name; `data` becomes the next scene's `init(data)` payload
            // (e.g. an interior scene provides a custom startPosition when returning outside).
            const { target, transition, data } = eff.goToScene;
            transitionTo(this.scene, target, { preset: transition, data });
            return;
        }

        if (eff.pushSubscene) {
            const backgroundKey = typeof eff.pushSubscene === "string"
                ? eff.pushSubscene
                : eff.pushSubscene.backgroundKey;
            this.scene.subscenes?.push({ backgroundKey });
            return;
        }

        if (eff.showThought) {
            const o = eff.showThought;
            DialogueBubble.show(this.scene, {
                character: this.scene.walk?.sprite,
                text: o.text ?? "",
                icons: o.icons,
                autoDestroyMs: o.ms ?? 2800,
            });
            return;
        }

        if (eff.emit) {
            // Pass the prop as the first arg (unchanged for legacy handlers
            // that ignore it) and the full effect ctx as the second so drop
            // handlers can destructure { draggedId, prop, … } from it.
            this.scene.bus.emit(eff.emit, ctx.prop, ctx);
            return;
        }
    }
}

/**
 * Approach points of every prop whose top-level OR any state's cursor reads as
 * an exit. Used by autonomous NPC controllers and the idle character to "spawn
 * from an exit" and to keep wander waypoints clear of door zones. Skips
 * `"in-place"` props.
 *
 * @param {Prop[] | undefined} propsConfig
 * @returns {{ x: number, y: number, facing?: string }[]}
 */
export function exitApproaches(propsConfig) {
    /** @type {{ x: number, y: number, facing?: string }[]} */
    const out = [];
    for (const p of propsConfig ?? []) {
        const hasExitCursor = p.cursor === "exit" ||
            (p.states ?? []).some((st) => /** @type {any} */ (st).cursor === "exit");
        if (!hasExitCursor) continue;
        const approach = p.approach;
        if (!approach || approach === "in-place") continue;
        out.push(/** @type {{ x: number, y: number, facing?: string }} */ (approach));
    }
    return out;
}

/**
 * Resolve sentinel ids:
 *   - `"$self"`   → the prop's own id
 *   - `"$dragged"` → the inventory item being dropped (onDrop only)
 * Everything else passes through unchanged.
 * @param {any} value @param {any} ctx
 */
function resolve(value, ctx) {
    if (value === "$self") return ctx.prop.id;
    if (value === "$dragged") return ctx.draggedId;
    return value;
}

/**
 * Normalize an addTo/removeFrom argument into `[collection, id]` pairs.
 * A bare string is the collection name with the prop's own id as the member.
 * Object values resolve `$self` / `$dragged` per {@link resolve}.
 * @param {string | Record<string, string>} arg @param {any} ctx
 * @returns {[string, string][]}
 */
function normalizeColl(arg, ctx) {
    if (typeof arg === "string") return [[arg, ctx.prop.id]];
    return Object.entries(arg).map(([coll, id]) => [coll, resolve(id, ctx)]);
}

/** @param {number} x @param {number} y @param {{x:number,y:number,w:number,h:number}} b */
function pointInBounds(x, y, b) {
    return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}
