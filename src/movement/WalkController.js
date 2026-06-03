import Phaser from "phaser";
import { computePerspectiveScale } from "../core/perspective.js";
import { findPath, snapToPolygon } from "./pathfinding.js";
import { DialogueBubble } from "../cutscene/DialogueBubble.js";
import { WearableManager } from "../characters/Wearables.js";
import { store } from "../state/Store.js";
import { characters } from "../characters/CharacterRegistry.js";

/** @typedef {Object} Point
 * @property {number} x
 * @property {number} y */
/** @typedef {"up" | "down" | "left" | "right"} Facing */
/** @typedef {"front" | "back" | "side"} Direction */
/** @typedef {"walk" | "still" | "fidget" | "reach"} MotionState */

/**
 * @typedef {object} WalkControllerOpts
 * @property {string} spriteKey
 * @property {{ x: number, y: number }} startPosition
 * @property {{ x: number, y: number }[]} walkable
 * @property {number} [walkSpeed]
 * @property {number} [spriteScale]
 * @property {Partial<Record<Direction, { still?: string, idle?: string, walk?: string, reach?: string }>>} [animationSet]
 * @property {Record<string, number>} [animationScales]
 * @property {Record<string, { x?: number, y?: number }>} [animationOrigins]
 * @property {number} [fidgetIntervalMs]
 * @property {import("../core/perspective.js").PerspectiveConfig | null} [perspective]
 * @property {boolean} [nonControllable] - if true, skip scene.input click listeners
 * @property {Facing} [initialFacing] - optional facing direction on spawn
 * @property {string} [characterId] - character name for wearable offset lookup
 */

/**
 * Per-direction animation entries:
 *   - `still`: TEXTURE key shown when the character is stationary.
 *   - `idle`:  ANIMATION key played as an occasional fidget while stationary.
 *              Should be registered with `repeat: 0` so it plays once and stops.
 *   - `walk`:  ANIMATION key looped while the character is moving.
 *   - `reach`: ANIMATION key played ONCE during an action like picking up
 *              an object. Fired explicitly via `playReach(onComplete)` — never
 *              auto-plays. Should be registered with `repeat: 0`.
 *
 * Fallback chain when something's missing: walk → still → idle; idle → still; still → idle.
 *
 * @typedef {Partial<Record<Direction, { still?: string, idle?: string, walk?: string, reach?: string }>>} AnimationSet
 */

/**
 * Owns the active character sprite. Click anywhere walkable → The character walks there.
 * Click a Hotspot → The character walks to its `approachPoint`, then the scene receives
 * `hotspot:arrived`.
 *
 * Three motion states drive what's displayed:
 *   - `walk`   — tween active, plays the direction's walk animation.
 *   - `still`  — stationary, shows the direction's still texture.
 *   - `fidget` — stationary, plays the direction's idle animation ONCE, then
 *                returns to `still`. Fidget fires every `fidgetIntervalMs`
 *                while still; cancels the moment motion starts.
 *
 * No pathfinding — walks are linear interpolations. Off-polygon clicks snap to
 * the nearest polygon edge.
 */
