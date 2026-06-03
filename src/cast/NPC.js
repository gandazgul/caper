import Phaser from "phaser";
import { DialogueBubble } from "../cutscene/DialogueBubble.js";
import { attachFidget } from "../movement/Fidget.js";
import { WearableManager } from "../characters/Wearables.js";
import { store } from "../state/Store.js";
import { characters } from "../characters/CharacterRegistry.js";
import { computePerspectiveScale } from "../core/perspective.js";
import { findPath, pointInPolygon, snapToPolygon } from "../movement/pathfinding.js";
import { WanderBehavior } from "../movement/behaviors/WanderBehavior.js";
import { PatrolBehavior } from "../movement/behaviors/PatrolBehavior.js";
import { FollowBehavior } from "../movement/behaviors/FollowBehavior.js";
import { npcWanderHost } from "../movement/behaviors/walker.js";

/**
 * NPC represents a dynamic, non-player character in the world.
 * It manages their sprite, optional fidget idle animations, and registers a
 * dynamic hotspot zone that follows the character as they walk or relocate.
 */
export class NPC {
    /**
     * @param {import("../scene/EngineScene.js").EngineScene} scene
     * @param {object} config
     * @param {string} config.id - the NPC's id, e.g. "shopkeeper"
     * @param {string} config.name - Display name of the NPC
     * @param {number} config.x
     * @param {number} config.y
     * @param {string} config.texture
     * @param {string|number} [config.frame]
     * @param {number} [config.scale]
     * @param {number} [config.depth]
     * @param {{x: number, y: number}} [config.origin]
     * @param {{stillKey: string, idleAnimKey: string, intervalMs?: number}} [config.fidget]
     * @param {{x: number, y: number, facing: "up"|"down"|"left"|"right"}} [config.approachOffset] - relative to the sprite x, y
     * @param {{x: number, y: number, w: number, h: number}} [config.boundsOffset] - relative to the sprite x, y
     * @param {Record<string, { scale?: number, origin?: {x?: number, y?: number}, boundsOffset?: {x: number, y: number, w: number, h: number}, approachOffset?: {x: number, y: number, facing: "up"|"down"|"left"|"right"} }>} [config.animationOverrides] - overrides by animation key
     * @param {(npc: NPC) => void} [config.onClick] - override default click handler
     * @param {number} [config.walkSpeed] - px/sec for `walkTo` tweens. Default 80.
     * @param {string} [config.walkAnim] - animation key looped while walking. Defaults to `texture`.
     * @param {string} [config.stillFrame] - texture key shown (frame 0) when stationary. Defaults to `texture`.
     * @param {string[]} [config.chatter] - random lines spoken by the default click handler.
     */
    constructor(scene, config) {
        this.scene = scene;
        this.id = config.id;
        this.name = config.name;

        // Register this character's presence in the scene so wanderers can
        // avoid spawning a duplicate of a character that's already here (an
        // explicit NPC or an activity-loop copy). See `AdventureScene.hasCharacter`.
        const presence = (scene._npcPresence ??= new Map());
        presence.set(this.id, (presence.get(this.id) ?? 0) + 1);

        // Locomotion + chatter config (consumed by walkTo and the behaviors).
        this.walkSpeed = config.walkSpeed ?? 80;
        this.walkAnim = config.walkAnim ?? config.texture;
        this.stillFrame = config.stillFrame ?? config.texture;
        this.chatter = config.chatter ?? null;
        /** @type {Phaser.Tweens.Tween | null} */
        this._walkTween = null;
        /** @type {import("../movement/behaviors/WanderBehavior.js").WanderBehavior | import("../movement/behaviors/PatrolBehavior.js").PatrolBehavior | import("../movement/behaviors/FollowBehavior.js").FollowBehavior | null} */
        this._behavior = null;

        // Default offsets for a standard tall character sprite.
        this.approachOffset = config.approachOffset ?? { x: 90, y: -10, facing: "left" };
        this.boundsOffset = config.boundsOffset ?? { x: -50, y: -260, w: 100, h: 160 };
        this.onClickOverride = config.onClick;

        let finalScale = config.scale ?? 1.0;
        const sceneCfg = scene.sceneConfig;
        if (sceneCfg && sceneCfg.characterScales) {
            const override = sceneCfg.characterScales[this.id.toLowerCase()] ??
                sceneCfg.characterScales[this.id] ??
                sceneCfg.characterScales[this.name.toLowerCase()] ??
                sceneCfg.characterScales[this.name];
            if (override !== undefined) {
                finalScale = override;
            }
        }
        this.baseScale = finalScale;
        this.perspective = sceneCfg?.perspective ?? null;
        this.yScale = computePerspectiveScale(this.perspective, config.y);

        this.configScale = config.scale ?? 1.0;
        this.configOrigin = config.origin ?? { x: 0.5, y: 1.0 };
        this.animationOverrides = config.animationOverrides ?? {};

        this.sprite = scene.add.sprite(config.x, config.y, config.texture, config.frame ?? 0)
            .setDepth(this.perspective ? config.y : (config.depth ?? 0));
        // Mark as a night actor so NightLayer lifts + tints it after dark
        // (every NPC, whether Director-managed or ad-hoc).
        this.sprite.setData("nightActor", true);
        // Tall speakers (flagged on the character registration) anchor their
        // thought bubbles higher/wider — see DialogueBubble.
        if (characters.get(this.name)?.largeBubble) this.sprite.setData("bubbleLarge", true);

        this.updateScaleAndOrigin();

        if (config.fidget) {
            attachFidget(scene, this.sprite, config.fidget);
        }

        // Setup the initial hotspot config.
        /** @type {import("../interaction/HotspotManager.js").HotspotConfig} */
        this.hotspotConfig = {
            id: `${this.id}-character`,
            type: "look",
            bounds: this.getBounds(),
            approachPoint: this.getApproachPoint(),
            data: { npc: this },
        };

        // Register to HotspotManager
        scene.hotspots.register(this.hotspotConfig);

        // Update bounds and approach point every frame
        this.updateListener = () => this.update();
        scene.events.on("update", this.updateListener);

        // When the player clicks us, hold still so the active character can reach us
        // before the greeting — a moving NPC would otherwise drift away mid-walk.
        this._onSelfClick = (/** @type {import("../interaction/HotspotManager.js").HotspotConfig} */ config) => {
            if (config?.data?.npc === this) this._behavior?.holdForGreeting?.();
        };
        scene.bus?.on("hotspot:click", this._onSelfClick);

        // Auto clean up when scene shuts down
        scene.events.once("shutdown", () => this.destroy());
    }

