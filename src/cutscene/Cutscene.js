/**
 * Rejection thrown into a cutscene's awaits when it is cancelled (scene
 * shutdown or preemption). The runner swallows this specific error so a
 * cancelled cutscene unwinds silently; any other error propagates.
 */
export class CutsceneCancelled extends Error {
    constructor(message = "cutscene cancelled") {
        super(message);
        this.name = "CutsceneCancelled";
    }
}

/**
 * The cancellation core of the cutscene runner — deliberately Phaser-free so the
 * contract is unit-testable. A cutscene is a plain async function over awaitable
 * primitives (walkTo/say/play); those primitives are callback-based underneath
 * (a Phaser tween's `onComplete`, a timer). `wait()` bridges callback → promise
 * and registers an `onCancel` so an in-flight tween/timer can be stopped.
 *
 * On `cancel()` every outstanding await rejects with {@link CutsceneCancelled},
 * so the async function unwinds at its current `await` and never runs later
 * steps that would touch an already-destroyed sprite.
 */
export class Cutscene {
    constructor() {
        this._cancelled = false;
        /** @type {Set<{ reject: (e: Error) => void, onCancel?: () => void }>} */
        this._pending = new Set();
    }

    /** @returns {boolean} */
    get cancelled() {
        return this._cancelled;
    }

    /** Bail out of a sequence between awaits (e.g. after a synchronous step). */
    throwIfCancelled() {
        if (this._cancelled) throw new CutsceneCancelled();
    }

    /**
     * Turn a callback-style operation into a cancellable promise.
     * @param {(done: (value?: any) => void) => void} start - kicks off the op;
     *   call `done(value)` when it completes (e.g. from a tween's onComplete).
     * @param {() => void} [onCancel] - stop the underlying tween/timer if the
     *   cutscene is cancelled while this op is still in flight.
     * @returns {Promise<any>}
     */
    wait(start, onCancel) {
        if (this._cancelled) return Promise.reject(new CutsceneCancelled());
        return new Promise((resolve, reject) => {
            const entry = { reject, onCancel };
            this._pending.add(entry);
            const done = (/** @type {any} */ value) => {
                // Ignore a completion that races teardown: a tween whose
                // onComplete fires after cancel() must be a harmless no-op.
                if (this._cancelled || !this._pending.has(entry)) return;
                this._pending.delete(entry);
                resolve(value);
            };
            start(done);
        });
    }

    /**
     * Cancel the cutscene: stop every in-flight op and reject its await. Safe to
     * call more than once.
     */
    cancel() {
        if (this._cancelled) return;
        this._cancelled = true;
        const pending = [...this._pending];
        this._pending.clear();
        for (const entry of pending) {
            try {
                entry.onCancel?.();
            } catch {
                // Cleanup is best-effort — a failing stopWalking on a
                // half-destroyed sprite must not block the rest of teardown.
            }
            entry.reject(new CutsceneCancelled());
        }
    }
}
