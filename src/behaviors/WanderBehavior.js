import Phaser from "phaser";
import { exitApproaches, randomExitSpawn } from "./walker.js";

/**
 * @typedef {object} WanderOptions
 * @property {boolean} [startPresent] - force the initial present/absent roll.
 * @property {{x: number, y: number} | null} [startPos] - when present-on-entry
 *   (not from an exit), stand here instead of a random walkable point.
 * @property {number} [presentChance] - chance of being present on attach. Default 1 (always present).
 * @property {[number, number] | null} [walksRange] - wanders before leaving the scene. `null` = perpetual (never leaves).
 * @property {[number, number]} [wanderDelayRange] - ms paused between wanders. Default [3000, 6000].
 * @property {number} [returnInterval] - ms between return-check rolls while absent. Default 18000.
 * @property {number} [returnChance] - chance to return on each check. Default 0.33.
 * @property {{x: number, y: number, w: number, h: number}} [area] - explicit roam bounds. When set, random
 *   destinations are picked inside this rect (no walkable snap) — use it when the character's roam zone differs
 *   from the player walkable polygon (e.g. a foreground shore strip). Defaults to the scene walkable.
 * @property {boolean} [startAtExit] - spawn from a random scene exit. Default = can-leave.
 * @property {boolean} [walkInOnSpawn] - walk to a random point immediately on spawn (vs pausing first). Default false.
 * @property {string | null} [idleFrame] - texture shown while paused between wanders. Default = host still frame.
 * @property {number} [interruptResumeMs] - ms before the routine resumes after a click greeting. Default 2600.
 * @property {boolean} [autoStart] - run the state machine on construction. Default true.
 */

/**
 * The come-and-go wander machine, generalized out of the six controllers that
 * each hand-rolled it. Drives a {@link import("./walker.js").WanderHost} through
 * `wandering` → `leaving` → `absent`, picking random walkable points, and
 * (optionally) leaving the scene after a few walks before checking back on a
 * timer. Knows nothing about sprites except through the host.
 */
export class WanderBehavior {
    /**
     * @param {import("./walker.js").WanderHost} host
     * @param {WanderOptions} [opts]
     */
    constructor(host, opts = {}) {
        this.host = host;
        /** @type {any} */
        this.scene = host.scene;

        this.startPresent = opts.startPresent;
        this.startPos = opts.startPos ?? null;
        this.presentChance = opts.presentChance ?? 1;
        this.walksRange = opts.walksRange ?? null;
        this.wanderDelayRange = opts.wanderDelayRange ?? [3000, 6000];
        this.returnInterval = opts.returnInterval ?? 18000;
        this.returnChance = opts.returnChance ?? 0.33;
        this.canLeave = this.walksRange !== null;
        this.area = opts.area ?? null;
        this.startAtExit = opts.startAtExit ?? this.canLeave;
        this.walkInOnSpawn = opts.walkInOnSpawn ?? false;
        this.idleFrame = opts.idleFrame ?? null;
        this.interruptResumeMs = opts.interruptResumeMs ?? 2600;

        /** @type {"wandering" | "leaving" | "absent"} */
        this.state = "absent";
        this.walksRemaining = 0;
        this.paused = false;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.wanderTimer = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.returnTimer = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.resumeTimer = null;

        if (opts.autoStart !== false) this.start();
    }

    start() {
        const present = this.startPresent ?? (Math.random() < this.presentChance);

        if (!present) {
            // Absent on entry — hidden until the return timer rolls a walk-in
            // from an exit while the player is here.
            this.host.despawn();
            this.state = "absent";
            this.startReturnCheckTimer();
            return;
        }

        if (this.startAtExit) {
            // Walk in from a door (always-present shelter/quest NPCs). Defer a
            // tick so scene `create()` finishes before the walk-in.
            this.host.despawn();
            this.scene.time.delayedCall(150, () => this.becomePresent(true));
        } else {
            // Already in the room when the player arrives — no walk-in entrance.
            this.becomePresent(false);
        }
    }