    /**
     * The key used to look up per-animation scale/origin/bounds overrides: the
     * playing animation's key, or the static texture key when nothing is
     * playing. Must gate on `isPlaying` — Phaser's `anims.stop()` leaves
     * `currentAnim` set, so after a `setTexture()` to a still frame the stale
     * anim key would otherwise keep applying that animation's overrides (e.g.
     * the greeting swap from watering to the still walk frame kept watering's
     * scale multiplier, making the sprite "grow" on click).
     * @returns {string}
     */
    _overrideKey() {
        const playingKey = this.sprite.anims?.isPlaying ? this.sprite.anims.currentAnim?.key : null;
        return playingKey || this.sprite.texture.key;
    }

    /**
     * Resolve scale and origin overrides based on the currently playing animation.
     */
    updateScaleAndOrigin() {
        if (!this.sprite) return;
        const key = this._overrideKey();
        let scale = this.baseScale;
        let origin = this.configOrigin;

        // Per-animation RELATIVE scale from the scene config — the same
        // `animationScales` mechanism the active character uses (1.0 = base size),
        // compensating for inconsistent frame sizes across a character's poses
        // (e.g. a 638×536 activity frame vs 640×640 walk/idle frames).
        const sceneAnimScale = this.scene.sceneConfig?.animationScales?.[key];
        if (sceneAnimScale !== undefined) {
            scale = this.baseScale * sceneAnimScale;
        }

        if (key && this.animationOverrides && this.animationOverrides[key]) {
            const override = this.animationOverrides[key];
            if (override.scale !== undefined) {
                // Legacy per-NPC ABSOLUTE override (replaces base). Prefer the
                // relative scene animationScales above for new content.
                scale = override.scale;
            }
            if (override.origin !== undefined) {
                origin = { ...origin, ...override.origin };
            }
        }

        const targetScale = scale * this.yScale;
        if (Math.abs(this.sprite.scaleX - targetScale) > 0.001 || Math.abs(this.sprite.scaleY - targetScale) > 0.001) {
            this.sprite.setScale(targetScale);
        }
        if (this.sprite.originX !== origin.x || this.sprite.originY !== origin.y) {
            this.sprite.setOrigin(origin.x, origin.y);
        }
    }

