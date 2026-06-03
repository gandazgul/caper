import Phaser from "phaser";

/**
 * @typedef {object} FollowOptions
 * @property {number} [lag] - distance (px) the NPC trails the active character before
 *   re-pathing toward them. Default 180.
 * @property {number} [repathMs] - how often to re-check the player's position. Default 700.
 * @property {number} [interruptResumeMs] - ms before following resumes after a click greeting. Default 2600.
 * @property {boolean} [autoStart] - begin following on construction. Default true.
 */

/**
 * Trail the active character at a lag distance — the come-along companion movement
 * shared by quest NPCs and protective companions. Driven by the
 * NPC's `walkTo`; re-targets a point `lag` px behind the player on a timer so
 * the NPC ambles after them without crowding.
 */
export class FollowBehavior {
    /**
     * @param {import("../../cast/NPC.js").NPC} npc
     * @param {FollowOptions} [opts]
     */
    constructor(npc, opts = {}) {
        this.npc = npc;
        /** @type {any} */
        this.scene = npc.scene;
        this.lag = opts.lag ?? 180;
        this.repathMs = opts.repathMs ?? 700;
        this.interruptResumeMs = opts.interruptResumeMs ?? 2600;
        this.paused = false;
        this._holding = false;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.timer = null;
        /** @type {Phaser.Time.TimerEvent | null} */
        this.resumeTimer = null;

        if (opts.autoStart !== false) this.start();
    }

    start() {
        this.clearTimer();
        this.timer = this.scene.time.addEvent({
            delay: this.repathMs,
            loop: true,
            callback: () => this.tick(),
        });
    }

    /**
     * Hold still the moment the player clicks us so the active character can reach a
     * stationary target (a moving NPC drifts away mid-walk). Following resumes
     * on the next tick after a safety timeout. Mirrors the other behaviors.
     */
    holdForGreeting() {
        if (this.paused) return;
        this.clearResumeTimer();
        this.npc.stopWalking();
        this._holding = true;
        this.resumeTimer = this.scene.time.delayedCall(6000, () => {
            this._holding = false;
        });
    }

    /** Re-path toward the player if they've drifted beyond `lag`. */
    tick() {
        if (this.paused || this._holding) return;
        const player = this.scene.walk?.sprite;
        const sprite = this.npc.sprite;
        if (!player || !sprite || !sprite.active) return;

        const dist = Phaser.Math.Distance.Between(sprite.x, sprite.y, player.x, player.y);
        if (dist <= this.lag) return;

        // Aim for a point `lag` px from the player, back along the line to us,
        // so the NPC settles a step behind rather than on top of the character.
        const ang = Phaser.Math.Angle.Between(player.x, player.y, sprite.x, sprite.y);
        const target = {
            x: player.x + Math.cos(ang) * this.lag,
            y: player.y + Math.sin(ang) * this.lag,
        };
        this.npc.walkTo(target);
    }

    /**
     * Stop following, run `action` (face player + speak), then resume after the
     * greeting is read. Mirrors the other behaviors' click-interrupt.
     * @param {() => void} action
     */
    interrupt(action) {
        if (this.paused) {
            action();
            return;
        }
        this.clearResumeTimer();
        this.npc.stopWalking();
        action();
        this.resumeTimer = this.scene.time.delayedCall(this.interruptResumeMs, () => {
            // following just resumes on the next tick; nothing to restore.
        });
    }

    /** Suspend following in place (cutscene takeover). */
    pause() {
        this.paused = true;
        this.clearResumeTimer();
        this.npc.stopWalking();
    }

    /** Resume following after {@link pause}. */
    resume() {
        this.paused = false;
        this._holding = false;
    }

    clearTimer() {
        if (this.timer) {
            this.timer.remove(false);
            this.timer = null;
        }
    }

    clearResumeTimer() {
        if (this.resumeTimer) {
            this.resumeTimer.remove(false);
            this.resumeTimer = null;
        }
    }

    destroy() {
        this.clearTimer();
        this.clearResumeTimer();
    }
}
