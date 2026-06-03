import Phaser from "phaser";

/**
 * @typedef {object} PatrolActivity
 * @property {string} [anim] - looped animation key played while dwelling.
 * @property {string} [texture] - static texture (frame 0) shown while dwelling (when no anim).
 * @property {boolean} [faceRight] - default facing for the activity. Default true.
 * @property {number} [frameRate] - optional playback rate for `anim`.
 */

/**
 * @typedef {Object} PatrolWaypoint
 * @property {number} x
 * @property {number} y
 * @property {string} [activity]
 * @property {boolean} [faceRight]
 */

/**
 * @typedef {object} PatrolOptions
 * @property {Record<string, PatrolActivity>} [activities] - named activities waypoints can reference.
 * @property {[number, number]} [dwellRange] - ms paused at each waypoint. Default [3000, 6000].
 * @property {{x: number, y: number} | null} [doorPoint] - retreat point for {@link PatrolBehavior#retreat}.
 * @property {number} [interruptResumeMs] - ms before patrol resumes after a click greeting. Default 3000.
 * @property {number} [startIndex] - waypoint index to dwell at first. Default random. The NPC should be
 *   spawned at this waypoint so the in-place activity matches its position.
 * @property {"loop" | "random"} [order] - how the next waypoint is chosen after
 *   each dwell: `"loop"` (default) steps through them in declared order, wrapping
 *   around (start is still random); `"random"` jumps to a random other waypoint.
 * @property {boolean} [autoStart] - begin patrolling on construction. Default true.
 */

/**
 * Fixed-waypoint patrol (generalized from garden/rake activity loops). Walks the
 * NPC between waypoints (via `npc.walkTo`), plays a per-waypoint activity anim
 * while it dwells, and supports a door retreat for rain/night hiding. The
 * click-interrupt restores the exact prior state (walking → resume target;
 * dwelling → re-arrive).
 */
export class PatrolBehavior {
    /**
     * @param {import("../NPC.js").NPC} npc
     * @param {PatrolWaypoint[]} waypoints
     * @param {PatrolOptions} [opts]
     */
    constructor(npc, waypoints, opts = {}) {
        this.npc = npc;
        /** @type {any} */
        this.scene = npc.scene;
        this.waypoints = waypoints;
        this.activities = opts.activities ?? {};
        this.dwellRange = opts.dwellRange ?? [3000, 6000];
        this.doorPoint = opts.doorPoint ?? null;
        this.interruptResumeMs = opts.interruptResumeMs ?? 3000;
        this.startIndex = opts.startIndex;
        this.order = opts.order ?? "loop";

        /** @type {"idle" | "walking" | "dwelling" | "greeting" | "hidden"} */
        this.state = "idle";
        this.paused = false;
        this.currentIndex = 0;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.dwellTimer = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.resumeTimer = null;

        if (opts.autoStart !== false) this.start();
    }

    /** Begin patrol, dwelling first at `startIndex` (default a random waypoint). */
    start() {
        if (this.startIndex !== undefined) {
            this.currentIndex = this.startIndex;
        } else {
            this.currentIndex = this.waypoints.length > 0 ? Phaser.Math.Between(0, this.waypoints.length - 1) : 0;
        }
        this.arriveAtWaypoint();
    }

    /** Play the current waypoint's activity, then dwell before moving on. */
    arriveAtWaypoint() {
        if (this.paused || !this.npc.sprite || this.state === "greeting" || this.state === "hidden") return;
        const waypoint = this.waypoints[this.currentIndex];
        const sprite = this.npc.sprite;
        sprite.anims.stop();

        const activity = waypoint?.activity ? this.activities[waypoint.activity] : null;
        if (activity) {
            const faceRight = waypoint?.faceRight ?? activity.faceRight ?? true;
            sprite.setFlipX(!faceRight);
            if (activity.anim && this.scene.anims.exists(activity.anim)) {
                sprite.play({
                    key: activity.anim,
                    repeat: -1,
                    ...(activity.frameRate ? { frameRate: activity.frameRate } : {}),
                });
            } else if (activity.texture) {
                sprite.setTexture(activity.texture, 0);
            }
        } else {
            sprite.setTexture(this.npc.stillFrame, 0);
        }
        this.state = "dwelling";
        this.npc.update();

        const wait = Phaser.Math.Between(this.dwellRange[0], this.dwellRange[1]);
        this.clearDwellTimer();
        this.dwellTimer = this.scene.time.delayedCall(wait, () => this.chooseNextWaypoint());
    }

