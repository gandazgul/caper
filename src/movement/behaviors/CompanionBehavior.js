import Phaser from "phaser";
import { snapToPolygon } from "../pathfinding.js";

/**
 * @typedef {object} CompanionOptions
 * @property {any} [target] - the thing to trail (defaults to `scene.walk`, the
 *   active character). Must expose `sprite`, `currentDirection`, `facingLeft`.
 * @property {(dir: "side" | "back" | "front") => { anim?: string | null, still: string }} animFor -
 *   resolve the walk-animation key (optional) + still-frame key for a facing
 *   direction.
 * @property {(dir: "side" | "back" | "front", target: any) => { x: number, y: number, flipX: boolean }} offset -
 *   per-direction trail offset behind the target + facing flip.
 * @property {(dist: number, isMoving: boolean) => number} [lerp] - smoothing
 *   factor each frame. Default: 0.12 moving (0.2 if far), 0.1 idle.
 * @property {number} [moveThreshold] - px past which the companion is "moving"
 *   (plays its walk anim). Default 15.
 * @property {number} [depthOffset] - drawn at `target.sprite.depth - depthOffset`.
 *   Default 1.
 * @property {(ctx: { dir: string, flipX: boolean, isMoving: boolean }) => void} [onFrame] -
 *   optional per-frame hook after the move (e.g. position a companion-held sprite).
 */

/**
 * Tight lockstep "conga line" trailing — the companion locks a fixed offset
 * behind a target each frame, matching its facing animation. Shared by
 * single-follower companions and multi-follower "train" formations (was
 * duplicated per-frame across game companion helpers).
 *
 * This is intentionally distinct from {@link import("./FollowBehavior.js").FollowBehavior},
 * which is a LOOSE trail (re-paths via walkTo on a timer). Companions move as a
 * locked unit; FollowBehavior ambles after you.
 */
export class CompanionBehavior {
    /**
     * @param {import("../../cast/NPC.js").NPC} npc
     * @param {CompanionOptions} opts
     */
    constructor(npc, opts) {
        this.npc = npc;
        /** @type {any} */
        this.scene = npc.scene;
        this.target = opts.target ?? this.scene.walk;
        this.animFor = opts.animFor;
        this.offset = opts.offset;
        this.lerpFn = opts.lerp ?? ((dist, moving) => (moving ? (dist > 150 ? 0.2 : 0.12) : 0.1));
        this.moveThreshold = opts.moveThreshold ?? 15;
        this.depthOffset = opts.depthOffset ?? 1;
        this.onFrame = opts.onFrame ?? null;

        const walkable = this.scene.sceneConfig?.walkable;
        this.walkable = walkable && walkable.length >= 3 ? walkable : null;

        this._onUpdate = () => this.tick();
        this.scene.events.on("update", this._onUpdate);
    }

    tick() {
        const npc = this.npc;
        const target = this.target;
        if (!npc.sprite || !npc.sprite.active) return;
        if (!target || !target.sprite || !target.sprite.active) return;

        const dir = target.currentDirection;
        const { anim, still } = this.animFor(dir);
        const { x: offsetX, y: offsetY, flipX } = this.offset(dir, target);

        // Aim for the offset-behind point, but keep it inside the walkable area
        // so the companion hugs the path's edge instead of cutting across
        // out-of-bounds terrain (e.g. the tree-house body / a pond).
        let targetX = target.sprite.x + offsetX;
        let targetY = target.sprite.y + offsetY;
        if (this.walkable) {
            const snapped = snapToPolygon({ x: targetX, y: targetY }, this.walkable);
            targetX = snapped.x;
            targetY = snapped.y;
        }
        const dist = Phaser.Math.Distance.Between(npc.sprite.x, npc.sprite.y, targetX, targetY);
        const isMoving = dist > this.moveThreshold;

        if (anim && isMoving) {
            if (!npc.sprite.anims.isPlaying || npc.sprite.anims.currentAnim?.key !== anim) {
                npc.sprite.play(anim);
            }
        } else {
            // Idle, or a stills-only companion: hold the still frame.
            if (npc.sprite.anims.isPlaying) npc.sprite.anims.stop();
            if (npc.sprite.texture.key !== still) {
                npc.sprite.anims.currentAnim = null;
                npc.setTexture(still, 0);
            }
        }

        npc.sprite.setFlipX(flipX);

        const t = this.lerpFn(dist, isMoving);
        npc.setPosition(
            npc.sprite.x + (targetX - npc.sprite.x) * t,
            npc.sprite.y + (targetY - npc.sprite.y) * t,
        );
        npc.sprite.setDepth(target.sprite.depth - this.depthOffset);

        if (this.onFrame) this.onFrame({ dir, flipX, isMoving });
    }

    destroy() {
        if (this._onUpdate) {
            this.scene.events.off("update", this._onUpdate);
            this._onUpdate = null;
        }
    }
}