    /**
     * Spawn present and kick off the wander loop.
     * @param {boolean} [fromExit] - true: spawn at a scene exit and walk in
     *   ("appearing while the player is here"); false: already standing in the
     *   room at a believable spot. Defaults to this wanderer's `startAtExit`.
     */
    becomePresent(fromExit = this.startAtExit) {
        this.state = "wandering";
        this.walksRemaining = this.walksRange ? Phaser.Math.Between(this.walksRange[0], this.walksRange[1]) : Infinity;

        if (fromExit) {
            const pos = randomExitSpawn(this.scene, this.host.walkable);
            this.host.spawnAt(pos.x, pos.y);
            this.walkToRandomPoint();
            return;
        }

        // In-room: an explicit start position wins; else keep a real on-screen
        // position if we have one (a fixed classroom NPC); else a random point.
        const sprite = this.host.sprite;
        const onscreen = !!sprite && sprite.x > -100 && this.host.isSpawned();
        const pos = this.startPos ?? (onscreen ? { x: sprite.x, y: sprite.y } : this.host.getRandomPoint());
        this.host.spawnAt(pos.x, pos.y);
        if (this.walkInOnSpawn) this.walkToRandomPoint();
        else this.queueNextWander();
    }

    /**
     * Force present and wandering, standing exactly at (x, y) — no entrance
     * walk-in. Used to drop the character at a precise spot (char-switch
     * handoff, forest family-line). Clears any leaving/return state and
     * unpauses so a frozen mini-game wanderer resumes.
     * @param {number} x @param {number} y
     */
    becomePresentAt(x, y) {
        this.clearWanderTimer();
        this.clearReturnTimer();
        this.clearResumeTimer();
        this.paused = false;
        this.state = "wandering";
        this.walksRemaining = this.walksRange ? Phaser.Math.Between(this.walksRange[0], this.walksRange[1]) : Infinity;
        this.host.spawnAt(x, y);
        this.host.stopWalking();
        this.queueNextWander();
    }

    /** Pause facing the room, then amble to the next random point. */
    queueNextWander() {
        this.clearWanderTimer();
        if (this.state !== "wandering" || this.paused) return;
        if (this.idleFrame && this.host.sprite) this.host.sprite.setTexture(this.idleFrame, 0);
        const delay = Phaser.Math.Between(this.wanderDelayRange[0], this.wanderDelayRange[1]);
        this.wanderTimer = this.scene.time.delayedCall(delay, () => {
            if (this.state !== "wandering" || this.paused) return;
            if (this.walksRemaining > 0) {
                this.walksRemaining--;
                this.walkToRandomPoint();
            } else {
                this.state = "leaving";
                this.leaveScene();
            }
        });
    }

    walkToRandomPoint() {
        if (this.state !== "wandering") return;
        // An explicit `area` rect lives outside the scene walkable, so move
        // straight to the target instead of polygon-routing (which would snap
        // it back into the walkable). Pass `direct` for area roamers.
        this.host.walkTo(this.pickPoint(), () => this.queueNextWander(), { direct: !!this.area });
    }

    /**
     * Pick the next destination: a random point inside the explicit `area` rect
     * when configured, otherwise a snapped point in the scene walkable polygon.
     * @returns {{x: number, y: number}}
     */
    pickPoint() {
        if (this.area) {
            return {
                x: Phaser.Math.Between(this.area.x, this.area.x + this.area.w),
                y: Phaser.Math.Between(this.area.y, this.area.y + this.area.h),
            };
        }
        return this.host.getRandomPoint();
    }

    /** Walk to the nearest exit, then despawn and start checking back. */
    leaveScene() {
        const sprite = this.host.sprite;
        if (!sprite) return;

        let targetX = sprite.x < 1376 / 2 ? -150 : 1526;
        let targetY = sprite.y;

        const exits = exitApproaches(this.scene.sceneConfig?.props);
        const closest = this._getClosestExit(exits);
        if (closest) {
            targetX = closest.x;
            targetY = closest.y;
        }

        this.host.walkTo({ x: targetX, y: targetY }, () => {
            this.host.despawn();
            this.state = "absent";
            this.startReturnCheckTimer();
        });
    }

    /** Walk to the nearest inside door to take shelter, then despawn. */
    retreatToShelter() {
        this.paused = true;
        this.clearWanderTimer();
        this.clearResumeTimer();
        this.host.stopWalking();
        this.state = "leaving";

        const sprite = this.host.sprite;
        if (!sprite) return;

        let targetX = sprite.x < 1376 / 2 ? -150 : 1526;
        let targetY = sprite.y;

        let exits = this.getInsideDoorApproaches();
        if (exits.length === 0) {
            exits = exitApproaches(this.scene.sceneConfig?.props);
        }

        const closest = this._getClosestExit(exits);
        if (closest) {
            targetX = closest.x;
            targetY = closest.y;
        }

        this.host.walkTo({ x: targetX, y: targetY }, () => {
            this.host.despawn();
            this.state = "absent";
        });
    }