    /**
     * Calculate current bounds of the character in world space.
     */
    getBounds() {
        const key = this._overrideKey();
        let boundsOffset = this.boundsOffset;
        if (key && this.animationOverrides && this.animationOverrides[key]?.boundsOffset) {
            boundsOffset = this.animationOverrides[key].boundsOffset;
        }
        const ox = this.sprite.flipX ? -boundsOffset.x - boundsOffset.w : boundsOffset.x;

        return {
            x: this.sprite.x + ox,
            y: this.sprite.y + boundsOffset.y,
            w: boundsOffset.w,
            h: boundsOffset.h,
        };
    }

    /**
     * Calculate current approach point of the character in world space.
     */
    getApproachPoint() {
        const key = this._overrideKey();
        let approachOffset = this.approachOffset;
        if (key && this.animationOverrides && this.animationOverrides[key]?.approachOffset) {
            approachOffset = this.animationOverrides[key].approachOffset;
        }
        const offsetX = this.sprite.flipX ? -approachOffset.x : approachOffset.x;
        let facing = approachOffset.facing;

        if (this.sprite.flipX) {
            if (facing === "left") facing = "right";
            else if (facing === "right") facing = "left";
        }

        return {
            x: this.sprite.x + offsetX,
            y: this.sprite.y + approachOffset.y,
            facing: facing,
        };
    }

    /**
     * Update the hotspot Zone position/size to track the character sprite.
     */
    update() {
        if (!this.sprite || !this.sprite.active) return;

        if (this.perspective) {
            this.sprite.setDepth(this.sprite.y);
            const next = computePerspectiveScale(this.perspective, this.sprite.y);
            if (Math.abs(next - this.yScale) > 0.001) {
                this.yScale = next;
            }
        }

        this.updateScaleAndOrigin();

        // Eagerly create the wearable manager on first update so persistent
        // wearables (e.g. a companion-held item) auto-reconcile.
        if (!this.__wearables) this._wearables;
        if (this.__wearables) this.__wearables.sync();

        const bounds = this.getBounds();
        const approachPoint = this.getApproachPoint();

        // Update the cached hotspot config
        this.hotspotConfig.bounds = bounds;
        this.hotspotConfig.approachPoint = approachPoint;

        // Sync with HotspotManager zone
        const zone = this.scene.hotspots.zones.get(this.hotspotConfig.id);
        if (zone) {
            zone.x = bounds.x;
            zone.y = bounds.y;
            if (zone.width !== bounds.w || zone.height !== bounds.h) {
                zone.setSize(bounds.w, bounds.h);
                if (zone.input && zone.input.hitArea) {
                    zone.input.hitArea.width = bounds.w;
                    zone.input.hitArea.height = bounds.h;
                }
            }
            // Re-sync config reference
            zone.setData("hotspot", this.hotspotConfig);
        }
    }

    /**
     * Update character position.
     * @param {number} x
     * @param {number} y
     */
    setPosition(x, y) {
        if (this.sprite) {
            this.sprite.x = x;
            this.sprite.y = y;
            this.update();
        }
    }

    /**
     * Update character texture and optionally frame.
     * @param {string} texture
     * @param {string|number} [frame]
     */
    setTexture(texture, frame) {
        if (this.sprite) {
            this.sprite.setTexture(texture, frame ?? 0);
            this.update();
        }
    }

    /**
     * Name of the currently active playable character (engine-canonical key).
     * @returns {string}
     */
    activeCharacterName() {
        return store.getActiveCharacter() ?? "";
    }

    /**
     * Handle arrival at this character's hotspot.
     */
    handleArrived() {
        if (this.onClickOverride) {
            this.onClickOverride(this);
            return;
        }
        // Default greeting. If a behavior is attached it owns the prior routine,
        // so route through interrupt() to face the player, speak, then restore.
        const greet = () => {
            this.facePlayer();
            // Greeting the player aloud → speech bubble.
            if (this.chatter) this.speakRandom(this.chatter, 2800, "speech");
            else {
                const who = this.activeCharacterName();
                this.speak(who ? `Hi ${who}!` : "Hi!", 2800, "speech");
            }
        };
        if (this._behavior) this._behavior.interrupt(greet);
        else greet();
    }

    // ─── Locomotion ─────────────────────────────────────────────────────