export class WalkController {
    /**
     * @param {import("phaser").Scene} scene
     * @param {object} opts
     * @param {string} opts.spriteKey - texture key used as the initial display and as the ultimate fallback
     * @param {Point} opts.startPosition
     * @param {Point[]} opts.walkable
     * @param {number} [opts.walkSpeed] - pixels/sec
     * @param {number} [opts.spriteScale]
     * @param {AnimationSet} [opts.animationSet]
     * @param {Record<string, number>} [opts.animationScales] - per-key scale multiplier
     *   applied on top of `spriteScale`. Compensates for source frames whose
     *   transparent margins differ from one anim to another.
     * @param {Record<string, { x?: number, y?: number }>} [opts.animationOrigins] -
     *   per-key origin override (0..1 fraction of the source frame). Default origin
     *   is (0.5, 1.0) — center-bottom of frame.
     * @param {number} [opts.fidgetIntervalMs] - delay between fidgets when stationary. Default 6000.
     * @param {string} [opts.characterId] - character name for wearable offset lookup.
     * @param {import("../core/perspective.js").PerspectiveConfig} [opts.perspective] -
     *   when provided, the sprite is y-sorted (depth = sprite.y) and scaled
     *   by Y so characters higher up the screen look smaller / farther away.
     */
    constructor(scene, /** @type {WalkControllerOpts} */ opts) {
        this.scene = scene;
        this.walkable = opts.walkable;
        this.walkSpeed = opts.walkSpeed ?? 240;
        this.defaultKey = opts.spriteKey;
        this.animationSet = opts.animationSet ?? {};
        this.animationScales = opts.animationScales ?? {};
        this.animationOrigins = opts.animationOrigins ?? {};
        this.baseScale = opts.spriteScale ?? 1;
        this.fidgetIntervalMs = opts.fidgetIntervalMs ?? 6000;
        this.perspective = opts.perspective ?? null;
        this.yScale = computePerspectiveScale(this.perspective, opts.startPosition.y);
        /** @type {Direction} */
        this.currentDirection = "front";
        this.facingLeft = false;

        if (opts.initialFacing) {
            if (opts.initialFacing === "up") {
                this.currentDirection = "back";
            } else if (opts.initialFacing === "down") {
                this.currentDirection = "front";
            } else if (opts.initialFacing === "left") {
                this.currentDirection = "side";
                this.facingLeft = true;
            } else if (opts.initialFacing === "right") {
                this.currentDirection = "side";
                this.facingLeft = false;
            }
        }

        /** @type {MotionState} */
        this.currentState = "still";

        this.sprite = scene.add.sprite(opts.startPosition.x, opts.startPosition.y, opts.spriteKey)
            .setOrigin(0.5, 1)
            .setDepth(this.perspective ? opts.startPosition.y : 10);
        this.sprite.setData("nightActor", true);

        // Character id: passed explicitly by the spawn, else the active
        // character from the store. The engine knows no character names.
        this.characterId = opts.characterId ?? store.getActiveCharacter?.() ?? "";

        // Tall speakers (flagged on the character registration) anchor their
        // thought bubbles higher/wider — mirrors NPC; read by DialogueBubble.
        if (characters.get(this.characterId)?.largeBubble) this.sprite.setData("bubbleLarge", true);

        /** @type {Phaser.Tweens.Tween | null} */
        this.currentTween = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.fidgetTimer = null;
        /** @type {(() => void) | null} */
        this.pendingReachHandler = null;
        /** When true, walkTo is a no-op — used by puzzles that need the character
         * frozen (e.g. ClosetPuzzle parks her in the middle of the room while
         * the player sorts clothes). */
        this.locked = false;

        // Wearable manager — auto-reconciles persistent items (e.g. a held item).
        this.wearables = new WearableManager(scene, () => ({
            characterId: this.characterId,
            direction: this.currentDirection,
            facingLeft: this.facingLeft,
            baseScale: this.baseScale,
            yScale: this.yScale,
            depth: this.sprite.depth,
            sprite: this.sprite,
        }));

        this.applyAnimation();
        this.scheduleFidget();

        // Keep bound references so we can detach on shutdown. Phaser clears
        // scene.input listeners automatically, but scene.events listeners
        // survive scene restarts — without cleanup, the OLD walker's handler
        // keeps firing on the NEW scene, hits its destroyed sprite, and the
        // thrown error propagates through EventEmitter3, swallowing the NEW
        // walker's response. End result: hotspots feel "locked."
        if (!opts.nonControllable) {
            this._onPointerDown = (/** @type {Phaser.Input.Pointer} */ pointer) => this.handleSceneClick(pointer);
            this._onHotspotClick = (/** @type {import("../interaction/HotspotManager.js").HotspotConfig} */ hotspot) =>
                this.walkToHotspot(hotspot);

            scene.input.on("pointerdown", this._onPointerDown);
            /** @type {any} */ (scene).bus.on("hotspot:click", this._onHotspotClick);
        }

        this._onUpdate = () => this.updatePerFrame();
        scene.events.on("update", this._onUpdate);

        scene.events.once("shutdown", () => this.shutdown());
    }