    /**
     * @param {{x: number, y: number}[]} exits
     * @returns {{x: number, y: number} | null}
     */
    _getClosestExit(exits) {
        const sprite = this.host.sprite;
        if (!sprite || exits.length === 0) return null;

        let closest = exits[0];
        let minDist = Phaser.Math.Distance.Between(sprite.x, sprite.y, closest.x, closest.y);
        for (let i = 1; i < exits.length; i++) {
            const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, exits[i].x, exits[i].y);
            if (dist < minDist) {
                minDist = dist;
                closest = exits[i];
            }
        }
        return closest;
    }

    getInsideDoorApproaches() {
        const propsConfig = this.scene.sceneConfig?.props;
        const out = [];
        for (const p of propsConfig ?? []) {
            const hasExitCursor = p.cursor === "exit" ||
                (p.states ?? []).some((/** @type {import("../PropEngine.js").PropState} */ st) => st.cursor === "exit");
            if (!hasExitCursor) continue;
            const approach = p.approach;
            if (!approach || approach === "in-place") continue;

            let goesInside = false;
            for (const st of (/** @type {import("../PropEngine.js").PropState[]} */ (p.states ?? []))) {
                if (st.onClick) {
                    for (const action of st.onClick) {
                        if (action.goToScene) {
                            const target = action.goToScene.target || action.goToScene;
                            const targetScene = this.scene.scene.get(target);
                            if (targetScene && targetScene.sceneConfig?.indoors) {
                                goesInside = true;
                            }
                        }
                    }
                }
            }
            if (goesInside) {
                out.push(approach);
            }
        }
        return out;
    }

    startReturnCheckTimer() {
        this.clearReturnTimer();
        this.returnTimer = this.scene.time.addEvent({
            delay: this.returnInterval,
            loop: true,
            callback: () => {
                if (this.state !== "absent" || this.paused) return;
                if (Math.random() < this.returnChance) {
                    this.clearReturnTimer();
                    // Returning while the player is here → walk in from an exit.
                    this.becomePresent(true);
                }
            },
        });
    }

    /**
     * Stop and hold the moment the player clicks us, so the active character can
     * reach a stationary target and the greeting lands where it was clicked
     * (otherwise a wandering NPC drifts away while the character walks over, and the
     * greeting fires somewhere off-screen — "no lines"). If the player redirects
     * before arriving, resume wandering after a safety timeout.
     */
    holdForGreeting() {
        if (this.paused || this.state !== "wandering") return;
        this.clearWanderTimer();
        this.clearResumeTimer();
        this.host.stopWalking();
        this.resumeTimer = this.scene.time.delayedCall(6000, () => {
            if (!this.paused && this.state === "wandering") this.queueNextWander();
        });
    }

    /**
     * Stop the routine, run `action` (typically face player + speak), then
     * restore the prior wander state after the greeting has been read. The
     * shared "what was I doing before you clicked me" resume.
     * @param {() => void} action
     */
    interrupt(action) {
        if (this.paused) {
            action();
            return;
        }
        this.clearWanderTimer();
        this.clearResumeTimer();
        this.host.stopWalking();
        const resumeState = this.state;
        action();
        this.resumeTimer = this.scene.time.delayedCall(this.interruptResumeMs, () => {
            if (this.paused) return;
            if (resumeState === "leaving") {
                this.state = "leaving";
                this.leaveScene();
            } else if (this.state !== "absent") {
                this.state = "wandering";
                this.queueNextWander();
            }
        });
    }

    /** Suspend the routine in place (e.g. an external "story time" mode). */
    pause() {
        this.paused = true;
        this.clearWanderTimer();
        this.clearResumeTimer();
        this.host.stopWalking();
    }

    /** Resume wandering after {@link pause}. */
    resume() {
        if (!this.paused) return;
        this.paused = false;
        if (this.state === "absent") this.startReturnCheckTimer();
        else {
            this.state = "wandering";
            this.queueNextWander();
        }
    }

    clearWanderTimer() {
        if (this.wanderTimer) {
            this.wanderTimer.remove(false);
            this.wanderTimer = null;
        }
    }

    clearReturnTimer() {
        if (this.returnTimer) {
            this.returnTimer.remove(false);
            this.returnTimer = null;
        }
    }

    clearResumeTimer() {
        if (this.resumeTimer) {
            this.resumeTimer.remove(false);
            this.resumeTimer = null;
        }
    }

    destroy() {
        this.clearWanderTimer();
        this.clearReturnTimer();
        this.clearResumeTimer();
    }
}