    /**
     * Walk to a point with a linear tween, flipping to face travel and looping
     * the walk animation, settling to the still frame on arrival. The minimal
     * Walker primitive the behaviors drive.
     * @param {{x: number, y: number}} target
     * @param {() => void} [onArrive]
     * @param {{ direct?: boolean }} [opts] - `direct`: skip polygon routing and
     *   move straight (for area-rect roamers outside the scene walkable).
     */
    walkTo(target, onArrive, opts = {}) {
        if (!this.sprite) return;
        this.stopWalking();
        const sprite = this.sprite;

        // Route around the walkable polygon's obstacles (e.g. the tree-house
        // body) instead of cutting a straight line through them — same routing
        // the active character's WalkController uses. Falls back to a direct path
        // when the scene has no walkable area, OR when `opts.direct` is set
        // (the caller roams an explicit area rect outside the walkable, e.g. the
        // shore strip — pathfinding would wrongly snap those targets back in).
        const walkable = this.scene.sceneConfig?.walkable;
        let path;
        if (walkable && walkable.length >= 3 && !opts.direct) {
            // If we START outside the polygon (e.g. spawned at an exit/approach
            // point just off the strip), `findPath` can't build a visibility
            // graph from that point and would fall back to a straight line that
            // ignores obstacles. So first hop to the nearest in-polygon point,
            // then route normally from there.
            const start = { x: sprite.x, y: sprite.y };
            const polyStart = pointInPolygon(start, walkable) ? start : snapToPolygon(start, walkable);

            const polyTarget = snapToPolygon(target, walkable);
            path = findPath(polyStart, polyTarget, walkable);
            if (polyStart !== start) path.unshift(polyStart);
            // If the requested target sat outside the polygon, add a final leg
            // out to it so we still reach the actual point (e.g. a door just
            // off the strip), matching WalkController's behavior.
            if (polyTarget.x !== target.x || polyTarget.y !== target.y) path.push(target);
        } else {
            path = [target];
        }

        this._walkPath(path, 0, onArrive);
    }

    /**
     * Walk a precomputed sequence of waypoints, one linear tween per leg,
     * flipping to face each leg's travel and settling to the still frame on the
     * final arrival.
     * @param {{x: number, y: number}[]} path
     * @param {number} index
     * @param {() => void} [onArrive]
     */
    _walkPath(path, index, onArrive) {
        const sprite = this.sprite;
        if (!sprite) return;
        if (index >= path.length) {
            this._walkTween = null;
            sprite.anims.stop();
            sprite.setTexture(this.stillFrame, 0);
            this.update();
            if (onArrive) onArrive();
            return;
        }
        const leg = path[index];
        const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, leg.x, leg.y);
        if (dist < 1) {
            this._walkPath(path, index + 1, onArrive);
            return;
        }

        sprite.setFlipX(!(leg.x > sprite.x));
        if (this.walkAnim && this.scene.anims.exists(this.walkAnim)) {
            sprite.play({ key: this.walkAnim, repeat: -1 });
        } else if (this.walkAnim) {
            // No walk cycle (e.g. a directional still that slides) — show the
            // walk texture's first frame instead of looping.
            sprite.anims.stop();
            sprite.setTexture(this.walkAnim, 0);
        }