    chooseNextWaypoint() {
        if (this.paused || !this.npc.sprite || this.state === "greeting" || this.state === "hidden") return;
        if (this.waypoints.length <= 1) {
            this.arriveAtWaypoint();
            return;
        }
        if (this.order === "random") {
            // Jump to a random OTHER waypoint each time.
            let next = this.currentIndex;
            while (next === this.currentIndex) {
                next = Phaser.Math.Between(0, this.waypoints.length - 1);
            }
            this.currentIndex = next;
        } else {
            // "loop": start was random (see `start`), then step through the
            // waypoints in declared order, wrapping around.
            this.currentIndex = (this.currentIndex + 1) % this.waypoints.length;
        }
        this.walkToCurrent();
    }

    /** Walk to the current waypoint, arriving into its activity. */
    walkToCurrent() {
        if (this.paused) return;
        this.state = "walking";
        this.npc.walkTo(this.waypoints[this.currentIndex], () => {
            if (this.state === "walking") this.arriveAtWaypoint();
        });
    }

    /**
     * Hold position when the player clicks us (while walking between waypoints)
     * so the active character can reach a stationary target before the greeting,
     * instead of chasing a moving NPC. Marks `greeting` so the dwell loop won't
     * restart; `interrupt` (on arrival) does the actual greet + resume.
     */
    holdForGreeting() {
        const heldState = this.state;
        if (heldState !== "walking" && heldState !== "dwelling") return;
        this.clearDwellTimer();
        this.clearResumeTimer();
        this.npc.stopWalking();
        // Keep `state` as-is so the on-arrival interrupt still knows whether we
        // were walking (resume target) or dwelling (re-arrive). Safety resume if
        // the player redirects before the character reaches us.
        this.resumeTimer = this.scene.time.delayedCall(6000, () => {
            if (this.state !== heldState) return;
            if (heldState === "walking") this.walkToCurrent();
            else this.arriveAtWaypoint();
        });
    }

    /**
     * Stop patrol, run `action` (face player + speak), then resume the exact
     * prior state once the greeting has been read.
     * @param {() => void} action
     */
    interrupt(action) {
        if (this.state === "hidden") {
            action();
            return;
        }
        const resumeWalking = this.state === "walking";
        this.state = "greeting";
        this.clearDwellTimer();
        this.clearResumeTimer();
        this.npc.stopWalking();
        action();
        this.resumeTimer = this.scene.time.delayedCall(this.interruptResumeMs, () => {
            if (this.state !== "greeting") return;
            this.state = "idle";
            if (resumeWalking) this.walkToCurrent();
            else this.arriveAtWaypoint();
        });
    }

    /**
     * Walk to the door point and hide (used for rain/night retreats). The NPC's
     * hotspot is unregistered so it can't be clicked while away.
     */
    retreat() {
        if (!this.doorPoint || !this.npc.sprite) return;
        this.clearDwellTimer();
        this.clearResumeTimer();
        this.npc.walkTo(this.doorPoint, () => {
            if (!this.npc.sprite) return;
            this.state = "hidden";
            this.npc.sprite.anims.stop();
            this.npc.sprite.setVisible(false);
            this.scene.hotspots.unregister(this.npc.hotspotConfig.id);
        });
    }

    /** Reappear at the door point and resume patrolling. */
    emerge() {
        if (!this.npc.sprite) return;
        this.npc.sprite.setVisible(true);
        if (this.doorPoint) this.npc.setPosition(this.doorPoint.x, this.doorPoint.y);
        if (!this.scene.hotspots.zones.has(this.npc.hotspotConfig.id)) {
            this.scene.hotspots.register(this.npc.hotspotConfig);
        }
        this.state = "idle";
        this.chooseNextWaypoint();
    }

    /**
     * Suspend the patrol in place — the uniform behavior-suspend the
     * CastDirector calls when a cutscene takes the NPC over. Mirrors
     * {@link import("./WanderBehavior.js").WanderBehavior#pause}.
     */
    pause() {
        if (this.paused) return;
        this.paused = true;
        this.clearDwellTimer();
        this.clearResumeTimer();
        this.npc.stopWalking();
    }

    /** Resume patrolling after {@link pause}, re-arriving at the current waypoint. */
    resume() {
        if (!this.paused) return;
        this.paused = false;
        if (this.state === "hidden") return;
        this.state = "idle";
        this.arriveAtWaypoint();
    }

    clearDwellTimer() {
        if (this.dwellTimer) {
            this.dwellTimer.remove(false);
            this.dwellTimer = null;
        }
    }

    clearResumeTimer() {
        if (this.resumeTimer) {
            this.resumeTimer.remove(false);
            this.resumeTimer = null;
        }
    }

    destroy() {
        this.clearDwellTimer();
        this.clearResumeTimer();
    }
}