    /** Y-sort depth + Y-based scale, recomputed every frame while moving. */
    updatePerFrame() {
        if (!this.sprite || !this.sprite.active) return;

        if (this.perspective) {
            this.sprite.setDepth(this.sprite.y);
            const next = computePerspectiveScale(this.perspective, this.sprite.y);
            if (Math.abs(next - this.yScale) > 0.001) {
                this.yScale = next;
                this.applyAnimation();
            }
        }

        // Sync wearable sprites every frame.
        if (this.wearables) this.wearables.sync();
    }

    /** Detach listeners + stop in-flight tweens/timers when the scene shuts down. */
    /**
     * Shortcut for showing a thought bubble over the active character that auto-
     * follows the sprite. Mirrors NPC.speak so any character — active or
     * NPC — can speak the same way.
     *
     * @param {string | import("../cutscene/DialogueBubble.js").DialogueBubbleOpts} textOrOpts
     * @param {number} [holdMs]
     * @returns {DialogueBubble | null}
     */
    speak(textOrOpts, holdMs = 2800) {
        if (!this.sprite) return null;
        const opts = typeof textOrOpts === "string"
            ? { character: this.sprite, text: textOrOpts, autoDestroyMs: Math.max(800, holdMs - 200) }
            : { ...textOrOpts, character: this.sprite };
        return DialogueBubble.show(this.scene, opts);
    }

    shutdown() {
        if (this._onHotspotClick) {
            /** @type {any} */ (this.scene).bus.off("hotspot:click", this._onHotspotClick);
        }
        if (this._onUpdate) {
            this.scene.events.off("update", this._onUpdate);
            this._onUpdate = null;
        }
        // scene.input is already torn down by Phaser by the time SHUTDOWN
        // fires, so off() is just defensive.
        if (this._onPointerDown) {
            this.scene.input?.off?.("pointerdown", this._onPointerDown);
        }
        if (this.currentTween) {
            this.currentTween.stop();
            this.currentTween = null;
        }
        this.clearFidget();
        this.cancelReach();

        if (this.wearables) {
            this.wearables.destroy();
            this.wearables = null;
        }
    }

    /** @param {Phaser.Input.Pointer} pointer */
    handleSceneClick(pointer) {
        const hit = this.scene.input.hitTestPointer(pointer);
        if (hit && hit.length > 0) return;
        const target = this.snapToWalkable({ x: pointer.worldX, y: pointer.worldY });
        this.walkTo(target);
    }

    /**
     * @param {Point} target
     * @param {() => void} [onArrive]
     * @param {{ direct?: boolean }} [opts] - `direct`: move straight to the
     *   target without polygon routing (for area-rect roamers, e.g. the
     *   inactive sibling strolling a shore strip outside the walkable).
     */
    walkTo(target, onArrive, opts = {}) {
        if (this.locked) return;

        this.clearFidget();
        this.cancelReach();
        if (this.currentTween) this.currentTween.stop();

        const dist = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, target.x, target.y);

        // Already standing at the target — skip the tween (and the brief
        // direction-flicker it would cause, since the min 50ms duration would
        // otherwise show her facing toward the click for a few frames before
        // the hotspot's facing is applied).
        if (dist < 4) {
            if (onArrive) onArrive();
            return;
        }

        if (opts.direct) {
            this.walkPath([target], 0, onArrive);
            return;
        }