        const duration = Math.max(1, (dist / this.walkSpeed) * 1000);
        this._walkTween = this.scene.tweens.add({
            targets: sprite,
            x: leg.x,
            y: leg.y,
            duration,
            ease: "Linear",
            onComplete: () => this._walkPath(path, index + 1, onArrive),
        });
    }

    /** Cancel any in-flight walk tween and settle to the still frame. */
    stopWalking() {
        if (this._walkTween) {
            this._walkTween.stop();
            this._walkTween = null;
        }
        // Guard against a sprite that's already been destroyed during scene
        // shutdown — `this.sprite` is still truthy but `anims` is gone.
        if (this.sprite && this.sprite.active) {
            this.sprite.anims?.stop();
            this.sprite.setTexture(this.stillFrame, 0);
        }
    }

    // ─── Speak / chatter ────────────────────────────────────────────────

    /** Flip to face the active character, settling to the still frame. */
    facePlayer() {
        if (!this.sprite) return;
        this.sprite.anims.stop();
        this.sprite.setTexture(this.stillFrame, 0);
        const player = this.scene.walk?.sprite;
        if (player) this.sprite.setFlipX(!(player.x > this.sprite.x));
    }

    /**
     * Speak a random line from the given list.
     * @param {string[]} lines
     * @param {number} [holdMs]
     * @param {"thought" | "speech"} [variant] - bubble art (default "thought").
     */
    speakRandom(lines, holdMs = 2800, variant = "thought") {
        return this.speak(Phaser.Utils.Array.GetRandom(lines), holdMs, variant);
    }

    // ─── Behavior attach points ─────────────────────────────────────────

    /**
     * Attach a come-and-go wander behavior driven by this NPC's walkTo.
     * @param {import("../movement/behaviors/WanderBehavior.js").WanderOptions} [opts]
     */
    wander(opts = {}) {
        this._behavior?.destroy();
        this._behavior = new WanderBehavior(npcWanderHost(this), opts);
        return this._behavior;
    }

    /**
     * Attach a fixed-waypoint patrol behavior driven by this NPC's walkTo.
     * @param {import("../movement/behaviors/PatrolBehavior.js").PatrolWaypoint[]} waypoints
     * @param {import("../movement/behaviors/PatrolBehavior.js").PatrolOptions} [opts]
     */
    patrol(waypoints, opts = {}) {
        this._behavior?.destroy();
        this._behavior = new PatrolBehavior(this, waypoints, opts);
        return this._behavior;
    }

    /**
     * Attach a follow-the-active-character behavior driven by this NPC's walkTo.
     * @param {import("../movement/behaviors/FollowBehavior.js").FollowOptions} [opts]
     */
    follow(opts = {}) {
        this._behavior?.destroy();
        this._behavior = new FollowBehavior(this, opts);
        return this._behavior;
    }

    /**
     * Show a dialogue bubble with text from this character.
     * @param {string} text
     * @param {number} [holdMs]
     * @param {"thought" | "speech"} [variant] - bubble art (default "thought").
     * @returns {DialogueBubble | null}
     */
    speak(text, holdMs = 2800, variant = "thought") {
        if (!this.sprite) return null;
        this.bubble = DialogueBubble.show(this.scene, {
            character: this.sprite,
            text,
            variant,
            autoDestroyMs: Math.max(800, holdMs - 200),
        });
        return this.bubble;
    }

    // ─── Wearable helpers ────────────────────────────────────────────────

    /**
     * Lazily-created WearableManager for this NPC.
     * @returns {WearableManager}
     */
    get _wearables() {
        if (!this.__wearables) {
            this.__wearables = new WearableManager(this.scene, () => ({
                characterId: this.name,
                // NPCs typically face sideways; infer facing from sprite flip.
                direction: "side",
                facingLeft: this.sprite?.flipX ?? false,
                baseScale: this.baseScale,
                yScale: this.yScale,
                depth: this.sprite?.depth ?? 0,
                sprite: this.sprite,
            }));
        }
        return this.__wearables;
    }

    /**
     * Equip a wearable on this NPC.
     * @param {string} id - wearable registry id
     * @param {{ visible?: boolean }} [opts]
     * @returns {import("../characters/Wearables.js").Wearable | null}
     */
    equipWearable(id, opts = {}) {
        return this._wearables.equip(id, opts);
    }

    /**
     * Unequip a wearable from this NPC.
     * @param {string} id - wearable registry id
     */
    unequipWearable(id) {
        if (this.__wearables) this.__wearables.unequip(id);
    }

    /**
     * Get a named anchor point from an equipped wearable.
     * @param {string} id
     * @param {string} anchorName
     * @returns {{ x: number, y: number } | null}
     */
    getWearableAnchor(id, anchorName) {
        if (!this.__wearables) return null;
        return this.__wearables.getAnchor(id, anchorName);
    }

    /**
     * Destroy the NPC's sprite and hotspot.
     */
    destroy() {
        if (this._behavior) {
            this._behavior.destroy();
            this._behavior = null;
        }

        this.stopWalking();

        if (this.__wearables) {
            this.__wearables.destroy();
            this.__wearables = null;
        }

        // Release this character's presence (once, even if destroy is called
        // both explicitly and again on scene shutdown).
        if (!this._presenceReleased) {
            this._presenceReleased = true;
            const presence = this.scene?._npcPresence;
            if (presence) {
                const next = (presence.get(this.id) ?? 0) - 1;
                if (next > 0) presence.set(this.id, next);
                else presence.delete(this.id);
            }
        }

        if (this.scene) {
            this.scene.events.off("update", this.updateListener);
            this.scene.bus?.off("hotspot:click", this._onSelfClick);
        }
        if (this.scene && this.scene.hotspots) {
            this.scene.hotspots.unregister(this.hotspotConfig.id);
        }
        if (this.sprite) {
            this.sprite.destroy();
        }
    }
}
