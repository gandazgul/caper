import { Cutscene, CutsceneCancelled } from "./Cutscene.js";

/**
 * @typedef {object} CutsceneHooks
 * @property {(cast: string[] | undefined) => void} suspend - pause the listed
 *   cast's ambient behaviors (undefined = all present).
 * @property {(cast: string[] | undefined) => void} resume - restore them.
 * @property {() => void} [lockPlayer] - lock the player walk for the cutscene.
 * @property {() => void} [unlockPlayer]
 * @property {(cs: Cutscene) => any} buildContext - build the `d` actor context
 *   (cast members + player + helpers) bound to this cutscene's cancel token.
 */

/**
 * @typedef {object} CutsceneOpts
 * @property {boolean} [lockPlayer] - lock the player walk while it plays.
 * @property {string[]} [cast] - which ambient behaviors to suspend. Default: all.
 */

/**
 * One-at-a-time cutscene orchestration over a {@link Cutscene} cancel token.
 * Deliberately Phaser-free: the host (CastDirector) injects suspend/resume/lock
 * hooks and the actor-context builder. Guarantees:
 *  - ambient is suspended before the sequence and resumed exactly once after,
 *    even if the sequence throws;
 *  - {@link CutsceneCancelled} is swallowed (a cancelled cutscene unwinds
 *    silently); any other error propagates after cleanup;
 *  - a new cutscene preempts a running one — the preempted cutscene loses
 *    ownership and does NOT resume/unlock on its way out.
 */
export class CutsceneRunner {
    /** @param {CutsceneHooks} hooks */
    constructor(hooks) {
        this.hooks = hooks;
        /** @type {Cutscene | null} */
        this.active = null;
    }

    /**
     * @param {(d: any) => (Promise<void> | void)} fn
     * @param {CutsceneOpts} [opts]
     */
    async run(fn, opts = {}) {
        // Preempt any running cutscene: cancel its token so its awaits reject.
        if (this.active) this.active.cancel();

        const cs = new Cutscene();
        this.active = cs;
        this.hooks.suspend(opts.cast);
        if (opts.lockPlayer) this.hooks.lockPlayer?.();

        try {
            await fn(this.hooks.buildContext(cs));
        } catch (e) {
            if (!(e instanceof CutsceneCancelled)) throw e;
        } finally {
            // Resume/unlock only if we're still the active cutscene. If a
            // preempting cutscene took over, IT owns suspend/lock now and will
            // resume when it ends — we must not double-resume.
            if (this.active === cs) {
                this.active = null;
                if (opts.lockPlayer) this.hooks.unlockPlayer?.();
                this.hooks.resume(opts.cast);
            }
        }
    }

    /** Scene shutdown: cancel whatever's running so its awaits reject. */
    shutdown() {
        if (this.active) this.active.cancel();
    }
}