        // Route around polygon obstacles (e.g. the tree house body) instead
        // of cutting a straight line through them. Hotspot approach points
        // sometimes sit just outside the walkable strip (so the character ends
        // up flush against a wall/door); pathfind to the in-polygon snap of
        // the target, then take a final leg out to the actual approach point.
        //
        // Snap *start* too — the character may be standing at an approach
        // point outside the polygon (e.g. stairs exit at x=220 when the
        // polygon left edge is x=260). Without the snap, findPath receives
        // an outside start, its visibility graph disconnects, and it falls
        // back to a straight diagonal through unwalkable space.
        const rawStart = { x: this.sprite.x, y: this.sprite.y };
        const start = snapToPolygon(rawStart, this.walkable);
        const polyTarget = snapToPolygon(target, this.walkable);
        const path = findPath(start, polyTarget, this.walkable);
        if (polyTarget.x !== target.x || polyTarget.y !== target.y) {
            path.push(target);
        }
        // If the sprite is outside the polygon, walk to the boundary first.
        if (start.x !== rawStart.x || start.y !== rawStart.y) {
            path.unshift(start);
        }
        this.walkPath(path, 0, onArrive);
    }

    /**
     * Walk a precomputed sequence of waypoints, one tween per leg. Direction
     * and animation update at each leg so the character turns at corners.
     *
     * @param {Point[]} path
     * @param {number} index
     * @param {(() => void) | undefined} onArrive
     */
    walkPath(path, index, onArrive) {
        if (this.locked) return;
        if (index >= path.length) {
            this.enterStill();
            if (onArrive) onArrive();
            return;
        }
        const target = path[index];
        const dx = target.x - this.sprite.x;
        const dy = target.y - this.sprite.y;
        const dist = Phaser.Math.Distance.Between(this.sprite.x, this.sprite.y, target.x, target.y);

        // Skip degenerate legs (e.g. start happens to coincide with first node).
        if (dist < 1) {
            this.walkPath(path, index + 1, onArrive);
            return;
        }

        this.currentDirection = directionFromVector(dx, dy);
        if (this.currentDirection === "side") this.facingLeft = dx < 0;
        this.currentState = "walk";
        this.applyAnimation();

        const duration = (dist / this.walkSpeed) * 1000;
        this.currentTween = this.scene.tweens.add({
            targets: this.sprite,
            x: target.x,
            y: target.y,
            duration,
            onComplete: () => {
                this.currentTween = null;
                this.walkPath(path, index + 1, onArrive);
            },
        });
    }

    /**
     * Cancel any in-flight walk and settle to the still pose. Satisfies the
     * `Walker` contract shared with `NPC` so behaviors can drive either.
     */
    stopWalking() {
        if (this.currentTween) {
            this.currentTween.stop();
            this.currentTween = null;
        }
        this.enterStill();
    }

    /** @param {import("../interaction/HotspotManager.js").HotspotConfig} hotspot */
    walkToHotspot(hotspot) {
        this.walkTo(hotspot.approachPoint, () => {
            this.applyFacing(hotspot.approachPoint.facing);
            /** @type {any} */ (this.scene).bus.emit("hotspot:arrived", hotspot);
        });
    }

    /**
     * Freeze the character — walkTo becomes a no-op until `unlock()` is called.
     * Cancels any in-flight tween, reach, or fidget so she settles immediately.
     */
    lock() {
        this.locked = true;
        if (this.currentTween) this.currentTween.stop();
        this.currentTween = null;
        this.clearFidget();
        this.cancelReach();
        this.enterStill();
    }

    unlock() {
        this.locked = false;
        this.scheduleFidget();
    }

    /**
     * Snap the character to a position (no walk animation) and optionally face
     * a direction. Used by puzzles to pose the character for the mini-game.
     * @param {Point} point
     * @param {Facing} [facing]
     */
    teleportTo(point, facing) {
        if (this.currentTween) this.currentTween.stop();
        this.currentTween = null;
        this.sprite.x = point.x;
        this.sprite.y = point.y;
        if (facing) this.applyFacing(facing);
        else this.enterStill();
    }

    /** @param {Facing} facing */
    applyFacing(facing) {
        if (facing === "up") {
            this.currentDirection = "back";
        } else if (facing === "down") {
            this.currentDirection = "front";
        } else if (facing === "left") {
            this.currentDirection = "side";
            this.facingLeft = true;
        } else if (facing === "right") {
            this.currentDirection = "side";
            this.facingLeft = false;
        }
        this.enterStill();
    }

    /** Enter stationary state, show still texture, restart fidget timer. */
    enterStill() {
        this.currentState = "still";
        this.applyAnimation();
        this.scheduleFidget();
    }

    scheduleFidget() {
        this.clearFidget();
        this.fidgetTimer = this.scene.time.delayedCall(this.fidgetIntervalMs, () => this.startFidget());
    }

    clearFidget() {
        if (this.fidgetTimer) {
            this.fidgetTimer.remove(false);
            this.fidgetTimer = null;
        }
    }

    /**
     * Play the reach animation for the current direction once, then return
     * to `still` and invoke `onComplete`. If no `reach` anim is registered
     * for this direction, `onComplete` fires synchronously so the caller
     * (e.g. a pickup) still happens.
     *
     * Interruptible — if `walkTo()` (or any state change away from `reach`)
     * fires before the animation completes, `onComplete` is NOT called.
     *
     * @param {(() => void) | null} [onComplete]
     */
    playReach(onComplete) {
        const dirSet = this.animationSet[this.currentDirection] ?? {};
        const reachKey = dirSet.reach;
        if (!reachKey || !this.scene.anims.exists(reachKey)) {
            if (onComplete) onComplete();
            return;
        }
        this.clearFidget();
        this.cancelReach();
        this.currentState = "reach";
        this.applyAnimation();

        const handler = () => {
            this.pendingReachHandler = null;
            if (this.currentState !== "reach") return; // interrupted
            this.enterStill();
            if (onComplete) onComplete();
        };
        this.pendingReachHandler = handler;
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, handler);
    }

    cancelReach() {
        if (this.pendingReachHandler) {
            this.sprite.off(Phaser.Animations.Events.ANIMATION_COMPLETE, this.pendingReachHandler);
            this.pendingReachHandler = null;
        }
    }

    startFidget() {
        if (this.currentState !== "still") return;
        const idleKey = this.animationSet[this.currentDirection]?.idle;
        if (!idleKey || !this.scene.anims.exists(idleKey)) {
            // No fidget available for this direction — just reschedule and stay still.
            this.scheduleFidget();
            return;
        }
        this.currentState = "fidget";
        this.applyAnimation();
        this.sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
            // Guard: motion may have started during the fidget.
            if (this.currentState === "fidget") this.enterStill();
        });
    }

    /** Pick & display the right asset for the current direction + state. */
    applyAnimation() {
        const dir = this.currentDirection;
        const dirSet = this.animationSet[dir] ?? {};
        let key;
        let isAnim;
        if (this.currentState === "walk") {
            key = dirSet.walk ?? dirSet.still ?? dirSet.idle ?? this.defaultKey;
            isAnim = key === dirSet.walk || key === dirSet.idle;
        } else if (this.currentState === "fidget") {
            key = dirSet.idle ?? dirSet.still ?? this.defaultKey;
            isAnim = key === dirSet.idle;
        } else if (this.currentState === "reach") {
            key = dirSet.reach ?? dirSet.still ?? this.defaultKey;
            isAnim = key === dirSet.reach;
        } else {
            // still
            key = dirSet.still ?? dirSet.idle ?? this.defaultKey;
            isAnim = key === dirSet.idle && key !== dirSet.still;
        }

        if (isAnim && this.scene.anims.exists(key)) {
            const current = this.sprite.anims.currentAnim?.key;
            if (current !== key || !this.sprite.anims.isPlaying) this.sprite.play(key);
        } else {
            // Static frame — explicitly use frame 0 so reusing a spritesheet
            // texture (e.g. side-still pointing at side-walk) shows the first
            // pose, not whatever frame the anim was paused on.
            this.sprite.anims.stop();
            this.sprite.setTexture(key, 0);
        }

        this.sprite.setFlipX(this.currentDirection === "side" && this.facingLeft);
        const scaleAdjust = (key && this.animationScales[key]) || 1;
        this.sprite.setScale(this.baseScale * scaleAdjust * this.yScale);
        const origin = (key && this.animationOrigins[key]) || {};
        this.sprite.setOrigin(origin.x ?? 0.5, origin.y ?? 1.0);

        // Sync wearable sprites after the host
        // sprite's flip/scale/origin have been updated.
        if (this.wearables) this.wearables.sync();
    }

    /** @param {Point} p @returns {Point} */
    snapToWalkable(p) {
        return snapToPolygon(p, this.walkable);
    }
}

/**
 * @param {number} dx @param {number} dy
 * @returns {Direction}
 */
function directionFromVector(dx, dy) {
    if (Math.abs(dx) > Math.abs(dy)) return "side";
    return dy < 0 ? "back" : "front";
}
